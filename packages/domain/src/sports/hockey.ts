// Field hockey: four count-down quarters, one-point goals (field, penalty corner, penalty stroke), green,
// yellow and red cards, rolling substitutions and an optional shoot-out when level.
import { z } from 'zod';
import { clockDisplayMs, clockExpired, createClock, formatClock } from '../clock';
import type { FactInput, LogEntry, SportAdapter } from '../adapter';
import { err, ok, type DisplayModel, type EventTypeDef, type PhaseDef, type Result, type Side } from '../types';
import { adjustStat, basePre, bump, cloneProjection, playerInLineup, sideSchema } from './common';
import { onField, substitutionProblem } from '../lineup';
import { clocksForPeriodPhase, ordinal, periodClockText, periodOf, periodPhases, periodTransitions, type PeriodSpec } from './periods';

export const hockeyConfigSchema = z.object({
  periodMinutes: z.number().int().min(5).max(20),
  quarterBreakMinutes: z.number().int().min(1).max(10),
  halfTimeMinutes: z.number().int().min(2).max(20),
  shootout: z.object({ enabled: z.boolean() }),
  label: z.string().max(80),
});
export type HockeyConfig = z.infer<typeof hockeyConfigSchema>;

const STANDARD: HockeyConfig = { periodMinutes: 15, quarterBreakMinutes: 2, halfTimeMinutes: 10, shootout: { enabled: false }, label: 'Standard 4×15' };

const spec = (c: HockeyConfig): PeriodSpec => ({
  count: 4,
  period: (n) => ({ label: `${ordinal(n)} Quarter`, short: `Q${n}` }),
  interval: (n, half) => (half ? { label: 'Half Time', short: 'HT' } : n === 1 ? { label: 'Quarter Time', short: 'QT' } : { label: 'Three-Quarter Time', short: '3QT' }),
  extra: null,
  shootout: c.shootout.enabled ? { label: 'Shoot-out', short: 'SO' } : null,
  final: { label: 'Full Time', short: 'FT' },
});
const phasesFor = (c: HockeyConfig): PhaseDef[] => periodPhases(spec(c));

const EVENTS: EventTypeDef[] = [
  { type: 'goal', label: 'Goal', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'green_card', label: 'Green card', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: false },
  { type: 'yellow_card', label: 'Yellow card', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: false },
  { type: 'red_card', label: 'Red card', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: true },
  { type: 'substitution', label: 'Substitution', group: 'change', requiresSide: true, playerField: 'none', graphic: 'substitution', highlightDefault: false, phases: ['play', 'break'] },
  { type: 'shot', label: 'Shot', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'penalty_corner', label: 'Penalty corner', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false },
  { type: 'penalty_stroke_missed', label: 'Penalty stroke missed', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: true },
  { type: 'circle_entry', label: 'Circle entry', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false },
  { type: 'stat_adjust', label: 'Adjust team stat', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false, phases: ['play', 'break', 'final'] },
  { type: 'possession_change', label: 'Possession', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false },
  { type: 'shootout_stroke', label: 'Shoot-out attempt', group: 'shootout', requiresSide: true, playerField: 'optional', highlightDefault: true },
];

export const HOCKEY_STATS = ['goals', 'shots', 'penalty_corners', 'circle_entries', 'green_cards', 'yellow_cards', 'red_cards', 'possession_pct'] as const;

const payloadSchemas: Record<string, z.ZodType> = {
  goal: z.object({ goalType: z.enum(['field', 'penalty_corner', 'penalty_stroke']).optional(), assistId: z.string().uuid().nullable().optional() }),
  yellow_card: z.object({ minutes: z.union([z.literal(5), z.literal(10)]).optional() }),
  substitution: z.object({ playerOutId: z.string().uuid().nullable().optional(), playerInId: z.string().uuid().nullable().optional() }),
  stat_adjust: z.object({ stat: z.enum(HOCKEY_STATS), delta: z.number().int().min(-50).max(50) }),
  shootout_stroke: z.object({ scored: z.boolean() }),
};

const lengthMs = (c: HockeyConfig) => (phase: string) => (periodOf(phase)?.kind === 'reg' ? c.periodMinutes * 60_000 : null);

export const hockeyAdapter: SportAdapter<HockeyConfig> = {
  sport: 'hockey',
  label: 'Hockey',
  rulesVersion: 'hockey-1',
  configSchema: hockeyConfigSchema,
  defaultConfig: STANDARD,
  presets: [
    { id: 'standard', label: STANDARD.label, config: STANDARD },
    { id: 'finals', label: 'Finals 4×15 with shoot-out', config: { ...STANDARD, shootout: { enabled: true }, label: 'Finals 4×15 with shoot-out' } },
    { id: 'junior', label: 'Junior 4×10', config: { ...STANDARD, periodMinutes: 10, halfTimeMinutes: 5, label: 'Junior 4×10' } },
  ],
  describeRules: (c) => [
    `4×${c.periodMinutes}-minute quarters (count-down clock), ${c.quarterBreakMinutes}-minute quarter breaks, ${c.halfTimeMinutes}-minute half time`,
    'Green card: 2-minute suspension; yellow: 5 or 10 minutes; red: sent off',
    c.shootout.enabled ? 'Shoot-out when level (kept separately from the match score)' : 'Draws stand',
    'Rolling substitutions',
  ],
  phases: phasesFor,
  phase: (c, id) => phasesFor(c).find((p) => p.id === id),
  allowedTransitions: (c, p) => periodTransitions(spec(c), p, { extraTime: false, shootout: c.shootout.enabled }),
  eventTypes: () => EVENTS,
  initialProjection: () => basePre('hockey', 'hockey-1', { home: {}, away: {} }),
  initialClocks: (c) => ({ main: createClock('main', 'down', c.periodMinutes * 60_000, 'scheduled', c.periodMinutes * 60_000) }),

  validateFact(c, p, f, lineup) {
    const def = EVENTS.find((e) => e.type === f.type);
    if (!def) return err('UNKNOWN_EVENT', `Unsupported hockey event "${f.type}"`, 'type');
    const phase = phasesFor(c).find((x) => x.id === p.phase)!;
    if (!(def.phases ?? ['play']).includes(phase.kind)) return err('PHASE_NOT_ALLOWED', `${def.label} cannot be recorded during ${phase.label}`, 'type');
    if (f.type === 'shootout_stroke' && p.phase !== 'shootout') return err('PHASE_NOT_ALLOWED', 'Shoot-out attempts are only valid during the shoot-out', 'type');
    if (p.phase === 'shootout' && def.group === 'score') return err('PHASE_NOT_ALLOWED', 'Use shoot-out attempts during the shoot-out; they never change the match score', 'type');
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
    if (f.type === 'goal') {
      const pl = f.payload as { assistId?: string | null };
      if (pl.assistId && pl.assistId === f.playerId) return err('INVALID_ASSIST', 'The scorer cannot also be the assist', 'payload.assistId');
      const e3 = check(pl.assistId, 'payload.assistId');
      if (e3) return e3;
    }
    if (f.type === 'substitution' && f.side) {
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
    switch (e.type) {
      case 'goal': {
        p.score[side] += 1;
        const ps = (p.periodScores[e.periodId] ??= { home: 0, away: 0 });
        ps[side] += 1;
        bump(p.stats[side], 'goals');
        bump(p.stats[side], 'shots');
        const pl = e.payload as { goalType?: string; assistId?: string | null };
        if (pl.goalType === 'penalty_corner') bump(p.stats[side], 'penalty_corner_goals');
        if (e.playerId) tally(e.playerId)!.goals = (tally(e.playerId)!.goals ?? 0) + 1;
        if (pl.assistId) tally(pl.assistId)!.assists = (tally(pl.assistId)!.assists ?? 0) + 1;
        bump(p.counters, 'goals');
        break;
      }
      case 'green_card':
        bump(p.stats[side], 'green_cards');
        bump(p.counters, 'cards');
        break;
      case 'yellow_card':
        bump(p.stats[side], 'yellow_cards');
        if (e.playerId) tally(e.playerId)!.yellow = (tally(e.playerId)!.yellow ?? 0) + 1;
        bump(p.counters, 'cards');
        break;
      case 'red_card':
        bump(p.stats[side], 'red_cards');
        if (e.playerId) Object.assign(tally(e.playerId)!, { red: true, onCourt: false });
        bump(p.counters, 'cards');
        break;
      case 'substitution': {
        const pl = e.payload as { playerOutId?: string; playerInId?: string };
        if (pl.playerOutId) tally(pl.playerOutId)!.onCourt = false;
        if (pl.playerInId) tally(pl.playerInId)!.onCourt = true;
        bump(p.counters, 'substitutions');
        break;
      }
      case 'shot':
        bump(p.stats[side], 'shots');
        break;
      case 'penalty_corner':
        bump(p.stats[side], 'penalty_corners');
        break;
      case 'penalty_stroke_missed':
        bump(p.stats[side], 'shots');
        break;
      case 'circle_entry':
        bump(p.stats[side], 'circle_entries');
        break;
      case 'stat_adjust': {
        const pl = e.payload as { stat: string; delta: number };
        adjustStat(p.stats[side], pl.stat, pl.delta);
        break;
      }
      case 'shootout_stroke': {
        const pl = e.payload as { scored: boolean };
        p.shootout ??= { home: 0, away: 0, kicks: [] };
        p.shootout.kicks.push({ side, scored: pl.scored, playerId: e.playerId ?? null });
        if (pl.scored) p.shootout[side] += 1;
        break;
      }
    }
    p.lastFactSequence = e.sequence;
    return p;
  },

  applyPhase(_c, prev, to) {
    const p = cloneProjection(prev);
    p.phase = to;
    if (to === 'shootout') p.shootout ??= { home: 0, away: 0, kicks: [] };
    return p;
  },
  clocksForPhase: (c, _from, to, clocks, at) => clocksForPeriodPhase({ direction: 'down', lengthMs: lengthMs(c) }, to, clocks, at),
  clocksForFact: (_c, _f, clocks) => clocks,

  display(c, p, clocks, now): DisplayModel {
    const ph = phasesFor(c).find((x) => x.id === p.phase)!;
    const main = clocks.main!;
    const ms = clockDisplayMs(main, now);
    const alerts: string[] = [];
    if (ph.kind === 'play' && p.phase !== 'shootout' && clockExpired(main, now)) alerts.push('Quarter clock at 0:00 — end the quarter when the umpires confirm');
    return {
      periodLabel: ph.label,
      periodShort: ph.short,
      clockText: p.phase === 'shootout' ? 'SO' : periodClockText(ph, formatClock(ms)),
      clockRunning: main.running,
      score: { ...p.score },
      shootout: p.shootout ? { home: p.shootout.home, away: p.shootout.away } : null,
      alerts,
    };
  },

  capabilities: () => ({
    graphics: ['scorebug', 'ident', 'lineup', 'goal', 'card', 'substitution', 'period_banner', 'lower_third', 'player_card', 'stats', 'break_score', 'sponsor', 'full_frame', 'ticker', 'slate', 'league_table', 'fixtures', 'formation', 'match_summary', 'head_to_head', 'match_info', 'stat_compare', 'top_scorers', 'player_of_match', 'stinger', 'shootout'],
    scorebugFields: ['score', 'clock', 'period', 'shootout'],
    statRows: [
      { key: 'shots', label: 'Shots' },
      { key: 'penalty_corners', label: 'Penalty corners' },
      { key: 'circle_entries', label: 'Circle entries' },
      { key: 'green_cards', label: 'Green cards' },
      { key: 'yellow_cards', label: 'Yellow cards' },
      { key: 'red_cards', label: 'Red cards' },
      { key: 'possession_pct', label: 'Possession', unit: '%' },
      { key: 'goals', label: 'Goals' },
    ],
  }),
  highlightDefaults: () => ['goal', 'penalty_stroke_missed', 'red_card', 'manual_moment'],
  knockout: { label: 'Shoot-out when level', isOn: (c) => c.shootout.enabled, set: (c, on) => ({ ...c, shootout: { ...c.shootout, enabled: on } }) },
};
