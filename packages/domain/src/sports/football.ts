import { z } from 'zod';
import { applyClockAction, clockDisplayMs, createClock, formatClock, type ClockState } from '../clock';
import type { FactInput, LogEntry, SportAdapter } from '../adapter';
import {
  err,
  ok,
  otherSide,
  type DisplayModel,
  type EventTypeDef,
  type LineupSnapshot,
  type MatchProjection,
  type PhaseDef,
  type Result,
  type Side,
} from '../types';
import { adjustStat, basePre, bump, cloneProjection, playerInLineup, sideSchema } from './common';
import { onField, substitutionProblem } from '../lineup';

export const footballConfigSchema = z.object({
  periodMinutes: z.number().int().min(5).max(60),
  halfTimeMinutes: z.number().int().min(0).max(30),
  extraTime: z.object({ enabled: z.boolean(), periodMinutes: z.number().int().min(3).max(20) }),
  shootout: z.object({ enabled: z.boolean() }),
  label: z.string().max(80),
});
export type FootballConfig = z.infer<typeof footballConfigSchema>;

const STANDARD: FootballConfig = {
  periodMinutes: 45,
  halfTimeMinutes: 15,
  extraTime: { enabled: true, periodMinutes: 15 },
  shootout: { enabled: true },
  label: 'Standard 2×45 with extra time and penalties',
};

const PHASES: PhaseDef[] = [
  { id: 'scheduled', label: 'Scheduled', short: 'SCH', kind: 'pre', tags: [] },
  { id: 'ready', label: 'Ready', short: 'RDY', kind: 'pre', tags: [] },
  { id: 'pre_match', label: 'Pre-match', short: 'PRE', kind: 'pre', tags: ['pre_match'] },
  { id: 'players_entering', label: 'Players entering', short: 'ENT', kind: 'pre', tags: ['players_entering'] },
  { id: 'about_to_start', label: 'About to start', short: 'KO', kind: 'pre', tags: ['about_to_start'] },
  { id: 'first_half', label: '1st Half', short: '1H', kind: 'play', tags: ['period_start', 'first_period'] },
  { id: 'half_time', label: 'Half Time', short: 'HT', kind: 'break', tags: ['half_time', 'interval'] },
  // between halves the walk-out repeats: tagged like the pre-match steps so the same playlists play again
  { id: 'second_half_entering', label: 'Players entering (2nd half)', short: 'ENT', kind: 'break', tags: ['players_entering', 'second_half_entering'] },
  { id: 'second_half_ready', label: 'About to start (2nd half)', short: 'KO', kind: 'break', tags: ['about_to_start', 'second_half_ready'] },
  { id: 'second_half', label: '2nd Half', short: '2H', kind: 'play', tags: ['period_start'] },
  { id: 'extra_time_break', label: 'Before Extra Time', short: 'ET', kind: 'break', tags: ['extra_time_interval', 'interval'] },
  { id: 'et_first_half', label: 'Extra Time 1st', short: 'ET1', kind: 'play', tags: ['period_start', 'extra_time'] },
  { id: 'et_half_time', label: 'Extra Time Break', short: 'ETH', kind: 'break', tags: ['extra_time_interval', 'interval'] },
  { id: 'et_second_half', label: 'Extra Time 2nd', short: 'ET2', kind: 'play', tags: ['period_start', 'extra_time'] },
  { id: 'shootout', label: 'Penalty Shootout', short: 'PEN', kind: 'play', tags: ['shootout'] },
  { id: 'full_time', label: 'Full Time', short: 'FT', kind: 'final', tags: ['full_time'] },
  { id: 'postponed', label: 'Postponed', short: 'PPD', kind: 'terminal', tags: [] },
  { id: 'abandoned', label: 'Abandoned', short: 'ABD', kind: 'terminal', tags: [] },
  { id: 'cancelled', label: 'Cancelled', short: 'CAN', kind: 'terminal', tags: [] },
];

const EVENTS: EventTypeDef[] = [
  { type: 'goal', label: 'Goal', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'own_goal', label: 'Own goal', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'penalty_scored', label: 'Penalty scored', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'penalty_missed', label: 'Penalty missed', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: true },
  { type: 'yellow_card', label: 'Yellow card', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: false },
  { type: 'second_yellow', label: 'Second yellow', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: false },
  { type: 'red_card', label: 'Red card', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: true },
  { type: 'substitution', label: 'Substitution', group: 'change', requiresSide: true, playerField: 'none', graphic: 'substitution', highlightDefault: false },
  { type: 'corner', label: 'Corner', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false },
  { type: 'shot_on_target', label: 'Shot on target', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'shot_off_target', label: 'Shot off target', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'save', label: 'Save', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'offside', label: 'Offside', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'foul', label: 'Foul', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'stat_adjust', label: 'Adjust team stat', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false, phases: ['play', 'break', 'final'] },
  { type: 'stoppage_announced', label: 'Stoppage time', group: 'control', requiresSide: false, playerField: 'none', highlightDefault: false },
  { type: 'shootout_kick', label: 'Shootout kick', group: 'shootout', requiresSide: true, playerField: 'optional', highlightDefault: true },
];

export const FOOTBALL_STATS = ['goals', 'shots_on_target', 'shots_off_target', 'corners', 'saves', 'yellow_cards', 'red_cards', 'fouls', 'offsides', 'possession_pct'] as const;

export const GOAL_TYPES = ['open_play', 'header', 'volley', 'long_range', 'counter_attack', 'set_piece', 'free_kick', 'penalty', 'own_goal'] as const;
export const GOAL_TYPE_LABELS: Record<(typeof GOAL_TYPES)[number], string> = { open_play: 'Open play', header: 'Header', volley: 'Volley', long_range: 'Long range', counter_attack: 'Counter attack', set_piece: 'Set piece', free_kick: 'Free kick', penalty: 'Penalty', own_goal: 'Own goal' };
const goalPayload = z.object({ assistId: z.string().uuid().nullable().optional(), goalType: z.enum(GOAL_TYPES).optional() });
const payloadSchemas: Record<string, z.ZodType> = {
  goal: goalPayload,
  penalty_scored: goalPayload.extend({ goalType: z.literal('penalty').optional() }),
  own_goal: z.object({ goalType: z.literal('own_goal').optional() }),
  substitution: z.object({ playerOutId: z.string().uuid().nullable().optional(), playerInId: z.string().uuid().nullable().optional() }),
  stat_adjust: z.object({ stat: z.enum(FOOTBALL_STATS), delta: z.number().int().min(-50).max(50) }),
  stoppage_announced: z.object({ minutes: z.number().int().min(0).max(30) }),
  shootout_kick: z.object({ scored: z.boolean() }),
};

function limitsFor(cfg: FootballConfig, phase: string): { base: number; limit: number } | null {
  const p = cfg.periodMinutes * 60_000;
  const e = cfg.extraTime.periodMinutes * 60_000;
  switch (phase) {
    case 'first_half':
      return { base: 0, limit: p };
    case 'second_half':
      return { base: p, limit: 2 * p };
    case 'et_first_half':
      return { base: 2 * p, limit: 2 * p + e };
    case 'et_second_half':
      return { base: 2 * p + e, limit: 2 * p + 2 * e };
    default:
      return null;
  }
}

function transitions(cfg: FootballConfig, p: MatchProjection): string[] {
  const tied = p.score.home === p.score.away;
  switch (p.phase) {
    case 'scheduled':
      return ['ready', 'pre_match', 'first_half', 'postponed', 'cancelled'];
    case 'ready':
      return ['pre_match', 'players_entering', 'about_to_start', 'first_half', 'postponed', 'cancelled'];
    case 'pre_match':
      return ['players_entering', 'about_to_start', 'first_half', 'postponed', 'abandoned', 'cancelled'];
    case 'players_entering':
      return ['about_to_start', 'first_half', 'abandoned'];
    case 'about_to_start':
      return ['first_half', 'abandoned'];
    case 'first_half':
      return ['half_time', 'abandoned'];
    case 'half_time':
      return ['second_half_entering', 'second_half_ready', 'second_half', 'abandoned'];
    case 'second_half_entering':
      return ['second_half_ready', 'second_half', 'abandoned'];
    case 'second_half_ready':
      return ['second_half', 'abandoned'];
    case 'second_half': {
      const out = ['full_time'];
      if (tied && cfg.extraTime.enabled) out.push('extra_time_break');
      if (tied && cfg.shootout.enabled) out.push('shootout');
      return [...out, 'abandoned'];
    }
    case 'extra_time_break':
      return ['et_first_half', 'abandoned'];
    case 'et_first_half':
      return ['et_half_time', 'abandoned'];
    case 'et_half_time':
      return ['et_second_half', 'abandoned'];
    case 'et_second_half':
      return tied && cfg.shootout.enabled ? ['full_time', 'shootout', 'abandoned'] : ['full_time', 'abandoned'];
    case 'shootout':
      return ['full_time', 'abandoned'];
    case 'postponed':
      return ['scheduled', 'cancelled'];
    default:
      return [];
  }
}

export const footballAdapter: SportAdapter<FootballConfig> = {
  sport: 'football',
  label: 'Football',
  rulesVersion: 'football-1',
  configSchema: footballConfigSchema,
  defaultConfig: STANDARD,
  presets: [
    { id: 'standard', label: STANDARD.label, config: STANDARD },
    { id: 'league', label: 'League 2×45 (no extra time)', config: { ...STANDARD, extraTime: { enabled: false, periodMinutes: 15 }, shootout: { enabled: false }, label: 'League 2×45 (no extra time)' } },
    { id: 'junior-u12', label: 'Junior 2×25', config: { periodMinutes: 25, halfTimeMinutes: 10, extraTime: { enabled: false, periodMinutes: 5 }, shootout: { enabled: false }, label: 'Junior 2×25' } },
  ],
  describeRules: (cfg) => [
    `${cfg.periodMinutes}-minute halves, ${cfg.halfTimeMinutes}-minute interval`,
    cfg.extraTime.enabled ? `Extra time: 2×${cfg.extraTime.periodMinutes} minutes when level` : 'No extra time',
    cfg.shootout.enabled ? 'Penalty shootout when level (shootout score kept separately)' : 'No shootout',
    'Running clock counts up; stoppage time shown after the nominal period length',
  ],
  phases: () => PHASES,
  phase: (_cfg, id) => PHASES.find((p) => p.id === id),
  allowedTransitions: transitions,
  eventTypes: () => EVENTS,
  initialProjection: () => basePre('football', 'football-1', { home: {}, away: {} }),
  initialClocks: (cfg) => ({ main: createClock('main', 'up', 0, 'scheduled', cfg.periodMinutes * 60_000) }),

  validateFact(_cfg, p, f, lineup) {
    const def = EVENTS.find((e) => e.type === f.type);
    if (!def) return err('UNKNOWN_EVENT', `Unsupported football event "${f.type}"`, 'type');
    const phase = PHASES.find((x) => x.id === p.phase)!;
    const allowedKinds = def.phases ?? ['play'];
    if (!allowedKinds.includes(phase.kind)) return err('PHASE_NOT_ALLOWED', `${def.label} cannot be recorded during ${phase.label}`, 'type');
    if (f.type === 'shootout_kick' && p.phase !== 'shootout') return err('PHASE_NOT_ALLOWED', 'Shootout kicks are only valid during the shootout', 'type');
    if (p.phase === 'shootout' && def.group === 'score') return err('PHASE_NOT_ALLOWED', 'Use shootout kicks during the shootout; they never change the match score', 'type');
    if (def.requiresSide && !sideSchema.safeParse(f.side).success) return err('SIDE_REQUIRED', 'Choose a team', 'side');
    const schema = payloadSchemas[f.type];
    if (schema) {
      const r = schema.safeParse(f.payload ?? {});
      if (!r.success) return err('INVALID_PAYLOAD', r.error.issues[0]?.message ?? 'Invalid event details', 'payload');
    }
    if (def.playerField === 'required' && !f.playerId) return err('PLAYER_REQUIRED', 'Choose a player', 'playerId');
    const check = (id: unknown, side: Side, field: string): Result<FactInput> | null =>
      id && lineup && !playerInLineup(lineup, side, String(id)) ? err('PLAYER_NOT_IN_LINEUP', 'Player is not in this team’s match lineup', field) : null;
    if (f.side && f.playerId) {
      const e = check(f.playerId, f.side, 'playerId');
      if (e) return e;
    }
    if ((f.type === 'goal' || f.type === 'penalty_scored') && f.side) {
      const pl = f.payload as { assistId?: string | null };
      if (pl.assistId) {
        if (pl.assistId === f.playerId) return err('INVALID_ASSIST', 'The scorer cannot also be the assist', 'payload.assistId');
        const e2 = check(pl.assistId, f.side, 'payload.assistId');
        if (e2) return e2;
      }
    }
    if (f.type === 'substitution' && f.side) {
      const pl = f.payload as { playerOutId?: string; playerInId?: string };
      const e1 = check(pl.playerOutId, f.side, 'payload.playerOutId') ?? check(pl.playerInId, f.side, 'payload.playerInId');
      if (e1) return e1;
      if (pl.playerOutId && pl.playerOutId === pl.playerInId) return err('INVALID_SUBSTITUTION', 'Player in and out must differ', 'payload');
      if (lineup) {
        const problem = substitutionProblem(onField(lineup, p, f.side), pl.playerOutId, pl.playerInId, false);
        if (problem) return err('INVALID_SUBSTITUTION', problem, 'payload');
      }
    }
    return ok(f);
  },

  applyFact(_cfg, prev, e: LogEntry) {
    const p = cloneProjection(prev);
    const side = e.side as Side | undefined;
    const tally = (id: string | null | undefined) => (id ? (p.players[id] ??= {}) : null);
    const periodKey = e.periodId;
    const addGoal = (s: Side) => {
      p.score[s] += 1;
      const ps = (p.periodScores[periodKey] ??= { home: 0, away: 0 });
      ps[s] += 1;
      bump(p.stats[s], 'goals');
    };
    switch (e.type) {
      case 'goal':
      case 'penalty_scored': {
        addGoal(side!);
        if (e.playerId) tally(e.playerId)!.goals = (tally(e.playerId)!.goals ?? 0) + 1;
        const assistId = (e.payload as { assistId?: string | null }).assistId;
        if (assistId) {
          tally(assistId)!.assists = (tally(assistId)!.assists ?? 0) + 1;
          bump(p.stats[side!], 'assists');
        }
        bump(p.counters, 'goals');
        break;
      }
      case 'own_goal':
        // Credits the opposing team; the responsible player is preserved on the fact but gets no goal.
        addGoal(otherSide(side!));
        bump(p.counters, 'goals');
        break;
      case 'penalty_missed':
        break;
      case 'yellow_card':
        bump(p.stats[side!], 'yellow_cards');
        if (e.playerId) tally(e.playerId)!.yellow = (tally(e.playerId)!.yellow ?? 0) + 1;
        bump(p.counters, 'cards');
        break;
      case 'second_yellow':
        bump(p.stats[side!], 'yellow_cards');
        bump(p.stats[side!], 'red_cards');
        if (e.playerId) Object.assign(tally(e.playerId)!, { yellow: 2, red: true, onCourt: false });
        bump(p.counters, 'cards');
        break;
      case 'red_card':
        bump(p.stats[side!], 'red_cards');
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
      case 'corner':
        bump(p.stats[side!], 'corners');
        break;
      case 'shot_on_target':
        bump(p.stats[side!], 'shots_on_target');
        break;
      case 'shot_off_target':
        bump(p.stats[side!], 'shots_off_target');
        break;
      case 'save':
        bump(p.stats[side!], 'saves');
        break;
      case 'offside':
        bump(p.stats[side!], 'offsides');
        break;
      case 'foul':
        bump(p.stats[side!], 'fouls');
        break;
      case 'stat_adjust': {
        const pl = e.payload as { stat: string; delta: number };
        adjustStat(p.stats[side!], pl.stat, pl.delta);
        break;
      }
      case 'stoppage_announced':
        p.stoppageMinutes = (e.payload as { minutes: number }).minutes;
        break;
      case 'shootout_kick': {
        const pl = e.payload as { scored: boolean };
        p.shootout ??= { home: 0, away: 0, kicks: [] };
        p.shootout.kicks.push({ side: side!, scored: pl.scored, playerId: e.playerId ?? null });
        if (pl.scored) p.shootout[side!] += 1;
        break;
      }
    }
    p.lastFactSequence = e.sequence;
    return p;
  },

  applyPhase(_cfg, prev, to) {
    const p = cloneProjection(prev);
    p.phase = to;
    if (PHASES.find((x) => x.id === to)?.kind === 'play') p.stoppageMinutes = null;
    if (to === 'shootout') p.shootout ??= { home: 0, away: 0, kicks: [] };
    return p;
  },

  clocksForPhase(cfg, _from, to, clocks, at) {
    const main = clocks.main!;
    const lim = limitsFor(cfg, to);
    if (lim) {
      const reset = applyClockAction(main, { type: 'reset', at, ms: lim.base, periodId: to, limitMs: lim.limit });
      return { ...clocks, main: applyClockAction(reset, { type: 'start', at }) };
    }
    if (main.running) return { ...clocks, main: { ...applyClockAction(main, { type: 'pause', at }), periodId: to } };
    return { ...clocks, main: { ...main, periodId: to } };
  },

  clocksForFact: (_cfg, _f, clocks) => clocks,

  display(cfg, p, clocks, now): DisplayModel {
    const ph = PHASES.find((x) => x.id === p.phase)!;
    const main = clocks.main!;
    const ms = clockDisplayMs(main, now);
    const lim = limitsFor(cfg, p.phase);
    let clockText = formatClock(ms);
    let stoppageText: string | null = null;
    if (lim && ms > lim.limit) {
      clockText = formatClock(lim.limit);
      stoppageText = `+${formatClock(ms - lim.limit).replace(/^0/, '')}`;
    }
    if (ph.kind !== 'play' || p.phase === 'shootout') {
      clockText = ph.kind === 'final' ? 'FT' : p.phase.startsWith('second_half_') ? 'HT' : ph.kind === 'break' ? ph.short : p.phase === 'shootout' ? 'PEN' : clockText;
    }
    return {
      periodLabel: ph.label,
      periodShort: ph.short,
      clockText,
      clockRunning: main.running,
      stoppageText,
      score: { ...p.score },
      shootout: p.shootout ? { home: p.shootout.home, away: p.shootout.away } : null,
      alerts: p.stoppageMinutes ? [`+${p.stoppageMinutes} min added`] : [],
    };
  },

  capabilities: () => ({
    graphics: ['scorebug', 'ident', 'lineup', 'goal', 'card', 'substitution', 'period_banner', 'lower_third', 'player_card', 'stats', 'break_score', 'sponsor', 'full_frame', 'ticker', 'slate'],
    scorebugFields: ['score', 'clock', 'period', 'stoppage', 'shootout'],
    // broadcast order: the first six are the default half-time / full-time panel
    statRows: [
      { key: 'shots_on_target', label: 'Shots on target' },
      { key: 'shots_off_target', label: 'Shots off target' },
      { key: 'corners', label: 'Corners' },
      { key: 'fouls', label: 'Fouls' },
      { key: 'offsides', label: 'Offsides' },
      { key: 'yellow_cards', label: 'Yellow cards' },
      { key: 'red_cards', label: 'Red cards' },
      { key: 'saves', label: 'Saves' },
      { key: 'possession_pct', label: 'Possession', unit: '%' },
      { key: 'goals', label: 'Goals' },
    ],
  }),
  highlightDefaults: () => ['goal', 'own_goal', 'penalty_scored', 'penalty_missed', 'red_card', 'manual_moment'],
};

export type { LineupSnapshot, ClockState };
