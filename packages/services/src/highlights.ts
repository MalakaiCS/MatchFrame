// Match highlights (Match → Highlights). A video of the whole match is uploaded in parts through the API (S3 multipart:
// a full match is gigabytes) and kept as uploaded; the media worker reads its length and makes a small copy for the
// browser. The operator marks where each period kicked off in it. A package is planned from the scorer's log
// (`planHighlights`, the same plan in the browser and here); the browser draws the graphics over it and sends them,
// and the media worker cuts the clips, slows the replays, joins them and lays the graphics on top.
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { exportJobs, matches, matchFacts, matchVideos, type Tx } from '@bs/db';
import { getAdapter, highlightOptionsDefaults, planHighlights, type HighlightOptions, type HighlightPlan, type StoredFact } from '@bs/domain';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { AppError, conflict, invalid, notFound } from './errors';
import { tx, type Ctx } from './context';
import { assertQuota, type MediaRef } from './library';
import { factRowToStored } from './scoring';
import { keys } from './storage';

/** The video files a match can be uploaded as (the container is checked by the media worker). */
export const MATCH_VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/webm': 'webm' };
const EXT_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm' };
export const MATCH_VIDEO_MAX_BYTES = 40 * 1024 ** 3;
const MiB = 1024 ** 2;
/** S3 parts are at least 5 MB (all but the last) and at most 10 000 */
export const partSizeFor = (bytes: number) => Math.max(16 * MiB, Math.ceil(bytes / 9_000 / MiB) * MiB);
/** a package stays a highlights package */
export const HIGHLIGHTS_MAX_MS = 20 * 60_000;
/** the graphics the browser drew for one package */
export const HIGHLIGHT_GRAPHICS_MAX_BYTES = 800 * MiB;

export const matchVideoInput = z.object({ name: z.string().trim().min(1).max(160), mime: z.string().max(80).default(''), bytes: z.number().int().min(1).max(MATCH_VIDEO_MAX_BYTES) });

/** The file type from the browser, or from the name when the browser does not know it (MKV often comes without). */
export function matchVideoMime(name: string, mime: string): string | null {
  const m = mime.split(';')[0]!.trim().toLowerCase();
  if (MATCH_VIDEO_TYPES[m]) return m;
  if (m && m !== 'application/octet-stream' && !m.startsWith('video/')) return null;
  return EXT_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

async function matchFor(t: Tx, ctx: Ctx, matchId: string, perm: 'media.edit' | 'media.read') {
  const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
  if (!m) throw notFound('Match');
  assertCan(ctx.actor, perm, { matchId, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
  return m;
}

async function videoFor(t: Tx, ctx: Ctx, videoId: string, perm: 'media.edit' | 'media.read') {
  const [v] = await t.select().from(matchVideos).where(and(eq(matchVideos.id, videoId), eq(matchVideos.organisationId, ctx.actor.organisationId)));
  if (!v) throw notFound('Match video');
  const m = await matchFor(t, ctx, v.matchId, perm);
  return { v, m };
}

const publicVideo = (v: typeof matchVideos.$inferSelect) => ({
  id: v.id,
  matchId: v.matchId,
  name: v.name,
  mime: v.mime,
  bytes: v.bytes,
  state: v.state,
  error: v.error,
  durationMs: v.durationMs,
  width: v.width,
  height: v.height,
  fps: v.fps,
  sync: v.sync,
  partSize: v.partSize,
  parts: v.parts.length,
  /** the parts still to send (an upload that stopped carries on from here) */
  missingParts: v.state === 'UPLOADING' ? v.parts.flatMap((p, i) => (p ? [] : [i + 1])) : [],
  previewUrl: v.proxyKey ? `/api/v1/match-videos/${v.id}/preview` : null,
  thumbnailUrl: v.thumbnailKey ? `/api/v1/match-videos/${v.id}/thumbnail` : null,
  createdAt: v.createdAt,
});

// ------------------------------------------------------------------ match videos

/** `opts.partSize` (at least 5 MB, the S3 minimum) is for tests, which send a small file in several parts. */
export async function createMatchVideo(ctx: Ctx, matchId: string, input: z.input<typeof matchVideoInput>, opts: { partSize?: number } = {}) {
  if (!ctx.storage) throw new AppError('STORAGE_UNAVAILABLE', 503, 'Object storage is not configured: match videos need it');
  const d = matchVideoInput.parse(input);
  const mime = matchVideoMime(d.name, d.mime);
  if (!mime) throw invalid('Upload the match as an MP4, MOV, MKV or WebM video', [{ field: 'mime', message: 'Unsupported type' }], 'UNSUPPORTED_MEDIA');
  const id = crypto.randomUUID();
  const key = keys.matchVideo(ctx.actor.organisationId, id);
  const partSize = opts.partSize ? Math.max(5 * MiB, opts.partSize) : partSizeFor(d.bytes);
  return tx(ctx, async (t) => {
    await matchFor(t, ctx, matchId, 'media.edit');
    await assertQuota(t, ctx.actor.organisationId, d.bytes);
    const uploadId = await ctx.storage!.createMultipart(key, mime);
    const [v] = await t
      .insert(matchVideos)
      .values({ id, organisationId: ctx.actor.organisationId, matchId, name: d.name, objectKey: key, mime, bytes: d.bytes, uploadId, parts: Array.from({ length: Math.ceil(d.bytes / partSize) }, () => null), partSize, state: 'UPLOADING', createdBy: ctx.actor.userId })
      .returning();
    await audit(t, ctx.actor, 'match_video.upload', 'match_video', id, { after: { matchId, name: d.name, bytes: d.bytes } });
    return publicVideo(v!);
  });
}

/** One part of an upload (part numbers from 1); a part sent twice replaces the first. */
export async function uploadMatchVideoPart(ctx: Ctx, videoId: string, partNumber: number, body: Readable, contentLength: number) {
  if (!ctx.storage) throw new AppError('STORAGE_UNAVAILABLE', 503, 'Object storage is not configured');
  const v = await tx(ctx, async (t) => {
    const { v } = await videoFor(t, ctx, videoId, 'media.edit');
    if (v.state !== 'UPLOADING' || !v.uploadId) throw conflict('UPLOAD_CLOSED', 'This video has already been received');
    const n = v.parts.length;
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > n) throw invalid(`Part numbers run from 1 to ${n}`, undefined, 'BAD_PART');
    const expected = partNumber < n ? v.partSize : v.bytes - v.partSize * (n - 1);
    if (contentLength !== expected) throw invalid(`Part ${partNumber} must be ${expected} bytes`, undefined, 'UPLOAD_SIZE_MISMATCH');
    return v;
  });
  const etag = await ctx.storage.uploadPart(v.objectKey, v.uploadId!, partNumber, body, contentLength);
  return tx(ctx, async (t) => {
    const [r] = await t
      .update(matchVideos)
      .set({ parts: sql`jsonb_set(${matchVideos.parts}, ${`{${partNumber - 1}}`}::text[], to_jsonb(${etag}::text))`, updatedAt: new Date() })
      .where(and(eq(matchVideos.id, videoId), eq(matchVideos.organisationId, ctx.actor.organisationId), eq(matchVideos.state, 'UPLOADING')))
      .returning();
    if (!r) throw conflict('UPLOAD_CLOSED', 'This video has already been received');
    return { partNumber, received: r.parts.filter(Boolean).length, parts: r.parts.length };
  });
}

/** Every part is in: the file is put together, then the media worker reads it and makes the preview. */
export async function completeMatchVideo(ctx: Ctx, videoId: string) {
  if (!ctx.storage) throw new AppError('STORAGE_UNAVAILABLE', 503, 'Object storage is not configured');
  const v = await tx(ctx, async (t) => (await videoFor(t, ctx, videoId, 'media.edit')).v);
  if (v.state !== 'UPLOADING' || !v.uploadId) return publicVideo(v);
  const missing = v.parts.flatMap((p, i) => (p ? [] : [i + 1]));
  if (missing.length) throw invalid(`${missing.length} part(s) still to send`, undefined, 'UPLOAD_INCOMPLETE');
  await ctx.storage.completeMultipart(v.objectKey, v.uploadId, v.parts as string[]);
  const head = await ctx.storage.head(v.objectKey);
  const job = await tx(ctx, async (t) => {
    if (!head || head.contentLength !== v.bytes) {
      await t.update(matchVideos).set({ state: 'FAILED', error: 'The file put together is not the size that was sent', uploadId: null, updatedAt: new Date() }).where(eq(matchVideos.id, v.id));
      return null;
    }
    await t.update(matchVideos).set({ state: 'PROCESSING', uploadId: null, updatedAt: new Date() }).where(eq(matchVideos.id, v.id));
    const [j] = await t.insert(exportJobs).values({ organisationId: v.organisationId, kind: 'match_video_probe', sourceType: 'match_video', sourceId: v.id, jobKey: `match_video:${v.id}`, params: {}, state: 'QUEUED', createdBy: ctx.actor.userId }).onConflictDoNothing().returning();
    return j ?? null;
  });
  if (!job && (!head || head.contentLength !== v.bytes)) throw invalid('The upload did not arrive complete. Upload the video again.', undefined, 'UPLOAD_SIZE_MISMATCH');
  if (job) await ctx.queues?.addMedia({ kind: 'export', organisationId: v.organisationId, exportJobId: job.id }, { jobId: job.id }).catch(() => undefined);
  return { ...publicVideo(v), state: 'PROCESSING', missingParts: [] };
}

export async function listMatchVideos(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    await matchFor(t, ctx, matchId, 'media.read');
    const rows = await t.select().from(matchVideos).where(and(eq(matchVideos.matchId, matchId), eq(matchVideos.organisationId, ctx.actor.organisationId))).orderBy(desc(matchVideos.createdAt));
    return rows.map(publicVideo);
  });
}

export const syncInput = z.object({ anchors: z.record(z.string().max(40), z.number().int().min(0)) });

/** Where each period kicked off in the video (ms); a period left out follows the one before it. */
export async function setMatchVideoSync(ctx: Ctx, videoId: string, input: z.input<typeof syncInput>) {
  const d = syncInput.parse(input);
  return tx(ctx, async (t) => {
    const { v, m } = await videoFor(t, ctx, videoId, 'media.edit');
    const adapter = getAdapter(m.sport as never);
    for (const [periodId, ms] of Object.entries(d.anchors)) {
      const kind = adapter.phase(m.rulesConfig as never, periodId)?.kind;
      if (kind !== 'play' && periodId !== 'shootout') throw invalid(`${periodId} is not a period of play`, [{ field: 'anchors', message: 'Not a period' }]);
      if (v.durationMs != null && ms > v.durationMs) throw invalid('A kick-off is after the end of the video', [{ field: 'anchors', message: 'Past the end' }]);
    }
    const [r] = await t.update(matchVideos).set({ sync: d.anchors, updatedAt: new Date() }).where(eq(matchVideos.id, v.id)).returning();
    await audit(t, ctx.actor, 'match_video.sync', 'match_video', v.id, { before: v.sync, after: d.anchors });
    return publicVideo(r!);
  });
}

export async function deleteMatchVideo(ctx: Ctx, videoId: string) {
  const v = await tx(ctx, async (t) => (await videoFor(t, ctx, videoId, 'media.edit')).v);
  if (ctx.storage) {
    if (v.uploadId) await ctx.storage.abortMultipart(v.objectKey, v.uploadId).catch(() => undefined);
    for (const k of [v.objectKey, v.proxyKey, v.thumbnailKey]) if (k) await ctx.storage.delete(k).catch(() => undefined);
  }
  return tx(ctx, async (t) => {
    await t.delete(matchVideos).where(and(eq(matchVideos.id, v.id), eq(matchVideos.organisationId, ctx.actor.organisationId)));
    await audit(t, ctx.actor, 'match_video.delete', 'match_video', v.id, { before: { name: v.name, bytes: v.bytes } });
    return { deleted: true };
  });
}

export async function matchVideoMedia(ctx: Ctx, videoId: string, which: 'preview' | 'thumbnail'): Promise<MediaRef> {
  return tx(ctx, async (t) => {
    const { v } = await videoFor(t, ctx, videoId, 'media.read');
    const key = which === 'preview' ? v.proxyKey : v.thumbnailKey;
    if (!key) throw notFound(which === 'preview' ? 'Preview' : 'Thumbnail');
    return { key, mime: which === 'preview' ? 'video/mp4' : 'image/jpeg', filename: `${v.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_')}-${which}.${which === 'preview' ? 'mp4' : 'jpg'}` };
  });
}

// ------------------------------------------------------------------ packages

/** What the browser plans a package from: the match's log, rules and videos. */
export async function highlightsSource(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    const m = await matchFor(t, ctx, matchId, 'media.read');
    const facts = (await t.select().from(matchFacts).where(and(eq(matchFacts.matchId, matchId), eq(matchFacts.organisationId, ctx.actor.organisationId))).orderBy(asc(matchFacts.sequence))).map(factRowToStored);
    const videos = await t.select().from(matchVideos).where(and(eq(matchVideos.matchId, matchId), eq(matchVideos.organisationId, ctx.actor.organisationId))).orderBy(desc(matchVideos.createdAt));
    return { sport: m.sport, rulesConfig: m.rulesConfig, facts, videos: videos.map(publicVideo) };
  });
}

const overrideSchema = z.object({ include: z.boolean().optional(), shiftMs: z.number().int().min(-60_000).max(60_000).optional() });
export const highlightOptionsSchema = z.object({
  targetMs: z.number().int().min(30_000).max(HIGHLIGHTS_MAX_MS).default(highlightOptionsDefaults.targetMs),
  kinds: z.object({ score: z.boolean(), key: z.boolean(), chance: z.boolean(), minor: z.boolean(), shootout: z.boolean() }).partial().default({}),
  replays: z.boolean().default(highlightOptionsDefaults.replays),
  replaySpeed: z.number().min(0.5).max(1).default(highlightOptionsDefaults.replaySpeed),
  stinger: z.boolean().default(highlightOptionsDefaults.stinger),
  intro: z.boolean().default(highlightOptionsDefaults.intro),
  fullTime: z.boolean().default(highlightOptionsDefaults.fullTime),
  endCard: z.boolean().default(highlightOptionsDefaults.endCard),
  scorebug: z.boolean().default(highlightOptionsDefaults.scorebug),
  title: z.string().trim().max(30).default(highlightOptionsDefaults.title),
  endMessage: z.string().trim().max(60).default(highlightOptionsDefaults.endMessage),
  overrides: z.record(z.string().uuid(), overrideSchema).refine((o) => Object.keys(o).length <= 400, 'Too many changes').default({}),
});

/** The options as the planner takes them (missing kinds read as their defaults). */
export function toPlanOptions(o: z.output<typeof highlightOptionsSchema>): HighlightOptions {
  return { ...o, kinds: { ...highlightOptionsDefaults.kinds, ...o.kinds } };
}

/** The plan for a match video with these options, worked out from the database. */
export async function planFor(t: Tx, organisationId: string, matchId: string, video: typeof matchVideos.$inferSelect, options: HighlightOptions): Promise<HighlightPlan> {
  const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, organisationId)));
  if (!m) throw notFound('Match');
  const facts: StoredFact[] = (await t.select().from(matchFacts).where(and(eq(matchFacts.matchId, matchId), eq(matchFacts.organisationId, organisationId))).orderBy(asc(matchFacts.sequence))).map(factRowToStored);
  const adapter = getAdapter(m.sport as never);
  return planHighlights({ adapter, cfg: m.rulesConfig as never, facts, video: { durationMs: video.durationMs ?? 0, anchors: video.sync }, options });
}

export const highlightsInput = z.object({ videoId: z.string().uuid(), planKey: z.string().min(1).max(40), title: z.string().trim().max(120).optional(), options: highlightOptionsSchema });

/**
 * A package: checked against the plan the browser drew its graphics for (the same plan, or the match or video
 * changed meanwhile), then waiting for those graphics. Their upload queues the media worker.
 */
export async function createHighlights(ctx: Ctx, matchId: string, input: z.input<typeof highlightsInput>) {
  const d = highlightsInput.parse(input);
  return tx(ctx, async (t) => {
    const m = await matchFor(t, ctx, matchId, 'media.edit');
    const [v] = await t.select().from(matchVideos).where(and(eq(matchVideos.id, d.videoId), eq(matchVideos.matchId, matchId), eq(matchVideos.organisationId, ctx.actor.organisationId)));
    if (!v) throw notFound('Match video');
    if (v.state !== 'READY') throw conflict('VIDEO_NOT_READY', 'The video is still being read: try again in a moment');
    if (!Object.keys(v.sync).length) throw invalid('Mark the kick-off in the video first', [{ field: 'sync', message: 'No kick-off' }], 'NOT_SYNCED');
    const options = toPlanOptions(d.options);
    const plan = await planFor(t, ctx.actor.organisationId, matchId, v, options);
    if (plan.key !== d.planKey) throw conflict('PLAN_CHANGED', 'The match or the video changed while the graphics were being prepared. Prepare them again.');
    if (!plan.segments.length) throw invalid('Nothing to show: no moments are in the video', undefined, 'NOTHING_TO_SHOW');
    if (plan.durationMs > HIGHLIGHTS_MAX_MS) throw invalid(`A package can run ${HIGHLIGHTS_MAX_MS / 60_000} minutes at most: leave some moments out`, undefined, 'TOO_LONG');
    await assertQuota(t, ctx.actor.organisationId, Math.round((plan.durationMs / 1000) * 1_200_000));
    const title = d.title || `Highlights ${m.externalId ?? matchId.slice(0, 8)}`;
    const [j] = await t
      .insert(exportJobs)
      .values({ organisationId: ctx.actor.organisationId, kind: 'highlights', sourceType: 'match', sourceId: matchId, jobKey: `highlights:${matchId}:${crypto.randomUUID()}`, params: { videoId: v.id, options, planKey: plan.key, title, durationMs: plan.durationMs }, state: 'UPLOADING', createdBy: ctx.actor.userId })
      .returning();
    await audit(t, ctx.actor, 'highlights.create', 'match', matchId, { after: { jobId: j!.id, videoId: v.id, durationMs: plan.durationMs, moments: plan.moments.filter((x) => x.included).length } });
    return { jobId: j!.id, durationMs: plan.durationMs, graphicsUrl: `/api/v1/exports/${j!.id}/graphics` };
  });
}

/** The graphics the browser drew for a package (see `parseOverlay`); the package then goes to the media worker. */
export async function receiveHighlightGraphics(ctx: Ctx, jobId: string, body: Readable, contentLength: number) {
  if (!ctx.storage) throw new AppError('STORAGE_UNAVAILABLE', 503, 'Object storage is not configured');
  assertCan(ctx.actor, 'media.edit');
  if (!Number.isInteger(contentLength) || contentLength <= 0) throw new AppError('LENGTH_REQUIRED', 411, 'Send the graphics with their size (Content-Length)');
  if (contentLength > HIGHLIGHT_GRAPHICS_MAX_BYTES) throw invalid(`The graphics are larger than ${HIGHLIGHT_GRAPHICS_MAX_BYTES / MiB} MB`, undefined, 'TOO_LARGE');
  const [j] = await tx(ctx, (t) => t.select().from(exportJobs).where(and(eq(exportJobs.id, jobId), eq(exportJobs.organisationId, ctx.actor.organisationId), eq(exportJobs.kind, 'highlights'))));
  if (!j) throw notFound('Highlights');
  if (j.state !== 'UPLOADING') throw conflict('UPLOAD_CLOSED', 'The graphics for this package have already been received');
  const key = keys.highlightOverlay(ctx.actor.organisationId, jobId);
  await ctx.storage.put(key, body, 'application/octet-stream', contentLength);
  const job = await tx(ctx, async (t) => {
    const [r] = await t.update(exportJobs).set({ state: 'QUEUED', params: { ...j.params, overlayKey: key, overlayBytes: contentLength }, updatedAt: new Date() }).where(and(eq(exportJobs.id, jobId), eq(exportJobs.state, 'UPLOADING'))).returning();
    if (!r) throw conflict('UPLOAD_CLOSED', 'The graphics for this package have already been received');
    return r;
  });
  await ctx.queues?.addMedia({ kind: 'export', organisationId: job.organisationId, exportJobId: job.id }, { jobId: job.id });
  return { jobId, state: 'QUEUED' };
}

/** The highlights packages of a match, newest first (the files are downloaded from Media → Exports as well). */
export async function listHighlights(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    await matchFor(t, ctx, matchId, 'media.read');
    const rows = await t.select().from(exportJobs).where(and(eq(exportJobs.organisationId, ctx.actor.organisationId), eq(exportJobs.kind, 'highlights'), eq(exportJobs.sourceId, matchId))).orderBy(desc(exportJobs.createdAt)).limit(50);
    return rows.map((j) => ({ id: j.id, state: j.state, progress: j.progress, error: j.error, title: String((j.params as { title?: string }).title ?? 'Highlights'), durationMs: Number((j.params as { durationMs?: number }).durationMs ?? 0) || null, bytes: j.outputBytes, createdAt: j.createdAt, finishedAt: j.finishedAt, expiresAt: j.expiresAt, downloadUrl: j.state === 'COMPLETED' && j.outputKey ? `/api/v1/exports/${j.id}/download` : null }));
  });
}
