// Rehearsal: replay a fact timeline against a game plan with the production decision functions, in isolation.
// Produces an explained decision log and the cue schedule for a local preview. No I/O.
import { clockCrossings, decidePriority, matchTriggers, phaseBoundCancellations, planRun, playlistLayers, type ActiveRun, type GamePlan, type TriggerInput, type TriggerMatch } from './automation';
import { getAdapter } from './engine';
import type { MatchProjection, Side } from './types';

export interface TimelineEntry {
  t: number; // ms from rehearsal start (match time, before speed scaling)
  kind: 'phase' | 'event';
  phase?: string;
  type?: string;
  side?: Side | null;
  playerId?: string | null;
  payload?: Record<string, unknown>;
  /** recorded later than it happened (offline sync) */
  lateByMs?: number;
}

export interface RehearsalDecision {
  t: number;
  playlistId: string;
  triggerId: string;
  outcome: 'fired' | 'skipped' | 'queued' | 'preempted' | 'cancelled' | 'completed';
  reason: string;
}

export interface RehearsalCue {
  t: number;
  playlistId: string;
  runId: string;
  action: string;
  templateKey?: string;
  layer: string | null;
  variables: Record<string, unknown>;
  durationMs: number | null;
  placement?: string;
}

export function syntheticTimeline(sport: 'football' | 'basketball'): TimelineEntry[] {
  if (sport === 'football')
    return [
      { t: 0, kind: 'phase', phase: 'pre_match' },
      { t: 40_000, kind: 'phase', phase: 'first_half' },
      { t: 70_000, kind: 'event', type: 'goal', side: 'home' },
      { t: 76_000, kind: 'event', type: 'yellow_card', side: 'away' },
      { t: 110_000, kind: 'event', type: 'substitution', side: 'home', payload: {} },
      { t: 140_000, kind: 'phase', phase: 'half_time' },
      { t: 200_000, kind: 'phase', phase: 'second_half' },
      { t: 230_000, kind: 'event', type: 'goal', side: 'away', lateByMs: 45_000 },
      { t: 250_000, kind: 'event', type: 'penalty_scored', side: 'home' },
      { t: 300_000, kind: 'phase', phase: 'full_time' },
    ];
  const out: TimelineEntry[] = [{ t: 0, kind: 'phase', phase: 'pre_match' }, { t: 30_000, kind: 'phase', phase: 'p1' }];
  for (let i = 0; i < 14; i++) out.push({ t: 35_000 + i * 6000, kind: 'event', type: 'score', side: i % 2 ? 'away' : 'home', payload: { points: i % 3 === 0 ? 3 : 2, resetShotClock: true } });
  out.push({ t: 70_000, kind: 'event', type: 'timeout', side: 'home' }, { t: 130_000, kind: 'phase', phase: 'break_1' }, { t: 160_000, kind: 'phase', phase: 'p2' }, { t: 200_000, kind: 'phase', phase: 'half_time' });
  return out.sort((a, b) => a.t - b.t);
}

export function simulateRehearsal(plan: GamePlan, rulesConfig: unknown, timeline: TimelineEntry[], opts: { templateLayers: Record<string, string>; sponsorAvailable?: (placement: string) => boolean; freshnessMs?: number }): { decisions: RehearsalDecision[]; cues: RehearsalCue[]; durationMs: number } {
  const adapter = getAdapter(plan.sport);
  const cfg = rulesConfig as never;
  let proj: MatchProjection = adapter.initialProjection(cfg);
  const decisions: RehearsalDecision[] = [];
  const cues: RehearsalCue[] = [];
  const keys = new Set<string>();
  let active: (ActiveRun & { endsAt: number })[] = [];
  let queued: { m: TriggerMatch; input: TriggerInput; deadline: number; layers: string[] }[] = [];
  let runSeq = 0;
  let seq = 0;
  let clockStart: number | null = null;
  let clockBase = 0;
  let lastClock = 0;
  const freshness = opts.freshnessMs ?? plan.freshnessMs;
  const guard = { hasLineup: true, sponsorAvailable: opts.sponsorAvailable ?? (() => true), now: 0 };

  const cancelRun = (runId: string, now: number, reason: string) => {
    const r = active.find((x) => x.runId === runId);
    active = active.filter((x) => x.runId !== runId);
    if (r) decisions.push({ t: now, playlistId: r.playlistId, triggerId: '-', outcome: reason.startsWith('preempted') ? 'preempted' : 'cancelled', reason });
    for (const c of cues) if (c.runId === runId && c.t > now && !c.action.endsWith('(cancelled)')) c.action = `${c.action} (cancelled)`;
  };

  const launch = (m: TriggerMatch, input: TriggerInput, now: number, layers: string[]) => {
    const runId = `run${++runSeq}`;
    const iterations = m.playlist.repeat.mode === 'loop' ? Math.min(m.playlist.repeat.maxIterations, 6) : 1;
    let start = now;
    let end = now;
    for (let k = 0; k < iterations; k++) {
      const planned = planRun(m.playlist, m, start, { freshnessMs: freshness, templateLayers: opts.templateLayers, liveTrigger: input.kind === 'event' });
      for (const c of planned) cues.push({ t: c.dueAt, playlistId: m.playlist.id, runId, action: c.item.action, templateKey: c.item.templateKey, layer: c.layer, variables: c.variables, durationMs: c.durationMs, placement: c.item.placement });
      const len = Math.max(...planned.map((c) => c.dueAt - start + (c.durationMs ?? 0)));
      end = start + len;
      start = end + m.playlist.repeat.gapMs;
    }
    active.push({ runId, playlistId: m.playlist.id, priority: m.playlist.priority, layers, state: 'running', createdAt: now, promotional: m.playlist.promotional, kind: m.playlist.kind, endsAt: end });
    return iterations;
  };

  /** advance simulated time: finished runs leave; queued runs start when unblocked or expire */
  const advance = (now: number) => {
    for (;;) {
      const finished = active.filter((r) => r.endsAt <= now).sort((a, b) => a.endsAt - b.endsAt);
      const nextEnd = finished[0]?.endsAt ?? now;
      active = active.filter((r) => r.endsAt > nextEnd);
      let progressed = false;
      for (const q of [...queued]) {
        if (q.deadline < nextEnd) {
          queued = queued.filter((x) => x !== q);
          decisions.push({ t: nextEnd, playlistId: q.m.playlist.id, triggerId: q.m.trigger.id, outcome: 'cancelled', reason: 'waited past its freshness deadline' });
          progressed = true;
          continue;
        }
        const d = decidePriority({ priority: q.m.playlist.priority, layers: q.layers, promotional: q.m.playlist.promotional }, active);
        if (d.action === 'start') {
          queued = queued.filter((x) => x !== q);
          for (const p of d.preempt) cancelRun(p.runId, nextEnd, p.reason);
          launch(q.m, q.input, nextEnd, q.layers);
          decisions.push({ t: nextEnd, playlistId: q.m.playlist.id, triggerId: q.m.trigger.id, outcome: 'fired', reason: 'started after the run it was queued behind finished' });
          progressed = true;
        }
      }
      if (!finished.length && !progressed) break;
      if (!finished.length) continue;
    }
  };

  const startRuns = (input: TriggerInput, now: number) => {
    guard.now = now;
    advance(now);
    if (input.kind === 'phase') for (const c of phaseBoundCancellations(active, input.phaseKind)) cancelRun(c.runId, now, c.reason);
    const { matches, skipped } = matchTriggers(plan, input, guard);
    for (const s of skipped) decisions.push({ t: now, playlistId: s.playlistId, triggerId: s.triggerId, outcome: 'skipped', reason: s.reason });
    for (const m of matches) {
      const key = `${m.trigger.id}:${m.playlist.id}:${m.iteration}`;
      if (keys.has(key)) {
        decisions.push({ t: now, playlistId: m.playlist.id, triggerId: m.trigger.id, outcome: 'skipped', reason: 'duplicate trigger (execution key already used)' });
        continue;
      }
      keys.add(key);
      if (m.occurredAt + freshness < now) {
        decisions.push({ t: now, playlistId: m.playlist.id, triggerId: m.trigger.id, outcome: 'skipped', reason: `older than the ${freshness / 1000}s freshness window` });
        continue;
      }
      const layers = playlistLayers(m.playlist, opts.templateLayers);
      const d = decidePriority({ priority: m.playlist.priority, layers, promotional: m.playlist.promotional }, active);
      if (d.action === 'skip') {
        decisions.push({ t: now, playlistId: m.playlist.id, triggerId: m.trigger.id, outcome: 'skipped', reason: d.reason });
        continue;
      }
      if (d.action === 'queue') {
        queued.push({ m, input, layers, deadline: input.kind === 'event' ? m.occurredAt + freshness : now + 60_000 });
        decisions.push({ t: now, playlistId: m.playlist.id, triggerId: m.trigger.id, outcome: 'queued', reason: d.reason });
        continue;
      }
      for (const p of d.preempt) cancelRun(p.runId, now, p.reason);
      const iterations = launch(m, input, now, layers);
      decisions.push({ t: now, playlistId: m.playlist.id, triggerId: m.trigger.id, outcome: 'fired', reason: `${m.trigger.type} trigger${iterations > 1 ? ` (loop, ${iterations} iterations previewed)` : ''}` });
    }
  };

  for (const e of [...timeline].sort((a, b) => a.t - b.t)) {
    // clock thresholds between entries
    if (clockStart != null) {
      const nowClock = clockBase + (e.t - clockStart);
      for (const x of clockCrossings(plan, proj.phase, lastClock, nowClock, { maxNormalStepMs: Number.MAX_SAFE_INTEGER })) {
        const at = clockStart + (x.thresholdMs - clockBase);
        startRuns({ kind: 'match_clock', triggerId: x.triggerId, periodId: x.periodId, thresholdMs: x.thresholdMs, at, phaseKind: 'play' }, at);
      }
      lastClock = nowClock;
    }
    if (e.kind === 'phase' && e.phase) {
      const def = adapter.phase(cfg, e.phase);
      if (!def) continue;
      proj = adapter.applyPhase(cfg, proj, e.phase);
      seq++;
      if (def.kind === 'play') {
        clockStart = e.t;
        clockBase = 0;
        lastClock = 0;
      } else clockStart = null;
      startRuns({ kind: 'phase', phaseId: e.phase, phaseTags: def.tags, phaseKind: def.kind, at: e.t, occurredAt: e.t, seq }, e.t);
    } else if (e.kind === 'event' && e.type) {
      const prev = proj.counters;
      seq++;
      try {
        proj = adapter.applyFact(cfg, proj, { sequence: seq, category: 'event', type: e.type, side: e.side ?? null, playerId: e.playerId ?? null, payload: e.payload ?? {}, periodId: proj.phase });
      } catch {
        continue;
      }
      const occurredAt = e.t - (e.lateByMs ?? 0);
      startRuns({ kind: 'event', eventType: e.type, side: e.side ?? null, factId: `f${seq}`, factRevision: 1, playerId: e.playerId ?? null, payload: e.payload ?? {}, clockMs: clockStart != null ? e.t - clockStart : null, phaseId: proj.phase, phaseKind: adapter.phase(cfg, proj.phase)?.kind ?? 'play', occurredAt, at: e.t, historical: (e.lateByMs ?? 0) > freshness, counters: proj.counters, prevCounters: prev }, e.t);
    }
  }
  advance(Number.MAX_SAFE_INTEGER / 2);
  const durationMs = Math.max(0, ...timeline.map((x) => x.t), ...cues.map((c) => c.t + (c.durationMs ?? 0)));
  return { decisions, cues: cues.sort((a, b) => a.t - b.t), durationMs };
}
