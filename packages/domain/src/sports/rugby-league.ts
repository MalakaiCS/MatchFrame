// Rugby league: two count-up halves, tries (4), conversions (2), penalty goals (2), field goals (1, or 2 from
// beyond 40 m), sin bin (timed on playing time) and send-off, a capped interchange bench, video reviews, optional
// golden point when level.
import { z } from 'zod';
import { clockDisplayMs, createClock, formatClock } from '../clock';
import type { FactInput, LogEntry, SportAdapter } from '../adapter';
import { err, ok, type DisplayModel, type EventTypeDef, type MatchProjection, type PhaseDef, type Result, type Side } from '../types';
import { adjustStat, basePre, bump, cloneProjection, playerInLineup, sideSchema } from './common';
import { onField, substitutionProblem } from '../lineup';
import { REVIEW_SUBJECTS } from '../review';
import { clocksForPeriodPhase, extraBreaksText, extraPeriodsSchema, periodClockText, periodOf, periodPhases, periodTransitions, type PeriodSpec } from './periods';

export const rugbyLeagueConfigSchema = z.object({
  periodMinutes: z.number().int().min(10).max(45),
  halfTimeMinutes: z.number().int().min(5).max(20),
  goldenPoint: extraPeriodsSchema({ min: 3, max: 10 }, { before: 5, between: 0 }),
  interchangeLimit: z.number().int().min(0).max(20),
  /** minutes of playing time a sin-binned player is off (rules stored before this setting read as 10) */
  sinBinMinutes: z.number().int().min(2).max(20).default(10),
  label: z.string().max(80),
});
export type RugbyLeagueConfig = z.infer<typeof rugbyLeagueConfigSchema>;

const STANDARD: RugbyLeagueConfig = { periodMinutes: 40, halfTimeMinutes: 10, goldenPoint: { enabled: false, periodMinutes: 5, breakMinutes: 5, intervalMinutes: 0 }, interchangeLimit: 8, sinBinMinutes: 10, label: 'Standard 2×40, 8 interchanges' };

const spec = (c: RugbyLeagueConfig): PeriodSpec => ({
  count: 2,
  period: (n) => (n === 1 ? { label: '1st Half', short: '1H' } : { label: '2nd Half', short: '2H' }),
  interval: () => ({ label: 'Half Time', short: 'HT' }),
  extra: c.goldenPoint.enabled ? { count: 2, period: (k) => ({ label: `Golden Point ${k}`, short: `GP${k}` }), beforeLabel: 'Before Golden Point' } : null,
  shootout: null,
  final: { label: 'Full Time', short: 'FT' },
});
const phasesFor = (c: RugbyLeagueConfig): PhaseDef[] => periodPhases(spec(c));

const EVENTS: EventTypeDef[] = [
  { type: 'try', label: 'Try', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'penalty_try', label: 'Penalty try', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'conversion', label: 'Conversion', group: 'score', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'conversion_missed', label: 'Conversion missed', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'penalty_goal', label: 'Penalty goal', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: false },
  { type: 'field_goal', label: 'Field goal', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'sin_bin', label: 'Sin bin', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: false },
  { type: 'send_off', label: 'Send off', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: true },
  { type: 'interchange', label: 'Interchange', group: 'change', requiresSide: true, playerField: 'none', graphic: 'substitution', highlightDefault: false },
  { type: 'error', label: 'Error', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'penalty_conceded', label: 'Penalty conceded', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'six_again', label: 'Six again', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false },
  { type: 'line_break', label: 'Line break', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'stat_adjust', label: 'Adjust team stat', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false, phases: ['play', 'break', 'final'] },
  { type: 'possession_change', label: 'Possession', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false },
  // the video referee (or a captain's challenge) checks a decision for a team: the review graphic shows it, then the decision
  { type: 'video_review', label: 'Video review', group: 'control', requiresSide: true, playerField: 'none', graphic: 'review', highlightDefault: false },
  { type: 'review_decision', label: 'Review decision', group: 'control', requiresSide: false, playerField: 'none', highlightDefault: false },
];

export const RUGBY_LEAGUE_STATS = ['points', 'tries', 'conversions', 'penalty_goals', 'field_goals', 'errors', 'penalties', 'six_agains', 'line_breaks', 'interchanges', 'possession_pct'] as const;

const payloadSchemas: Record<string, z.ZodType> = {
  field_goal: z.object({ points: z.union([z.literal(1), z.literal(2)]).default(1) }),
  interchange: z.object({ playerOutId: z.string().uuid().nullable().optional(), playerInId: z.string().uuid().nullable().optional(), free: z.boolean().default(false) }),
  stat_adjust: z.object({ stat: z.enum(RUGBY_LEAGUE_STATS), delta: z.number().int().min(-50).max(50) }),
  video_review: z.object({ subject: z.enum(REVIEW_SUBJECTS).default('try') }),
  review_decision: z.object({ outcome: z.enum(['awarded', 'denied']) }),
};

const POINTS: Record<string, number> = { try: 4, penalty_try: 4, conversion: 2, penalty_goal: 2 };

const lengthMs = (c: RugbyLeagueConfig) => (phase: string) => {
  const per = periodOf(phase);
  if (!per) return null;
  return (per.kind === 'reg' ? c.periodMinutes : c.goldenPoint.periodMinutes) * 60_000;
};
const baseMs = (c: RugbyLeagueConfig) => (phase: string) => {
  const per = periodOf(phase)!;
  const half = c.periodMinutes * 60_000;
  return per.kind === 'reg' ? (per.n - 1) * half : 2 * half + (per.n - 1) * c.goldenPoint.periodMinutes * 60_000;
};

const sinBinMs = (c: RugbyLeagueConfig) => (c.sinBinMinutes ?? 10) * 60_000;

/**
 * Playing time since kick-off (ms) at a clock reading in a period. The clock counts up through the match; time
 * played after the siren, past the period's length, is not counted (the game clock stops there), so a sin bin
 * that runs over half time carries its remaining time into the second half.
 */
export function rugbyLeagueMatchMs(c: RugbyLeagueConfig, periodId: string, clockMs: number | null | undefined): number | null {
  const per = periodOf(periodId);
  if (!per || clockMs == null) return null;
  const base = baseMs(c)(periodId);
  return base + Math.min(lengthMs(c)(periodId)!, Math.max(0, clockMs - base));
}

/** Playing time while the clock is not running at a break: where the period before it ended. */
function matchMsAtBreak(c: RugbyLeagueConfig, phase: string): number | null {
  const half = c.periodMinutes * 60_000;
  if (phase === 'half_time' || phase.startsWith('second_half_')) return half;
  if (phase === 'extra_time_break') return 2 * half;
  const m = /^et_break_(\d+)$/.exec(phase);
  return m ? 2 * half + Number(m[1]) * c.goldenPoint.periodMinutes * 60_000 : null;
}

type SinBin = NonNullable<MatchProjection['sinBins']>[number];
const sinBinActive = (c: RugbyLeagueConfig, s: SinBin, atMs: number) => s.endedAtMs == null && s.atMs != null && atMs - s.atMs < sinBinMs(c);
/** "6:22", not "06:22" */
const countdown = (ms: number) => formatClock(Math.max(0, ms)).replace(/^0(?=\d:)/, '');

/** Sin bins whose time is up by `atMs` end, and their players go back where they were (mutates `p`). */
function endSinBins(c: RugbyLeagueConfig, p: MatchProjection, atMs: number | null) {
  if (atMs == null) return;
  for (const s of p.sinBins ?? []) {
    if (s.endedAtMs != null || s.atMs == null || atMs - s.atMs < sinBinMs(c)) continue;
    s.endedAtMs = s.atMs + sinBinMs(c);
    const t = s.playerId ? p.players[s.playerId] : null;
    if (!t || t.red) continue;
    // on the field, or on the bench for a bench player who was sin-binned
    if (s.onCourtBefore == null) delete t.onCourt;
    else t.onCourt = s.onCourtBefore;
  }
}

export const rugbyLeagueAdapter: SportAdapter<RugbyLeagueConfig> = {
  sport: 'rugby_league',
  label: 'Rugby League',
  rulesVersion: 'rugby_league-1',
  configSchema: rugbyLeagueConfigSchema,
  defaultConfig: STANDARD,
  presets: [
    { id: 'standard', label: STANDARD.label, config: STANDARD },
    { id: 'golden-point', label: 'Finals 2×40 with golden point', config: { ...STANDARD, goldenPoint: { enabled: true, periodMinutes: 5, breakMinutes: 5, intervalMinutes: 0 }, label: 'Finals 2×40 with golden point' } },
    { id: 'junior', label: 'Junior 2×25, unlimited interchange', config: { ...STANDARD, periodMinutes: 25, halfTimeMinutes: 5, interchangeLimit: 0, label: 'Junior 2×25, unlimited interchange' } },
  ],
  describeRules: (c) => [
    `${c.periodMinutes}-minute halves (count-up clock), ${c.halfTimeMinutes}-minute half time`,
    'Try 4, conversion 2, penalty goal 2, field goal 1 (2 from beyond 40 m)',
    `Sin bin: ${c.sinBinMinutes ?? 10} minutes of playing time`,
    c.interchangeLimit ? `${c.interchangeLimit} interchanges per team` : 'Unlimited interchange',
    c.goldenPoint.enabled ? `Golden point: 2×${c.goldenPoint.periodMinutes} minutes when level${extraBreaksText(c.goldenPoint, 5, 0)}` : 'Draws stand',
  ],
  phases: phasesFor,
  phase: (c, id) => phasesFor(c).find((p) => p.id === id),
  allowedTransitions: (c, p) => periodTransitions(spec(c), p, { extraTime: c.goldenPoint.enabled, shootout: false }),
  eventTypes: () => EVENTS,
  initialProjection: () => basePre('rugby_league', 'rugby_league-1', { home: {}, away: {} }),
  initialClocks: (c) => ({ main: createClock('main', 'up', 0, 'scheduled', c.periodMinutes * 60_000) }),

  validateFact(c, p, f, lineup) {
    const def = EVENTS.find((e) => e.type === f.type);
    if (!def) return err('UNKNOWN_EVENT', `Unsupported rugby league event "${f.type}"`, 'type');
    const phase = phasesFor(c).find((x) => x.id === p.phase)!;
    if (!(def.phases ?? ['play']).includes(phase.kind)) return err('PHASE_NOT_ALLOWED', `${def.label} cannot be recorded during ${phase.label}`, 'type');
    if (def.requiresSide && !sideSchema.safeParse(f.side).success) return err('SIDE_REQUIRED', 'Choose a team', 'side');
    const schema = payloadSchemas[f.type];
    if (schema) {
      const r = schema.safeParse(f.payload ?? {});
      if (!r.success) return err('INVALID_PAYLOAD', r.error.issues[0]?.message ?? 'Invalid event details', 'payload');
      f = { ...f, payload: r.data as Record<string, unknown> };
    }
    if (f.type === 'video_review' && p.review && p.review.outcome == null) return err('REVIEW_OPEN', 'A video review is already waiting for its decision: give that first', 'type');
    if (f.type === 'review_decision' && (!p.review || p.review.outcome != null)) return err('NO_REVIEW', 'There is no video review waiting for a decision', 'type');
    // players whose sin bin is over by now are back on the field
    const at = rugbyLeagueMatchMs(c, f.periodId ?? p.phase, f.clockMs);
    if (at != null && p.sinBins?.length) {
      p = cloneProjection(p);
      endSinBins(c, p, at);
    }
    const inSinBin = (id: unknown) => !!id && at != null && !!p.sinBins?.some((s) => s.playerId === id && sinBinActive(c, s, at));
    if (f.type === 'sin_bin' && inSinBin(f.playerId)) return err('IN_SIN_BIN', 'That player is already in the sin bin', 'playerId');
    if (f.type === 'interchange' && inSinBin((f.payload as { playerInId?: string }).playerInId)) return err('IN_SIN_BIN', 'That player is in the sin bin: they come back when their time is up', 'payload.playerInId');
    const check = (id: unknown, field: string): Result<FactInput> | null =>
      id && lineup && f.side && !playerInLineup(lineup, f.side, String(id)) ? err('PLAYER_NOT_IN_LINEUP', 'Player is not in this team’s match lineup', field) : null;
    const e = check(f.playerId, 'playerId');
    if (e) return e;
    if (f.type === 'interchange' && f.side) {
      const pl = f.payload as { playerOutId?: string; playerInId?: string; free?: boolean };
      const e2 = check(pl.playerOutId, 'payload.playerOutId') ?? check(pl.playerInId, 'payload.playerInId');
      if (e2) return e2;
      if (c.interchangeLimit && !pl.free && (p.stats[f.side]!.interchanges ?? 0) >= c.interchangeLimit) return err('INTERCHANGE_LIMIT', `All ${c.interchangeLimit} interchanges have been used`, 'payload');
      if (lineup) {
        const problem = substitutionProblem(onField(lineup, p, f.side), pl.playerOutId, pl.playerInId, true);
        if (problem) return err('INVALID_SUBSTITUTION', problem, 'payload');
      }
    }
    return ok(f);
  },

  applyFact(c, prev, e: LogEntry) {
    const p = cloneProjection(prev);
    const side = e.side as Side;
    const at = rugbyLeagueMatchMs(c, e.periodId, e.clockMs);
    endSinBins(c, p, at);
    const tally = (id: string | null | undefined) => (id ? (p.players[id] ??= {}) : null);
    const addPoints = (pts: number, kind: string) => {
      p.score[side] += pts;
      const ps = (p.periodScores[e.periodId] ??= { home: 0, away: 0 });
      ps[side] += pts;
      bump(p.stats[side], 'points', pts);
      bump(p.stats[side], kind);
      if (e.playerId) {
        const t = tally(e.playerId)!;
        t.points = (t.points ?? 0) + pts;
        t.breakdown ??= {};
        t.breakdown[kind] = (t.breakdown[kind] ?? 0) + 1;
      }
      bump(p.counters, 'points', pts);
    };
    switch (e.type) {
      case 'try':
      case 'penalty_try':
        addPoints(POINTS[e.type]!, 'tries');
        bump(p.counters, 'tries');
        break;
      case 'conversion':
        addPoints(2, 'conversions');
        break;
      case 'conversion_missed':
        break;
      case 'penalty_goal':
        addPoints(2, 'penalty_goals');
        break;
      case 'field_goal':
        addPoints((e.payload as { points?: number }).points ?? 1, 'field_goals');
        break;
      case 'sin_bin':
        bump(p.stats[side], 'sin_bins');
        (p.sinBins ??= []).push({ side, playerId: e.playerId ?? null, atMs: at, endedAtMs: null, onCourtBefore: e.playerId ? (p.players[e.playerId]?.onCourt ?? null) : null });
        if (e.playerId) tally(e.playerId)!.onCourt = false;
        bump(p.counters, 'cards');
        break;
      case 'send_off':
        bump(p.stats[side], 'send_offs');
        if (e.playerId) Object.assign(tally(e.playerId)!, { red: true, onCourt: false });
        // a sin-binned player sent off does not come back: the sin bin's countdown ends
        for (const s of p.sinBins ?? []) if (e.playerId && s.playerId === e.playerId && s.endedAtMs == null) s.endedAtMs = at ?? s.atMs;
        bump(p.counters, 'cards');
        break;
      case 'video_review':
        p.review = { subject: String((e.payload as { subject?: string }).subject ?? 'try'), side, outcome: null, sequence: e.sequence };
        break;
      case 'review_decision':
        if (p.review && p.review.outcome == null) p.review = { ...p.review, outcome: (e.payload as { outcome: 'awarded' | 'denied' }).outcome };
        break;
      case 'interchange': {
        const pl = e.payload as { playerOutId?: string; playerInId?: string; free?: boolean };
        if (pl.playerOutId) tally(pl.playerOutId)!.onCourt = false;
        if (pl.playerInId) tally(pl.playerInId)!.onCourt = true;
        if (!pl.free) bump(p.stats[side], 'interchanges');
        bump(p.counters, 'substitutions');
        break;
      }
      case 'error':
        bump(p.stats[side], 'errors');
        break;
      case 'penalty_conceded':
        bump(p.stats[side], 'penalties');
        break;
      case 'six_again':
        bump(p.stats[side], 'six_agains');
        break;
      case 'line_break':
        bump(p.stats[side], 'line_breaks');
        break;
      case 'stat_adjust': {
        const pl = e.payload as { stat: string; delta: number };
        adjustStat(p.stats[side], pl.stat, pl.delta);
        break;
      }
    }
    p.lastFactSequence = e.sequence;
    return p;
  },

  applyPhase(_c, prev, to) {
    const p = cloneProjection(prev);
    p.phase = to;
    // a review still waiting for its decision when the period ends is dropped
    if (p.review && p.review.outcome == null) p.review = null;
    return p;
  },
  clocksForPhase: (c, _from, to, clocks, at) => clocksForPeriodPhase({ direction: 'up', lengthMs: lengthMs(c), cumulativeBaseMs: baseMs(c) }, to, clocks, at),
  clocksForFact: (_c, _f, clocks) => clocks,

  display(c, p, clocks, now): DisplayModel {
    const ph = phasesFor(c).find((x) => x.id === p.phase)!;
    const main = clocks.main!;
    const ms = clockDisplayMs(main, now);
    // the sin-bin countdown runs on playing time; in a break it stands where the period ended
    const nowMatch = periodOf(p.phase) ? rugbyLeagueMatchMs(c, p.phase, ms) : matchMsAtBreak(c, p.phase);
    const timers: NonNullable<DisplayModel['timers']> = [];
    const alerts: string[] = [];
    if (nowMatch != null) {
      for (const s of ['home', 'away'] as const) {
        const active = (p.sinBins ?? []).filter((x) => x.side === s && sinBinActive(c, x, nowMatch));
        if (!active.length) continue;
        const remainingMs = Math.min(...active.map((x) => sinBinMs(c) - (nowMatch - x.atMs!)));
        timers.push({ side: s, kind: 'sin_bin', count: active.length, remainingMs, remainingText: countdown(remainingMs) });
        alerts.push(`${s === 'home' ? 'Home' : 'Away'}: ${active.length > 1 ? `${active.length} players` : 'a player'} in the sin bin, ${countdown(remainingMs)} of playing time to go`);
      }
    }
    return {
      periodLabel: ph.label,
      periodShort: ph.short,
      clockText: periodClockText(ph, formatClock(ms)),
      clockRunning: main.running,
      score: { ...p.score },
      timers: timers.length ? timers : null,
      alerts,
    };
  },

  capabilities: () => ({
    graphics: ['scorebug', 'ident', 'lineup', 'goal', 'card', 'substitution', 'period_banner', 'lower_third', 'player_card', 'stats', 'break_score', 'sponsor', 'full_frame', 'ticker', 'slate', 'league_table', 'fixtures', 'formation', 'match_summary', 'head_to_head', 'match_info', 'stat_compare', 'top_scorers', 'player_of_match', 'stinger', 'review'],
    scorebugFields: ['score', 'clock', 'period', 'sin_bins'],
    statRows: [
      { key: 'tries', label: 'Tries' },
      { key: 'conversions', label: 'Conversions' },
      { key: 'penalty_goals', label: 'Penalty goals' },
      { key: 'field_goals', label: 'Field goals' },
      { key: 'line_breaks', label: 'Line breaks' },
      { key: 'errors', label: 'Errors' },
      { key: 'penalties', label: 'Penalties conceded' },
      { key: 'six_agains', label: 'Six agains' },
      { key: 'interchanges', label: 'Interchanges' },
      { key: 'possession_pct', label: 'Possession', unit: '%' },
    ],
  }),
  highlightDefaults: () => ['try', 'penalty_try', 'field_goal', 'send_off', 'manual_moment'],
  knockout: { label: 'Golden point when level', isOn: (c) => c.goldenPoint.enabled, set: (c, on) => ({ ...c, goldenPoint: { ...c.goldenPoint, enabled: on } }) },
};
