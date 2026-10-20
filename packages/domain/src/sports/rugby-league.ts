// Rugby league: two count-up halves, tries (4), conversions (2), penalty goals (2), field goals (1, or 2 from
// beyond 40 m), sin bin and send-off, a capped interchange bench, optional golden point when level.
import { z } from 'zod';
import { clockDisplayMs, createClock, formatClock } from '../clock';
import type { FactInput, LogEntry, SportAdapter } from '../adapter';
import { err, ok, type DisplayModel, type EventTypeDef, type PhaseDef, type Result, type Side } from '../types';
import { adjustStat, basePre, bump, cloneProjection, playerInLineup, sideSchema } from './common';
import { onField, substitutionProblem } from '../lineup';
import { clocksForPeriodPhase, periodClockText, periodOf, periodPhases, periodTransitions, type PeriodSpec } from './periods';

export const rugbyLeagueConfigSchema = z.object({
  periodMinutes: z.number().int().min(10).max(45),
  halfTimeMinutes: z.number().int().min(5).max(20),
  goldenPoint: z.object({ enabled: z.boolean(), periodMinutes: z.number().int().min(3).max(10) }),
  interchangeLimit: z.number().int().min(0).max(20),
  label: z.string().max(80),
});
export type RugbyLeagueConfig = z.infer<typeof rugbyLeagueConfigSchema>;

const STANDARD: RugbyLeagueConfig = { periodMinutes: 40, halfTimeMinutes: 10, goldenPoint: { enabled: false, periodMinutes: 5 }, interchangeLimit: 8, label: 'Standard 2×40, 8 interchanges' };

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
];

export const RUGBY_LEAGUE_STATS = ['points', 'tries', 'conversions', 'penalty_goals', 'field_goals', 'errors', 'penalties', 'six_agains', 'line_breaks', 'interchanges'] as const;

const payloadSchemas: Record<string, z.ZodType> = {
  field_goal: z.object({ points: z.union([z.literal(1), z.literal(2)]).default(1) }),
  interchange: z.object({ playerOutId: z.string().uuid().nullable().optional(), playerInId: z.string().uuid().nullable().optional(), free: z.boolean().default(false) }),
  stat_adjust: z.object({ stat: z.enum(RUGBY_LEAGUE_STATS), delta: z.number().int().min(-50).max(50) }),
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

export const rugbyLeagueAdapter: SportAdapter<RugbyLeagueConfig> = {
  sport: 'rugby_league',
  label: 'Rugby League',
  rulesVersion: 'rugby_league-1',
  configSchema: rugbyLeagueConfigSchema,
  defaultConfig: STANDARD,
  presets: [
    { id: 'standard', label: STANDARD.label, config: STANDARD },
    { id: 'golden-point', label: 'Finals 2×40 with golden point', config: { ...STANDARD, goldenPoint: { enabled: true, periodMinutes: 5 }, label: 'Finals 2×40 with golden point' } },
    { id: 'junior', label: 'Junior 2×25, unlimited interchange', config: { ...STANDARD, periodMinutes: 25, halfTimeMinutes: 5, interchangeLimit: 0, label: 'Junior 2×25, unlimited interchange' } },
  ],
  describeRules: (c) => [
    `${c.periodMinutes}-minute halves (count-up clock), ${c.halfTimeMinutes}-minute half time`,
    'Try 4, conversion 2, penalty goal 2, field goal 1 (2 from beyond 40 m)',
    c.interchangeLimit ? `${c.interchangeLimit} interchanges per team` : 'Unlimited interchange',
    c.goldenPoint.enabled ? `Golden point: 2×${c.goldenPoint.periodMinutes} minutes when level` : 'Draws stand',
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

  applyFact(_c, prev, e: LogEntry) {
    const p = cloneProjection(prev);
    const side = e.side as Side;
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
        if (e.playerId) tally(e.playerId)!.onCourt = false;
        bump(p.counters, 'cards');
        break;
      case 'send_off':
        bump(p.stats[side], 'send_offs');
        if (e.playerId) Object.assign(tally(e.playerId)!, { red: true, onCourt: false });
        bump(p.counters, 'cards');
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
    return p;
  },
  clocksForPhase: (c, _from, to, clocks, at) => clocksForPeriodPhase({ direction: 'up', lengthMs: lengthMs(c), cumulativeBaseMs: baseMs(c) }, to, clocks, at),
  clocksForFact: (_c, _f, clocks) => clocks,

  display(c, p, clocks, now): DisplayModel {
    const ph = phasesFor(c).find((x) => x.id === p.phase)!;
    const main = clocks.main!;
    const ms = clockDisplayMs(main, now);
    return {
      periodLabel: ph.label,
      periodShort: ph.short,
      clockText: periodClockText(ph, formatClock(ms)),
      clockRunning: main.running,
      score: { ...p.score },
      alerts: [],
    };
  },

  capabilities: () => ({
    graphics: ['scorebug', 'ident', 'lineup', 'goal', 'card', 'substitution', 'period_banner', 'lower_third', 'player_card', 'stats', 'break_score', 'sponsor', 'full_frame', 'ticker', 'slate'],
    scorebugFields: ['score', 'clock', 'period'],
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
    ],
  }),
  highlightDefaults: () => ['try', 'penalty_try', 'field_goal', 'send_off', 'manual_moment'],
};
