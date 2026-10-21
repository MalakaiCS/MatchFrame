// Media library (spec §14–15): uploads, recordings, highlight requests, clips, edits/exports, compilations,
// share links, quotas and retention. Heavy work runs in the media worker through export_jobs.
import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  clips,
  compilations,
  creatives,
  entitlements,
  exportJobs,
  highlightRequests,
  inputs,
  matches,
  matchFacts,
  mediaAssets,
  outputSessions,
  recordingParts,
  recordings,
  recordingSegments,
  shareLinks,
  streamOutputs,
  withTenant,
  type Db,
  type Tx,
} from '@bs/db';
import { ASPECTS, captureTime, HIGHLIGHT_RECIPE, mapWindow, parseHlsPlaylist, type Aspect } from '@bs/domain';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { publicId, randomToken, sha256, safeEqual } from './crypto';
import { AppError, conflict, invalid, notFound } from './errors';
import { nowMs, tx, type Ctx } from './context';
import { enqueueOutbox } from './outbox';
import { keys, type Storage } from './storage';
import type { JobQueues } from './queues';
import type { Readable } from 'node:stream';

// ------------------------------------------------------------------ quotas & usage

export async function storageUsage(t: Tx, organisationId: string) {
  const r = await t.execute<{ bytes: string }>(sql`
    select (
      coalesce((select sum(bytes) from media_assets where organisation_id = ${organisationId} and state <> 'ARCHIVED'), 0) +
      coalesce((select sum(bytes) from asset_derivatives where organisation_id = ${organisationId}), 0) +
      coalesce((select sum(bytes) from recordings where organisation_id = ${organisationId}), 0) +
      coalesce((select sum(bytes) from clips where organisation_id = ${organisationId}), 0) +
      coalesce((select sum(output_bytes) from export_jobs where organisation_id = ${organisationId} and state = 'COMPLETED'), 0)
    )::bigint as bytes`);
  return Number(r.rows[0]?.bytes ?? 0);
}

async function limits(t: Tx, organisationId: string) {
  const [e] = await t.select().from(entitlements).where(eq(entitlements.organisationId, organisationId));
  return { storageBytes: (e?.limits.storageGb ?? 100) * 1024 ** 3, maxUploadBytes: (e?.limits.maxUploadMb ?? 500) * 1024 ** 2 };
}

/** New storage-consuming work is refused at the quota; live matches/recordings are never interrupted. */
async function assertQuota(t: Tx, organisationId: string, addBytes: number) {
  const l = await limits(t, organisationId);
  const used = await storageUsage(t, organisationId);
  if (used + addBytes > l.storageBytes) throw new AppError('STORAGE_QUOTA_REACHED', 409, `Storage quota reached (${(used / 1024 ** 3).toFixed(2)} of ${(l.storageBytes / 1024 ** 3).toFixed(0)} GB). Delete or archive media, or raise the plan limit. Live matches and recordings continue.`);
  return { used, limit: l.storageBytes };
}

export async function usageSummary(ctx: Ctx) {
  assertCan(ctx.actor, 'org.read');
  return tx(ctx, async (t) => {
    const l = await limits(t, ctx.actor.organisationId);
    return { storageBytes: await storageUsage(t, ctx.actor.organisationId), storageLimitBytes: l.storageBytes, maxUploadBytes: l.maxUploadBytes };
  });
}

// ------------------------------------------------------------------ uploads

const ALLOWED_UPLOADS: Record<string, string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  logo: ['image/png', 'image/jpeg', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac'],
  /** a club typeface for the look; stored as uploaded (no re-encoding) and served to the renderer */
  font: ['font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'application/font-woff', 'application/x-font-ttf', 'application/octet-stream'],
};

export const uploadInput = z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(['image', 'logo', 'video', 'audio', 'font']), mime: z.string().max(80), bytes: z.number().int().min(1), tags: z.array(z.string().max(30)).max(20).default([]), ownerTeamId: z.string().uuid().nullable().optional() });

export async function createUpload(ctx: Ctx, input: z.input<typeof uploadInput>) {
  const d = uploadInput.parse(input);
  if (d.ownerTeamId) assertCan(ctx.actor, 'team_assets.write', { teamIds: [d.ownerTeamId], ownerTeamId: d.ownerTeamId });
  else assertCan(ctx.actor, 'media.edit');
  if (!ALLOWED_UPLOADS[d.kind]!.includes(d.mime)) throw invalid(`Unsupported file type for ${d.kind}. Allowed: ${ALLOWED_UPLOADS[d.kind]!.join(', ')}`, [{ field: 'mime', message: 'Unsupported type' }], 'UNSUPPORTED_MEDIA');
  if (!ctx.storage) throw new AppError('STORAGE_UNAVAILABLE', 503, 'Object storage is not configured');
  return tx(ctx, async (t) => {
    const l = await limits(t, ctx.actor.organisationId);
    if (d.bytes > l.maxUploadBytes) throw invalid(`File is larger than the ${Math.round(l.maxUploadBytes / 1024 ** 2)} MB upload limit`, [{ field: 'bytes', message: 'Too large' }], 'UPLOAD_TOO_LARGE');
    await assertQuota(t, ctx.actor.organisationId, d.bytes);
    const id = crypto.randomUUID();
    const key = keys.assetOriginal(ctx.actor.organisationId, id);
    await t.insert(mediaAssets).values({ id, organisationId: ctx.actor.organisationId, kind: d.kind, name: d.name, tags: d.tags, originalKey: key, originalMime: d.mime, expectedBytes: d.bytes, state: 'UPLOADING', ownerTeamId: d.ownerTeamId ?? null, createdBy: ctx.actor.userId });
    const url = await ctx.storage!.presignPut(key, d.mime, d.bytes, 900);
    return { assetId: id, uploadUrl: url, method: 'PUT', headers: { 'content-type': d.mime }, expiresInSeconds: 900 };
  });
}

/** Called after the browser PUT: size is verified at storage, then the worker validates and normalises. */
/**
 * The file of an upload sent through the API, from the app's own origin (browsers cannot reach private or internal
 * storage, and the app's content security policy only allows its own origin). Stored as the asset's original; the
 * caller then completes the upload as with a direct-to-storage PUT.
 */
export async function receiveUpload(ctx: Ctx, assetId: string, body: Readable, contentType: string, contentLength: number) {
  if (!ctx.storage) throw new AppError('STORAGE_UNAVAILABLE', 503, 'Object storage is not configured');
  const a = await tx(ctx, async (t) => {
    const [a] = await t.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.organisationId, ctx.actor.organisationId)));
    if (!a) throw notFound('Asset');
    if (a.ownerTeamId) assertCan(ctx.actor, 'team_assets.write', { teamIds: [a.ownerTeamId], ownerTeamId: a.ownerTeamId });
    else assertCan(ctx.actor, 'media.edit');
    if (a.state !== 'UPLOADING') throw conflict('UPLOAD_CLOSED', 'This upload has already been received');
    if (contentType.split(';')[0]!.trim().toLowerCase() !== a.originalMime) throw invalid('The file type does not match the upload', [{ field: 'content-type', message: `Expected ${a.originalMime}` }], 'UNSUPPORTED_MEDIA');
    if (!a.expectedBytes || contentLength !== a.expectedBytes) throw invalid('The file size does not match the upload', undefined, 'UPLOAD_SIZE_MISMATCH');
    return a;
  });
  await ctx.storage.put(a.originalKey, body, a.originalMime!, contentLength);
  return { ok: true };
}

export async function completeUpload(ctx: Ctx, assetId: string) {
  if (!ctx.storage) throw new AppError('STORAGE_UNAVAILABLE', 503, 'Object storage is not configured');
  const job = await tx(ctx, async (t) => {
    const [a] = await t.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.organisationId, ctx.actor.organisationId)));
    if (!a) throw notFound('Asset');
    if (a.state !== 'UPLOADING') return null;
    const head = await ctx.storage!.head(a.originalKey);
    if (!head) throw invalid('The upload has not arrived in storage yet', undefined, 'UPLOAD_MISSING');
    if (a.expectedBytes && head.contentLength !== a.expectedBytes) {
      await t.update(mediaAssets).set({ state: 'FAILED', error: 'Uploaded size does not match the declared size', updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
      throw invalid('Uploaded size does not match the declared size', undefined, 'UPLOAD_SIZE_MISMATCH');
    }
    await t.update(mediaAssets).set({ state: 'PROCESSING', bytes: head.contentLength, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
    const [j] = await t.insert(exportJobs).values({ organisationId: ctx.actor.organisationId, kind: 'asset_normalise', sourceType: 'asset', sourceId: assetId, jobKey: `asset:${assetId}`, params: { kind: a.kind }, state: 'QUEUED', createdBy: ctx.actor.userId }).onConflictDoNothing().returning();
    await audit(t, ctx.actor, 'asset.upload', 'media_asset', assetId, { after: { name: a.name, bytes: head.contentLength } });
    return j ?? null;
  });
  if (job) await ctx.queues?.addMedia({ kind: 'export', organisationId: ctx.actor.organisationId, exportJobId: job.id }, { jobId: job.id });
  return { assetId, state: 'PROCESSING' };
}

export async function archiveAsset(ctx: Ctx, assetId: string) {
  assertCan(ctx.actor, 'media.edit');
  return tx(ctx, async (t) => {
    const used = await t.select({ id: creatives.id }).from(creatives).where(and(eq(creatives.assetId, assetId), eq(creatives.approvalStatus, 'approved')));
    if (used.length) throw conflict('ASSET_IN_USE', 'This asset is used by an approved sponsor creative; reject the creative first');
    const [a] = await t.update(mediaAssets).set({ state: 'ARCHIVED', updatedAt: new Date() }).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.organisationId, ctx.actor.organisationId))).returning();
    if (!a) throw notFound('Asset');
    await audit(t, ctx.actor, 'asset.archive', 'media_asset', assetId);
    return { ok: true };
  });
}

// ------------------------------------------------------------------ recordings & segments

/** Sync the segment index of a recording part from its HLS playlist (worker or on demand). */
export async function syncSegments(t: Tx, storage: Storage, part: typeof recordingParts.$inferSelect) {
  if (!part.playlistKey) return 0;
  const live = part.playlistKey.replace(/index\.m3u8$/, 'live.m3u8');
  let text: string | null = null;
  for (const k of [part.playlistKey, live]) {
    try {
      text = (await storage.getBuffer(k)).toString('utf8');
      break;
    } catch {
      /* try next */
    }
  }
  if (!text) return 0;
  const { segments } = parseHlsPlaylist(text);
  const dir = part.playlistKey.slice(0, part.playlistKey.lastIndexOf('/') + 1);
  if (!segments.length) return 0;
  await t
    .insert(recordingSegments)
    .values(segments.map((s) => ({ organisationId: part.organisationId, recordingId: part.recordingId, partId: part.id, seq: s.seq, objectKey: dir + s.uri, startAt: new Date(s.startAt), durationMs: s.durationMs, mediaOffsetMs: s.mediaOffsetMs, discontinuity: !!s.discontinuity })))
    .onConflictDoNothing();
  if (!part.captureStartAt) await t.update(recordingParts).set({ captureStartAt: new Date(segments[0]!.startAt) }).where(eq(recordingParts.id, part.id));
  return segments.length;
}

export async function listRecordings(ctx: Ctx, matchId?: string) {
  assertCan(ctx.actor, 'media.read');
  return tx(ctx, async (t) => {
    const rows = await t.select({ r: recordings, m: matches }).from(recordings).innerJoin(matches, eq(matches.id, recordings.matchId)).where(and(eq(recordings.organisationId, ctx.actor.organisationId), matchId ? eq(recordings.matchId, matchId) : undefined)).orderBy(desc(recordings.createdAt)).limit(200);
    return rows.map(({ r, m }) => ({ id: r.id, matchId: r.matchId, matchLabel: m.externalId ?? m.id.slice(0, 8), title: r.title, kind: r.kind, state: r.state, durationMs: r.durationMs, bytes: r.bytes, pinned: r.pinned, retainUntil: r.retainUntil, createdAt: r.createdAt, mediaUrl: r.state === 'READY' || r.state === 'PARTIAL' ? `/api/v1/recordings/${r.id}/media` : null }));
  });
}

// ------------------------------------------------------------------ highlight requests

/** Called for each accepted event fact (worker). One request per (fact, revision, output, recipe). */
export async function requestHighlights(db: Db, organisationId: string, factId: string, queue?: (jobId: string) => Promise<void>) {
  return withTenant(db, { organisationId }, async (t) => {
    const [f] = await t.select().from(matchFacts).where(eq(matchFacts.id, factId));
    if (!f || f.voided || f.category !== 'event') return [];
    const recipe = HIGHLIGHT_RECIPE.events[f.type];
    if (!recipe) return [];
    const outs = await t.select({ o: streamOutputs, i: inputs }).from(streamOutputs).leftJoin(inputs, eq(inputs.id, streamOutputs.inputId)).where(and(eq(streamOutputs.matchId, f.matchId), eq(streamOutputs.record, true)));
    const created = [];
    for (const { o, i } of outs) {
      const target = captureTime(f.occurredAt.getTime(), i?.sourceDelayMs ?? 0, o.calibrationMs + (i?.calibrationMs ?? 0));
      const [r] = await t
        .insert(highlightRequests)
        .values({ organisationId, matchId: f.matchId, factId: f.id, factRevision: f.revision, outputId: o.id, recipeVersion: HIGHLIGHT_RECIPE.version, requestKey: `${f.id}:${f.revision}:${o.id}:${HIGHLIGHT_RECIPE.version}`, label: `${recipe.label}${f.side ? ` (${f.side})` : ''}`, targetCaptureAt: new Date(target), prerollMs: recipe.preroll, postrollMs: recipe.postroll, state: 'WAITING_FOR_MEDIA', mappingConfidence: (i?.calibrationMs ?? 0) || o.calibrationMs ? 'calibrated' : 'uncalibrated' })
        .onConflictDoNothing({ target: highlightRequests.requestKey })
        .returning();
      if (r) created.push(r);
    }
    void queue;
    return created;
  });
}

/** Corrections make derived clips/requests stale (never silently re-cut). */
export async function markFactStale(db: Db, organisationId: string, factId: string, toRevision: number) {
  return withTenant(db, { organisationId }, async (t) => {
    const reqs = await t.update(highlightRequests).set({ state: 'STALE', reason: `Fact corrected (revision ${toRevision})`, updatedAt: new Date() }).where(and(eq(highlightRequests.factId, factId), sql`${highlightRequests.factRevision} < ${toRevision}`)).returning();
    const clipIds = reqs.map((r) => r.clipId).filter((x): x is string => !!x);
    if (clipIds.length) await t.update(clips).set({ stale: true, state: 'STALE', updatedAt: new Date() }).where(inArray(clips.id, clipIds));
    return reqs.length;
  });
}

/**
 * Advance waiting highlight requests: sync segments, map the window, create the clip + extraction job.
 * Live sessions wait for post-roll; finished recordings map once and fail explicitly when they cannot.
 */
export async function processHighlights(db: Db, storage: Storage, queues: Pick<JobQueues, 'addMedia'> | undefined, now = Date.now()) {
  const waiting = await db.select({ id: highlightRequests.id, org: highlightRequests.organisationId }).from(highlightRequests).where(and(eq(highlightRequests.state, 'WAITING_FOR_MEDIA'), lte(highlightRequests.targetCaptureAt, new Date(now)))).limit(50);
  let made = 0;
  for (const w of waiting) {
    const job = await withTenant(db, { organisationId: w.org }, async (t) => {
      const [h] = await t.select().from(highlightRequests).where(and(eq(highlightRequests.id, w.id), eq(highlightRequests.state, 'WAITING_FOR_MEDIA'))).for('update', { skipLocked: true });
      if (!h) return null;
      const [os] = await t
        .select({ os: outputSessions })
        .from(outputSessions)
        .where(and(eq(outputSessions.outputId, h.outputId), sql`${outputSessions.startedAt} <= ${h.targetCaptureAt}`, sql`(${outputSessions.endedAt} is null or ${outputSessions.endedAt} >= ${h.targetCaptureAt})`))
        .orderBy(desc(outputSessions.createdAt))
        .limit(1);
      const fail = (state: string, reason: string) => t.update(highlightRequests).set({ state, reason, attempts: h.attempts + 1, updatedAt: new Date() }).where(eq(highlightRequests.id, h.id));
      if (!os) {
        if (now - h.targetCaptureAt.getTime() > 10 * 60_000) await fail('FAILED', 'No recording of this output covers the moment of the event');
        return null;
      }
      const [rec] = await t.select().from(recordings).where(eq(recordings.outputSessionId, os.os.id));
      if (!rec) return void (await fail('FAILED', 'Recording is disabled for this output'));
      const parts = await t.select().from(recordingParts).where(eq(recordingParts.recordingId, rec.id)).orderBy(asc(recordingParts.partIndex));
      for (const p of parts) await syncSegments(t, storage, p);
      const live = !['STOPPED', 'FAILED'].includes(os.os.state);
      let best: ReturnType<typeof mapWindow> | null = null;
      let bestPart: (typeof parts)[number] | null = null;
      for (const p of parts) {
        const segs = await t.select().from(recordingSegments).where(eq(recordingSegments.partId, p.id)).orderBy(asc(recordingSegments.seq));
        const r = mapWindow(segs.map((s) => ({ seq: s.seq, startAt: s.startAt.getTime(), durationMs: s.durationMs, mediaOffsetMs: s.mediaOffsetMs, discontinuity: s.discontinuity, objectExists: s.objectExists })), h.targetCaptureAt.getTime(), h.prerollMs, h.postrollMs, { live: live && p === parts[parts.length - 1] });
        if (r.ok || !best || (best.ok === false && r.ok === false && r.reason === 'NOT_YET_AVAILABLE')) {
          best = r;
          bestPart = p;
        }
        if (r.ok) break;
      }
      if (!best || !bestPart) return void (live ? null : await fail('FAILED', 'Recording has no media parts'));
      if (!best.ok) {
        if (best.reason === 'NOT_YET_AVAILABLE') return null; // keep waiting for post-roll
        return void (await fail(best.reason === 'GAP' ? 'FAILED' : 'NEEDS_ALIGNMENT', `${best.reason}: ${best.detail}`));
      }
      const [f] = h.factId ? await t.select().from(matchFacts).where(eq(matchFacts.id, h.factId)) : [undefined];
      if (f && (f.voided || f.revision !== h.factRevision)) return void (await fail('STALE', 'The event was corrected before the clip was made'));
      const startSeg = await t.select().from(recordingSegments).where(and(eq(recordingSegments.partId, bestPart.id), eq(recordingSegments.seq, best.fromSeq)));
      const inMs = startSeg[0]!.mediaOffsetMs + best.startOffsetMs;
      const [c] = await t.insert(clips).values({ organisationId: w.org, matchId: h.matchId, recordingId: rec.id, partId: bestPart.id, title: h.label, tags: ['highlight', h.label.toLowerCase()], inMs, outMs: inMs + best.durationMs, markers: [{ atMs: h.targetCaptureAt.getTime() - (startSeg[0]!.startAt.getTime() + best.startOffsetMs), label: h.label }], state: 'PROCESSING', edit: { source: 'highlight', shortened: best.shortened, fromSeq: best.fromSeq, toSeq: best.toSeq, startOffsetMs: best.startOffsetMs, durationMs: best.durationMs } }).returning();
      const [j] = await t.insert(exportJobs).values({ organisationId: w.org, kind: 'clip_extract', sourceType: 'clip', sourceId: c!.id, jobKey: `clip_extract:${c!.id}`, params: { partId: bestPart.id, fromSeq: best.fromSeq, toSeq: best.toSeq, startOffsetMs: best.startOffsetMs, durationMs: best.durationMs }, state: 'QUEUED' }).returning();
      await t.update(highlightRequests).set({ state: 'PROCESSING', clipId: c!.id, shortened: best.shortened, attempts: h.attempts + 1, reason: best.shortened ? 'Shortened to the contiguous media around the event' : null, updatedAt: new Date() }).where(eq(highlightRequests.id, h.id));
      return j!;
    });
    if (job) {
      made++;
      await queues?.addMedia({ kind: 'export', organisationId: w.org, exportJobId: job.id }, { jobId: job.id });
    }
  }
  return made;
}

// ------------------------------------------------------------------ clips, edits, exports

export async function listClips(ctx: Ctx, q: { matchId?: string } = {}) {
  assertCan(ctx.actor, 'media.read');
  return tx(ctx, async (t) => {
    const rows = await t.select().from(clips).where(and(eq(clips.organisationId, ctx.actor.organisationId), q.matchId ? eq(clips.matchId, q.matchId) : undefined)).orderBy(desc(clips.createdAt)).limit(300);
    const reqs = rows.length ? await t.select().from(highlightRequests).where(inArray(highlightRequests.clipId, rows.map((r) => r.id))) : [];
    const jobs = rows.length ? await t.select().from(exportJobs).where(and(eq(exportJobs.sourceType, 'clip'), inArray(exportJobs.sourceId, rows.map((r) => r.id)))).orderBy(desc(exportJobs.createdAt)) : [];
    return rows.map((c) => ({
      ...c,
      objectKey: undefined,
      thumbnailKey: undefined,
      mediaUrl: c.state === 'READY' || c.state === 'STALE' ? `/api/v1/clips/${c.id}/media` : null,
      thumbnailUrl: c.thumbnailKey ? `/api/v1/clips/${c.id}/thumbnail` : null,
      highlight: reqs.find((r) => r.clipId === c.id) ? { state: reqs.find((r) => r.clipId === c.id)!.state, reason: reqs.find((r) => r.clipId === c.id)!.reason, confidence: reqs.find((r) => r.clipId === c.id)!.mappingConfidence } : null,
      exports: jobs.filter((j) => j.sourceId === c.id && j.kind === 'clip_export').map((j) => ({ id: j.id, state: j.state, progress: j.progress, error: j.error, params: j.params, downloadUrl: j.state === 'COMPLETED' ? `/api/v1/exports/${j.id}/download` : null })),
    }));
  });
}

export async function listHighlightRequests(ctx: Ctx, matchId: string) {
  assertCan(ctx.actor, 'media.read');
  return tx(ctx, (t) => t.select().from(highlightRequests).where(and(eq(highlightRequests.organisationId, ctx.actor.organisationId), eq(highlightRequests.matchId, matchId))).orderBy(desc(highlightRequests.createdAt)));
}

export const exportInput = z.object({
  aspect: z.enum(Object.keys(ASPECTS) as [Aspect, ...Aspect[]]).default('16:9'),
  trimInMs: z.number().int().min(0).default(0),
  trimOutMs: z.number().int().min(1).nullable().optional(),
  focusX: z.number().min(0).max(1).default(0.5),
  introCreativeId: z.string().uuid().nullable().optional(),
  outroCreativeId: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(120).optional(),
});

async function queueJob(ctx: Ctx, t: Tx, values: typeof exportJobs.$inferInsert) {
  const [j] = await t.insert(exportJobs).values(values).returning();
  return j!;
}

export async function exportClip(ctx: Ctx, clipId: string, input: z.input<typeof exportInput>) {
  assertCan(ctx.actor, 'media.edit');
  const d = exportInput.parse(input);
  const job = await tx(ctx, async (t) => {
    const [c] = await t.select().from(clips).where(and(eq(clips.id, clipId), eq(clips.organisationId, ctx.actor.organisationId)));
    if (!c) throw notFound('Clip');
    if (!['READY', 'STALE'].includes(c.state)) throw conflict('CLIP_NOT_READY', 'The clip is still processing');
    const dur = c.outMs - c.inMs;
    if (d.trimOutMs != null && (d.trimOutMs <= d.trimInMs || d.trimOutMs > dur)) throw invalid('Trim out must be after trim in and within the clip', [{ field: 'trimOutMs', message: 'Out of range' }]);
    for (const id of [d.introCreativeId, d.outroCreativeId].filter(Boolean) as string[]) {
      const [cr] = await t.select({ c: creatives, a: mediaAssets }).from(creatives).innerJoin(mediaAssets, eq(mediaAssets.id, creatives.assetId)).where(and(eq(creatives.id, id), eq(creatives.organisationId, ctx.actor.organisationId)));
      if (!cr || cr.c.approvalStatus !== 'approved' || cr.a.state !== 'READY') throw invalid('Intro/outro creatives must be approved and processed', [{ field: 'introCreativeId', message: 'Not approved' }]);
    }
    await assertQuota(t, ctx.actor.organisationId, Math.max(5, dur / 1000) * 1_000_000);
    const j = await queueJob(ctx, t, { organisationId: ctx.actor.organisationId, kind: 'clip_export', sourceType: 'clip', sourceId: clipId, jobKey: `clip_export:${clipId}:${crypto.randomUUID()}`, params: { ...d, trimOutMs: d.trimOutMs ?? dur }, state: 'QUEUED', createdBy: ctx.actor.userId });
    await audit(t, ctx.actor, 'clip.export', 'clip', clipId, { after: { aspect: d.aspect, intro: !!d.introCreativeId, outro: !!d.outroCreativeId } });
    return j;
  });
  await ctx.queues?.addMedia({ kind: 'export', organisationId: ctx.actor.organisationId, exportJobId: job.id }, { jobId: job.id });
  return job;
}

export const manualClipInput = z.object({ recordingId: z.string().uuid(), title: z.string().trim().min(1).max(120), inMs: z.number().int().min(0), outMs: z.number().int().min(1) });

/** Operator-defined clip from a finished recording's media timeline (the editor's "Make clip"). */
export async function createManualClip(ctx: Ctx, input: z.input<typeof manualClipInput>) {
  assertCan(ctx.actor, 'media.edit');
  const d = manualClipInput.parse(input);
  if (d.outMs - d.inMs < 1000 || d.outMs - d.inMs > 10 * 60_000) throw invalid('Clips must be between 1 second and 10 minutes', [{ field: 'outMs', message: 'Out of range' }]);
  const job = await tx(ctx, async (t) => {
    const [r] = await t.select().from(recordings).where(and(eq(recordings.id, d.recordingId), eq(recordings.organisationId, ctx.actor.organisationId)));
    if (!r) throw notFound('Recording');
    if (!['READY', 'PARTIAL'].includes(r.state) || !r.mp4Key) throw conflict('RECORDING_NOT_READY', 'The recording is not finalised yet');
    if (r.durationMs && d.outMs > r.durationMs) throw invalid('Out point is beyond the end of the recording', [{ field: 'outMs', message: 'Beyond end' }]);
    const [part] = await t.select().from(recordingParts).where(and(eq(recordingParts.recordingId, r.id), eq(recordingParts.partIndex, 0)));
    const [c] = await t.insert(clips).values({ organisationId: ctx.actor.organisationId, matchId: r.matchId, recordingId: r.id, partId: part?.id ?? null, title: d.title, inMs: d.inMs, outMs: d.outMs, state: 'PROCESSING', edit: { source: 'manual' }, createdBy: ctx.actor.userId }).returning();
    return queueJob(ctx, t, { organisationId: ctx.actor.organisationId, kind: 'clip_extract', sourceType: 'clip', sourceId: c!.id, jobKey: `clip_extract:${c!.id}`, params: { fromRecordingMp4: true }, state: 'QUEUED', createdBy: ctx.actor.userId });
  });
  await ctx.queues?.addMedia({ kind: 'export', organisationId: ctx.actor.organisationId, exportJobId: job.id }, { jobId: job.id });
  return { clipId: job.sourceId, jobId: job.id };
}

export const compilationInput = z.object({ title: z.string().trim().min(1).max(120), clipIds: z.array(z.string().uuid()).min(2).max(30), aspect: z.enum(['16:9', '9:16', '1:1']).default('16:9') });

export async function createCompilation(ctx: Ctx, input: z.input<typeof compilationInput>) {
  assertCan(ctx.actor, 'media.edit');
  const d = compilationInput.parse(input);
  const job = await tx(ctx, async (t) => {
    const cs = await t.select().from(clips).where(and(inArray(clips.id, d.clipIds), eq(clips.organisationId, ctx.actor.organisationId)));
    if (cs.length !== new Set(d.clipIds).size) throw notFound('Clip');
    if (cs.some((c) => c.state !== 'READY')) throw conflict('CLIP_NOT_READY', 'All clips must be ready (stale clips need review first)');
    await assertQuota(t, ctx.actor.organisationId, cs.reduce((n, c) => n + c.bytes, 0));
    const [comp] = await t.insert(compilations).values({ organisationId: ctx.actor.organisationId, title: d.title, clipIds: d.clipIds, options: { aspect: d.aspect }, createdBy: ctx.actor.userId }).returning();
    return queueJob(ctx, t, { organisationId: ctx.actor.organisationId, kind: 'compilation', sourceType: 'compilation', sourceId: comp!.id, jobKey: `compilation:${comp!.id}`, params: { clipIds: d.clipIds, aspect: d.aspect, title: d.title }, state: 'QUEUED', createdBy: ctx.actor.userId });
  });
  await ctx.queues?.addMedia({ kind: 'export', organisationId: ctx.actor.organisationId, exportJobId: job.id }, { jobId: job.id });
  return job;
}

export async function listJobs(ctx: Ctx, q: { kind?: string } = {}) {
  assertCan(ctx.actor, 'media.read');
  return tx(ctx, async (t) => {
    const rows = await t.select().from(exportJobs).where(and(eq(exportJobs.organisationId, ctx.actor.organisationId), q.kind ? eq(exportJobs.kind, q.kind) : undefined)).orderBy(desc(exportJobs.createdAt)).limit(100);
    return rows.map((j) => ({ ...j, outputKey: undefined, workerPid: undefined, downloadUrl: j.state === 'COMPLETED' && j.outputKey ? `/api/v1/exports/${j.id}/download` : null }));
  });
}

export async function cancelJob(ctx: Ctx, jobId: string) {
  assertCan(ctx.actor, 'media.edit');
  return tx(ctx, async (t) => {
    const [j] = await t.update(exportJobs).set({ cancelRequested: true, updatedAt: new Date() }).where(and(eq(exportJobs.id, jobId), eq(exportJobs.organisationId, ctx.actor.organisationId), inArray(exportJobs.state, ['QUEUED', 'RUNNING']))).returning();
    if (!j) throw conflict('JOB_NOT_CANCELLABLE', 'Only queued or running jobs can be cancelled');
    if (j.state === 'QUEUED') await t.update(exportJobs).set({ state: 'CANCELLED', finishedAt: new Date() }).where(eq(exportJobs.id, jobId));
    await audit(t, ctx.actor, 'export.cancel', 'export_job', jobId);
    return { cancelRequested: true };
  });
}

export async function retryJob(ctx: Ctx, jobId: string) {
  assertCan(ctx.actor, 'media.edit');
  const j = await tx(ctx, async (t) => {
    const [r] = await t.update(exportJobs).set({ state: 'QUEUED', cancelRequested: false, error: null, progress: 0, updatedAt: new Date() }).where(and(eq(exportJobs.id, jobId), eq(exportJobs.organisationId, ctx.actor.organisationId), inArray(exportJobs.state, ['FAILED', 'CANCELLED']))).returning();
    if (!r) throw conflict('JOB_NOT_RETRYABLE', 'Only failed or cancelled jobs can be retried');
    return r;
  });
  await ctx.queues?.addMedia({ kind: 'export', organisationId: ctx.actor.organisationId, exportJobId: j.id }, { jobId: `${j.id}:${j.attempts + 1}` });
  return { state: 'QUEUED' };
}

// ------------------------------------------------------------------ authorised media access

export type MediaRef = { key: string; mime: string; filename: string };

export async function mediaFor(ctx: Ctx, type: 'clip' | 'recording' | 'export' | 'clip_thumb', id: string): Promise<MediaRef> {
  assertCan(ctx.actor, 'media.read');
  return tx(ctx, (t) => resolveMedia(t, ctx.actor.organisationId, type, id));
}

async function resolveMedia(t: Tx, organisationId: string, type: 'clip' | 'recording' | 'export' | 'clip_thumb', id: string): Promise<MediaRef> {
  if (type === 'clip' || type === 'clip_thumb') {
    const [c] = await t.select().from(clips).where(and(eq(clips.id, id), eq(clips.organisationId, organisationId)));
    const key = type === 'clip' ? c?.objectKey : c?.thumbnailKey;
    if (!c || !key) throw notFound('Clip');
    return { key, mime: type === 'clip' ? 'video/mp4' : 'image/jpeg', filename: `${c.title.replace(/[^\w.-]+/g, '_')}.${type === 'clip' ? 'mp4' : 'jpg'}` };
  }
  if (type === 'recording') {
    const [r] = await t.select().from(recordings).where(and(eq(recordings.id, id), eq(recordings.organisationId, organisationId)));
    if (!r?.mp4Key) throw notFound('Recording');
    return { key: r.mp4Key, mime: 'video/mp4', filename: `${r.title.replace(/[^\w.-]+/g, '_')}.mp4` };
  }
  const [j] = await t.select().from(exportJobs).where(and(eq(exportJobs.id, id), eq(exportJobs.organisationId, organisationId), eq(exportJobs.state, 'COMPLETED')));
  if (!j?.outputKey) throw notFound('Export');
  return { key: j.outputKey, mime: 'video/mp4', filename: `${String((j.params as { title?: string }).title ?? j.kind).replace(/[^\w.-]+/g, '_')}.mp4` };
}

// ------------------------------------------------------------------ shares

export const shareInput = z.object({ resourceType: z.enum(['clip', 'recording', 'export']), resourceId: z.string().uuid(), expiresInHours: z.number().int().min(1).max(24 * 90).nullable().default(24 * 7) });

export async function createShare(ctx: Ctx, input: z.input<typeof shareInput>) {
  assertCan(ctx.actor, 'media.edit');
  const d = shareInput.parse(input);
  return tx(ctx, async (t) => {
    await resolveMedia(t, ctx.actor.organisationId, d.resourceType, d.resourceId);
    const token = randomToken(24);
    const pid = publicId('sh');
    const [s] = await t.insert(shareLinks).values({ organisationId: ctx.actor.organisationId, resourceType: d.resourceType, resourceId: d.resourceId, publicId: pid, tokenHash: sha256(token), expiresAt: d.expiresInHours ? new Date(nowMs(ctx) + d.expiresInHours * 3600_000) : null, createdBy: ctx.actor.userId }).returning();
    await audit(t, ctx.actor, 'share.create', d.resourceType, d.resourceId, { after: { shareId: s!.id, expiresAt: s!.expiresAt } });
    // the token is shown once; only its hash is stored
    return { id: s!.id, publicId: pid, expiresAt: s!.expiresAt, watchUrl: `${ctx.config.PUBLIC_WEB_URL}/watch/${pid}?t=${token}`, embedUrl: `${ctx.config.PUBLIC_WEB_URL}/embed/${pid}?t=${token}` };
  });
}

export async function listShares(ctx: Ctx, resourceId?: string) {
  assertCan(ctx.actor, 'media.read');
  return tx(ctx, (t) => t.select({ id: shareLinks.id, resourceType: shareLinks.resourceType, resourceId: shareLinks.resourceId, publicId: shareLinks.publicId, expiresAt: shareLinks.expiresAt, revokedAt: shareLinks.revokedAt, accessCount: shareLinks.accessCount, createdAt: shareLinks.createdAt }).from(shareLinks).where(and(eq(shareLinks.organisationId, ctx.actor.organisationId), resourceId ? eq(shareLinks.resourceId, resourceId) : undefined)).orderBy(desc(shareLinks.createdAt)));
}

export async function revokeShare(ctx: Ctx, shareId: string) {
  assertCan(ctx.actor, 'media.edit');
  return tx(ctx, async (t) => {
    const [s] = await t.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.id, shareId), eq(shareLinks.organisationId, ctx.actor.organisationId), isNull(shareLinks.revokedAt))).returning();
    if (!s) throw notFound('Share link');
    await audit(t, ctx.actor, 'share.revoke', s.resourceType, s.resourceId, { after: { shareId } });
    return { revoked: true };
  });
}

/** Every share request (page, metadata, media bytes) re-validates token, expiry and revocation. */
export async function resolveShare(db: Db, pid: string, token: string, opts: { countAccess?: boolean; media?: 'video' | 'thumbnail' } = {}) {
  const r = await db.execute<{ organisation_id: string; id: string; resource_type: string; resource_id: string; token_hash: string; expires_at: Date | null; revoked_at: Date | null }>(sql`select * from resolve_share_link(${pid})`);
  const s = r.rows[0];
  if (!s || !token || !safeEqual(sha256(token), s.token_hash)) throw new AppError('SHARE_INVALID', 404, 'This link is not valid');
  if (s.revoked_at) throw new AppError('SHARE_REVOKED', 410, 'This link has been revoked');
  if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) throw new AppError('SHARE_EXPIRED', 410, 'This link has expired');
  return withTenant(db, { organisationId: s.organisation_id }, async (t) => {
    if (opts.countAccess) await t.update(shareLinks).set({ accessCount: sql`${shareLinks.accessCount} + 1` }).where(eq(shareLinks.id, s.id));
    const type = (opts.media === 'thumbnail' ? 'clip_thumb' : s.resource_type) as 'clip' | 'recording' | 'export' | 'clip_thumb';
    const m = await resolveMedia(t, s.organisation_id, type, s.resource_id);
    let title = m.filename.replace(/\.\w+$/, '').replace(/_/g, ' ');
    if (s.resource_type === 'clip') {
      const [c] = await t.select({ title: clips.title }).from(clips).where(eq(clips.id, s.resource_id));
      title = c?.title ?? title;
    }
    return { media: m, title, resourceType: s.resource_type, expiresAt: s.expires_at };
  });
}

// ------------------------------------------------------------------ retention

/**
 * Delete expired, unpinned media objects that nothing references. Recordings of matches with an active
 * session, clips inside running compilations and creatives' assets are kept.
 */
export async function runRetention(db: Db, storage: Storage, now = Date.now()) {
  const expired = await db.select().from(recordings).where(and(eq(recordings.pinned, false), lte(recordings.retainUntil, new Date(now)), inArray(recordings.state, ['READY', 'PARTIAL', 'FAILED'])));
  let removed = 0;
  for (const r of expired) {
    const inUse = await db.execute(sql`select 1 from broadcast_sessions where match_id = ${r.matchId} and state not in ('STOPPED','FAILED') limit 1`);
    if (inUse.rows.length) continue;
    for (const o of await storage.list(r.storagePrefix)) await storage.delete(o.key);
    const parts = await db.select().from(recordingParts).where(eq(recordingParts.recordingId, r.id));
    for (const p of parts) if (p.playlistKey) for (const o of await storage.list(p.playlistKey.slice(0, p.playlistKey.lastIndexOf('/') + 1))) await storage.delete(o.key);
    await db.update(recordingSegments).set({ objectExists: false }).where(eq(recordingSegments.recordingId, r.id));
    await db.update(recordings).set({ state: 'DELETED', mp4Key: null, bytes: 0, updatedAt: new Date() }).where(eq(recordings.id, r.id));
    await enqueueOutboxRaw(db, r.organisationId, r.id);
    removed++;
  }
  const oldExports = await db.select().from(exportJobs).where(and(eq(exportJobs.state, 'COMPLETED'), lte(exportJobs.expiresAt, new Date(now))));
  for (const j of oldExports) {
    if (j.outputKey) await storage.delete(j.outputKey).catch(() => undefined);
    await db.update(exportJobs).set({ state: 'EXPIRED', outputKey: null, outputBytes: 0, updatedAt: new Date() }).where(eq(exportJobs.id, j.id));
    removed++;
  }
  return removed;
}

async function enqueueOutboxRaw(db: Db, organisationId: string, recordingId: string) {
  await db.transaction((t) => enqueueOutbox(t, { organisationId, topic: 'recording.updated', aggregateType: 'recording', aggregateId: recordingId, payload: { recordingId, state: 'DELETED', reason: 'retention' } }));
}

export async function setPinned(ctx: Ctx, type: 'recording', id: string, pinned: boolean) {
  assertCan(ctx.actor, 'media.edit');
  return tx(ctx, async (t) => {
    const [r] = await t.update(recordings).set({ pinned, updatedAt: new Date() }).where(and(eq(recordings.id, id), eq(recordings.organisationId, ctx.actor.organisationId))).returning();
    if (!r) throw notFound('Recording');
    await audit(t, ctx.actor, pinned ? 'recording.pin' : 'recording.unpin', type, id);
    return { pinned };
  });
}

/** Authorised preview (thumbnail or broadcast derivative) of a library asset. */
export async function assetPreview(ctx: Ctx, assetId: string, purpose: 'thumbnail' | 'broadcast' = 'thumbnail'): Promise<MediaRef> {
  assertCan(ctx.actor, 'org.read');
  return tx(ctx, async (t) => {
    const rows = await t.execute<{ object_key: string; mime: string; name: string }>(sql`select d.object_key, d.mime, a.name from asset_derivatives d join media_assets a on a.id = d.asset_id where d.asset_id = ${assetId} and a.organisation_id = ${ctx.actor.organisationId} and d.purpose = ${purpose}`);
    const r = rows.rows[0];
    if (!r) throw notFound('Preview');
    return { key: r.object_key, mime: r.mime, filename: r.name };
  });
}
