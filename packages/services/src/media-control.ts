// Worker-side session orchestration (spec §13.4). The only code that talks to the media provider for
// sessions. LIVE is reported only from provider state (egress active), never from request submission.
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  broadcastSessions,
  capacityReservations,
  destinations,
  inputs,
  matches,
  outputSessions,
  providerResources,
  providerWebhookEvents,
  recordingParts,
  recordings,
  streamOutputs,
  withTenant,
  type Db,
  type Tx,
} from '@bs/db';
import type { AppConfig } from '@bs/config';
import { createFakeProvider, createLiveKitProvider, type MediaProvider, type OutputPreset, type OutputStatus, type ProviderWebhookEvent } from '@bs/media';
import { compositorToken } from './overlays';
import { enqueueOutbox } from './outbox';
import { destinationUrl, hlsPrefix, idleRoom, inputIdentity, ACTIVE_SESSION_STATES } from './streams';
import { keys } from './storage';
import { recordUsage } from './usage';

export interface MediaControlDeps {
  db: Db; // worker role
  config: AppConfig;
  media: MediaProvider;
  now?: () => number;
  /** bounded wait for a source before failing the session */
  inputWaitMs?: number;
  /** egress restarts allowed per output session after provider termination */
  maxEgressRetries?: number;
}

const now = (d: MediaControlDeps) => (d.now ? d.now() : Date.now());
const INPUT_WAIT_MS = 10 * 60_000;

async function load(t: Tx, sessionId: string) {
  // no row lock: provider calls happen inside reconcile; writes use compare-and-set on state instead
  const [s] = await t.select().from(broadcastSessions).where(eq(broadcastSessions.id, sessionId));
  if (!s) return null;
  const os = await t.select({ os: outputSessions, o: streamOutputs }).from(outputSessions).innerJoin(streamOutputs, eq(streamOutputs.id, outputSessions.outputId)).where(eq(outputSessions.broadcastSessionId, sessionId));
  return { s, os };
}

async function ingressId(t: Tx, inputId: string) {
  const [r] = await t.select().from(providerResources).where(and(eq(providerResources.kind, 'ingress'), eq(providerResources.resourceId, inputId), eq(providerResources.state, 'active')));
  return r?.providerId ?? null;
}

async function egressFor(t: Tx, outputSessionId: string) {
  return t.select().from(providerResources).where(and(eq(providerResources.kind, 'egress'), eq(providerResources.resourceType, 'output_session'), eq(providerResources.resourceId, outputSessionId))).orderBy(sql`${providerResources.createdAt} desc`);
}

async function setSession(t: Tx, s: typeof broadcastSessions.$inferSelect, state: string, error: Record<string, unknown> | null = null, extra: Partial<typeof broadcastSessions.$inferInsert> = {}) {
  if (s.state === state && JSON.stringify(s.error ?? null) === JSON.stringify(error)) return;
  // CAS: an operator stop (STOPPING) that landed meanwhile is never overwritten by a stale reconcile
  const [u] = await t.update(broadcastSessions).set({ state, error, updatedAt: new Date(), ...extra }).where(and(eq(broadcastSessions.id, s.id), eq(broadcastSessions.state, s.state))).returning({ id: broadcastSessions.id });
  if (!u) return;
  s.state = state;
  await enqueueOutbox(t, { organisationId: s.organisationId, topic: 'stream.status.updated', aggregateType: 'broadcast_session', aggregateId: s.id, payload: { matchId: s.matchId, sessionId: s.id, state, error } });
}

/** Template URL the egress browser loads; LiveKit appends url= and token= for the room connection. */
export function templateUrl(cfg: AppConfig, o: typeof streamOutputs.$inferSelect, s: typeof broadcastSessions.$inferSelect, osId: string) {
  const q = new URLSearchParams({ mode: o.mode === 'PROGRAMME' ? 'programme' : 'clean', input: inputIdentity(s.inputId!), os: osId });
  if (o.mode === 'PROGRAMME' && o.overlayId) q.set('bt', compositorToken(cfg, { organisationId: s.organisationId, overlayId: o.overlayId, matchId: s.matchId }));
  return `${cfg.INTERNAL_RENDER_BASE_URL}/render/programme?${q}`;
}

/** session.start job: room + input binding at the provider; outputs start once the source publishes. */
export async function startSessionJob(d: MediaControlDeps, organisationId: string, sessionId: string) {
  const ctx = await withTenant(d.db, { organisationId }, async (t) => {
    const x = await load(t, sessionId);
    if (!x || !['STARTING', 'WAITING_FOR_INPUT'].includes(x.s.state)) return null;
    return { s: x.s, ingress: x.s.inputId ? await ingressId(t, x.s.inputId) : null };
  });
  if (!ctx) return 'skipped';
  if (!ctx.ingress) {
    await withTenant(d.db, { organisationId }, async (t) => {
      const x = await load(t, sessionId);
      if (x) await failSession(d, t, x.s, { code: 'INPUT_NOT_PROVISIONED', message: 'The input has no provider endpoint. Rotate its key to re-provision.' });
    });
    return 'failed';
  }
  await d.media.ensureRoom(ctx.s.roomName);
  await d.media.bindInput(ctx.ingress, ctx.s.roomName, inputIdentity(ctx.s.inputId!));
  await withTenant(d.db, { organisationId }, async (t) => {
    const x = await load(t, sessionId);
    if (!x || x.s.state !== 'STARTING') return;
    await t.insert(providerResources).values({ organisationId, provider: d.media.name, kind: 'room', providerId: x.s.roomName, resourceType: 'broadcast_session', resourceId: x.s.id }).onConflictDoNothing();
    await setSession(t, x.s, 'WAITING_FOR_INPUT');
  });
  await reconcileSession(d, organisationId, sessionId);
  return 'ok';
}

async function failSession(d: MediaControlDeps, t: Tx, s: typeof broadcastSessions.$inferSelect, error: Record<string, unknown>) {
  await setSession(t, s, 'FAILED', error, { endedAt: new Date(now(d)) });
  await t.update(outputSessions).set({ state: 'FAILED', error, endedAt: new Date(now(d)), updatedAt: new Date() }).where(and(eq(outputSessions.broadcastSessionId, s.id), notInArray(outputSessions.state, ['STOPPED', 'FAILED'])));
  await release(d, t, s);
}

async function release(d: MediaControlDeps, t: Tx, s: typeof broadcastSessions.$inferSelect) {
  const os = await t.select({ id: outputSessions.id }).from(outputSessions).where(eq(outputSessions.broadcastSessionId, s.id));
  if (os.length) await t.update(capacityReservations).set({ releasedAt: new Date(now(d)) }).where(and(inArray(capacityReservations.outputSessionId, os.map((x) => x.id)), isNull(capacityReservations.releasedAt)));
  if (s.inputId) await t.update(inputs).set({ boundSessionId: null, status: 'idle', updatedAt: new Date() }).where(and(eq(inputs.id, s.inputId), eq(inputs.boundSessionId, s.id)));
}

/** Map provider stream results back to our destinations (same order as requested). */
async function updateDestinationStatuses(t: Tx, outputId: string, requested: string[], st: OutputStatus) {
  for (let i = 0; i < requested.length; i++) {
    const s = st.streams[i];
    await t.update(destinations).set({ lastStatus: { status: s?.status ?? 'unknown', error: s?.error ?? null, at: new Date().toISOString() }, updatedAt: new Date() }).where(eq(destinations.id, requested[i]!));
  }
  void outputId;
}

async function startOutput(d: MediaControlDeps, t: Tx, s: typeof broadcastSessions.$inferSelect, os: typeof outputSessions.$inferSelect, o: typeof streamOutputs.$inferSelect, partIndex: number) {
  const dests = (await t.select().from(destinations).where(and(eq(destinations.outputId, o.id), eq(destinations.enabled, true))).orderBy(destinations.createdAt, destinations.id)).slice(0, 3);
  let recordingKey: string | null = null;
  let rec: typeof recordings.$inferSelect | undefined;
  if (o.record) {
    [rec] = await t.select().from(recordings).where(eq(recordings.outputSessionId, os.id));
    if (!rec) [rec] = await t.insert(recordings).values({ organisationId: s.organisationId, matchId: s.matchId, outputSessionId: os.id, outputId: o.id, kind: o.mode === 'PROGRAMME' ? 'programme' : 'clean', title: `${o.name} recording`, state: 'PENDING', storagePrefix: keys.recordingPrefix(s.organisationId, os.id) }).returning();
    recordingKey = `${rec!.storagePrefix}part-${partIndex}.mp4`;
  }
  // mark the request before calling out: if the call times out after the provider accepted it, the next
  // reconcile adopts the egress by its os= correlation id instead of starting a duplicate
  await t.update(outputSessions).set({ state: 'REQUESTING', updatedAt: new Date() }).where(eq(outputSessions.id, os.id));
  let providerId: string;
  try {
    ({ providerId } = await d.media.startOutput({
    roomName: s.roomName,
    templateUrl: templateUrl(d.config, o, s, os.id),
    preset: o.preset as OutputPreset,
    hls: o.hls ? { prefix: `${hlsPrefix(s.organisationId, os.id)}${partIndex ? `p${partIndex}_` : ''}`, segmentSeconds: 2 } : null,
    file: recordingKey ? { key: recordingKey } : null,
    rtmp: dests.map((x) => destinationUrl(x, d.config.ENCRYPTION_KEY)),
    }));
  } catch (e) {
    await t.update(outputSessions).set({ error: { code: 'EGRESS_REQUEST_UNCONFIRMED', message: (e as Error).message }, updatedAt: new Date() }).where(eq(outputSessions.id, os.id));
    return;
  }
  await adoptEgress(t, d, s, os.id, providerId, dests.map((x) => x.id), partIndex);
  if (rec) {
    await t.insert(recordingParts).values({ organisationId: s.organisationId, recordingId: rec.id, partIndex, egressId: providerId, mp4Key: recordingKey, playlistKey: o.hls ? `${hlsPrefix(s.organisationId, os.id)}${partIndex ? `p${partIndex}_` : ''}index.m3u8` : null, calibrationMs: o.calibrationMs, state: 'RECORDING' }).onConflictDoNothing();
    await t.update(recordings).set({ state: 'RECORDING', updatedAt: new Date() }).where(eq(recordings.id, rec.id));
  }
}

async function adoptEgress(t: Tx, d: MediaControlDeps, s: typeof broadcastSessions.$inferSelect, osId: string, providerId: string, destinationIds: string[], partIndex: number) {
  await t.insert(providerResources).values({ organisationId: s.organisationId, provider: d.media.name, kind: 'egress', providerId, resourceType: 'output_session', resourceId: osId, fence: partIndex + 1, details: { destinations: destinationIds, partIndex } }).onConflictDoNothing();
  await t.update(outputSessions).set({ state: 'STARTING', error: null, startedAt: sql`coalesce(${outputSessions.startedAt}, now())`, updatedAt: new Date() }).where(eq(outputSessions.id, osId));
}

/** Idempotent state convergence from provider truth. Called by jobs, webhooks and the periodic loop. */
export async function reconcileSession(d: MediaControlDeps, organisationId: string, sessionId: string) {
  return withTenant(d.db, { organisationId }, async (t) => {
    // one reconciler per session at a time (jobs, webhooks and the loop may overlap)
    const lk = await t.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${'bs:reconcile:' + sessionId})) as ok`);
    if (!lk.rows[0]?.ok) return 'BUSY';
    const x = await load(t, sessionId);
    if (!x) return null;
    const { s } = x;
    if (!(ACTIVE_SESSION_STATES as readonly string[]).includes(s.state)) return s.state;
    if (s.state === 'STOPPING') return finishStop(d, t, s, x.os);
    const tracks = s.inputId ? await d.media.participantTracks(s.roomName, inputIdentity(s.inputId)) : null;
    const ing = s.inputId ? await ingressId(t, s.inputId) : null;
    const health = ing ? await d.media.inputHealth(ing).catch(() => null) : null;
    const hasVideo = !!tracks && tracks.video > 0;
    if (s.inputId) await t.update(inputs).set({ status: hasVideo ? 'receiving' : 'bound', lastHealth: { ...(health ?? {}), tracks, checkedAt: new Date(now(d)).toISOString() } as never, updatedAt: new Date() }).where(eq(inputs.id, s.inputId));

    if (s.state === 'WAITING_FOR_INPUT' && !hasVideo) {
      if (now(d) - (s.startedAt?.getTime() ?? now(d)) > (d.inputWaitMs ?? INPUT_WAIT_MS)) await failSession(d, t, s, { code: 'NO_INPUT', message: 'No source video arrived within the wait window. Check the encoder URL/key and start again.' });
      return s.state;
    }
    let live = 0;
    let degradedReason: string | null = null;
    for (const { os, o } of x.os) {
      if (['STOPPED', 'FAILED'].includes(os.state)) continue;
      const eg = await egressFor(t, os.id);
      const cur = eg[0];
      if (!cur) {
        if (os.state === 'REQUESTING') {
          // a start request whose response was lost: adopt the provider egress tagged with our id, else retry later
          const found = (await d.media.listRoomOutputs(s.roomName).catch(() => [])).find((e) => e.templateUrl?.includes(`os=${os.id}`) && !['complete', 'failed', 'aborted'].includes(e.state));
          if (found) {
            const dests = (await t.select({ id: destinations.id }).from(destinations).where(and(eq(destinations.outputId, o.id), eq(destinations.enabled, true))).orderBy(destinations.createdAt, destinations.id)).slice(0, 3);
            await adoptEgress(t, d, s, os.id, found.providerId, dests.map((x) => x.id), 0);
            const [rec] = await t.select().from(recordings).where(eq(recordings.outputSessionId, os.id));
            if (rec) await t.insert(recordingParts).values({ organisationId: s.organisationId, recordingId: rec.id, partIndex: 0, egressId: found.providerId, mp4Key: `${rec.storagePrefix}part-0.mp4`, playlistKey: o.hls ? `${hlsPrefix(s.organisationId, os.id)}index.m3u8` : null, calibrationMs: o.calibrationMs, state: 'RECORDING' }).onConflictDoNothing();
          } else if (now(d) - os.updatedAt.getTime() > 120_000) await t.update(outputSessions).set({ state: 'PENDING', updatedAt: new Date() }).where(eq(outputSessions.id, os.id));
          continue;
        }
        if (hasVideo) await startOutput(d, t, s, os, o, 0); // first source frame → request egress
        continue;
      }
      const st = await d.media.outputStatus(cur.providerId).catch(() => null);
      if (!st) continue;
      await updateDestinationStatuses(t, o.id, (cur.details as { destinations?: string[] }).destinations ?? [], st);
      if (st.state === 'active') {
        live++;
        if (os.state !== 'LIVE') await t.update(outputSessions).set({ state: 'LIVE', liveAt: os.liveAt ?? new Date(now(d)), error: null, updatedAt: new Date() }).where(eq(outputSessions.id, os.id));
        const [part] = await t.select().from(recordingParts).where(eq(recordingParts.egressId, cur.providerId));
        if (part && !part.captureStartAt && st.startedAt) await t.update(recordingParts).set({ captureStartAt: new Date(st.startedAt) }).where(eq(recordingParts.id, part.id));
        if (st.streams.some((x) => x.status === 'failed')) degradedReason = 'A destination failed; other outputs continue';
      } else if (['failed', 'aborted', 'limit_reached', 'complete'].includes(st.state)) {
        // provider terminated the egress while the session is live: bounded retry as a new recording part
        await t.update(providerResources).set({ state: 'ended', updatedAt: new Date() }).where(eq(providerResources.id, cur.id));
        await t.update(recordingParts).set({ state: 'PARTIAL', endedAt: new Date(now(d)) }).where(eq(recordingParts.egressId, cur.providerId));
        if (eg.length <= (d.maxEgressRetries ?? 3)) {
          await t.update(outputSessions).set({ state: 'STARTING', error: { code: 'EGRESS_RESTARTED', message: st.error ?? `Provider output ${st.state}; restarted` }, updatedAt: new Date() }).where(eq(outputSessions.id, os.id));
          await startOutput(d, t, s, os, o, eg.length);
        } else {
          await t.update(outputSessions).set({ state: 'FAILED', error: { code: 'EGRESS_FAILED', message: st.error ?? `Provider output ${st.state}` }, endedAt: new Date(now(d)), updatedAt: new Date() }).where(eq(outputSessions.id, os.id));
          await t.update(capacityReservations).set({ releasedAt: new Date(now(d)) }).where(and(eq(capacityReservations.outputSessionId, os.id), isNull(capacityReservations.releasedAt)));
        }
      }
    }
    const active = x.os.filter(({ os }) => !['STOPPED', 'FAILED'].includes(os.state)).length;
    if (!active && x.os.length) {
      await failSession(d, t, s, { code: 'ALL_OUTPUTS_FAILED', message: 'Every output failed at the provider' });
      return 'FAILED';
    }
    if (live) {
      const next = !hasVideo ? 'DEGRADED' : degradedReason ? 'DEGRADED' : 'LIVE';
      await setSession(t, s, next, next === 'DEGRADED' ? { code: hasVideo ? 'DESTINATION_FAILED' : 'INPUT_LOST', message: hasVideo ? degradedReason : 'Source lost: holding slate on air, recording continues' } : null);
      return next;
    }
    if (s.state === 'WAITING_FOR_INPUT' && hasVideo) await setSession(t, s, 'STARTING');
    return s.state;
  });
}

async function finishStop(d: MediaControlDeps, t: Tx, s: typeof broadcastSessions.$inferSelect, os: { os: typeof outputSessions.$inferSelect; o: typeof streamOutputs.$inferSelect }[]) {
  let pending = 0;
  for (const { os: x } of os) {
    for (const eg of await egressFor(t, x.id)) {
      if (eg.state === 'ended') continue;
      const st = await d.media.outputStatus(eg.providerId).catch(() => null);
      if (st && ['starting', 'active'].includes(st.state)) {
        await d.media.stopOutput(eg.providerId);
        pending++;
        continue;
      }
      if (st && st.state === 'ending') {
        pending++;
        continue;
      }
      await t.update(providerResources).set({ state: 'ended', updatedAt: new Date() }).where(eq(providerResources.id, eg.id));
      await t.update(recordingParts).set({ state: st?.state === 'complete' ? 'READY' : 'PARTIAL', durationMs: st?.file?.durationMs ?? null, endedAt: new Date(now(d)) }).where(eq(recordingParts.egressId, eg.providerId));
    }
    if (!['STOPPED', 'FAILED'].includes(x.state) && !pending) {
      const end = new Date(now(d));
      await t.update(outputSessions).set({ state: 'STOPPED', endedAt: end, updatedAt: new Date() }).where(eq(outputSessions.id, x.id));
      if (x.liveAt) await recordUsage(t, { organisationId: s.organisationId, module: 'streaming', sessionRef: x.id, quantity: Math.round((end.getTime() - x.liveAt.getTime()) / 1000), unit: 'output_seconds', start: x.liveAt, end, dedupKey: `output:${x.id}`, details: { broadcastSessionId: s.id, preset: x.preset, demo: s.demo } });
    }
  }
  if (pending) return 'STOPPING';
  // recordings: READY when every part completed, PARTIAL if any part was interrupted
  const recs = os.length ? await t.select().from(recordings).where(inArray(recordings.outputSessionId, os.map((x) => x.os.id))) : [];
  for (const r of recs) {
    const parts = await t.select().from(recordingParts).where(eq(recordingParts.recordingId, r.id));
    const state = !parts.length ? 'FAILED' : parts.every((p) => p.state === 'READY') ? 'READY' : parts.some((p) => p.state === 'READY' || p.state === 'PARTIAL') ? 'PARTIAL' : 'FAILED';
    const first = parts.sort((a, b) => a.partIndex - b.partIndex)[0];
    await t.update(recordings).set({ state, mp4Key: first?.mp4Key ?? null, playlistKey: first?.playlistKey ?? null, durationMs: parts.reduce((n, p) => n + (p.durationMs ?? 0), 0) || null, updatedAt: new Date() }).where(eq(recordings.id, r.id));
    await enqueueOutbox(t, { organisationId: s.organisationId, topic: 'recording.updated', aggregateType: 'recording', aggregateId: r.id, payload: { recordingId: r.id, matchId: s.matchId, state } });
  }
  await release(d, t, s);
  // unbind at the provider: the input goes back to its idle room; only this session's room is deleted
  if (s.inputId) {
    const ing = await ingressId(t, s.inputId);
    if (ing) await d.media.bindInput(ing, idleRoom(s.inputId), inputIdentity(s.inputId)).catch(() => undefined);
  }
  await d.media.deleteRoom(s.roomName).catch(() => undefined);
  await t.update(providerResources).set({ state: 'ended', updatedAt: new Date() }).where(and(eq(providerResources.kind, 'room'), eq(providerResources.providerId, s.roomName)));
  await setSession(t, s, 'STOPPED', null, { endedAt: new Date(now(d)) });
  return 'STOPPED';
}

export async function stopSessionJob(d: MediaControlDeps, organisationId: string, sessionId: string) {
  return reconcileSession(d, organisationId, sessionId);
}

/** Periodic convergence for every active session (worker loop). */
export async function reconcileActive(d: MediaControlDeps) {
  const rows = await d.db.select({ id: broadcastSessions.id, org: broadcastSessions.organisationId }).from(broadcastSessions).where(inArray(broadcastSessions.state, ['WAITING_FOR_INPUT', 'STARTING', 'LIVE', 'DEGRADED', 'STOPPING']));
  for (const r of rows) await reconcileSession(d, r.org, r.id).catch((e) => console.error('[media] reconcile failed', r.id, (e as Error).message));
  return rows.length;
}

/** Webhooks are deduplicated by provider event id, then trigger reconciliation (never trusted alone). */
export async function handleWebhook(d: MediaControlDeps, ev: ProviderWebhookEvent) {
  const [ins] = await d.db.insert(providerWebhookEvents).values({ id: ev.id, provider: d.media.name, event: ev.event, payload: ev.raw }).onConflictDoNothing().returning();
  if (!ins) return { duplicate: true };
  let session: { id: string; org: string } | undefined;
  if (ev.roomName?.startsWith('bs_') && !ev.roomName.startsWith('bs_idle_')) {
    [session] = await d.db.select({ id: broadcastSessions.id, org: broadcastSessions.organisationId }).from(broadcastSessions).where(eq(broadcastSessions.roomName, ev.roomName));
  } else if (ev.egressId) {
    const [r] = await d.db.select().from(providerResources).where(and(eq(providerResources.kind, 'egress'), eq(providerResources.providerId, ev.egressId)));
    if (r) [session] = await d.db.select({ id: broadcastSessions.id, org: broadcastSessions.organisationId }).from(broadcastSessions).innerJoin(outputSessions, eq(outputSessions.broadcastSessionId, broadcastSessions.id)).where(eq(outputSessions.id, r.resourceId));
  }
  if (session) await reconcileSession(d, session.org, session.id);
  await d.db.update(providerWebhookEvents).set({ processedAt: new Date() }).where(eq(providerWebhookEvents.id, ev.id));
  return { duplicate: false, sessionId: session?.id ?? null };
}

/**
 * After a restart: provider egresses we do not know about in our rooms are stopped (no duplicate resources);
 * known ones are adopted by reconciliation.
 */
export async function reconcileOrphans(d: MediaControlDeps) {
  const rows = await d.db.select().from(broadcastSessions).where(inArray(broadcastSessions.state, ['STARTING', 'LIVE', 'DEGRADED', 'STOPPING', 'WAITING_FOR_INPUT']));
  let stopped = 0;
  for (const s of rows) {
    const known = new Set((await d.db.select({ p: providerResources.providerId }).from(providerResources).where(and(eq(providerResources.kind, 'egress'), eq(providerResources.organisationId, s.organisationId)))).map((x) => x.p));
    for (const e of await d.media.listRoomOutputs(s.roomName).catch(() => [])) {
      if (!known.has(e.providerId) && ['starting', 'active'].includes(e.state)) {
        await d.media.stopOutput(e.providerId);
        stopped++;
      }
    }
  }
  return stopped;
}

/** Scheduled starts (pre-roll) and stops (post-roll after the final phase), versioned against reschedules. */
export async function scanSchedules(d: MediaControlDeps, start: (organisationId: string, matchId: string, scheduleVersion: number) => Promise<unknown>, stop: (organisationId: string, matchId: string) => Promise<unknown>) {
  const t0 = now(d);
  const due = await d.db
    .select({ o: streamOutputs, m: matches })
    .from(streamOutputs)
    .innerJoin(matches, eq(matches.id, streamOutputs.matchId))
    .where(and(eq(streamOutputs.autoSchedule, true), inArray(matches.status, ['scheduled', 'live']), sql`${matches.scheduledAt} - make_interval(secs => ${streamOutputs.prerollSeconds}) <= ${new Date(t0)}`, sql`${matches.scheduledAt} > ${new Date(t0 - 6 * 3600_000)}`));
  for (const r of due) {
    const [active] = await d.db.select({ id: broadcastSessions.id }).from(broadcastSessions).where(and(eq(broadcastSessions.matchId, r.m.id), inArray(broadcastSessions.state, [...ACTIVE_SESSION_STATES, 'STOPPED']))).limit(1);
    if (!active) await start(r.o.organisationId, r.m.id, r.o.scheduleVersion).catch((e) => console.warn('[media] scheduled start refused', r.m.id, (e as Error).message));
  }
  const ending = await d.db
    .select({ s: broadcastSessions, m: matches, post: sql<number>`max(${streamOutputs.postrollSeconds})` })
    .from(broadcastSessions)
    .innerJoin(matches, eq(matches.id, broadcastSessions.matchId))
    .innerJoin(streamOutputs, and(eq(streamOutputs.matchId, matches.id), eq(streamOutputs.autoSchedule, true)))
    .where(and(inArray(broadcastSessions.state, ['LIVE', 'DEGRADED', 'WAITING_FOR_INPUT', 'STARTING']), eq(matches.status, 'completed')))
    .groupBy(broadcastSessions.id, matches.id);
  for (const r of ending) if (t0 - r.m.updatedAt.getTime() >= Number(r.post) * 1000) await stop(r.s.organisationId, r.m.id);
}

/** Provider from configuration. The fake adapter is only for tests/explicit demo mode and labels itself demo. */
export function createMediaProvider(cfg: AppConfig): MediaProvider {
  return cfg.MEDIA_PROVIDER === 'fake'
    ? createFakeProvider()
    : createLiveKitProvider({ httpUrl: cfg.INTERNAL_LIVEKIT_HTTP, apiKey: cfg.LIVEKIT_API_KEY, apiSecret: cfg.LIVEKIT_API_SECRET, rtmpBaseUrl: cfg.PUBLIC_RTMP_URL });
}
