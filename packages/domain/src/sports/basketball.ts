import { z } from 'zod';
import { applyClockAction, clockDisplayMs, clockExpired, createClock, formatClock, type ClockState } from '../clock';
import type { FactInput, LogEntry, SportAdapter } from '../adapter';
import { err, ok, type DisplayModel, type EventTypeDef, type MatchProjection, type PhaseDef, type Result, type Side } from '../types';
import { adjustStat, basePre, bump, cloneProjection, playerInLineup, sideSchema } from './common';
import { onField, substitutionProblem } from '../lineup';

export const basketballConfigSchema = z.object({
  format: z.enum(['quarters', 'halves']),
  periodMinutes: z.number().int().min(1).max(30),
  overtimeMinutes: z.number().int().min(1).max(10),
  maxOvertimes: z.number().int().min(0).max(9),
  shotClock: z.object({
    enabled: z.boolean(),
    fullSeconds: z.number().int().min(10).max(60),
    resetSeconds: z.number().int().min(5).max(60),
  }),
  timeouts: z.object({
    firstHalf: z.number().int().min(0).max(10),
    secondHalf: z.number().int().min(0).max(10),
    overtime: z.number().int().min(0).max(5),
  }),
  teamFoulLimit: z.number().int().min(1).max(20),
  playerFoulLimit: z.number().int().min(1).max(10),
  label: z.string().max(80),
});
export type BasketballConfig = z.infer<typeof basketballConfigSchema>;

const COMMUNITY: BasketballConfig = {
  format: 'quarters',
  periodMinutes: 10,
  overtimeMinutes: 5,
  maxOvertimes: 9,
  shotClock: { enabled: true, fullSeconds: 24, resetSeconds: 14 },
  timeouts: { firstHalf: 2, secondHalf: 3, overtime: 1 },
  teamFoulLimit: 4,
  playerFoulLimit: 5,
  label: 'Community 4×10 (FIBA-style preset, not certified)',
};

const regPeriods = (c: BasketballConfig) => (c.format === 'quarters' ? 4 : 2);
const secondHalfStart = (c: BasketballConfig) => (c.format === 'quarters' ? 3 : 2);
const periodLabel = (c: BasketballConfig, n: number) =>
  c.format === 'quarters' ? [`1st Quarter`, `2nd Quarter`, `3rd Quarter`, `4th Quarter`][n - 1]! : n === 1 ? '1st Half' : '2nd Half';

function buildPhases(c: BasketballConfig): PhaseDef[] {
  const out: PhaseDef[] = [
    { id: 'scheduled', label: 'Scheduled', short: 'SCH', kind: 'pre', tags: [] },
    { id: 'ready', label: 'Ready', short: 'RDY', kind: 'pre', tags: [] },
    { id: 'pre_match', label: 'Pre-game', short: 'PRE', kind: 'pre', tags: ['pre_match'] },
    { id: 'players_entering', label: 'Players entering', short: 'ENT', kind: 'pre', tags: ['players_entering'] },
    { id: 'about_to_start', label: 'About to start', short: 'TIP', kind: 'pre', tags: ['about_to_start'] },
  ];
  const n = regPeriods(c);
  for (let i = 1; i <= n; i++) {
    out.push({
      id: `p${i}`,
      label: periodLabel(c, i),
      short: c.format === 'quarters' ? `Q${i}` : `H${i}`,
      kind: 'play',
      tags: i === 1 ? ['period_start', 'first_period'] : ['period_start'],
    });
    if (i < n) {
      const half = c.format === 'quarters' ? i === 2 : i === 1;
      out.push({
        id: half ? 'half_time' : `break_${i}`,
        label: half ? 'Half Time' : `End of ${c.format === 'quarters' ? `Q${i}` : `H${i}`}`,
        short: half ? 'HT' : `END Q${i}`,
        kind: 'break',
        tags: half ? ['half_time', 'interval', 'period_break'] : ['interval', 'period_break'],
      });
    }
  }
  for (let k = 1; k <= c.maxOvertimes; k++) {
    out.push({ id: `break_ot${k}`, label: `Before Overtime ${k}`, short: `OT${k}`, kind: 'break', tags: ['interval', 'period_break'] });
    out.push({ id: `ot${k}`, label: k === 1 ? 'Overtime' : `Overtime ${k}`, short: `OT${k}`, kind: 'play', tags: ['period_start', 'overtime'] });
  }
  out.push(
    { id: 'full_time', label: 'Final', short: 'FINAL', kind: 'final', tags: ['full_time'] },
    { id: 'postponed', label: 'Postponed', short: 'PPD', kind: 'terminal', tags: [] },
    { id: 'abandoned', label: 'Abandoned', short: 'ABD', kind: 'terminal', tags: [] },
    { id: 'cancelled', label: 'Cancelled', short: 'CAN', kind: 'terminal', tags: [] },
  );
  return out;
}

const EVENTS: EventTypeDef[] = [
  { type: 'score', label: 'Score', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'score', highlightDefault: false },
  { type: 'foul', label: 'Foul', group: 'discipline', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'timeout', label: 'Timeout', group: 'control', requiresSide: true, playerField: 'none', graphic: 'timeout', highlightDefault: false, phases: ['play'] },
  { type: 'substitution', label: 'Substitution', group: 'change', requiresSide: true, playerField: 'none', graphic: 'substitution', highlightDefault: false, phases: ['play', 'break'] },
  { type: 'possession', label: 'Possession', group: 'control', requiresSide: true, playerField: 'none', highlightDefault: false, phases: ['play', 'break', 'pre'] },
  { type: 'rebound', label: 'Rebound', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'assist', label: 'Assist', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'stat_adjust', label: 'Adjust team stat', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false, phases: ['play', 'break', 'final'] },
];

export const BASKETBALL_STATS = ['points', 'fouls', 'rebounds', 'assists', 'timeouts_used', 'two_pt_made', 'three_pt_made', 'free_throws_made'] as const;

const payloadSchemas: Record<string, z.ZodType> = {
  score: z.object({ points: z.union([z.literal(1), z.literal(2), z.literal(3)]), resetShotClock: z.boolean() }),
  foul: z.object({ foulType: z.enum(['personal', 'technical', 'unsportsmanlike', 'offensive', 'disqualifying']) }),
  substitution: z.object({ playerOutId: z.string().uuid().nullable().optional(), playerInId: z.string().uuid().nullable().optional() }),
  stat_adjust: z.object({ stat: z.enum(BASKETBALL_STATS), delta: z.number().int().min(-50).max(50) }),
};

function periodNumber(c: BasketballConfig, phase: string): { kind: 'reg' | 'ot'; n: number } | null {
  let m = /^p(\d)$/.exec(phase);
  if (m) return { kind: 'reg', n: Number(m[1]) };
  m = /^ot(\d)$/.exec(phase);
  if (m && Number(m[1]) <= c.maxOvertimes) return { kind: 'ot', n: Number(m[1]) };
  return null;
}

function transitions(c: BasketballConfig, p: MatchProjection): string[] {
  const n = regPeriods(c);
  const tied = p.score.home === p.score.away;
  const pre: Record<string, string[]> = {
    scheduled: ['ready', 'pre_match', 'p1', 'postponed', 'cancelled'],
    ready: ['pre_match', 'players_entering', 'about_to_start', 'p1', 'postponed', 'cancelled'],
    pre_match: ['players_entering', 'about_to_start', 'p1', 'postponed', 'abandoned', 'cancelled'],
    players_entering: ['about_to_start', 'p1', 'abandoned'],
    about_to_start: ['p1', 'abandoned'],
    postponed: ['scheduled', 'cancelled'],
  };
  if (pre[p.phase]) return pre[p.phase]!;
  const per = periodNumber(c, p.phase);
  if (per?.kind === 'reg') {
    if (per.n < n) {
      const half = c.format === 'quarters' ? per.n === 2 : per.n === 1;
      return [half ? 'half_time' : `break_${per.n}`, 'abandoned'];
    }
    return tied && c.maxOvertimes > 0 ? ['break_ot1', 'abandoned'] : ['full_time', 'abandoned'];
  }
  if (per?.kind === 'ot') {
    return tied && per.n < c.maxOvertimes ? [`break_ot${per.n + 1}`, 'abandoned'] : ['full_time', 'abandoned'];
  }
  if (p.phase === 'half_time') return [`p${secondHalfStart(c)}`, 'abandoned'];
  let m = /^break_(\d)$/.exec(p.phase);
  if (m) return [`p${Number(m[1]) + 1}`, 'abandoned'];
  m = /^break_ot(\d)$/.exec(p.phase);
  if (m) return [`ot${m[1]}`, 'abandoned'];
  return [];
}

function fmtMain(ms: number): string {
  if (ms < 60_000) return formatClock(ms, { tenths: true });
  return formatClock(Math.ceil(ms / 1000) * 1000);
}

export const basketballAdapter: SportAdapter<BasketballConfig> = {
  sport: 'basketball',
  label: 'Basketball',
  rulesVersion: 'basketball-1',
  configSchema: basketballConfigSchema,
  defaultConfig: COMMUNITY,
  presets: [
    { id: 'community-4x10', label: COMMUNITY.label, config: COMMUNITY },
    { id: 'halves-2x20', label: 'College-style 2×20', config: { ...COMMUNITY, format: 'halves', periodMinutes: 20, timeouts: { firstHalf: 2, secondHalf: 3, overtime: 1 }, teamFoulLimit: 6, label: 'College-style 2×20' } },
    { id: 'junior-4x8', label: 'Junior 4×8, no shot clock', config: { ...COMMUNITY, periodMinutes: 8, overtimeMinutes: 3, shotClock: { enabled: false, fullSeconds: 30, resetSeconds: 14 }, label: 'Junior 4×8, no shot clock' } },
  ],
  describeRules: (c) => [
    `${regPeriods(c)}×${c.periodMinutes}-minute ${c.format}, ${c.overtimeMinutes}-minute overtime (max ${c.maxOvertimes})`,
    c.shotClock.enabled ? `Shot clock ${c.shotClock.fullSeconds}s (reset ${c.shotClock.resetSeconds}s)` : 'No shot clock',
    `Timeouts: ${c.timeouts.firstHalf} first half, ${c.timeouts.secondHalf} second half, ${c.timeouts.overtime} per overtime`,
    `Team bonus after ${c.teamFoulLimit} fouls per period; player limit ${c.playerFoulLimit} fouls`,
    'Countdown period clock; reaching zero alerts but never ends the period automatically',
  ],
  phases: buildPhases,
  phase: (c, id) => buildPhases(c).find((p) => p.id === id),
  allowedTransitions: transitions,
  eventTypes: () => EVENTS,
  initialProjection: (c) => ({
    ...basePre('basketball', 'basketball-1', { home: {}, away: {} }),
    teamFouls: { home: 0, away: 0 },
    timeouts: { home: c.timeouts.firstHalf, away: c.timeouts.firstHalf },
  }),
  initialClocks: (c) => ({
    main: createClock('main', 'down', c.periodMinutes * 60_000, 'scheduled', c.periodMinutes * 60_000),
    ...(c.shotClock.enabled ? { shot: createClock('shot', 'down', c.shotClock.fullSeconds * 1000, 'scheduled', c.shotClock.fullSeconds * 1000) } : {}),
  }),

  validateFact(c, p, f, lineup) {
    const def = EVENTS.find((e) => e.type === f.type);
    if (!def) return err('UNKNOWN_EVENT', `Unsupported basketball event "${f.type}"`, 'type');
    const phase = buildPhases(c).find((x) => x.id === p.phase)!;
    if (!(def.phases ?? ['play']).includes(phase.kind)) return err('PHASE_NOT_ALLOWED', `${def.label} cannot be recorded during ${phase.label}`, 'type');
    if (def.requiresSide && !sideSchema.safeParse(f.side).success) return err('SIDE_REQUIRED', 'Choose a team', 'side');
    const schema = payloadSchemas[f.type];
    if (schema) {
      const r = schema.safeParse(f.payload ?? {});
      if (!r.success) return err('INVALID_PAYLOAD', r.error.issues[0]?.message ?? 'Invalid event details', 'payload');
    }
    if (f.type === 'timeout' && (p.timeouts?.[f.side as Side] ?? 0) <= 0) return err('NO_TIMEOUTS_LEFT', 'No timeouts remaining for this team in this period', 'side');
    const inLineup = (id: unknown, field: string): Result<FactInput> | null =>
      id && lineup && f.side && !playerInLineup(lineup, f.side, String(id)) ? err('PLAYER_NOT_IN_LINEUP', 'Player is not in this team’s match lineup', field) : null;
    const e = inLineup(f.playerId, 'playerId');
    if (e) return e;
    if (f.type === 'substitution') {
      const pl = f.payload as { playerOutId?: string; playerInId?: string };
      const e2 = inLineup(pl.playerOutId, 'payload.playerOutId') ?? inLineup(pl.playerInId, 'payload.playerInId');
      if (e2) return e2;
      if (lineup && f.side) {
        const problem = substitutionProblem(onField(lineup, p, f.side), pl.playerOutId, pl.playerInId, true);
        if (problem) return err('INVALID_SUBSTITUTION', problem, 'payload');
      }
    }
    return ok(f);
  },

  applyFact(c, prev, e: LogEntry) {
    const p = cloneProjection(prev);
    const side = e.side as Side;
    const tally = (id: string | null | undefined) => (id ? (p.players[id] ??= {}) : null);
    switch (e.type) {
      case 'score': {
        const pts = (e.payload as { points: number }).points;
        p.score[side] += pts;
        const ps = (p.periodScores[e.periodId] ??= { home: 0, away: 0 });
        ps[side] += pts;
        bump(p.stats[side], 'points', pts);
        bump(p.stats[side], pts === 3 ? 'three_pt_made' : pts === 2 ? 'two_pt_made' : 'free_throws_made');
        if (e.playerId) tally(e.playerId)!.points = (tally(e.playerId)!.points ?? 0) + pts;
        bump(p.counters, 'points', pts);
        bump(p.counters, `points_${side}`, pts);
        break;
      }
      case 'foul': {
        p.teamFouls![side] += 1;
        bump(p.stats[side], 'fouls');
        if (e.playerId) tally(e.playerId)!.fouls = (tally(e.playerId)!.fouls ?? 0) + 1;
        break;
      }
      case 'timeout':
        p.timeouts![side] = Math.max(0, p.timeouts![side] - 1);
        bump(p.stats[side], 'timeouts_used');
        bump(p.counters, 'timeouts');
        break;
      case 'substitution': {
        const pl = e.payload as { playerOutId?: string; playerInId?: string };
        if (pl.playerOutId) tally(pl.playerOutId)!.onCourt = false;
        if (pl.playerInId) tally(pl.playerInId)!.onCourt = true;
        break;
      }
      case 'possession':
        p.possession = side;
        break;
      case 'rebound':
        bump(p.stats[side], 'rebounds');
        break;
      case 'assist':
        bump(p.stats[side], 'assists');
        break;
      case 'stat_adjust': {
        const pl = e.payload as { stat: string; delta: number };
        adjustStat(p.stats[side], pl.stat, pl.delta);
        break;
      }
    }
    p.lastFactSequence = e.sequence;
    void c;
    return p;
  },

  applyPhase(c, prev, to) {
    const p = cloneProjection(prev);
    const per = periodNumber(c, to);
    p.phase = to;
    if (per) {
      // Team fouls reset each regulation period; overtime carries the last regulation period's count.
      if (per.kind === 'reg' && (c.format === 'quarters' || per.n > 1)) p.teamFouls = { home: 0, away: 0 };
      if (per.kind === 'reg' && per.n === secondHalfStart(c)) p.timeouts = { home: c.timeouts.secondHalf, away: c.timeouts.secondHalf };
      if (per.kind === 'ot') p.timeouts = { home: c.timeouts.overtime, away: c.timeouts.overtime };
    }
    return p;
  },

  clocksForPhase(c, _from, to, clocks, at) {
    const per = periodNumber(c, to);
    const out: Record<string, ClockState> = {};
    for (const [id, clk] of Object.entries(clocks)) {
      const paused = clk.running ? applyClockAction(clk, { type: 'pause', at }) : clk;
      if (per) {
        const len = id === 'main' ? (per.kind === 'reg' ? c.periodMinutes : c.overtimeMinutes) * 60_000 : c.shotClock.fullSeconds * 1000;
        out[id] = applyClockAction(paused, { type: 'reset', at, ms: len, periodId: to, limitMs: len });
      } else {
        out[id] = { ...paused, periodId: to };
      }
    }
    return out;
  },

  clocksForFact(c, f, clocks, at) {
    if (f.type !== 'score' || !clocks.shot || !(f.payload as { resetShotClock?: boolean }).resetShotClock) return clocks;
    const full = c.shotClock.fullSeconds * 1000;
    let shot = applyClockAction(clocks.shot, { type: 'reset', at, ms: full });
    if (clocks.main?.running) shot = applyClockAction(shot, { type: 'start', at });
    return { ...clocks, shot };
  },

  display(c, p, clocks, now): DisplayModel {
    const ph = buildPhases(c).find((x) => x.id === p.phase)!;
    const main = clocks.main!;
    const ms = clockDisplayMs(main, now);
    const alerts: string[] = [];
    if (ph.kind === 'play' && clockExpired(main, now)) alerts.push('Period clock at 0:00 — end the period when officials confirm');
    let shotClockText: string | null = null;
    if (clocks.shot && ph.kind === 'play') {
      const s = clockDisplayMs(clocks.shot, now);
      shotClockText = String(Math.ceil(s / 1000));
      if (clocks.shot.running && clockExpired(clocks.shot, now)) alerts.push('Shot clock expired');
    }
    const bonus = p.teamFouls ? { home: p.teamFouls.home >= c.teamFoulLimit, away: p.teamFouls.away >= c.teamFoulLimit } : null;
    return {
      periodLabel: ph.label,
      periodShort: ph.short,
      clockText: ph.kind === 'play' ? fmtMain(ms) : ph.kind === 'final' ? 'FINAL' : ph.short,
      clockRunning: main.running,
      shotClockText,
      score: { ...p.score },
      fouls: p.teamFouls ? { ...p.teamFouls } : null,
      timeouts: p.timeouts ? { ...p.timeouts } : null,
      possession: p.possession ?? null,
      bonus,
      alerts,
    };
  },

  capabilities: (c) => ({
    graphics: ['scorebug', 'ident', 'lineup', 'score', 'substitution', 'lower_third', 'player_card', 'stats', 'break_score', 'sponsor', 'full_frame', 'ticker', 'slate', 'timeout'],
    scorebugFields: ['score', 'clock', 'period', 'fouls', 'timeouts', 'possession', ...(c.shotClock.enabled ? ['shot_clock'] : [])],
    statRows: [
      { key: 'points', label: 'Points' },
      { key: 'two_pt_made', label: '2PT made' },
      { key: 'three_pt_made', label: '3PT made' },
      { key: 'free_throws_made', label: 'Free throws made' },
      { key: 'rebounds', label: 'Rebounds' },
      { key: 'assists', label: 'Assists' },
      { key: 'fouls', label: 'Fouls' },
      { key: 'timeouts_used', label: 'Timeouts used' },
    ],
  }),
  highlightDefaults: () => ['manual_moment'],
};
