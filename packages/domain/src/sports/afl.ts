// Australian football: four count-up quarters (time-on runs past the nominal length), goals (6) and behinds (1),
// the "12.7 (79)" score line, rolling interchange, and the usual broadcast counts.
import { z } from 'zod';
import { clockDisplayMs, createClock, formatClock } from '../clock';
import type { FactInput, LogEntry, SportAdapter } from '../adapter';
import { err, ok, type DisplayModel, type EventTypeDef, type PhaseDef, type Result, type Side } from '../types';
import { adjustStat, basePre, bump, cloneProjection, playerInLineup, sideSchema } from './common';
import { onField, substitutionProblem } from '../lineup';
import { clocksForPeriodPhase, ordinal, periodClockText, periodOf, periodPhases, periodTransitions, type PeriodSpec } from './periods';

export const aflConfigSchema = z.object({
  periodMinutes: z.number().int().min(5).max(30),
  quarterBreakMinutes: z.number().int().min(1).max(10),
  halfTimeMinutes: z.number().int().min(5).max(30),
  extraTime: z.object({ enabled: z.boolean(), periodMinutes: z.number().int().min(2).max(10) }),
  label: z.string().max(80),
});
export type AflConfig = z.infer<typeof aflConfigSchema>;

const STANDARD: AflConfig = { periodMinutes: 20, quarterBreakMinutes: 6, halfTimeMinutes: 20, extraTime: { enabled: false, periodMinutes: 3 }, label: 'Standard 4×20 plus time-on' };

const spec = (c: AflConfig): PeriodSpec => ({
  count: 4,
  period: (n) => ({ label: `${ordinal(n)} Quarter`, short: `Q${n}` }),
  interval: (n, half) => (half ? { label: 'Half Time', short: 'HT' } : n === 1 ? { label: 'Quarter Time', short: 'QT' } : { label: 'Three-Quarter Time', short: '3QT' }),
  extra: c.extraTime.enabled ? { count: 2, period: (k) => ({ label: `Extra Time ${k}`, short: `ET${k}` }), beforeLabel: 'Before Extra Time' } : null,
  shootout: null,
  final: { label: 'Final Siren', short: 'FT' },
});
const phasesFor = (c: AflConfig): PhaseDef[] => periodPhases(spec(c));

const EVENTS: EventTypeDef[] = [
  { type: 'goal', label: 'Goal', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'behind', label: 'Behind', group: 'score', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'rushed_behind', label: 'Rushed behind', group: 'score', requiresSide: true, playerField: 'none', highlightDefault: false },
  { type: 'mark', label: 'Mark', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'tackle', label: 'Tackle', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'inside_50', label: 'Inside 50', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false },
  { type: 'clearance', label: 'Clearance', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'free_kick', label: 'Free kick', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'interchange', label: 'Interchange', group: 'change', requiresSide: true, playerField: 'none', graphic: 'substitution', highlightDefault: false, phases: ['play', 'break'] },
  { type: 'stat_adjust', label: 'Adjust team stat', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false, phases: ['play', 'break', 'final'] },
];

export const AFL_STATS = ['goals', 'behinds', 'points', 'marks', 'tackles', 'inside_50s', 'clearances', 'free_kicks', 'interchanges'] as const;

const payloadSchemas: Record<string, z.ZodType> = {
  interchange: z.object({ playerOutId: z.string().uuid().nullable().optional(), playerInId: z.string().uuid().nullable().optional() }),
  stat_adjust: z.object({ stat: z.enum(AFL_STATS), delta: z.number().int().min(-50).max(50) }),
};

const lengthMs = (c: AflConfig) => (phase: string) => {
  const per = periodOf(phase);
  if (!per) return null;
  return (per.kind === 'reg' ? c.periodMinutes : c.extraTime.periodMinutes) * 60_000;
};

export const aflScoreLine = (goals: number, behinds: number) => `${goals}.${behinds} (${goals * 6 + behinds})`;

export const aflAdapter: SportAdapter<AflConfig> = {
  sport: 'afl',
  label: 'Australian Football',
  rulesVersion: 'afl-1',
  configSchema: aflConfigSchema,
  defaultConfig: STANDARD,
  presets: [
    { id: 'standard', label: STANDARD.label, config: STANDARD },
    { id: 'finals', label: 'Finals 4×20 with extra time', config: { ...STANDARD, extraTime: { enabled: true, periodMinutes: 3 }, label: 'Finals 4×20 with extra time' } },
    { id: 'junior', label: 'Junior 4×15', config: { ...STANDARD, periodMinutes: 15, quarterBreakMinutes: 5, halfTimeMinutes: 10, label: 'Junior 4×15' } },
  ],
  describeRules: (c) => [
    `4×${c.periodMinutes}-minute quarters plus time-on (count-up clock), ${c.quarterBreakMinutes}-minute quarter breaks, ${c.halfTimeMinutes}-minute half time`,
    'Goal 6, behind 1; the score line reads goals.behinds (total)',
    c.extraTime.enabled ? `Extra time: 2×${c.extraTime.periodMinutes} minutes when level` : 'Draws stand',
    'Rolling interchange',
  ],
  phases: phasesFor,
  phase: (c, id) => phasesFor(c).find((p) => p.id === id),
  allowedTransitions: (c, p) => periodTransitions(spec(c), p, { extraTime: c.extraTime.enabled, shootout: false }),
  eventTypes: () => EVENTS,
  initialProjection: () => basePre('afl', 'afl-1', { home: {}, away: {} }),
  initialClocks: (c) => ({ main: createClock('main', 'up', 0, 'scheduled', c.periodMinutes * 60_000) }),

  validateFact(c, p, f, lineup) {
    const def = EVENTS.find((e) => e.type === f.type);
    if (!def) return err('UNKNOWN_EVENT', `Unsupported AFL event "${f.type}"`, 'type');
    const phase = phasesFor(c).find((x) => x.id === p.phase)!;
    if (!(def.phases ?? ['play']).includes(phase.kind)) return err('PHASE_NOT_ALLOWED', `${def.label} cannot be recorded during ${phase.label}`, 'type');
    if (def.requiresSide && !sideSchema.safeParse(f.side).success) return err('SIDE_REQUIRED', 'Choose a team', 'side');
    const schema = payloadSchemas[f.type];
    if (schema) {
      const r = schema.safeParse(f.payload ?? {});
      if (!r.success) return err('INVALID_PAYLOAD', r.error.issues[0]?.message ?? 'Invalid event details', 'payload');
    }
    const check = (id: unknown, field: string): Result<FactInput> | null =>
      id && lineup && f.side && !playerInLineup(lineup, f.side, String(id)) ? err('PLAYER_NOT_IN_LINEUP', 'Player is not in this team’s match lineup', field) : null;
    const e = check(f.playerId, 'playerId');
    if (e) return e;
    if (f.type === 'interchange' && f.side) {
      const pl = f.payload as { playerOutId?: string; playerInId?: string };
      const e2 = check(pl.playerOutId, 'payload.playerOutId') ?? check(pl.playerInId, 'payload.playerInId');
      if (e2) return e2;
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
    const score = (pts: number, kind: 'goals' | 'behinds') => {
      p.score[side] += pts;
      const ps = (p.periodScores[e.periodId] ??= { home: 0, away: 0 });
      ps[side] += pts;
      bump(p.stats[side], 'points', pts);
      bump(p.stats[side], kind);
      if (e.playerId) {
        const t = tally(e.playerId)!;
        t.points = (t.points ?? 0) + pts;
        if (kind === 'goals') t.goals = (t.goals ?? 0) + 1;
        t.breakdown ??= {};
        t.breakdown[kind] = (t.breakdown[kind] ?? 0) + 1;
      }
      bump(p.counters, 'points', pts);
    };
    switch (e.type) {
      case 'goal':
        score(6, 'goals');
        bump(p.counters, 'goals');
        break;
      case 'behind':
      case 'rushed_behind':
        score(1, 'behinds');
        break;
      case 'mark':
        bump(p.stats[side], 'marks');
        break;
      case 'tackle':
        bump(p.stats[side], 'tackles');
        break;
      case 'inside_50':
        bump(p.stats[side], 'inside_50s');
        break;
      case 'clearance':
        bump(p.stats[side], 'clearances');
        break;
      case 'free_kick':
        bump(p.stats[side], 'free_kicks');
        break;
      case 'interchange': {
        const pl = e.payload as { playerOutId?: string; playerInId?: string };
        if (pl.playerOutId) tally(pl.playerOutId)!.onCourt = false;
        if (pl.playerInId) tally(pl.playerInId)!.onCourt = true;
        bump(p.stats[side], 'interchanges');
        bump(p.counters, 'substitutions');
        break;
      }
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
  clocksForPhase: (c, _from, to, clocks, at) => clocksForPeriodPhase({ direction: 'up', lengthMs: lengthMs(c) }, to, clocks, at),
  clocksForFact: (_c, _f, clocks) => clocks,

  display(c, p, clocks, now): DisplayModel {
    const ph = phasesFor(c).find((x) => x.id === p.phase)!;
    const main = clocks.main!;
    const ms = clockDisplayMs(main, now);
    const line = (s: Side) => aflScoreLine(p.stats[s]!.goals ?? 0, p.stats[s]!.behinds ?? 0);
    return {
      periodLabel: ph.label,
      periodShort: ph.short,
      clockText: periodClockText(ph, formatClock(ms)),
      clockRunning: main.running,
      score: { ...p.score },
      scoreDetail: { home: line('home'), away: line('away') },
      alerts: [],
    };
  },

  capabilities: () => ({
    graphics: ['scorebug', 'ident', 'lineup', 'goal', 'substitution', 'period_banner', 'lower_third', 'player_card', 'stats', 'break_score', 'sponsor', 'full_frame', 'ticker', 'slate', 'league_table', 'fixtures', 'formation', 'match_summary', 'head_to_head', 'match_info', 'stat_compare', 'top_scorers', 'player_of_match', 'stinger'],
    scorebugFields: ['score', 'score_detail', 'clock', 'period'],
    statRows: [
      { key: 'goals', label: 'Goals' },
      { key: 'behinds', label: 'Behinds' },
      { key: 'marks', label: 'Marks' },
      { key: 'tackles', label: 'Tackles' },
      { key: 'inside_50s', label: 'Inside 50s' },
      { key: 'clearances', label: 'Clearances' },
      { key: 'free_kicks', label: 'Free kicks' },
    ],
  }),
  highlightDefaults: () => ['goal', 'manual_moment'],
  knockout: { label: 'Extra time when level', isOn: (c) => c.extraTime.enabled, set: (c, on) => ({ ...c, extraTime: { ...c.extraTime, enabled: on } }) },
};
