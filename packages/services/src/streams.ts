// Streaming operations (spec §13): inputs, programme/clean outputs, destinations, broadcast sessions.
// API-side commands only record intent and enqueue control jobs; the worker (media-control.ts) talks to the
// media provider and is the only place that reports LIVE, based on provider state.
import dns from 'node:dns/promises';
import net from 'node:net';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  broadcastSessions,
  capacityReservations,
  destinations,
  inputs,
  matches,
  outputSessions,
  overlays,
  providerResources,
  recordings,
  streamOutputs,
  type Tx,
} from '@bs/db';
import { PRESETS, redactUrl, type OutputPreset } from '@bs/media';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { decryptSecret, encryptSecret } from './crypto';
import { AppError, conflict, invalid, notFound, unavailable } from './errors';
import { tx, type Ctx } from './context';
import { enqueueOutbox } from './outbox';
import { createOverlay } from './overlays';

export const ACTIVE_SESSION_STATES = ['SCHEDULED', 'WAITING_FOR_INPUT', 'STARTING', 'LIVE', 'DEGRADED', 'STOPPING'] as const;
const TERMINAL = ['STOPPED', 'FAILED'];
export const MAX_DESTINATIONS = 3;

export const inputIdentity = (inputId: string) => `input_${inputId}`;
export const idleRoom = (inputId: string) => `bs_idle_${inputId}`;
export const sessionRoom = (sessionId: string) => `bs_${sessionId}`;

function requireMedia(ctx: Ctx) {
  if (!ctx.media) throw unavailable('MEDIA_NOT_CONFIGURED', 'Streaming is not configured on this deployment (media provider missing).');
  return ctx.media;
}

// ------------------------------------------------------------------ destination safety (SSRF)

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./];
export function isPrivateAddress(ip: string) {
  if (net.isIPv4(ip)) return PRIVATE_V4.some((r) => r.test(ip));
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

/** RTMP/RTMPS only; hostnames must resolve to public addresses unless allow-listed for development. */
export async function checkDestinationUrl(raw: string, allowlist: string, resolve: (h: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((a) => a.address)) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw invalid('Enter a valid RTMP or RTMPS server URL', [{ field: 'serverUrl', message: 'Not a URL' }]);
  }
  if (!['rtmp:', 'rtmps:'].includes(u.protocol)) throw invalid('Only rtmp:// and rtmps:// destinations are supported', [{ field: 'serverUrl', message: 'Unsupported scheme' }]);
  if (u.username || u.password) throw invalid('Put credentials in the stream key field, not the URL', [{ field: 'serverUrl', message: 'Credentials in URL' }]);
  const port = u.port || (u.protocol === 'rtmps:' ? '443' : '1935');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const allowed = allowlist.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(`${host}:${port}`)) return { url: u, allowlisted: true };
  const addrs = net.isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!addrs.length) throw invalid('The destination host could not be resolved', [{ field: 'serverUrl', message: 'DNS lookup failed' }]);
  if (addrs.some(isPrivateAddress)) throw invalid('Private, loopback and link-local destinations are not allowed', [{ field: 'serverUrl', message: 'Private network address' }], 'DESTINATION_BLOCKED');
  return { url: u, allowlisted: false };
}

// ------------------------------------------------------------------ inputs

export const inputSchema = z.object({ name: z.string().trim().min(1).max(60), teamId: z.string().uuid().nullable().optional(), venueId: z.string().uuid().nullable().optional(), sourceDelayMs: z.number().int().min(0).max(30_000).default(0) });

const publicInput = (i: typeof inputs.$inferSelect, ingress?: typeof providerResources.$inferSelect) => ({
  id: i.id,
  name: i.name,
  kind: i.kind,
  teamId: i.teamId,
  venueId: i.venueId,
  status: i.status,
  boundSessionId: i.boundSessionId,
  keyVersion: i.keyVersion,
  sourceDelayMs: i.sourceDelayMs,
  lastHealth: i.lastHealth,
  serverUrl: (ingress?.details as { url?: string } | undefined)?.url ?? null,
  streamKeyMasked: i.streamKeyEnc ? '••••••••' : null,
  transport: 'RTMP (unencrypted)',
  updatedAt: i.updatedAt,
});

export async function listInputs(ctx: Ctx) {
  assertCan(ctx.actor, 'org.read');
  return tx(ctx, async (t) => {
    const rows = await t.select().from(inputs).where(eq(inputs.organisationId, ctx.actor.organisationId)).orderBy(asc(inputs.name));
    const res = rows.length ? await t.select().from(providerResources).where(and(eq(providerResources.organisationId, ctx.actor.organisationId), eq(providerResources.kind, 'ingress'), eq(providerResources.state, 'active'), inArray(providerResources.resourceId, rows.map((r) => r.id)))) : [];
    return rows.map((i) => publicInput(i, res.find((r) => r.resourceId === i.id)));
  });
}

export async function createInput(ctx: Ctx, input: z.input<typeof inputSchema>) {
  assertCan(ctx.actor, 'stream.manage');
  const media = requireMedia(ctx);
  const d = inputSchema.parse(input);
  const id = crypto.randomUUID();
  // provider call first, outside the transaction; a DB failure afterwards deletes the orphan
  const p = await media.provisionInput({ name: d.name, roomName: idleRoom(id), participantIdentity: inputIdentity(id) });
  try {
    return await tx(ctx, async (t) => {
      const [row] = await t.insert(inputs).values({ id, organisationId: ctx.actor.organisationId, name: d.name, teamId: d.teamId ?? null, venueId: d.venueId ?? null, sourceDelayMs: d.sourceDelayMs, streamKeyEnc: encryptSecret(p.streamKey, ctx.config.ENCRYPTION_KEY) }).returning();
      const [res] = await t.insert(providerResources).values({ organisationId: ctx.actor.organisationId, provider: media.name, kind: 'ingress', providerId: p.providerId, resourceType: 'input', resourceId: id, details: { url: p.url } }).returning();
      await audit(t, ctx.actor, 'input.create', 'input', id, { after: { name: d.name } });
      return publicInput(row!, res);
    });
  } catch (e) {
    await media.deleteInput(p.providerId).catch(() => undefined);
    throw e;
  }
}

async function ingressFor(t: Tx, inputId: string) {
  const [r] = await t.select().from(providerResources).where(and(eq(providerResources.kind, 'ingress'), eq(providerResources.resourceType, 'input'), eq(providerResources.resourceId, inputId), eq(providerResources.state, 'active')));
  return r ?? null;
}

/** Reveal the encoder key to an authorised user (audited; never in list responses). */
export async function revealInputKey(ctx: Ctx, inputId: string) {
  assertCan(ctx.actor, 'stream.manage');
  return tx(ctx, async (t) => {
    const [i] = await t.select().from(inputs).where(and(eq(inputs.id, inputId), eq(inputs.organisationId, ctx.actor.organisationId)));
    if (!i?.streamKeyEnc) throw notFound('Input');
    const res = await ingressFor(t, inputId);
    await audit(t, ctx.actor, 'input.key_revealed', 'input', inputId);
    return { serverUrl: (res?.details as { url?: string })?.url ?? null, streamKey: decryptSecret(i.streamKeyEnc, ctx.config.ENCRYPTION_KEY) };
  });
}

/** Rotation provisions a new provider input and deletes the old one, invalidating the previous key. */
export async function rotateInputKey(ctx: Ctx, inputId: string) {
  assertCan(ctx.actor, 'stream.manage');
  const media = requireMedia(ctx);
  const cur = await tx(ctx, async (t) => {
    const [i] = await t.select().from(inputs).where(and(eq(inputs.id, inputId), eq(inputs.organisationId, ctx.actor.organisationId)));
    if (!i) throw notFound('Input');
    if (i.boundSessionId) throw conflict('INPUT_IN_USE', 'Stop the live session using this input before rotating its key');
    return { i, res: await ingressFor(t, inputId) };
  });
  const p = await media.provisionInput({ name: cur.i.name, roomName: idleRoom(inputId), participantIdentity: inputIdentity(inputId) });
  await tx(ctx, async (t) => {
    await t.update(inputs).set({ streamKeyEnc: encryptSecret(p.streamKey, ctx.config.ENCRYPTION_KEY), keyVersion: cur.i.keyVersion + 1, updatedAt: new Date() }).where(eq(inputs.id, inputId));
    if (cur.res) await t.update(providerResources).set({ state: 'deleted', updatedAt: new Date() }).where(eq(providerResources.id, cur.res.id));
    await t.insert(providerResources).values({ organisationId: ctx.actor.organisationId, provider: media.name, kind: 'ingress', providerId: p.providerId, resourceType: 'input', resourceId: inputId, details: { url: p.url } });
    await audit(t, ctx.actor, 'input.key_rotated', 'input', inputId, { after: { keyVersion: cur.i.keyVersion + 1 } });
  });
  if (cur.res) await media.deleteInput(cur.res.providerId);
  return { keyVersion: cur.i.keyVersion + 1 };
}

// ------------------------------------------------------------------ outputs & destinations

export const outputSchema = z.object({
  mode: z.enum(['PROGRAMME', 'CLEAN']),
  name: z.string().trim().min(1).max(60).optional(),
  inputId: z.string().uuid().nullable().optional(),
  preset: z.enum(Object.keys(PRESETS) as [OutputPreset, ...OutputPreset[]]).default('720p30'),
  record: z.boolean().default(true),
  hls: z.boolean().default(true),
  prerollSeconds: z.number().int().min(0).max(3600).default(0),
  postrollSeconds: z.number().int().min(0).max(3600).default(120),
  autoSchedule: z.boolean().default(false),
});

async function loadMatch(ctx: Ctx, t: Tx, matchId: string) {
  const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
  if (!m) throw notFound('Match');
  return m;
}

export async function saveOutput(ctx: Ctx, matchId: string, input: z.input<typeof outputSchema>) {
  const d = outputSchema.parse(input);
  return tx(ctx, async (t) => {
    const m = await loadMatch(ctx, t, matchId);
    assertCan(ctx.actor, 'stream.manage', { matchId, competitionId: m.competitionId });
    if (d.inputId) {
      const [i] = await t.select().from(inputs).where(and(eq(inputs.id, d.inputId), eq(inputs.organisationId, ctx.actor.organisationId)));
      if (!i) throw notFound('Input');
    }
    const [existing] = await t.select().from(streamOutputs).where(and(eq(streamOutputs.matchId, matchId), eq(streamOutputs.mode, d.mode)));
    if (existing) {
      const [active] = await t.select().from(outputSessions).where(and(eq(outputSessions.outputId, existing.id), notInArray(outputSessions.state, TERMINAL)));
      if (active && (d.inputId !== existing.inputId || d.preset !== existing.preset)) throw conflict('OUTPUT_LIVE', 'Stop the stream before changing its input or preset');
      const [u] = await t.update(streamOutputs).set({ ...d, name: d.name ?? existing.name, inputId: d.inputId ?? null, scheduleVersion: existing.scheduleVersion + 1, updatedAt: new Date() }).where(eq(streamOutputs.id, existing.id)).returning();
      await audit(t, ctx.actor, 'output.update', 'stream_output', existing.id, { after: { mode: d.mode, preset: d.preset, autoSchedule: d.autoSchedule } });
      return u!;
    }
    let overlayId: string | null = null;
    if (d.mode === 'PROGRAMME') {
      const ov = await createOverlay(ctx, matchId, { name: 'Programme graphics', kind: 'programme' }, t);
      overlayId = ov.id;
    }
    const [o] = await t.insert(streamOutputs).values({ organisationId: ctx.actor.organisationId, matchId, mode: d.mode, name: d.name ?? (d.mode === 'PROGRAMME' ? 'Programme' : 'Clean feed'), inputId: d.inputId ?? null, overlayId, preset: d.preset, record: d.record, hls: d.hls, prerollSeconds: d.prerollSeconds, postrollSeconds: d.postrollSeconds, autoSchedule: d.autoSchedule }).returning();
    if (overlayId) await t.update(overlays).set({ outputId: o!.id }).where(eq(overlays.id, overlayId));
    await audit(t, ctx.actor, 'output.create', 'stream_output', o!.id, { after: { mode: d.mode, preset: d.preset } });
    return o!;
  });
}

export const destinationSchema = z.object({ name: z.string().trim().min(1).max(60), platform: z.enum(['youtube', 'facebook', 'twitch', 'custom']).default('custom'), serverUrl: z.string().trim().max(500), streamKey: z.string().trim().min(1).max(500) });

const publicDestination = (d: typeof destinations.$inferSelect) => ({ id: d.id, outputId: d.outputId, name: d.name, platform: d.platform, serverUrl: d.serverUrl, streamKeyMasked: '••••••••', enabled: d.enabled, lastStatus: d.lastStatus });

export async function addDestination(ctx: Ctx, outputId: string, input: z.input<typeof destinationSchema>) {
  const d = destinationSchema.parse(input);
  await checkDestinationUrl(d.serverUrl, ctx.config.DEV_DESTINATION_ALLOWLIST);
  return tx(ctx, async (t) => {
    const [o] = await t.select({ o: streamOutputs, m: matches }).from(streamOutputs).innerJoin(matches, eq(matches.id, streamOutputs.matchId)).where(and(eq(streamOutputs.id, outputId), eq(streamOutputs.organisationId, ctx.actor.organisationId)));
    if (!o) throw notFound('Output');
    assertCan(ctx.actor, 'stream.manage', { matchId: o.m.id, competitionId: o.m.competitionId, outputId });
    const n = await t.select({ id: destinations.id }).from(destinations).where(eq(destinations.outputId, outputId));
    if (n.length >= MAX_DESTINATIONS) throw invalid(`Each output can have at most ${MAX_DESTINATIONS} destinations`, undefined, 'DESTINATION_LIMIT');
    const [row] = await t.insert(destinations).values({ organisationId: ctx.actor.organisationId, outputId, name: d.name, platform: d.platform, serverUrl: d.serverUrl.replace(/\/+$/, ''), streamKeyEnc: encryptSecret(d.streamKey, ctx.config.ENCRYPTION_KEY) }).returning();
    await audit(t, ctx.actor, 'destination.create', 'destination', row!.id, { after: { name: d.name, platform: d.platform, server: redactUrl(d.serverUrl) } });
    return publicDestination(row!);
  });
}

export async function removeDestination(ctx: Ctx, destinationId: string) {
  assertCan(ctx.actor, 'stream.manage');
  return tx(ctx, async (t) => {
    const [d] = await t.delete(destinations).where(and(eq(destinations.id, destinationId), eq(destinations.organisationId, ctx.actor.organisationId))).returning();
    if (!d) throw notFound('Destination');
    await audit(t, ctx.actor, 'destination.delete', 'destination', destinationId, { before: { name: d.name } });
    return { ok: true };
  });
}

export async function setDestinationEnabled(ctx: Ctx, destinationId: string, enabled: boolean) {
  assertCan(ctx.actor, 'stream.manage');
  return tx(ctx, async (t) => {
    const [d] = await t.update(destinations).set({ enabled, updatedAt: new Date() }).where(and(eq(destinations.id, destinationId), eq(destinations.organisationId, ctx.actor.organisationId))).returning();
    if (!d) throw notFound('Destination');
    await audit(t, ctx.actor, enabled ? 'destination.enable' : 'destination.disable', 'destination', destinationId);
    return publicDestination(d);
  });
}

/** Full RTMP URLs for the worker (decrypted only at egress start; never returned to clients). */
export function destinationUrl(d: typeof destinations.$inferSelect, encryptionKey: string) {
  const key = decryptSecret(d.streamKeyEnc, encryptionKey);
  return `${d.serverUrl}/${key}`;
}

// ------------------------------------------------------------------ sessions

export async function matchStreams(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    const m = await loadMatch(ctx, t, matchId);
    assertCan(ctx.actor, 'competition.read', { matchId, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const outs = await t.select().from(streamOutputs).where(eq(streamOutputs.matchId, matchId)).orderBy(asc(streamOutputs.mode));
    const dests = outs.length ? await t.select().from(destinations).where(inArray(destinations.outputId, outs.map((o) => o.id))) : [];
    const [session] = await t.select().from(broadcastSessions).where(eq(broadcastSessions.matchId, matchId)).orderBy(desc(broadcastSessions.createdAt)).limit(1);
    const outSessions = session ? await t.select().from(outputSessions).where(eq(outputSessions.broadcastSessionId, session.id)) : [];
    const recs = outSessions.length ? await t.select().from(recordings).where(inArray(recordings.outputSessionId, outSessions.map((s) => s.id))) : [];
    const ins = await t.select().from(inputs).where(eq(inputs.organisationId, ctx.actor.organisationId));
    return {
      demo: !!ctx.media?.demo,
      configured: !!ctx.media,
      outputs: outs.map((o) => {
        const os = outSessions.find((s) => s.outputId === o.id);
        return {
          ...o,
          input: ins.find((i) => i.id === o.inputId) ? { id: o.inputId, name: ins.find((i) => i.id === o.inputId)!.name, status: ins.find((i) => i.id === o.inputId)!.status, lastHealth: ins.find((i) => i.id === o.inputId)!.lastHealth } : null,
          destinations: dests.filter((d) => d.outputId === o.id).map(publicDestination),
          session: os ? { id: os.id, state: os.state, error: os.error, liveAt: os.liveAt, endedAt: os.endedAt, preset: os.preset, hlsUrl: o.hls ? `/api/v1/hls/${os.id}/live.m3u8` : null } : null,
          recording: recs.filter((r) => r.outputSessionId === os?.id).map((r) => ({ id: r.id, state: r.state, durationMs: r.durationMs })),
        };
      }),
      session: session ? { id: session.id, state: session.state, error: session.error, startedAt: session.startedAt, endedAt: session.endedAt, demo: session.demo } : null,
    };
  });
}

/** Reserve capacity under a global advisory lock so concurrent starts cannot oversubscribe. */
async function reserveCapacity(t: Tx, organisationId: string, outputSessionIds: string[], max: number) {
  await t.execute(sql`select pg_advisory_xact_lock(hashtext('bs:capacity'))`);
  const r = await t.execute<{ n: number }>(sql`select coalesce(sum(units), 0)::int as n from capacity_reservations where released_at is null`);
  const used = Number(r.rows[0]?.n ?? 0);
  if (used + outputSessionIds.length > max) throw new AppError('CAPACITY_REACHED', 409, `Streaming capacity reached (${used}/${max} outputs live). Stop another stream or raise the measured limit.`);
  await t.insert(capacityReservations).values(outputSessionIds.map((id) => ({ organisationId, outputSessionId: id, units: 1 })));
}

/**
 * Start (idempotent). Binds the input to this session's private room (CAS on the input), creates output
 * sessions (one active per output by unique index), reserves capacity and enqueues the worker start.
 */
export async function startSession(ctx: Ctx, matchId: string, opts: { outputIds?: string[]; scheduleVersion?: number; scheduled?: boolean } = {}) {
  const media = requireMedia(ctx);
  const res = await tx(ctx, async (t) => {
    const m = await loadMatch(ctx, t, matchId);
    assertCan(ctx.actor, 'stream.manage', { matchId, competitionId: m.competitionId });
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${'bs:session:' + matchId}))`);
    const [active] = await t.select().from(broadcastSessions).where(and(eq(broadcastSessions.matchId, matchId), inArray(broadcastSessions.state, [...ACTIVE_SESSION_STATES]))).limit(1);
    if (active) return { session: active, created: false };
    let outs = await t.select().from(streamOutputs).where(eq(streamOutputs.matchId, matchId));
    if (opts.outputIds?.length) outs = outs.filter((o) => opts.outputIds!.includes(o.id));
    if (!outs.length) throw invalid('Add a programme or clean output to this match first', undefined, 'NO_OUTPUTS');
    if (opts.scheduleVersion != null && outs.some((o) => o.scheduleVersion !== opts.scheduleVersion)) throw conflict('STALE_SCHEDULE', 'This scheduled start is for an older version of the fixture/output schedule');
    const inputIds = [...new Set(outs.map((o) => o.inputId).filter((x): x is string => !!x))];
    if (inputIds.length !== 1) throw invalid(inputIds.length ? 'All outputs of one session must use the same input' : 'Choose an input for this output', [{ field: 'inputId', message: 'Input required' }], 'INPUT_REQUIRED');
    const inputId = inputIds[0]!;
    const id = crypto.randomUUID();
    const [bound] = await t.update(inputs).set({ boundSessionId: id, bindingVersion: sql`${inputs.bindingVersion} + 1`, status: 'bound', updatedAt: new Date() }).where(and(eq(inputs.id, inputId), isNull(inputs.boundSessionId))).returning();
    if (!bound) throw conflict('INPUT_IN_USE', 'This input is already routed to another live session. Stop that session or choose another input.');
    const [s] = await t.insert(broadcastSessions).values({ id, organisationId: ctx.actor.organisationId, matchId, inputId, roomName: sessionRoom(id), state: 'STARTING', scheduleVersion: outs[0]!.scheduleVersion, demo: media.demo, startedAt: new Date(), createdBy: ctx.actor.userId }).returning();
    const os = await t
      .insert(outputSessions)
      .values(outs.map((o) => ({ organisationId: ctx.actor.organisationId, broadcastSessionId: id, outputId: o.id, state: 'PENDING', preset: { key: o.preset, ...PRESETS[o.preset as OutputPreset] }, reportingAuthority: o.mode === 'PROGRAMME' ? 'compositor' : 'none' })))
      .returning();
    await reserveCapacity(t, ctx.actor.organisationId, os.map((x) => x.id), ctx.config.MAX_CONCURRENT_PROGRAMMES);
    await audit(t, ctx.actor, opts.scheduled ? 'session.scheduled_start' : 'session.start', 'broadcast_session', id, { after: { matchId, outputs: outs.map((o) => o.mode) } });
    await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'stream.status.updated', aggregateType: 'broadcast_session', aggregateId: id, payload: { matchId, sessionId: id, state: 'STARTING' } });
    return { session: s!, created: true };
  });
  if (res.created) await ctx.queues?.addControl({ kind: 'session.start', organisationId: ctx.actor.organisationId, broadcastSessionId: res.session.id, scheduleVersion: res.session.scheduleVersion }, { jobId: `start-${res.session.id}` });
  return res;
}

export async function stopSession(ctx: Ctx, matchId: string, reason = 'operator stop') {
  const s = await tx(ctx, async (t) => {
    const m = await loadMatch(ctx, t, matchId);
    assertCan(ctx.actor, 'stream.manage', { matchId, competitionId: m.competitionId });
    const [cur] = await t.select().from(broadcastSessions).where(and(eq(broadcastSessions.matchId, matchId), inArray(broadcastSessions.state, [...ACTIVE_SESSION_STATES]))).limit(1);
    if (!cur) return null;
    if (cur.state !== 'STOPPING') {
      await t.update(broadcastSessions).set({ state: 'STOPPING', updatedAt: new Date() }).where(eq(broadcastSessions.id, cur.id));
      await audit(t, ctx.actor, 'session.stop', 'broadcast_session', cur.id, { after: { reason } });
      await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'stream.status.updated', aggregateType: 'broadcast_session', aggregateId: cur.id, payload: { matchId, sessionId: cur.id, state: 'STOPPING' } });
    }
    return cur;
  });
  if (s) await ctx.queues?.addControl({ kind: 'session.stop', organisationId: ctx.actor.organisationId, broadcastSessionId: s.id, reason }, { jobId: `stop-${s.id}` });
  return { stopping: !!s };
}

/** Receive-only, hidden WebRTC token for operator input preview (spec §13.5). */
export async function inputPreviewToken(ctx: Ctx, matchId: string) {
  const media = requireMedia(ctx);
  const s = await tx(ctx, async (t) => {
    const m = await loadMatch(ctx, t, matchId);
    assertCan(ctx.actor, 'competition.read', { matchId, competitionId: m.competitionId });
    const [cur] = await t.select().from(broadcastSessions).where(and(eq(broadcastSessions.matchId, matchId), inArray(broadcastSessions.state, [...ACTIVE_SESSION_STATES]))).limit(1);
    return cur;
  });
  if (!s?.inputId) throw conflict('NO_ACTIVE_SESSION', 'Start the stream to preview its input');
  const identity = `monitor_${ctx.actor.userId ?? 'key'}_${Math.random().toString(36).slice(2, 8)}`;
  return { url: ctx.config.PUBLIC_LIVEKIT_URL, token: await media.monitorToken(s.roomName, identity, 3600), inputIdentity: inputIdentity(s.inputId), demo: media.demo };
}

/** Authorise an HLS object read: the caller must be able to read the session's match. Returns the S3 key. */
export async function hlsObjectKey(ctx: Ctx, outputSessionId: string, file: string) {
  if (!/^(live|index)\.m3u8$|^seg_?\d+\.ts$|^seg\w*\.ts$/.test(file)) throw notFound('Segment');
  return tx(ctx, async (t) => {
    const [r] = await t.select({ os: outputSessions, m: matches }).from(outputSessions).innerJoin(broadcastSessions, eq(broadcastSessions.id, outputSessions.broadcastSessionId)).innerJoin(matches, eq(matches.id, broadcastSessions.matchId)).where(and(eq(outputSessions.id, outputSessionId), eq(outputSessions.organisationId, ctx.actor.organisationId)));
    if (!r) throw notFound('Stream');
    assertCan(ctx.actor, 'competition.read', { matchId: r.m.id, competitionId: r.m.competitionId, teamIds: [r.m.homeTeamId, r.m.awayTeamId] });
    return `${hlsPrefix(ctx.actor.organisationId, outputSessionId)}${file}`;
  });
}

export const hlsPrefix = (org: string, outputSessionId: string) => `org/${org}/live/${outputSessionId}/`;

/** Operations overview across the organisation (streams page, multiview). */
export async function streamsOverview(ctx: Ctx) {
  assertCan(ctx.actor, 'org.read');
  return tx(ctx, async (t) => {
    const rows = await t
      .select({ s: broadcastSessions, m: matches })
      .from(broadcastSessions)
      .innerJoin(matches, eq(matches.id, broadcastSessions.matchId))
      .where(and(eq(broadcastSessions.organisationId, ctx.actor.organisationId), sql`(${broadcastSessions.state} not in ('STOPPED','FAILED') or ${broadcastSessions.endedAt} > now() - interval '6 hours')`))
      .orderBy(desc(broadcastSessions.createdAt))
      .limit(50);
    const os = rows.length ? await t.select({ os: outputSessions, o: streamOutputs }).from(outputSessions).innerJoin(streamOutputs, eq(streamOutputs.id, outputSessions.outputId)).where(inArray(outputSessions.broadcastSessionId, rows.map((r) => r.s.id))) : [];
    const cap = await t.execute<{ n: number }>(sql`select coalesce(sum(units),0)::int as n from capacity_reservations where released_at is null`);
    return {
      demo: !!ctx.media?.demo,
      configured: !!ctx.media,
      capacity: { used: Number(cap.rows[0]?.n ?? 0), max: ctx.config.MAX_CONCURRENT_PROGRAMMES },
      sessions: rows.map((r) => ({
        id: r.s.id,
        matchId: r.m.id,
        matchLabel: r.m.externalId ?? r.m.id.slice(0, 8),
        state: r.s.state,
        error: r.s.error,
        demo: r.s.demo,
        startedAt: r.s.startedAt,
        outputs: os.filter((x) => x.os.broadcastSessionId === r.s.id).map((x) => ({ id: x.os.id, mode: x.o.mode, name: x.o.name, state: x.os.state, error: x.os.error, hlsUrl: x.o.hls ? `/api/v1/hls/${x.os.id}/live.m3u8` : null })),
      })),
    };
  });
}
