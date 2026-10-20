// Netball: four count-down quarters, one-point goals (two for a super shot when the competition uses it),
// rolling substitutions, and the broadcast statistics (attempts, intercepts, rebounds, turnovers, penalties).
import { z } from 'zod';
import { clockDisplayMs, clockExpired, createClock, formatClock } from '../clock';
import type { FactInput, LogEntry, SportAdapter } from '../adapter';
import { err, ok, type DisplayModel, type EventTypeDef, type PhaseDef, type Result, type Side } from '../types';
import { adjustStat, basePre, bump, cloneProjection, playerInLineup, sideSchema } from './common';
import { onField, substitutionProblem } from '../lineup';
import { clocksForPeriodPhase, ordinal, periodClockText, periodOf, periodPhases, periodTransitions, type PeriodSpec } from './periods';

export const netballConfigSchema = z.object({
  periodMinutes: z.number().int().min(5).max(20),
  quarterBreakMinutes: z.number().int().min(1).max(10),
  halfTimeMinutes: z.number().int().min(1).max(20),
  superShot: z.boolean(),
  extraTime: z.object({ enabled: z.boolean(), periodMinutes: z.number().int().min(3).max(10) }),
  label: z.string().max(80),
});
export type NetballConfig = z.infer<typeof netballConfigSchema>;

const STANDARD: NetballConfig = { periodMinutes: 15, quarterBreakMinutes: 4, halfTimeMinutes: 12, superShot: false, extraTime: { enabled: false, periodMinutes: 7 }, label: 'Standard 4×15' };

const spec = (c: NetballConfig): PeriodSpec => ({
  count: 4,
  period: (n) => ({ label: `${ordinal(n)} Quarter`, short: `Q${n}` }),
  interval: (n, half) => (half ? { label: 'Half Time', short: 'HT' } : n === 1 ? { label: 'Quarter Time', short: 'QT' } : { label: 'Three-Quarter Time', short: '3QT' }),
  extra: c.extraTime.enabled ? { count: 2, period: (k) => ({ label: `Extra Time ${k}`, short: `ET${k}` }), beforeLabel: 'Before Extra Time' } : null,
  shootout: null,
  final: { label: 'Full Time', short: 'FT' },
});
const phasesFor = (c: NetballConfig): PhaseDef[] => periodPhases(spec(c));

const EVENTS: EventTypeDef[] = [
  { type: 'goal', label: 'Goal', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: false },
  { type: 'goal_missed', label: 'Missed shot', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'intercept', label: 'Intercept', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'rebound', label: 'Rebound', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'turnover', label: 'Turnover', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'penalty', label: 'Penalty', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'centre_pass', label: 'Centre pass', group: 'control', requiresSide: true, playerField: 'none', highlightDefault: false, phases: ['play', 'break', 'pre'] },
  { type: 'substitution', label: 'Substitution', group: 'change', requiresSide: true, playerField: 'none', graphic: 'substitution', highlightDefault: false, phases: ['play', 'break'] },
  { type: 'stat_adjust', label: 'Adjust team stat', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false, phases: ['play', 'break', 'final'] },
];

export const NETBALL_STATS = ['goals', 'attempts', 'super_shots', 'intercepts', 'rebounds', 'turnovers', 'penalties'] as const;

const payloadSchemas: Record<string, z.ZodType> = {
  goal: z.object({ points: z.union([z.literal(1), z.literal(2)]).default(1) }),
  penalty: z.object({ kind: z.enum(['contact', 'obstruction', 'other']).optional() }),
  substitution: z.object({ playerOutId: z.string().uuid().nullable().optional(), playerInId: z.string().uuid().nullable().optional() }),
  stat_adjust: z.object({ stat: z.enum(NETBALL_STATS), delta: z.number().int().min(-50).max(50) }),
};

const lengthMs = (c: NetballConfig) => (phase: string) => {
  const per = periodOf(phase);
  if (!per) return null;
  return (per.kind === 'reg' ? c.periodMinutes : c.extraTime.periodMinutes) * 60_000;
};

export const netballAdapter: SportAdapter<NetballConfig> = {
  sport: 'netball',
  label: 'Netball',
  rulesVersion: 'netball-1',
  configSchema: netballConfigSchema,
  defaultConfig: STANDARD,
  presets: [
    { id: 'standard', label: STANDARD.label, config: STANDARD },
    { id: 'super-shot', label: 'League 4×15 with super shot', config: { ...STANDARD, superShot: true, extraTime: { enabled: true, periodMinutes: 7 }, label: 'League 4×15 with super shot' } },
    { id: 'junior', label: 'Junior 4×10', config: { ...STANDARD, periodMinutes: 10, quarterBreakMinutes: 3, halfTimeMinutes: 5, label: 'Junior 4×10' } },
  ],
  describeRules: (c) => [
    `4×${c.periodMinutes}-minute quarters (count-down clock), ${c.quarterBreakMinutes}-minute quarter breaks, ${c.halfTimeMinutes}-minute half time`,
    c.superShot ? 'Super shot worth two goals from the outer circle' : 'All goals worth one',
    c.extraTime.enabled ? `Extra time: 2×${c.extraTime.periodMinutes} minutes when level` : 'Draws stand',
    'Rolling substitutions at breaks and stoppages',
  ],
  phases: phasesFor,
  phase: (c, id) => phasesFor(c).find((p) => p.id === id),
  allowedTransitions: (c, p) => periodTransitions(spec(c), p, { extraTime: c.extraTime.enabled, shootout: false }),
  eventTypes: () => EVENTS,
  initialProjection: () => basePre('netball', 'netball-1', { home: {}, away: {} }),
  initialClocks: (c) => ({ main: createClock('main', 'down', c.periodMinutes * 60_000, 'scheduled', c.periodMinutes * 60_000) }),

  validateFact(c, p, f, lineup) {
    const def = EVENTS.find((e) => e.type === f.type);
    if (!def) return err('UNKNOWN_EVENT', `Unsupported netball event "${f.type}"`, 'type');
    const phase = phasesFor(c).find((x) => x.id === p.phase)!;
    if (!(def.phases ?? ['play']).includes(phase.kind)) return err('PHASE_NOT_ALLOWED', `${def.label} cannot be recorded during ${phase.label}`, 'type');
    if (def.requiresSide && !sideSchema.safeParse(f.side).success) return err('SIDE_REQUIRED', 'Choose a team', 'side');
    const schema = payloadSchemas[f.type];
    if (schema) {
      const r = schema.safeParse(f.payload ?? {});
      if (!r.success) return err('INVALID_PAYLOAD', r.error.issues[0]?.message ?? 'Invalid event details', 'payload');
      f = { ...f, payload: r.data as Record<string, unknown> };
    }
    if (f.type === 'goal' && (f.payload as { points: number }).points === 2 && !c.superShot) return err('INVALID_PAYLOAD', 'This competition does not use the super shot', 'payload.points');
    const check = (id: unknown, field: string): Result<FactInput> | null =>
      id && lineup && f.side && !playerInLineup(lineup, f.side, String(id)) ? err('PLAYER_NOT_IN_LINEUP', 'Player is not in this team’s match lineup', field) : null;
    const e = check(f.playerId, 'playerId');
    if (e) return e;
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
        const pts = (e.payload as { points?: number }).points ?? 1;
        p.score[side] += pts;
        const ps = (p.periodScores[e.periodId] ??= { home: 0, away: 0 });
        ps[side] += pts;
        bump(p.stats[side], 'goals', pts);
        bump(p.stats[side], 'attempts');
        if (pts === 2) bump(p.stats[side], 'super_shots');
        if (e.playerId) {
          const t = tally(e.playerId)!;
          t.goals = (t.goals ?? 0) + pts;
          t.points = (t.points ?? 0) + pts;
        }
        bump(p.counters, 'goals', pts);
        break;
      }
      case 'goal_missed':
        bump(p.stats[side], 'attempts');
        break;
      case 'intercept':
        bump(p.stats[side], 'intercepts');
        break;
      case 'rebound':
        bump(p.stats[side], 'rebounds');
        break;
      case 'turnover':
        bump(p.stats[side], 'turnovers');
        break;
      case 'penalty':
        bump(p.stats[side], 'penalties');
        break;
      case 'centre_pass':
        p.possession = side;
        break;
      case 'substitution': {
        const pl = e.payload as { playerOutId?: string; playerInId?: string };
        if (pl.playerOutId) tally(pl.playerOutId)!.onCourt = false;
        if (pl.playerInId) tally(pl.playerInId)!.onCourt = true;
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
  clocksForPhase: (c, _from, to, clocks, at) => clocksForPeriodPhase({ direction: 'down', lengthMs: lengthMs(c) }, to, clocks, at),
  clocksForFact: (_c, _f, clocks) => clocks,

  display(c, p, clocks, now): DisplayModel {
    const ph = phasesFor(c).find((x) => x.id === p.phase)!;
    const main = clocks.main!;
    const ms = clockDisplayMs(main, now);
    const alerts: string[] = [];
    if (ph.kind === 'play' && clockExpired(main, now)) alerts.push('Quarter clock at 0:00 — end the quarter when the umpires confirm');
    return {
      periodLabel: ph.label,
      periodShort: ph.short,
      clockText: periodClockText(ph, formatClock(ms)),
      clockRunning: main.running,
      score: { ...p.score },
      possession: p.possession ?? null,
      alerts,
    };
  },

  capabilities: (c) => ({
    graphics: ['scorebug', 'ident', 'lineup', 'goal', 'substitution', 'period_banner', 'lower_third', 'player_card', 'stats', 'break_score', 'sponsor', 'full_frame', 'ticker', 'slate'],
    scorebugFields: ['score', 'clock', 'period', 'possession'],
    statRows: [
      { key: 'goals', label: 'Goals' },
      { key: 'attempts', label: 'Goal attempts' },
      ...(c.superShot ? [{ key: 'super_shots', label: 'Super shots' }] : []),
      { key: 'intercepts', label: 'Intercepts' },
      { key: 'rebounds', label: 'Rebounds' },
      { key: 'turnovers', label: 'Turnovers' },
      { key: 'penalties', label: 'Penalties' },
    ],
  }),
  highlightDefaults: () => ['manual_moment'],
};
