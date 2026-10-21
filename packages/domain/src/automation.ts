// Game-plan automation engine (spec §11). Pure and deterministic: the worker and the rehearsal simulator
// call the same functions, so rehearsal shows exactly why production would fire, skip or preempt.
import { SPORTS } from './types';
import { z } from 'zod';

export const LAYER_NAMES = ['background', 'fullframe', 'scoreboard', 'event', 'lower', 'ticker', 'sponsor', 'transition'] as const;
/** Discipline event → card graphic variant, across codes (football, hockey, rugby league). */
export const CARD_TYPES: Record<string, string> = { yellow_card: 'yellow', second_yellow: 'second_yellow', red_card: 'red', green_card: 'green', sin_bin: 'sin_bin', send_off: 'red' };
const layer = z.enum(LAYER_NAMES);

/** Variables can be literals or references into the trigger context. */
export const varSource = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.object({ from: z.enum(['event.side', 'event.playerId', 'event.minute', 'event.type', 'event.points', 'event.playerOutId', 'event.playerInId', 'event.cardType', 'event.assistId', 'event.goalType', 'phase.label', 'trigger.milestone']) }),
]);

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().max(40), type: z.literal('phase'), phaseTags: z.array(z.string()).default([]), phaseIds: z.array(z.string()).default([]) }),
  z.object({ id: z.string().max(40), type: z.literal('event'), eventTypes: z.array(z.string()).min(1), sides: z.array(z.enum(['home', 'away'])).optional() }),
  z.object({ id: z.string().max(40), type: z.literal('match_clock'), atMs: z.number().int().min(0), repeatEveryMs: z.number().int().min(30_000).optional(), untilMs: z.number().int().optional(), periodIds: z.array(z.string()).default([]) }),
  z.object({ id: z.string().max(40), type: z.literal('wall_clock'), relativeToKickoffMs: z.number().int().optional(), atUtc: z.string().datetime().optional() }),
  z.object({ id: z.string().max(40), type: z.literal('milestone'), counter: z.string().max(40), every: z.number().int().min(1) }),
  z.object({ id: z.string().max(40), type: z.literal('manual') }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const guardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('phase'), phaseKinds: z.array(z.enum(['pre', 'play', 'break', 'final'])).default([]), phaseIds: z.array(z.string()).default([]) }),
  z.object({ type: z.literal('team'), sides: z.array(z.enum(['home', 'away'])) }),
  z.object({ type: z.literal('min_data'), require: z.array(z.enum(['lineup', 'player'])) }),
  z.object({ type: z.literal('freshness'), maxAgeMs: z.number().int().min(1000).max(600_000) }),
  z.object({ type: z.literal('sponsor_available'), placement: z.string() }),
  /** fire only when a match condition holds: "score gap >= 3", "home shots_on_target >= 5", "minute > 80", "quiet for 120 s" */
  z.object({
    type: z.literal('condition'),
    metric: z.enum(['score_gap', 'total_score', 'stat', 'minute', 'since_last_graphic_s']),
    stat: z.string().max(40).optional(),
    side: z.enum(['home', 'away', 'either', 'leader']).optional(),
    op: z.enum(['>=', '<=', '==', '>', '<']),
    value: z.number(),
  }),
]);
export type Guard = z.infer<typeof guardSchema>;

export const itemSchema = z.object({
  id: z.string().max(40),
  action: z.enum(['show', 'update', 'hide', 'scorebug_show', 'scorebug_hide', 'clear_layers', 'media', 'creative', 'sponsor', 'wait']),
  templateKey: z.string().max(80).optional(),
  layer: layer.optional(),
  layers: z.array(layer).optional(),
  variables: z.record(z.string(), varSource).optional(),
  offsetMs: z.number().int().min(0).max(3_600_000).default(0),
  durationMs: z.number().int().min(500).max(3_600_000).nullable().optional(),
  placement: z.string().max(40).optional(),
  creativeId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  audio: z.enum(['muted', 'replace', 'duck']).optional(),
  outputs: z.array(z.enum(['graphics', 'programme'])).optional(),
});
export type PlanItem = z.infer<typeof itemSchema>;

export const playlistSchema = z.object({
  id: z.string().max(40),
  name: z.string().max(80),
  kind: z.enum(['pre', 'in_play', 'break', 'post']),
  /** manual: cues wait in the control room for a producer's approval before going to air */
  approval: z.enum(['auto', 'manual']).optional(),
  /**
   * Phase playlists normally stop when the scorer presses the next step ("Players entering" ends at "About to
   * start"). With this set they keep going through later steps of the same part of the match, and still end when
   * play starts, a break begins or the match finishes.
   */
  continueOnPhaseStep: z.boolean().optional(),
  /** wait this long after the trigger before the first pass; repeats of a looping playlist follow on without it */
  startDelayMs: z.number().int().min(0).max(3_600_000).optional(),
  priority: z.number().int().min(1).max(4),
  triggers: z.array(triggerSchema).min(1),
  guards: z.array(guardSchema).default([]),
  repeat: z.object({ mode: z.enum(['once', 'loop']), gapMs: z.number().int().min(0).max(600_000).default(0), maxIterations: z.number().int().min(1).max(500).default(50) }).default({ mode: 'once', gapMs: 0, maxIterations: 50 }),
  cooldownMs: z.number().int().min(0).max(3_600_000).default(0),
  promotional: z.boolean().default(false),
  items: z.array(itemSchema).min(1).max(30),
});
export type Playlist = z.infer<typeof playlistSchema>;

export const gamePlanSchema = z.object({
  version: z.literal(1),
  sport: z.enum(SPORTS),
  defaultScorebug: z.boolean().default(true),
  freshnessMs: z.number().int().min(1000).max(120_000).default(10_000),
  playlists: z.array(playlistSchema).max(60),
});
export type GamePlan = z.infer<typeof gamePlanSchema>;

export interface PlanIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Publish-time validation: schema, templates, variables, unsafe overlap, loops, media references. */
export function validateGamePlan(input: unknown, opts: { templateKeys: string[]; templateLayers: Record<string, string>; eventTypes: string[]; creativeIds?: string[] }): { ok: true; plan: GamePlan; issues: PlanIssue[] } | { ok: false; issues: PlanIssue[] } {
  const r = gamePlanSchema.safeParse(input);
  if (!r.success) return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, severity: 'error' })) };
  const plan = r.data;
  const issues: PlanIssue[] = [];
  const ids = new Set<string>();
  plan.playlists.forEach((pl, pi) => {
    const base = `playlists[${pi}]`;
    if (ids.has(pl.id)) issues.push({ path: base, message: `Duplicate playlist id "${pl.id}"`, severity: 'error' });
    ids.add(pl.id);
    for (const t of pl.triggers) {
      if (t.type === 'event') for (const e of t.eventTypes) if (!opts.eventTypes.includes(e)) issues.push({ path: `${base}.triggers.${t.id}`, message: `Unknown ${plan.sport} event "${e}"`, severity: 'error' });
      if (t.type === 'wall_clock' && t.relativeToKickoffMs == null && !t.atUtc) issues.push({ path: `${base}.triggers.${t.id}`, message: 'Wall-clock trigger needs a time', severity: 'error' });
    }
    // timeline: each item occupies its layer for [offset, offset+duration)
    const occupied: { layer: string; from: number; to: number; id: string }[] = [];
    let end = 0;
    pl.items.forEach((it, ii) => {
      const p = `${base}.items[${ii}]`;
      if (['show', 'update'].includes(it.action)) {
        if (!it.templateKey || !opts.templateKeys.includes(it.templateKey)) issues.push({ path: p, message: `Missing or unknown template "${it.templateKey ?? ''}"`, severity: 'error' });
      }
      if (it.action === 'creative' && it.creativeId && opts.creativeIds && !opts.creativeIds.includes(it.creativeId)) issues.push({ path: p, message: 'Creative is not approved or does not exist', severity: 'error' });
      if (it.action === 'media' && !it.assetId) issues.push({ path: p, message: 'Media item needs an image or video', severity: 'error' });
      if ((it.action === 'sponsor' || it.action === 'creative') && !it.placement) issues.push({ path: p, message: 'Choose a sponsor placement', severity: 'error' });
      const lay = it.layer ?? (it.templateKey ? opts.templateLayers[it.templateKey] : it.action === 'media' || it.action === 'creative' || it.action === 'sponsor' ? (it.placement?.startsWith('full_frame') ? 'fullframe' : 'sponsor') : undefined);
      const dur = it.durationMs ?? 0;
      if (lay && dur) {
        const clash = occupied.find((o) => o.layer === lay && it.offsetMs < o.to && it.offsetMs + dur > o.from);
        if (clash) issues.push({ path: p, message: `Overlaps "${clash.id}" on the ${lay} layer`, severity: 'error' });
        occupied.push({ layer: lay, from: it.offsetMs, to: it.offsetMs + dur, id: it.id });
      }
      if (['show', 'media', 'creative', 'sponsor'].includes(it.action) && it.durationMs == null && pl.repeat.mode === 'loop') issues.push({ path: p, message: 'Looping playlists need a duration on every on-air item', severity: 'error' });
      end = Math.max(end, it.offsetMs + dur);
    });
    if (pl.repeat.mode === 'loop' && end + pl.repeat.gapMs < 1000) issues.push({ path: base, message: 'Loop has no duration (would spin); add item durations or a gap', severity: 'error' });
    if (pl.items.every((i) => i.action === 'wait')) issues.push({ path: base, message: 'Playlist only waits', severity: 'warning' });
    const hasManual = pl.triggers.some((t) => t.type === 'manual');
    if (pl.repeat.mode === 'loop' && !hasManual && pl.kind === 'in_play') issues.push({ path: base, message: 'In-play loops run until the phase changes; check this is intended', severity: 'warning' });
  });
  return issues.some((i) => i.severity === 'error') ? { ok: false, issues } : { ok: true, plan, issues };
}

// ------------------------------------------------------------------ trigger matching

export type TriggerInput =
  | { kind: 'phase'; phaseId: string; phaseTags: string[]; phaseKind: string; phaseLabel?: string; at: number; occurredAt: number; seq: number }
  | { kind: 'event'; eventType: string; side: 'home' | 'away' | null; factId: string; factRevision: number; playerId: string | null; payload: Record<string, unknown>; clockMs: number | null; phaseId: string; phaseKind: string; occurredAt: number; at: number; historical: boolean; counters: Record<string, number>; prevCounters: Record<string, number> }
  | { kind: 'match_clock'; triggerId: string; periodId: string; thresholdMs: number; at: number; phaseKind: string }
  | { kind: 'wall_clock'; triggerId: string; at: number; phaseKind: string; occurrence: string }
  | { kind: 'manual'; playlistId: string; at: number; requestId: string; phaseKind: string };

export interface TriggerMatch {
  playlist: Playlist;
  trigger: Trigger;
  iteration: string; // part of the execution key
  occurredAt: number;
  context: Record<string, unknown>;
}

export interface GuardContext {
  hasLineup: boolean;
  sponsorAvailable: (placement: string) => boolean;
  now: number;
  /** current match projection, for condition guards */
  projection?: { score: { home: number; away: number }; stats: { home: Record<string, number>; away: Record<string, number> } } | null;
  /** main clock position in ms, for the minute condition */
  clockMs?: number | null;
  /** when the last graphic went to air on this output (ms), for the "quiet for" condition */
  lastGraphicAt?: number | null;
}

const compare = (a: number, op: string, b: number) => (op === '>=' ? a >= b : op === '<=' ? a <= b : op === '==' ? a === b : op === '>' ? a > b : a < b);

/** Evaluate one condition guard against the context; returns a skip reason or null. */
export function evaluateCondition(g: Extract<Guard, { type: 'condition' }>, input: TriggerInput, c: GuardContext): string | null {
  const p = c.projection;
  let value: number | null = null;
  switch (g.metric) {
    case 'score_gap':
      value = p ? Math.abs(p.score.home - p.score.away) : null;
      break;
    case 'total_score':
      value = p ? p.score.home + p.score.away : null;
      break;
    case 'stat': {
      if (!p || !g.stat) break;
      const h = Number(p.stats.home?.[g.stat] ?? 0);
      const a = Number(p.stats.away?.[g.stat] ?? 0);
      const side = g.side === 'leader' ? (p.score.home >= p.score.away ? 'home' : 'away') : g.side ?? (input.kind === 'event' ? input.side ?? 'either' : 'either');
      value = side === 'home' ? h : side === 'away' ? a : Math.max(h, a);
      break;
    }
    case 'minute': {
      const ms = input.kind === 'event' ? input.clockMs : c.clockMs;
      value = ms == null ? null : Math.floor(ms / 60_000) + 1;
      break;
    }
    case 'since_last_graphic_s':
      value = c.lastGraphicAt == null ? Number.POSITIVE_INFINITY : (c.now - c.lastGraphicAt) / 1000;
      break;
  }
  if (value == null) return `condition: ${g.metric} not available`;
  return compare(value, g.op, g.value) ? null : `condition: ${g.metric} ${g.op} ${g.value} not met (${Number.isFinite(value) ? value : 'never'})`;
}

export function checkGuards(pl: Playlist, input: TriggerInput, g: GuardContext): string | null {
  for (const guard of pl.guards) {
    switch (guard.type) {
      case 'phase': {
        const kind = input.phaseKind;
        const pid = input.kind === 'event' ? input.phaseId : input.kind === 'phase' ? input.phaseId : input.kind === 'match_clock' ? input.periodId : '';
        if (guard.phaseKinds.length && !guard.phaseKinds.includes(kind as never)) return `phase guard: ${kind} not allowed`;
        if (guard.phaseIds.length && !guard.phaseIds.includes(pid)) return `phase guard: ${pid} not allowed`;
        break;
      }
      case 'team':
        if (input.kind === 'event' && input.side && !guard.sides.includes(input.side)) return `team guard: ${input.side} excluded`;
        break;
      case 'min_data':
        if (guard.require.includes('lineup') && !g.hasLineup) return 'minimum data: lineup missing';
        if (guard.require.includes('player') && input.kind === 'event' && !input.playerId) return 'minimum data: no player recorded';
        break;
      case 'freshness':
        if (g.now - ('occurredAt' in input ? input.occurredAt : input.at) > guard.maxAgeMs) return `stale: older than ${guard.maxAgeMs} ms`;
        break;
      case 'sponsor_available':
        if (!g.sponsorAvailable(guard.placement)) return `no eligible sponsor for ${guard.placement}`;
        break;
      case 'condition': {
        const r = evaluateCondition(guard, input, g);
        if (r) return r;
        break;
      }
    }
  }
  return null;
}

/** Which playlists does this trigger input start? Returns matches plus skip reasons for diagnostics. */
export function matchTriggers(plan: GamePlan, input: TriggerInput, g: GuardContext): { matches: TriggerMatch[]; skipped: { playlistId: string; triggerId: string; reason: string }[] } {
  const matches: TriggerMatch[] = [];
  const skipped: { playlistId: string; triggerId: string; reason: string }[] = [];
  for (const pl of plan.playlists) {
    for (const t of pl.triggers) {
      let hit = false;
      let iteration = '';
      let ctx: Record<string, unknown> = {};
      let occurredAt = input.at;
      if (t.type === 'phase' && input.kind === 'phase') {
        hit = t.phaseIds.includes(input.phaseId) || t.phaseTags.some((x) => input.phaseTags.includes(x));
        iteration = `phase:${input.phaseId}:${input.seq}`;
        ctx = { phaseId: input.phaseId, phaseLabel: input.phaseLabel };
        occurredAt = input.occurredAt;
      } else if (t.type === 'event' && input.kind === 'event') {
        hit = t.eventTypes.includes(input.eventType) && (!t.sides || (input.side != null && t.sides.includes(input.side)));
        iteration = `fact:${input.factId}:${input.factRevision}`;
        ctx = { factId: input.factId, factRevision: input.factRevision, eventType: input.eventType, side: input.side, playerId: input.playerId, clockMs: input.clockMs, payload: input.payload };
        occurredAt = input.occurredAt;
        if (hit && input.historical) {
          skipped.push({ playlistId: pl.id, triggerId: t.id, reason: 'historical fact (outside live window): no on-air replay' });
          continue;
        }
      } else if (t.type === 'milestone' && input.kind === 'event') {
        const before = input.prevCounters[t.counter] ?? 0;
        const after = input.counters[t.counter] ?? 0;
        // once per qualifying crossing of a multiple of `every`
        const crossed = Math.floor(after / t.every) > Math.floor(before / t.every) ? Math.floor(after / t.every) * t.every : 0;
        hit = crossed > 0;
        iteration = `milestone:${t.counter}:${crossed}`;
        ctx = { counter: t.counter, value: after, milestone: crossed, side: input.side, playerId: input.playerId };
        occurredAt = input.occurredAt;
        if (hit && input.historical) {
          skipped.push({ playlistId: pl.id, triggerId: t.id, reason: 'historical fact: milestone not replayed' });
          continue;
        }
      } else if (t.type === 'match_clock' && input.kind === 'match_clock' && input.triggerId === t.id) {
        hit = true;
        iteration = `clock:${input.periodId}:${input.thresholdMs}`;
        ctx = { periodId: input.periodId, thresholdMs: input.thresholdMs };
      } else if (t.type === 'wall_clock' && input.kind === 'wall_clock' && input.triggerId === t.id) {
        hit = true;
        iteration = `wall:${input.occurrence}`;
      } else if (t.type === 'manual' && input.kind === 'manual' && input.playlistId === pl.id) {
        hit = true;
        iteration = `manual:${input.requestId}`;
      }
      if (!hit) continue;
      const reason = checkGuards(pl, input, g);
      if (reason) {
        skipped.push({ playlistId: pl.id, triggerId: t.id, reason });
        continue;
      }
      matches.push({ playlist: pl, trigger: t, iteration, occurredAt, context: ctx });
    }
  }
  return { matches, skipped };
}

// ------------------------------------------------------------------ clock thresholds

export interface ClockCrossing {
  triggerId: string;
  playlistId: string;
  thresholdMs: number;
  periodId: string;
  /** fire, or skip because a forward correction jumped across it */
  outcome: 'fire' | 'skip';
}

/**
 * Thresholds crossed between two observed clock positions. A crossing during normal running (small step)
 * fires; a large forward jump (correction) records the crossing as skipped. Backward moves and pauses cross nothing.
 */
export function clockCrossings(plan: GamePlan, periodId: string, prevMs: number, nowMs: number, opts: { maxNormalStepMs?: number } = {}): ClockCrossing[] {
  if (nowMs <= prevMs) return [];
  const jump = nowMs - prevMs > (opts.maxNormalStepMs ?? 3000);
  const out: ClockCrossing[] = [];
  for (const pl of plan.playlists)
    for (const t of pl.triggers) {
      if (t.type !== 'match_clock') continue;
      if (t.periodIds.length && !t.periodIds.includes(periodId)) continue;
      const points: number[] = [];
      if (t.repeatEveryMs) {
        const until = t.untilMs ?? Number.MAX_SAFE_INTEGER;
        const first = Math.max(t.atMs, t.atMs + Math.ceil((prevMs + 1 - t.atMs) / t.repeatEveryMs) * t.repeatEveryMs);
        for (let x = first; x <= nowMs && x <= until; x += t.repeatEveryMs) if (x > prevMs) points.push(x);
        if (t.atMs > prevMs && t.atMs <= nowMs && !points.includes(t.atMs)) points.unshift(t.atMs);
      } else if (t.atMs > prevMs && t.atMs <= nowMs) points.push(t.atMs);
      for (const x of points) out.push({ triggerId: t.id, playlistId: pl.id, thresholdMs: x, periodId, outcome: jump ? 'skip' : 'fire' });
    }
  return out;
}

// ------------------------------------------------------------------ run planning & priority

export interface PlannedCue {
  itemIndex: number;
  item: PlanItem;
  dueAt: number;
  deadlineAt: number | null;
  durationMs: number | null;
  variables: Record<string, unknown>;
  layer: string | null;
}

/** "second_half_ready" → "Second half ready": the fallback when a phase label is not in the trigger context. */
export const humanisePhase = (id: string) => (id ? id.replace(/^p(\d+)$/, 'Period $1').replace(/^et(\d+)$/, 'Extra time $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : undefined);

export function resolveVariables(vars: PlanItem['variables'], ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    if (v && typeof v === 'object' && 'from' in v) {
      const src = v.from;
      const payload = (ctx.payload as Record<string, unknown>) ?? {};
      const val =
        src === 'event.side' ? ctx.side
        : src === 'event.playerId' ? ctx.playerId
        : src === 'event.type' ? ctx.eventType
        : src === 'event.minute' ? (ctx.clockMs != null ? String(Math.floor(Number(ctx.clockMs) / 60000) + 1) : undefined)
        : src === 'event.points' ? payload.points
        : src === 'event.playerOutId' ? payload.playerOutId
        : src === 'event.playerInId' ? payload.playerInId
        : src === 'event.cardType' ? CARD_TYPES[String(ctx.eventType ?? '')]
        : src === 'phase.label' ? (ctx.phaseLabel ?? humanisePhase(String(ctx.phaseId ?? '')))
        : src === 'event.assistId' ? payload.assistId
        : src === 'event.goalType' ? (payload.goalType ?? (ctx.eventType && ctx.eventType !== 'goal' ? ctx.eventType : undefined))
        : src === 'trigger.milestone' ? (ctx.milestone != null ? `${ctx.milestone} ${String(ctx.counter ?? '').replace(/_/g, ' ')}` : undefined)
        : undefined;
      if (val !== undefined && val !== null) out[k] = val;
    } else out[k] = v;
  }
  return out;
}

export function itemLayer(it: PlanItem, templateLayers: Record<string, string>): string | null {
  if (it.layer) return it.layer;
  if (it.templateKey) return templateLayers[it.templateKey] ?? null;
  if (it.action === 'media') return 'fullframe';
  if (it.action === 'creative' || it.action === 'sponsor') return it.placement?.startsWith('full_frame') ? 'fullframe' : it.placement === 'lower_third_banner' ? 'lower' : 'sponsor';
  if (it.action === 'scorebug_show' || it.action === 'scorebug_hide') return 'scoreboard';
  return null;
}

export function playlistLayers(pl: Playlist, templateLayers: Record<string, string>): string[] {
  return [...new Set(pl.items.map((i) => itemLayer(i, templateLayers)).filter((x): x is string => !!x && x !== 'scoreboard'))];
}

/**
 * Cue timeline for one run. Deadlines use occurrence time (+ alignment delay), not queue insertion time,
 * so a late-arriving fact never plays an obsolete celebration.
 */
export function planRun(pl: Playlist, m: TriggerMatch, startAt: number, opts: { freshnessMs: number; alignmentDelayMs?: number; templateLayers: Record<string, string>; liveTrigger: boolean; loop?: number }): PlannedCue[] {
  const origin = startAt + (opts.loop ? 0 : pl.startDelayMs ?? 0);
  const deadlineBase = m.occurredAt + (opts.alignmentDelayMs ?? 0) + opts.freshnessMs;
  return pl.items.map((item, itemIndex) => {
    const dueAt = origin + item.offsetMs;
    return {
      itemIndex,
      item,
      dueAt,
      // only the first item of an event-driven run is bound by freshness; later items follow the run
      deadlineAt: opts.liveTrigger && itemIndex === 0 ? Math.max(deadlineBase, dueAt + 1000) : null,
      durationMs: item.durationMs ?? null,
      variables: resolveVariables(item.variables, m.context),
      layer: itemLayer(item, opts.templateLayers),
    };
  });
}

export interface ActiveRun {
  runId: string;
  playlistId: string;
  priority: number;
  layers: string[];
  state: 'queued' | 'running';
  createdAt: number;
  promotional: boolean;
  kind?: Playlist['kind'];
}

const KIND_FOR_PHASE: Record<string, Playlist['kind'][]> = { pre: ['pre'], play: ['in_play'], break: ['break'], final: ['post'], terminal: [] };

/** Phase-bound playlists end when the match leaves their phase kind (a pre-game loop never runs into play). */
export function phaseBoundCancellations(active: ActiveRun[], newPhaseKind: string): { runId: string; reason: string }[] {
  const allowed = KIND_FOR_PHASE[newPhaseKind] ?? [];
  return active.filter((r) => r.kind && !allowed.includes(r.kind)).map((r) => ({ runId: r.runId, reason: `phase changed to ${newPhaseKind}` }));
}

/**
 * Phase-step playlists (every trigger is a phase trigger) belong to the phase that started them: when the match
 * moves to a phase none of their triggers match, they stop, so "Players entering" never runs into "About to start".
 */
export function phaseStepCancellations(plan: GamePlan, active: ActiveRun[], input: { phaseId: string; phaseTags: string[] }): { runId: string; reason: string }[] {
  return active
    .filter((r) => {
      const pl = plan.playlists.find((x) => x.id === r.playlistId);
      if (!pl || pl.continueOnPhaseStep || !pl.triggers.every((t) => t.type === 'phase')) return false;
      return !pl.triggers.some((t) => t.type === 'phase' && (t.phaseIds.includes(input.phaseId) || t.phaseTags.some((x) => input.phaseTags.includes(x))));
    })
    .map((r) => ({ runId: r.runId, reason: `phase moved on to ${input.phaseId}` }));
}

export type PriorityDecision = { action: 'start'; preempt: { runId: string; reason: string }[] } | { action: 'queue'; behind: string[]; reason: string } | { action: 'skip'; reason: string };

/**
 * 1 = highest. Higher priority preempts conflicting lower runs; equal priority keeps accepted trigger order
 * (the new run queues); lower priority waits behind conflicting higher runs (or is skipped if promotional and
 * already blocked). Non-conflicting layers run together.
 */
export function decidePriority(newRun: { priority: number; layers: string[]; promotional: boolean }, active: ActiveRun[]): PriorityDecision {
  const conflicting = active.filter((r) => r.layers.some((l) => newRun.layers.includes(l)));
  if (!conflicting.length) return { action: 'start', preempt: [] };
  const blockers = conflicting.filter((r) => r.priority <= newRun.priority);
  if (!blockers.length) return { action: 'start', preempt: conflicting.map((r) => ({ runId: r.runId, reason: `preempted by priority ${newRun.priority}` })) };
  if (newRun.promotional && blockers.some((b) => b.priority < newRun.priority)) return { action: 'skip', reason: `lost priority to ${blockers.map((b) => b.playlistId).join(', ')}` };
  return { action: 'queue', behind: blockers.map((b) => b.runId), reason: `waiting for ${blockers.map((b) => b.playlistId).join(', ')} (priority ${Math.min(...blockers.map((b) => b.priority))})` };
}

export function executionKey(overlayId: string, gamePlanVersionId: string, triggerId: string, playlistId: string, iteration: string) {
  return `${overlayId}:${gamePlanVersionId}:${triggerId}:${playlistId}:${iteration}`;
}
