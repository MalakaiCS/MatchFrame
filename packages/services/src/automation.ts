// Automation runtime (worker side, spec §11). Trigger processing creates durable runs and cues; a fenced
// dispatcher executes due cues through the same overlay command handler as operators. All decisions are
// written to automation_runs / automation_cues so the control room can explain what fired, waited or skipped.
import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  automationCues,
  automationRuns,
  matchFacts,
  matchLineups,
  matchState,
  matches,
  overlayState,
  overlays,
  triggerOccurrences,
  withTenant,
  type Db,
  type Tx,
} from '@bs/db';
import {
  clockCrossings,
  clockDisplayMs,
  decidePriority,
  executionKey,
  getAdapter,
  matchTriggers,
  phaseBoundCancellations,
  phaseStepCancellations,
  planRun,
  playlistLayers,
  replay,
  type ActiveRun,
  type ClockState,
  type MatchProjection,
  type GamePlan,
  type LineupSnapshot,
  type LogEntry,
  type Placement,
  type Playlist,
  type TriggerInput,
  type TriggerMatch,
} from '@bs/domain';
import { findTemplate, pruneExpired, validateVariables, type Cue, type Layer, type OverlayCommand, type OverlayPublicState } from '@bs/graphics';
import type { AppConfig } from '@bs/config';
import { systemActor } from './authz';
import { AppError, conflict, notFound } from './errors';
import { tx, type Ctx } from './context';
import { audit } from './audit';
import { applyOverlayCommandTx, customDefs, mutateOverlayStateTx, type CommandOpts } from './overlays';
import { loadPlanVersion, templateLayerMap } from './gameplans';
import { availablePlacements, closeStaleExposures, decide, fixedDecision } from './sponsors';

export const LEASE_RESOURCE = 'automation';
export const SLOT_ROTATION_MS = 30_000;

export interface AutomationDeps {
  db: Db; // worker role (BYPASSRLS); tenant context is still set per transaction
  config: AppConfig;
  workerId: string;
  now?: () => number;
}
type Fence = NonNullable<CommandOpts['fence']>;

const now = (d: AutomationDeps) => (d.now ? d.now() : Date.now());

/** Deterministic UUID from a string (idempotent command ids for derived commands). */
export function stableUuid(s: string) {
  const h = crypto.createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ------------------------------------------------------------------ lease

/** Acquire/renew the fenced automation lease. Takeover (expired owner) bumps the fence. */
export async function acquireLease(db: Db, owner: string, ttlMs = 10_000): Promise<Fence | null> {
  const r = await db.execute(sql`
    insert into worker_leases (resource, owner, fence, expires_at) values (${LEASE_RESOURCE}, ${owner}, 1, now() + (${ttlMs} || ' milliseconds')::interval)
    on conflict (resource) do update set
      fence = case when worker_leases.owner = excluded.owner then worker_leases.fence else worker_leases.fence + 1 end,
      owner = excluded.owner,
      expires_at = excluded.expires_at
    where worker_leases.owner = excluded.owner or worker_leases.expires_at < now()
    returning fence`);
  const row = r.rows[0] as { fence: string | number } | undefined;
  return row ? { resource: LEASE_RESOURCE, owner, fence: Number(row.fence) } : null;
}

export async function releaseLease(db: Db, owner: string) {
  await db.execute(sql`delete from worker_leases where resource = ${LEASE_RESOURCE} and owner = ${owner}`);
}

// ------------------------------------------------------------------ helpers

const planCache = new Map<string, { plan: GamePlan; sport: string }>();
async function planFor(t: Tx, versionId: string) {
  const hit = planCache.get(versionId);
  if (hit) return hit;
  const v = await loadPlanVersion(t, versionId);
  if (!v) return null;
  const val = { plan: v.plan, sport: v.sport };
  planCache.set(versionId, val); // published versions are immutable
  return val;
}

const sysCtx = (d: AutomationDeps, organisationId: string): Ctx => ({ db: d.db, config: d.config, now: d.now, actor: systemActor(organisationId) });

function playlistById(plan: GamePlan, id: string): Playlist | undefined {
  return plan.playlists.find((p) => p.id === id);
}

interface RunContext {
  occurredAt: number;
  context: Record<string, unknown>;
  liveTrigger: boolean;
  loop: number;
  phaseKind?: string;
}

async function activeRuns(t: Tx, overlayId: string, states = ['running']) {
  const rows = await t.select().from(automationRuns).where(and(eq(automationRuns.overlayId, overlayId), inArray(automationRuns.state, states)));
  return rows.map((r): ActiveRun & { row: typeof r } => ({ runId: r.id, playlistId: r.playlistId, priority: r.priority, layers: r.layers, state: r.state as 'running' | 'queued', createdAt: r.createdAt.getTime(), promotional: r.promotional, kind: r.playlistKind as Playlist['kind'], row: r }));
}

async function insertCues(t: Tx, run: typeof automationRuns.$inferSelect, pl: Playlist, rc: RunContext, startAt: number, layers: Record<string, string>, freshnessMs: number) {
  const m: TriggerMatch = { playlist: pl, trigger: pl.triggers.find((x) => x.id === run.triggerId) ?? pl.triggers[0]!, iteration: run.iteration, occurredAt: rc.occurredAt, context: rc.context };
  const planned = planRun(pl, m, startAt, { freshnessMs, templateLayers: layers, liveTrigger: rc.liveTrigger && rc.loop === 0 });
  await t.insert(automationCues).values(
    planned.map((c) => ({
      organisationId: run.organisationId,
      runId: run.id,
      overlayId: run.overlayId,
      cueKey: `${run.id}:${rc.loop}:${c.itemIndex}`,
      itemIndex: c.itemIndex,
      action: c.item.action,
      params: { item: c.item, variables: c.variables, layer: c.layer, loop: rc.loop } as never,
      dueAt: new Date(c.dueAt),
      deadlineAt: c.deadlineAt ? new Date(c.deadlineAt) : null,
      durationMs: c.durationMs,
      // manual playlists park their graphics until a producer approves them in the control room
      state: pl.approval === 'manual' && ['show', 'media', 'creative', 'sponsor'].includes(c.item.action) ? 'awaiting_approval' : 'pending',
    })),
  ).onConflictDoNothing();
}

/** Stop a run: pending cues are cancelled and a cleanup cue takes its on-air layers out (via the fenced dispatcher). */
async function stopRun(t: Tx, runId: string, state: 'cancelled' | 'preempted', reason: string, at: number, cleanup = true) {
  const [r] = await t.update(automationRuns).set({ state, reason, endedAt: new Date(at) }).where(and(eq(automationRuns.id, runId), inArray(automationRuns.state, ['running', 'queued']))).returning();
  if (!r) return;
  await t.update(automationCues).set({ state: 'cancelled', reason, updatedAt: new Date(at) }).where(and(eq(automationCues.runId, runId), inArray(automationCues.state, ['pending', 'awaiting_approval'])));
  if (cleanup && r.startedAt) await t.insert(automationCues).values({ organisationId: r.organisationId, runId, overlayId: r.overlayId, cueKey: `${runId}:cleanup`, itemIndex: -1, action: 'cleanup', params: { reason }, dueAt: new Date(at), state: 'pending' }).onConflictDoNothing();
}

// ------------------------------------------------------------------ trigger processing

export interface TriggerSource {
  sourceFactId?: string | null;
  sourceFactRevision?: number | null;
  onlyOverlayId?: string;
  /** replaying the current phase for an output that has just got a plan (see onOutputReady) */
  catchUp?: boolean;
}

/** Evaluate one trigger input against every automated overlay of a match. Idempotent via execution keys. */
export async function processTrigger(d: AutomationDeps, organisationId: string, matchId: string, input: TriggerInput, src: TriggerSource = {}) {
  return withTenant(d.db, { organisationId }, async (t) => {
    const ovs = await t.select().from(overlays).where(and(eq(overlays.matchId, matchId), eq(overlays.status, 'active'), src.onlyOverlayId ? eq(overlays.id, src.onlyOverlayId) : undefined));
    const out: { overlayId: string; started: string[]; queued: string[]; skipped: { playlistId: string; reason: string }[] }[] = [];
    for (const ov of ovs) {
      if (!ov.gamePlanVersionId) continue;
      out.push(await triggerForOverlay(t, d, ov, input, src));
    }
    return out;
  });
}

async function triggerForOverlay(t: Tx, d: AutomationDeps, ov: typeof overlays.$inferSelect, input: TriggerInput, src: TriggerSource) {
  const at = now(d);
  const res = { overlayId: ov.id, started: [] as string[], queued: [] as string[], skipped: [] as { playlistId: string; reason: string }[] };
  const pv = await planFor(t, ov.gamePlanVersionId!);
  if (!pv) return res;
  const { plan } = pv;
  const [st] = await t.select().from(overlayState).where(eq(overlayState.overlayId, ov.id)).for('update');
  if (!st) return res;
  const { layers: tl } = await templateLayerMap(t, ov.organisationId);
  const [lu] = await t.select().from(matchLineups).where(eq(matchLineups.matchId, ov.matchId));
  const snap = lu?.snapshot as unknown as LineupSnapshot | undefined;
  const sponsorGuards = plan.playlists.flatMap((p) => p.guards.filter((g) => g.type === 'sponsor_available').map((g) => (g as { placement: string }).placement));
  const avail = await availablePlacements(t, ov.organisationId, ov.matchId, [...new Set(sponsorGuards)], at);
  const [ms] = await t.select().from(matchState).where(eq(matchState.matchId, ov.matchId));
  const liveLayers = Object.entries((st.layers ?? {}) as Record<string, { startedAt?: number; outAt?: number | null } | null>).filter(([layer, c]) => c && layer !== 'scoreboard' && !c.outAt);
  const lastGraphicAt = liveLayers.length ? Math.max(...liveLayers.map(([, c]) => Number(c!.startedAt ?? 0))) : null;
  const mainClock = (ms?.clocks as Record<string, ClockState> | undefined)?.main;
  const guard = {
    hasLineup: !!snap && snap.home.length > 0 && snap.away.length > 0,
    sponsorAvailable: (p: string) => avail.has(p),
    now: at,
    projection: (ms?.projection as unknown as MatchProjection) ?? null,
    clockMs: mainClock ? clockDisplayMs(mainClock, at) : null,
    lastGraphicAt,
  };

  if (input.kind === 'phase') {
    const act = await activeRuns(t, ov.id, ['running', 'queued']);
    for (const c of phaseBoundCancellations(act, input.phaseKind)) await stopRun(t, c.runId, 'cancelled', c.reason, at);
    for (const c of phaseStepCancellations(plan, act, input)) await stopRun(t, c.runId, 'cancelled', c.reason, at);
    // default scorebug in play phases (Auto mode only)
    if (plan.defaultScorebug && input.phaseKind === 'play' && st.mode === 'auto' && !st.inhibited && !st.scorebugVisible) await defaultScorebugRun(t, ov, `phase:${input.phaseId}:${input.seq}`, at);
  }

  const found = matchTriggers(plan, input, guard);
  // catching up in the middle of a half: only the scorebug (above); a kick-off banner at minute 30 would be wrong
  const midPlay = !!src.catchUp && input.kind === 'phase' && input.phaseKind === 'play';
  const hits = midPlay ? [] : found.matches;
  const skipped = midPlay ? [] : found.skipped;
  const record = async (pl: Playlist, triggerId: string, iteration: string, state: string, reason: string, extra: Partial<typeof automationRuns.$inferInsert> = {}) => {
    const [row] = await t
      .insert(automationRuns)
      .values({ organisationId: ov.organisationId, overlayId: ov.id, matchId: ov.matchId, gamePlanVersionId: ov.gamePlanVersionId!, playlistId: pl.id, triggerId, iteration, executionKey: executionKey(ov.id, ov.gamePlanVersionId!, triggerId, pl.id, iteration), priority: pl.priority, playlistKind: pl.kind, promotional: pl.promotional, layers: playlistLayers(pl, tl), triggerContext: {}, sourceFactId: src.sourceFactId ?? null, sourceFactRevision: src.sourceFactRevision ?? null, state, reason, ...extra })
      .onConflictDoNothing({ target: automationRuns.executionKey })
      .returning();
    return row ?? null;
  };
  for (const s of skipped) {
    const pl = playlistById(plan, s.playlistId);
    const iter = input.kind === 'event' ? `fact:${input.factId}:${input.factRevision}` : `${input.kind}:${at}`;
    if (pl && (await record(pl, s.triggerId, `${iter}:skip`, 'skipped', s.reason, { endedAt: new Date(at) }))) res.skipped.push({ playlistId: s.playlistId, reason: s.reason });
  }
  for (const m of hits) {
    const pl = m.playlist;
    const rc: RunContext = { occurredAt: m.occurredAt, context: m.context, liveTrigger: input.kind === 'event', loop: 0, phaseKind: input.phaseKind };
    let reason: string | null = null;
    if (st.inhibited) reason = 'Emergency clear is active: automation paused';
    else if (st.mode === 'manual') reason = 'Manual mode: automatic takes paused (not replayed on return to Auto)';
    else if (input.kind === 'event' && m.occurredAt + plan.freshnessMs < at) reason = `Fact is older than the ${plan.freshnessMs / 1000}s live window`;
    else if (pl.cooldownMs) {
      const [recent] = await t.select({ id: automationRuns.id }).from(automationRuns).where(and(eq(automationRuns.overlayId, ov.id), eq(automationRuns.playlistId, pl.id), sql`${automationRuns.startedAt} > ${new Date(at - pl.cooldownMs)}`)).limit(1);
      if (recent) reason = `Cooldown: played less than ${Math.round(pl.cooldownMs / 1000)}s ago`;
    }
    if (reason) {
      if (await record(pl, m.trigger.id, m.iteration, 'skipped', reason, { triggerContext: rc as never, endedAt: new Date(at) })) res.skipped.push({ playlistId: pl.id, reason });
      continue;
    }
    const layers = playlistLayers(pl, tl);
    const act = await activeRuns(t, ov.id);
    const dec = decidePriority({ priority: pl.priority, layers, promotional: pl.promotional }, act);
    if (dec.action === 'skip') {
      if (await record(pl, m.trigger.id, m.iteration, 'skipped', dec.reason, { triggerContext: rc as never, endedAt: new Date(at) })) res.skipped.push({ playlistId: pl.id, reason: dec.reason });
      continue;
    }
    if (dec.action === 'queue') {
      const deadline = input.kind === 'event' ? m.occurredAt + plan.freshnessMs : at + 60_000;
      if (await record(pl, m.trigger.id, m.iteration, 'queued', dec.reason, { triggerContext: rc as never, deadlineAt: new Date(deadline) })) res.queued.push(pl.id);
      continue;
    }
    const run = await record(pl, m.trigger.id, m.iteration, 'running', `${m.trigger.type} trigger`, { triggerContext: rc as never, startedAt: new Date(at) });
    if (!run) continue; // duplicate trigger: execution key already used
    for (const p of dec.preempt) await stopRun(t, p.runId, 'preempted', p.reason, at);
    await insertCues(t, run, pl, rc, at, tl, plan.freshnessMs);
    res.started.push(pl.id);
  }
  return res;
}

async function defaultScorebugRun(t: Tx, ov: typeof overlays.$inferSelect, occurrence: string, at: number) {
  const [run] = await t
    .insert(automationRuns)
    .values({ organisationId: ov.organisationId, overlayId: ov.id, matchId: ov.matchId, gamePlanVersionId: ov.gamePlanVersionId!, playlistId: '_default_scorebug', triggerId: 'default', iteration: occurrence, executionKey: executionKey(ov.id, ov.gamePlanVersionId!, 'default', '_default_scorebug', occurrence), priority: 4, playlistKind: 'in_play', layers: [], triggerContext: {}, state: 'running', reason: 'default scorebug for play phase', startedAt: new Date(at) })
    .onConflictDoNothing({ target: automationRuns.executionKey })
    .returning();
  if (run) await t.insert(automationCues).values({ organisationId: ov.organisationId, runId: run.id, overlayId: ov.id, cueKey: `${run.id}:0:0`, itemIndex: 0, action: 'scorebug_show', params: { item: { id: 'default', action: 'scorebug_show' }, variables: {}, layer: 'scoreboard', loop: 0 }, dueAt: new Date(at), state: 'pending' });
}

/** Build the event trigger input for an accepted fact (counters before/after via deterministic replay). */
export async function factTriggerInput(t: Tx, matchId: string, factId: string): Promise<{ input: TriggerInput; revision: number } | null> {
  const [f] = await t.select().from(matchFacts).where(eq(matchFacts.id, factId));
  if (!f || f.voided || f.category !== 'event') return null;
  const [m] = await t.select().from(matches).where(eq(matches.id, matchId));
  const adapter = getAdapter(m!.sport);
  const cfg = m!.rulesConfig as never;
  const log = (await t.select().from(matchFacts).where(and(eq(matchFacts.matchId, matchId), lte(matchFacts.sequence, f.sequence))).orderBy(asc(matchFacts.sequence))).map(
    (r): LogEntry => ({ sequence: r.sequence, category: r.category as LogEntry['category'], type: r.type, side: r.side as LogEntry['side'], playerId: r.playerId, payload: r.payload, periodId: r.periodId, clockMs: r.clockMs, voided: r.voided, occurredAt: r.occurredAt.getTime() }),
  );
  const after = replay(adapter, cfg, log);
  const before = replay(adapter, cfg, log.filter((x) => x.sequence < f.sequence));
  return {
    revision: f.revision,
    input: {
      kind: 'event',
      eventType: f.type,
      side: f.side as 'home' | 'away' | null,
      factId: f.id,
      factRevision: f.revision,
      playerId: f.playerId,
      payload: f.payload,
      clockMs: f.clockMs,
      phaseId: f.periodId,
      phaseKind: adapter.phase(cfg, f.periodId)?.kind ?? 'play',
      occurredAt: f.occurredAt.getTime(),
      at: Date.now(),
      historical: f.historical,
      counters: after.counters,
      prevCounters: before.counters,
    },
  };
}

export async function onFactAccepted(d: AutomationDeps, organisationId: string, matchId: string, factId: string) {
  const r = await withTenant(d.db, { organisationId }, (t) => factTriggerInput(t, matchId, factId));
  if (!r) return [];
  return processTrigger(d, organisationId, matchId, { ...r.input, at: now(d) }, { sourceFactId: factId, sourceFactRevision: r.revision });
}

export async function onPhaseChanged(d: AutomationDeps, organisationId: string, matchId: string, phaseId: string, seq: number, occurredAt: number) {
  const phase = await withTenant(d.db, { organisationId }, async (t) => {
    const [m] = await t.select().from(matches).where(eq(matches.id, matchId));
    return getAdapter(m!.sport).phase(m!.rulesConfig as never, phaseId);
  });
  if (!phase) return [];
  return processTrigger(d, organisationId, matchId, { kind: 'phase', phaseId, phaseTags: phase.tags, phaseKind: phase.kind, phaseLabel: phase.label, at: now(d), occurredAt, seq });
}

/**
 * An output that has just got a plan (created with the match, or a plan chosen on the checklist) catches up with
 * the match's current phase: a scheduled match shows its pre-match background and header at once, an output set
 * up during half time starts the half-time boards. Uses the same execution keys as the live phase trigger, so a
 * phase already handled for this output and plan version never runs twice.
 */
export async function onOutputReady(d: AutomationDeps, organisationId: string, overlayId: string) {
  const x = await withTenant(d.db, { organisationId }, async (t) => {
    const [r] = await t
      .select({ o: overlays, m: matches, ms: matchState })
      .from(overlays)
      .innerJoin(matches, eq(matches.id, overlays.matchId))
      .innerJoin(matchState, eq(matchState.matchId, overlays.matchId))
      .where(and(eq(overlays.id, overlayId), eq(overlays.organisationId, organisationId)));
    if (!r?.o.gamePlanVersionId || r.o.status !== 'active') return null;
    const phase = getAdapter(r.m.sport).phase(r.m.rulesConfig as never, r.ms.phase);
    const [last] = await t
      .select({ sequence: matchFacts.sequence, occurredAt: matchFacts.occurredAt })
      .from(matchFacts)
      .where(and(eq(matchFacts.matchId, r.m.id), eq(matchFacts.organisationId, organisationId), eq(matchFacts.category, 'phase'), eq(matchFacts.voided, false)))
      .orderBy(desc(matchFacts.sequence))
      .limit(1);
    return { matchId: r.m.id, phase, seq: last?.sequence ?? 0, occurredAt: last?.occurredAt.getTime() ?? r.m.createdAt.getTime() };
  });
  if (!x?.phase || x.phase.kind === 'terminal') return [];
  const input: TriggerInput = { kind: 'phase', phaseId: x.phase.id, phaseTags: x.phase.tags, phaseKind: x.phase.kind, phaseLabel: x.phase.label, at: now(d), occurredAt: x.occurredAt, seq: x.seq };
  return processTrigger(d, organisationId, x.matchId, input, { onlyOverlayId: overlayId, catchUp: true });
}

/** A corrected or voided fact withdraws graphics that were driven by its earlier revision (never re-celebrates). */
export async function onFactCorrected(d: AutomationDeps, organisationId: string, factId: string, toRevision: number) {
  return withTenant(d.db, { organisationId }, async (t) => {
    const runs = await t.select().from(automationRuns).where(and(eq(automationRuns.sourceFactId, factId), inArray(automationRuns.state, ['running', 'queued']), sql`${automationRuns.sourceFactRevision} < ${toRevision}`));
    for (const r of runs) await stopRun(t, r.id, 'cancelled', `source fact corrected (revision ${toRevision})`, now(d));
    return runs.length;
  });
}

/** Manual mode / emergency clear cancel all pending and queued automatic work; return to Auto restores the scorebug. */
export async function onOverlayCommand(d: AutomationDeps, organisationId: string, overlayId: string, p: { type: string; cancelAutomation?: boolean; source?: string }) {
  return withTenant(d.db, { organisationId }, async (t) => {
    const at = now(d);
    if (p.cancelAutomation) {
      const [st] = await t.select().from(overlayState).where(eq(overlayState.overlayId, overlayId));
      const reason = p.type === 'CLEAR_OUTPUT' ? 'Emergency clear' : 'Switched to Manual mode';
      for (const r of await activeRuns(t, overlayId, ['running', 'queued'])) await stopRun(t, r.runId, 'cancelled', reason, at, false);
      return { cancelled: true, mode: st?.mode };
    }
    if (p.type === 'SET_MODE' || p.type === 'RESUME') {
      const [row] = await t.select({ o: overlays, s: overlayState, ms: matchState, m: matches }).from(overlays).innerJoin(overlayState, eq(overlayState.overlayId, overlays.id)).innerJoin(matches, eq(matches.id, overlays.matchId)).innerJoin(matchState, eq(matchState.matchId, overlays.matchId)).where(eq(overlays.id, overlayId));
      if (!row?.o.gamePlanVersionId || row.s.mode !== 'auto' || row.s.inhibited || row.s.scorebugVisible) return { restored: false };
      const pv = await planFor(t, row.o.gamePlanVersionId);
      const kind = getAdapter(row.m.sport).phase(row.m.rulesConfig as never, row.ms.phase)?.kind;
      if (pv?.plan.defaultScorebug && kind === 'play') {
        await defaultScorebugRun(t, row.o, `restore:${row.s.revision}`, at);
        return { restored: true };
      }
    }
    return { restored: false };
  });
}

/** Operator-started playlist (manual trigger). */
export async function triggerManualPlaylist(ctx: Ctx, d: AutomationDeps, overlayId: string, playlistId: string, requestId: string) {
  const [ov] = await withTenant(d.db, { organisationId: ctx.actor.organisationId }, (t) => t.select().from(overlays).where(and(eq(overlays.id, overlayId), eq(overlays.organisationId, ctx.actor.organisationId))));
  if (!ov) throw new AppError('NOT_FOUND', 404, 'Overlay not found');
  const phaseKind = await withTenant(d.db, { organisationId: ov.organisationId }, async (t) => {
    const [r] = await t.select({ ms: matchState, m: matches }).from(matchState).innerJoin(matches, eq(matches.id, matchState.matchId)).where(eq(matchState.matchId, ov.matchId));
    return getAdapter(r!.m.sport).phase(r!.m.rulesConfig as never, r!.ms.phase)?.kind ?? 'pre';
  });
  const r = await processTrigger(d, ov.organisationId, ov.matchId, { kind: 'manual', playlistId, at: now(d), requestId, phaseKind }, { onlyOverlayId: overlayId });
  return r[0] ?? { overlayId, started: [], queued: [], skipped: [{ playlistId, reason: 'Overlay has no game plan' }] };
}

// ------------------------------------------------------------------ cue dispatcher

/** Same graphic fields, whatever order they were written in. */
function sameVariables(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) return false;
  return true;
}

const SPONSOR_TEMPLATE: Record<string, string> = { full_frame_image: 'builtin:full_frame_media', full_frame_video: 'builtin:full_frame_media', lower_third_banner: 'builtin:sponsor', detached_logo: 'builtin:sponsor', event_partner: 'builtin:sponsor' };

async function executeCue(t: Tx, d: AutomationDeps, fence: Fence, cue: typeof automationCues.$inferSelect, run: typeof automationRuns.$inferSelect): Promise<{ state: string; reason?: string; revision?: number }> {
  const ctx = sysCtx(d, cue.organisationId);
  const p = cue.params as { item: { action: string; templateKey?: string; layers?: Layer[]; placement?: string; creativeId?: string; assetId?: string; audio?: string }; variables: Record<string, unknown>; layer: Layer | null };
  const opts: CommandOpts = { source: 'automation', runId: run.id, priority: run.priority, fence };
  const send = async (command: OverlayCommand, idSuffix = '') => (await applyOverlayCommandTx(ctx, t, cue.overlayId, { commandId: idSuffix ? stableUuid(cue.id + idSuffix) : cue.id, command: command as never }, opts)).revision;
  const [st] = await t.select().from(overlayState).where(eq(overlayState.overlayId, cue.overlayId));
  const layers = (st?.layers ?? {}) as Partial<Record<Layer, Cue>>;
  const ownLayer = (l: Layer) => layers[l] && layers[l]!.runId === run.id && !layers[l]!.outAt;
  switch (cue.action) {
    case 'wait':
      return { state: 'done' };
    case 'show': {
      // line-up graphics only go to air for a team whose line-up has been entered (no "to be confirmed" boards)
      if (findTemplate(p.item.templateKey ?? '')?.requiredData.includes('lineup')) {
        const [lu] = await t.select().from(matchLineups).where(and(eq(matchLineups.matchId, run.matchId), eq(matchLineups.organisationId, run.organisationId)));
        const snap = lu?.snapshot as unknown as LineupSnapshot | undefined;
        const want = p.variables.team === 'away' ? ['away'] : p.variables.team === 'home' ? ['home'] : ['home', 'away'];
        const missing = want.filter((s) => !(snap?.[s as 'home' | 'away'] ?? []).some((x) => x.starter));
        if (missing.length) return { state: 'skipped', reason: `no line-up entered for the ${missing.join(' and ')} team: not shown` };
      }
      // a stay-on graphic that is already showing exactly this is left alone, so a later step that asks for it
      // again (the pre-match background at "Pre-match" after it went up at match creation) does not re-animate it
      const tpl = findTemplate(p.item.templateKey ?? '');
      const lay = p.layer ?? tpl?.layer;
      const cur = lay ? layers[lay] : undefined;
      if (cue.durationMs == null && tpl && cur && !cur.outAt && cur.templateKey === tpl.key && cur.durationMs == null) {
        const v = validateVariables(tpl, p.variables);
        if (v.ok && sameVariables(v.value, cur.variables)) return { state: 'skipped', reason: 'already on air' };
      }
      return { state: 'done', revision: await send({ type: 'TAKE_IN', templateKey: p.item.templateKey!, variables: p.variables, layer: p.layer ?? undefined, durationMs: cue.durationMs, cueId: cue.id }) };
    }
    case 'update':
      if (!p.layer || !ownLayer(p.layer)) return { state: 'skipped', reason: 'graphic from this playlist is no longer on air' };
      return { state: 'done', revision: await send({ type: 'UPDATE', layer: p.layer, variables: p.variables }) };
    case 'hide':
      if (!p.layer || !ownLayer(p.layer)) return { state: 'skipped', reason: 'nothing from this playlist on that layer' };
      return { state: 'done', revision: await send({ type: 'TAKE_OUT', layer: p.layer }) };
    case 'scorebug_show':
      if (st?.scorebugVisible) return { state: 'skipped', reason: 'scorebug already visible' };
      return { state: 'done', revision: await send({ type: 'SHOW_SCOREBUG' }) };
    case 'scorebug_hide':
      return { state: 'done', revision: await send({ type: 'HIDE_SCOREBUG' }) };
    case 'clear_layers': {
      let rev: number | undefined;
      for (const l of p.item.layers ?? []) if (layers[l] && layers[l]!.source === 'automation') rev = await send({ type: 'CLEAR_LAYER', layer: l }, `:${l}`);
      return { state: 'done', revision: rev };
    }
    case 'media':
      return { state: 'done', revision: await send({ type: 'TAKE_IN', templateKey: 'builtin:full_frame_media', variables: { image: p.item.assetId, audio: p.item.audio ?? 'muted', fit: 'contain' }, durationMs: cue.durationMs, cueId: cue.id }) };
    case 'creative':
    case 'sponsor': {
      const placement = (p.item.placement ?? 'detached_logo') as Placement;
      const dec =
        cue.action === 'creative' && p.item.creativeId
          ? await fixedDecision(t, cue.organisationId, { matchId: run.matchId, overlayId: cue.overlayId, placement, creativeId: p.item.creativeId, requestKey: `cue:${cue.id}` })
          : await decide(t, cue.organisationId, { matchId: run.matchId, overlayId: cue.overlayId, placement, requestKey: `cue:${cue.id}`, now: now(d), eventType: ((run.triggerContext as unknown as RunContext).context?.eventType as string) ?? null });
      if (dec.outcome !== 'selected' || !dec.creativeId) return { state: 'skipped', reason: `no sponsor shown: ${dec.reason ?? 'no eligible creative'}` };
      const templateKey = SPONSOR_TEMPLATE[placement] ?? 'builtin:sponsor';
      const variables = templateKey === 'builtin:sponsor' ? { creative: dec.creativeId, placement } : { creative: dec.creativeId, audio: p.item.audio ?? 'muted', fit: 'contain' };
      return { state: 'done', revision: await send({ type: 'TAKE_IN', templateKey, variables, layer: p.layer ?? undefined, durationMs: cue.durationMs, cueId: cue.id, sponsor: { decisionId: dec.id, creativeId: dec.creativeId, campaignId: dec.campaignId, placement } }) };
    }
    case 'cleanup': {
      let rev: number | undefined;
      for (const [l, c] of Object.entries(layers) as [Layer, Cue][]) if (c.runId === run.id && c.source === 'automation' && !c.outAt) rev = await send({ type: 'TAKE_OUT', layer: l }, `:${l}`);
      return { state: 'done', revision: rev };
    }
  }
  return { state: 'skipped', reason: `unknown action ${cue.action}` };
}

/** Execute due cues. Each cue runs in its own transaction; reducer refusals are recorded, fencing loss aborts. */
export async function dispatchDueCues(d: AutomationDeps, fence: Fence, limit = 50) {
  const due = await d.db
    .select({ id: automationCues.id, org: automationCues.organisationId })
    .from(automationCues)
    .where(and(eq(automationCues.state, 'pending'), lte(automationCues.dueAt, new Date(now(d)))))
    .orderBy(asc(automationCues.dueAt), asc(automationCues.itemIndex))
    .limit(limit);
  let n = 0;
  for (const c of due) {
    await withTenant(d.db, { organisationId: c.org }, async (t) => {
      const [cue] = await t.select().from(automationCues).where(and(eq(automationCues.id, c.id), eq(automationCues.state, 'pending'))).for('update', { skipLocked: true });
      if (!cue) return;
      const [run] = await t.select().from(automationRuns).where(eq(automationRuns.id, cue.runId));
      const at = now(d);
      const finish = (state: string, reason?: string | null, revision?: number) => t.update(automationCues).set({ state, reason: reason ?? null, dispatchedRevision: revision ?? null, attempts: cue.attempts + 1, updatedAt: new Date(at) }).where(eq(automationCues.id, cue.id));
      if (!run || (run.state !== 'running' && cue.action !== 'cleanup')) return finish('cancelled', `run ${run?.state ?? 'missing'}`);
      if (cue.deadlineAt && cue.deadlineAt.getTime() < at) {
        await finish('skipped', 'missed its freshness deadline');
        await stopRun(t, run.id, 'cancelled', 'first cue missed its freshness deadline', at, false);
        return;
      }
      try {
        const r = await executeCue(t, d, fence, cue, run);
        await finish(r.state, r.reason, r.revision);
        n++;
      } catch (e) {
        if (e instanceof AppError && e.code === 'FENCED') throw e;
        if (e instanceof AppError) await finish('skipped', `${e.code}: ${e.message}`);
        else throw e;
      }
    });
  }
  return n;
}

/** Complete finished runs, schedule loop iterations, and promote/expire queued runs. */
export async function advanceRuns(d: AutomationDeps) {
  const at = now(d);
  const finished = await d.db.execute(sql`
    select r.id, r.organisation_id from automation_runs r
    where r.state = 'running'
      and not exists (select 1 from automation_cues c where c.run_id = r.id and c.state in ('pending','dispatched'))
      and coalesce((select max(c.due_at + make_interval(secs => coalesce(c.duration_ms, 0) / 1000.0)) from automation_cues c where c.run_id = r.id), r.started_at) <= ${new Date(at)}
    limit 100`);
  const touched = new Map<string, string>();
  for (const f of finished.rows as { id: string; organisation_id: string }[]) {
    await withTenant(d.db, { organisationId: f.organisation_id }, async (t) => {
      const [run] = await t.select().from(automationRuns).where(and(eq(automationRuns.id, f.id), eq(automationRuns.state, 'running'))).for('update', { skipLocked: true });
      if (!run) return;
      touched.set(run.overlayId, run.organisationId);
      const pv = run.playlistId.startsWith('_') ? null : await planFor(t, run.gamePlanVersionId);
      const pl = pv ? playlistById(pv.plan, run.playlistId) : undefined;
      const rc = run.triggerContext as unknown as RunContext;
      const [st] = await t.select().from(overlayState).where(eq(overlayState.overlayId, run.overlayId));
      if (pl && pl.repeat.mode === 'loop' && rc.loop + 1 < pl.repeat.maxIterations && st?.mode === 'auto' && !st.inhibited) {
        const next = { ...rc, loop: rc.loop + 1 };
        await t.update(automationRuns).set({ triggerContext: next as never }).where(eq(automationRuns.id, run.id));
        const { layers } = await templateLayerMap(t, run.organisationId);
        await insertCues(t, run, pl, next, at + pl.repeat.gapMs, layers, pv!.plan.freshnessMs);
        return;
      }
      await t.update(automationRuns).set({ state: 'completed', endedAt: new Date(at), reason: pl?.repeat.mode === 'loop' ? `loop finished after ${rc.loop + 1} iterations` : run.reason }).where(eq(automationRuns.id, run.id));
    });
  }
  // queued runs: start when unblocked, expire past deadline
  const queued = await d.db.select({ overlayId: automationRuns.overlayId, org: automationRuns.organisationId }).from(automationRuns).where(eq(automationRuns.state, 'queued')).groupBy(automationRuns.overlayId, automationRuns.organisationId);
  for (const q of queued) touched.set(q.overlayId, q.org);
  for (const [overlayId, org] of touched) await promoteQueued(d, org, overlayId);
  return finished.rows.length;
}

async function promoteQueued(d: AutomationDeps, organisationId: string, overlayId: string) {
  await withTenant(d.db, { organisationId }, async (t) => {
    const at = now(d);
    await t.select().from(overlayState).where(eq(overlayState.overlayId, overlayId)).for('update');
    const queued = await t.select().from(automationRuns).where(and(eq(automationRuns.overlayId, overlayId), eq(automationRuns.state, 'queued'))).orderBy(asc(automationRuns.priority), asc(automationRuns.createdAt));
    for (const q of queued) {
      if (q.deadlineAt && q.deadlineAt.getTime() < at) {
        await t.update(automationRuns).set({ state: 'cancelled', reason: 'waited past its freshness deadline', endedAt: new Date(at) }).where(eq(automationRuns.id, q.id));
        continue;
      }
      const act = await activeRuns(t, overlayId);
      const dec = decidePriority({ priority: q.priority, layers: q.layers, promotional: q.promotional }, act);
      if (dec.action !== 'start') continue;
      const pv = await planFor(t, q.gamePlanVersionId);
      const pl = pv && playlistById(pv.plan, q.playlistId);
      if (!pl) continue;
      for (const p of dec.preempt) await stopRun(t, p.runId, 'preempted', p.reason, at);
      const [run] = await t.update(automationRuns).set({ state: 'running', startedAt: new Date(at), reason: 'started after the run it was queued behind finished' }).where(eq(automationRuns.id, q.id)).returning();
      const { layers } = await templateLayerMap(t, organisationId);
      await insertCues(t, run!, pl, run!.triggerContext as unknown as RunContext, at, layers, pv!.plan.freshnessMs);
    }
  });
}

// ------------------------------------------------------------------ schedulers

/** Elapsed period time from a clock anchor (count-down clocks report time used). */
export function elapsedMs(c: ClockState, at: number) {
  const disp = clockDisplayMs(c, at);
  return c.direction === 'down' ? Math.max(0, (c.limitMs ?? c.baseMs) - disp) : disp;
}

const lastClock = new Map<string, { period: string; ms: number }>();

/** Match-clock thresholds. Crossings are recorded durably so pause/resume/restart never duplicate. */
export async function scanClockTriggers(d: AutomationDeps) {
  const at = now(d);
  const rows = await d.db
    .select({ o: overlays, ms: matchState, m: matches })
    .from(overlays)
    .innerJoin(matchState, eq(matchState.matchId, overlays.matchId))
    .innerJoin(matches, eq(matches.id, overlays.matchId))
    .where(and(eq(overlays.status, 'active'), sql`${overlays.gamePlanVersionId} is not null`, eq(matches.status, 'live')));
  let fired = 0;
  for (const r of rows) {
    const pv = await withTenant(d.db, { organisationId: r.o.organisationId }, (t) => planFor(t, r.o.gamePlanVersionId!));
    if (!pv || !pv.plan.playlists.some((p) => p.triggers.some((x) => x.type === 'match_clock'))) continue;
    const main = (r.ms.clocks as Record<string, ClockState>).main;
    if (!main) continue;
    const cur = elapsedMs(main, at);
    const key = r.o.id;
    const prev = lastClock.get(key);
    lastClock.set(key, { period: main.periodId, ms: cur });
    if (!prev || prev.period !== main.periodId) continue; // first observation: no backlog replay
    const phaseKind = getAdapter(r.m.sport).phase(r.m.rulesConfig as never, r.ms.phase)?.kind ?? 'play';
    for (const x of clockCrossings(pv.plan, main.periodId, prev.ms, cur, { maxNormalStepMs: 5000 })) {
      const occ = `clock:${x.triggerId}:${x.periodId}:${x.thresholdMs}`;
      const ins = await withTenant(d.db, { organisationId: r.o.organisationId }, (t) =>
        t.insert(triggerOccurrences).values({ organisationId: r.o.organisationId, overlayId: r.o.id, occurrenceKey: occ, outcome: x.outcome === 'fire' ? 'fired' : 'skipped', reason: x.outcome === 'skip' ? 'clock correction jumped across the threshold' : null }).onConflictDoNothing().returning(),
      );
      if (!ins.length || x.outcome !== 'fire') continue;
      await processTrigger(d, r.o.organisationId, r.o.matchId, { kind: 'match_clock', triggerId: x.triggerId, periodId: x.periodId, thresholdMs: x.thresholdMs, at, phaseKind }, { onlyOverlayId: r.o.id });
      fired++;
    }
  }
  return fired;
}

/** Wall-clock triggers relative to kickoff or at an absolute time (fired once, only within the freshness window). */
export async function scanWallClockTriggers(d: AutomationDeps) {
  const at = now(d);
  const rows = await d.db
    .select({ o: overlays, ms: matchState, m: matches })
    .from(overlays)
    .innerJoin(matchState, eq(matchState.matchId, overlays.matchId))
    .innerJoin(matches, eq(matches.id, overlays.matchId))
    .where(and(eq(overlays.status, 'active'), sql`${overlays.gamePlanVersionId} is not null`, inArray(matches.status, ['scheduled', 'live']), sql`${matches.scheduledAt} between ${new Date(at - 12 * 3600_000)} and ${new Date(at + 12 * 3600_000)}`));
  let fired = 0;
  for (const r of rows) {
    const pv = await withTenant(d.db, { organisationId: r.o.organisationId }, (t) => planFor(t, r.o.gamePlanVersionId!));
    if (!pv) continue;
    for (const pl of pv.plan.playlists)
      for (const tr of pl.triggers) {
        if (tr.type !== 'wall_clock') continue;
        const target = tr.relativeToKickoffMs != null ? r.m.scheduledAt.getTime() + tr.relativeToKickoffMs : Date.parse(tr.atUtc!);
        if (!(at >= target && at - target <= pv.plan.freshnessMs)) continue;
        const occ = `wall:${tr.id}:${target}`;
        const ins = await withTenant(d.db, { organisationId: r.o.organisationId }, (t) => t.insert(triggerOccurrences).values({ organisationId: r.o.organisationId, overlayId: r.o.id, occurrenceKey: occ, outcome: 'fired' }).onConflictDoNothing().returning());
        if (!ins.length) continue;
        const phaseKind = getAdapter(r.m.sport).phase(r.m.rulesConfig as never, r.ms.phase)?.kind ?? 'pre';
        await processTrigger(d, r.o.organisationId, r.o.matchId, { kind: 'wall_clock', triggerId: tr.id, at, phaseKind, occurrence: String(target) }, { onlyOverlayId: r.o.id });
        fired++;
      }
  }
  return fired;
}

/** Rotate the scorebug sponsor slot on visible scorebugs (Auto mode, not inhibited). */
export async function rotateScorebugSlots(d: AutomationDeps, fence: Fence) {
  const at = now(d);
  const bucket = Math.floor(at / SLOT_ROTATION_MS);
  const rows = await d.db.select({ s: overlayState, o: overlays }).from(overlayState).innerJoin(overlays, eq(overlays.id, overlayState.overlayId)).where(and(eq(overlayState.scorebugVisible, true), eq(overlayState.mode, 'auto'), eq(overlayState.inhibited, false), eq(overlays.status, 'active')));
  let changed = 0;
  for (const r of rows) {
    await withTenant(d.db, { organisationId: r.o.organisationId }, async (t) => {
      const dec = await decide(t, r.o.organisationId, { matchId: r.o.matchId, overlayId: r.o.id, placement: 'scorebug_logo', requestKey: `slot:${r.o.id}:scorebug_logo:${bucket}`, now: at });
      const cur = (r.s.slots as OverlayPublicState['slots'])?.scorebug_logo;
      const want = dec.outcome === 'selected' && dec.creativeId ? { creativeId: dec.creativeId, decisionId: dec.id, campaignId: dec.campaignId } : undefined;
      if (cur?.decisionId === want?.decisionId || (!cur && !want)) return;
      const st = await mutateOverlayStateTx(t, r.o.organisationId, r.o.id, fence, (s) => ({ ...s, slots: { ...(s.slots ?? {}), scorebug_logo: want } }), at);
      if (st) changed++;
    });
  }
  return changed;
}

/** Persist expiry of timed cues so control rooms and later decisions see the real on-air state. */
export async function sweepExpiredLayers(d: AutomationDeps, fence: Fence) {
  const at = now(d);
  const rows = await d.db.select({ id: overlayState.overlayId, org: overlayState.organisationId, layers: overlayState.layers }).from(overlayState).where(sql`${overlayState.layers} <> '{}'::jsonb`);
  let n = 0;
  for (const r of rows) {
    const cues = Object.values(r.layers) as Cue[];
    if (!cues.some((c) => c.outAt || c.durationMs != null)) continue;
    await withTenant(d.db, { organisationId: r.org }, async (t) => {
      const custom = await customDefs(t, r.org);
      const st = await mutateOverlayStateTx(t, r.org, r.id, fence, (s, nw) => {
        const p = pruneExpired(s, nw, custom);
        if (!p.removed.length) return null;
        return { ...p.state, scorebugVisible: p.state.layers.scoreboard ? s.scorebugVisible : false };
      }, at);
      if (st) n++;
    });
  }
  return n;
}

/** One scheduler pass. Returns false when this worker does not own the automation lease. */
export async function automationTick(d: AutomationDeps) {
  const fence = await acquireLease(d.db, d.workerId);
  if (!fence) return false;
  await dispatchDueCues(d, fence);
  await advanceRuns(d);
  await dispatchDueCues(d, fence);
  return true;
}

export async function housekeepingTick(d: AutomationDeps) {
  const fence = await acquireLease(d.db, d.workerId);
  if (!fence) return false;
  await scanClockTriggers(d);
  await scanWallClockTriggers(d);
  await rotateScorebugSlots(d, fence);
  await sweepExpiredLayers(d, fence);
  await closeStaleExposures(d.db, now(d));
  return true;
}

// ------------------------------------------------------------------ read models for the control room

export async function automationLog(ctx: Ctx, overlayId: string, limit = 60) {
  return withTenant(ctx.db, { organisationId: ctx.actor.organisationId }, async (t) => {
    const runs = await t.select().from(automationRuns).where(and(eq(automationRuns.overlayId, overlayId), eq(automationRuns.organisationId, ctx.actor.organisationId))).orderBy(sql`${automationRuns.createdAt} desc`).limit(limit);
    const cues = runs.length ? await t.select().from(automationCues).where(inArray(automationCues.runId, runs.map((r) => r.id))).orderBy(asc(automationCues.dueAt)) : [];
    return runs.map((r) => ({
      id: r.id,
      playlistId: r.playlistId,
      triggerId: r.triggerId,
      state: r.state,
      reason: r.reason,
      priority: r.priority,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      cues: cues.filter((c) => c.runId === r.id).map((c) => ({ id: c.id, action: c.action, state: c.state, reason: c.reason, dueAt: c.dueAt.toISOString(), templateKey: (c.params as { item?: { templateKey?: string } }).item?.templateKey ?? null })),
    }));
  });
}


// ------------------------------------------------------------------ approval mode

/** Cues parked by a manual playlist, for the control room's approval list. */
export async function awaitingCues(ctx: Ctx, overlayId: string) {
  return tx(ctx, async (t) => {
    const rows = await t
      .select({ c: automationCues, playlistId: automationRuns.playlistId })
      .from(automationCues)
      .innerJoin(automationRuns, eq(automationRuns.id, automationCues.runId))
      .where(and(eq(automationCues.overlayId, overlayId), eq(automationCues.organisationId, ctx.actor.organisationId), eq(automationCues.state, 'awaiting_approval')))
      .orderBy(asc(automationCues.dueAt));
    return rows.map((r) => {
      const params = r.c.params as { item?: { templateKey?: string; action?: string; placement?: string }; variables?: Record<string, unknown> };
      return { cueId: r.c.id, playlistId: r.playlistId, action: r.c.action, templateKey: params.item?.templateKey ?? null, placement: params.item?.placement ?? null, variables: params.variables ?? {}, durationMs: r.c.durationMs, queuedAt: r.c.createdAt };
    });
  });
}

/** A producer approves (sends now) or skips a parked cue. */
export async function decideCue(ctx: Ctx, overlayId: string, cueId: string, decision: 'approve' | 'skip') {
  return tx(ctx, async (t) => {
    const [c] = await t.select().from(automationCues).where(and(eq(automationCues.id, cueId), eq(automationCues.overlayId, overlayId), eq(automationCues.organisationId, ctx.actor.organisationId)));
    if (!c) throw notFound('Cue');
    if (c.state !== 'awaiting_approval') throw conflict('CUE_NOT_WAITING', 'This cue is no longer waiting for approval');
    const at = new Date();
    if (decision === 'approve') await t.update(automationCues).set({ state: 'pending', dueAt: at, deadlineAt: null, reason: `approved by ${ctx.actor.userId ?? 'operator'}`, updatedAt: at }).where(eq(automationCues.id, cueId));
    else await t.update(automationCues).set({ state: 'skipped', reason: `skipped by ${ctx.actor.userId ?? 'operator'}`, updatedAt: at }).where(eq(automationCues.id, cueId));
    await audit(t, ctx.actor, decision === 'approve' ? 'automation.cue.approve' : 'automation.cue.skip', 'overlay', overlayId, { after: { cueId, action: c.action } });
    return { ok: true, decision };
  });
}
