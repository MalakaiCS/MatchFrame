// Futsal under the Futsal Laws of the Game (FIFA's laws, which Football Australia and its member federations use):
// two count-down halves on a stopped clock, one one-minute timeout per team in each half and none in extra time,
// accumulated fouls counted per half (from the sixth in a half, every further one is a direct free kick from the
// 10 m mark without a wall; second-half fouls carry into extra time), a sent-off player's team plays a player short
// for two minutes of playing time or until the other team scores, rolling substitutions, then extra time 2×5 and
// kicks from the penalty mark when a winner is needed. Competitions change some of this (a running clock, shorter
// halves, stopped time only at the end); the presets and settings cover the usual variations.
// Phase ids are the shared period model's, with football's walk-out steps, so the football flow plays the same.
import { z } from 'zod';
import { applyClockAction, clockDisplayMs, clockExpired, createClock, formatClock } from '../clock';
import type { FactInput, LogEntry, SportAdapter } from '../adapter';
import { err, ok, otherSide, type DisplayModel, type EventTypeDef, type MatchProjection, type PhaseDef, type Result, type Side } from '../types';
import { adjustStat, basePre, bump, cloneProjection, playerInLineup, sideSchema } from './common';
import { onField, substitutionProblem } from '../lineup';
import { clocksForPeriodPhase, ordinal, periodClockText, periodOf, periodPhases, periodTransitions, type PeriodSpec } from './periods';

export const futsalConfigSchema = z.object({
  periodMinutes: z.number().int().min(5).max(30),
  halfTimeMinutes: z.number().int().min(0).max(20),
  clock: z.object({
    direction: z.enum(['down', 'up']),
    /** always: stopped whenever the ball is out of play; final_minutes: only in the last minutes of each half; never: running */
    stopped: z.enum(['always', 'final_minutes', 'never']),
    finalMinutes: z.number().int().min(1).max(5),
  }),
  timeouts: z.object({ perPeriod: z.number().int().min(0).max(3), seconds: z.number().int().min(30).max(120) }),
  /** accumulated fouls a team may commit in a half before every further one is a 10 m kick (the Laws: 5) */
  foulLimit: z.number().int().min(3).max(10),
  /** playing time a sent-off player's team plays short, unless the other team scores first (the Laws: 2) */
  sendOffMinutes: z.number().int().min(1).max(5),
  extraTime: z.object({ enabled: z.boolean(), periodMinutes: z.number().int().min(3).max(10) }),
  shootout: z.object({ enabled: z.boolean(), kicks: z.number().int().min(3).max(5) }),
  label: z.string().max(80),
});
export type FutsalConfig = z.infer<typeof futsalConfigSchema>;

const STANDARD: FutsalConfig = {
  periodMinutes: 20,
  halfTimeMinutes: 15,
  clock: { direction: 'down', stopped: 'always', finalMinutes: 2 },
  timeouts: { perPeriod: 1, seconds: 60 },
  foulLimit: 5,
  sendOffMinutes: 2,
  extraTime: { enabled: false, periodMinutes: 5 },
  shootout: { enabled: false, kicks: 5 },
  label: 'Futsal Laws: 2×20 stopped clock',
};

/** players a team has on the court at full strength, and the fewest it may continue with */
export const FUTSAL_ON_COURT = 5;
const MIN_ON_COURT = 3;

const spec = (c: FutsalConfig): PeriodSpec => ({
  count: 2,
  period: (n) => (n === 1 ? { label: '1st Half', short: '1H' } : { label: '2nd Half', short: '2H' }),
  interval: () => ({ label: 'Half Time', short: 'HT' }),
  extra: c.extraTime.enabled ? { count: 2, period: (k) => ({ label: k === 1 ? 'Extra Time 1st' : 'Extra Time 2nd', short: `ET${k}` }), beforeLabel: 'Before Extra Time' } : null,
  shootout: c.shootout.enabled ? { label: 'Kicks from the penalty mark', short: 'PEN' } : null,
  final: { label: 'Full Time', short: 'FT' },
});
const phasesFor = (c: FutsalConfig): PhaseDef[] => periodPhases(spec(c));

const EVENTS: EventTypeDef[] = [
  { type: 'goal', label: 'Goal', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'own_goal', label: 'Own goal', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'penalty_scored', label: 'Penalty scored', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  { type: 'ten_metre_scored', label: '10 m kick scored', group: 'score', requiresSide: true, playerField: 'optional', graphic: 'goal', highlightDefault: true },
  // an accumulated foul: one penalised with a direct free kick or a penalty kick
  { type: 'foul', label: 'Foul', group: 'discipline', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'yellow_card', label: 'Yellow card', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: false },
  { type: 'second_yellow', label: 'Second yellow', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: true },
  { type: 'red_card', label: 'Red card', group: 'discipline', requiresSide: true, playerField: 'optional', graphic: 'card', highlightDefault: true },
  { type: 'substitution', label: 'Substitution', group: 'change', requiresSide: true, playerField: 'none', graphic: 'substitution', highlightDefault: false, phases: ['play', 'break'] },
  { type: 'timeout', label: 'Timeout', group: 'control', requiresSide: true, playerField: 'none', graphic: 'timeout', highlightDefault: false },
  { type: 'penalty_missed', label: 'Penalty missed', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: true },
  { type: 'ten_metre_missed', label: '10 m kick missed', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: true },
  { type: 'shot_on_target', label: 'Shot on target', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'shot_off_target', label: 'Shot off target', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'corner', label: 'Corner', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false },
  { type: 'save', label: 'Save', group: 'stat', requiresSide: true, playerField: 'optional', highlightDefault: false },
  { type: 'stat_adjust', label: 'Adjust team stat', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false, phases: ['play', 'break', 'final'] },
  { type: 'possession_change', label: 'Possession', group: 'stat', requiresSide: true, playerField: 'none', highlightDefault: false },
  { type: 'shootout_kick', label: 'Penalty kick', group: 'shootout', requiresSide: true, playerField: 'optional', highlightDefault: true },
];

export const FUTSAL_STATS = ['goals', 'shots_on_target', 'shots_off_target', 'corners', 'saves', 'fouls', 'yellow_cards', 'red_cards', 'timeouts_used', 'ten_metre_kicks', 'possession_pct'] as const;

export const FUTSAL_GOAL_TYPES = ['open_play', 'counter_attack', 'set_piece', 'free_kick', 'long_range', 'power_play', 'penalty', 'second_penalty', 'own_goal'] as const;
export const FUTSAL_GOAL_TYPE_LABELS: Record<(typeof FUTSAL_GOAL_TYPES)[number], string> = {
  open_play: 'Open play',
  counter_attack: 'Counter attack',
  set_piece: 'Corner or kick-in',
  free_kick: 'Free kick',
  long_range: 'Long range',
  power_play: 'Fly goalkeeper',
  penalty: 'Penalty (6 m)',
  second_penalty: '10 m kick',
  own_goal: 'Own goal',
};
const goalPayload = z.object({ assistId: z.string().uuid().nullable().optional(), goalType: z.enum(FUTSAL_GOAL_TYPES).optional() });
const payloadSchemas: Record<string, z.ZodType> = {
  goal: goalPayload,
  penalty_scored: goalPayload.extend({ goalType: z.literal('penalty').optional() }),
  ten_metre_scored: goalPayload.extend({ goalType: z.literal('second_penalty').optional() }),
  own_goal: z.object({ goalType: z.literal('own_goal').optional() }),
  // a player sent off from the bench leaves the team at full strength on the court
  second_yellow: z.object({ onCourt: z.boolean().optional() }),
  red_card: z.object({ onCourt: z.boolean().optional() }),
  substitution: z.object({ playerOutId: z.string().uuid().nullable().optional(), playerInId: z.string().uuid().nullable().optional() }),
  stat_adjust: z.object({ stat: z.enum(FUTSAL_STATS), delta: z.number().int().min(-50).max(50) }),
  shootout_kick: z.object({ scored: z.boolean() }),
};

const regMs = (c: FutsalConfig) => c.periodMinutes * 60_000;
const etMs = (c: FutsalConfig) => c.extraTime.periodMinutes * 60_000;
const lengthMs = (c: FutsalConfig) => (phase: string) => {
  const per = periodOf(phase);
  return per ? (per.kind === 'reg' ? regMs(c) : etMs(c)) : null;
};

/** Playing time since the start of the match (ms) at a clock reading in a period, whichever way the clock counts. */
export function futsalMatchMs(c: FutsalConfig, periodId: string, clockMs: number | null | undefined): number | null {
  const per = periodOf(periodId);
  if (!per || clockMs == null) return null;
  const len = per.kind === 'reg' ? regMs(c) : etMs(c);
  const elapsed = Math.min(len, Math.max(0, c.clock.direction === 'down' ? len - clockMs : clockMs));
  const base = per.kind === 'reg' ? (per.n - 1) * regMs(c) : 2 * regMs(c) + (per.n - 1) * etMs(c);
  return base + elapsed;
}

/** Playing time at the end of the period before a break, for the send-off countdown while the clock is not running. */
function matchMsAtBreak(c: FutsalConfig, phase: string): number | null {
  if (phase === 'half_time' || phase.startsWith('second_half_')) return regMs(c);
  if (phase === 'extra_time_break') return 2 * regMs(c);
  if (/^et_break_\d+$/.test(phase)) return 2 * regMs(c) + etMs(c);
  return null;
}

type SendOff = NonNullable<MatchProjection['sendOffs']>[number];
/** "1:30", not "01:30" */
const countdown = (ms: number) => formatClock(ms).replace(/^0(?=\d:)/, '');
const sendOffActive = (c: FutsalConfig, s: SendOff, atMs: number) => s.endedBy == null && atMs - s.atMs < c.sendOffMinutes * 60_000;

/**
 * A goal and the numbers on the court: when the team with more players scores, the other team may bring one
 * player back on (5 v 4 becomes 5 v 5; 5 v 3 or 4 v 3 gains one). Level numbers (4 v 4, 3 v 3), or a goal by the
 * team with fewer players, change nothing.
 */
function goalEndsSendOff(c: FutsalConfig, p: MatchProjection, scorer: Side, atMs: number | null) {
  if (atMs == null || !p.sendOffs?.length) return;
  const active = (s: Side) => p.sendOffs!.filter((x) => x.side === s && sendOffActive(c, x, atMs));
  const mine = active(scorer);
  const theirs = active(otherSide(scorer));
  if (theirs.length > mine.length) Object.assign(theirs[0]!, { endedBy: 'goal' as const, endedAtMs: atMs });
}

export const futsalAdapter: SportAdapter<FutsalConfig> = {
  sport: 'futsal',
  label: 'Futsal',
  rulesVersion: 'futsal-1',
  configSchema: futsalConfigSchema,
  defaultConfig: STANDARD,
  presets: [
    { id: 'standard', label: STANDARD.label, config: STANDARD },
    {
      id: 'knockout',
      label: 'Knockout: 2×20 stopped clock, extra time 2×5 and kicks from the penalty mark',
      config: { ...STANDARD, extraTime: { enabled: true, periodMinutes: 5 }, shootout: { enabled: true, kicks: 5 }, label: 'Knockout: 2×20 stopped clock, extra time 2×5 and kicks from the penalty mark' },
    },
    {
      id: 'community',
      label: 'Community 2×20 running clock, stopped in the final 2 minutes',
      config: { ...STANDARD, halfTimeMinutes: 5, clock: { direction: 'down', stopped: 'final_minutes', finalMinutes: 2 }, label: 'Community 2×20 running clock, stopped in the final 2 minutes' },
    },
    {
      id: 'junior',
      label: 'Junior 2×15 running clock',
      config: { ...STANDARD, periodMinutes: 15, halfTimeMinutes: 5, clock: { direction: 'down', stopped: 'never', finalMinutes: 2 }, label: 'Junior 2×15 running clock' },
    },
  ],
  describeRules: (c) => [
    `2×${c.periodMinutes}-minute halves, counting ${c.clock.direction}; ${c.clock.stopped === 'always' ? 'stopped clock (stop it whenever the ball is out of play)' : c.clock.stopped === 'final_minutes' ? `running clock, stopped whenever the ball is out of play in the final ${c.clock.finalMinutes} minutes of each half` : 'running clock'}; half time up to ${c.halfTimeMinutes} minutes`,
    c.timeouts.perPeriod ? `${c.timeouts.perPeriod} timeout${c.timeouts.perPeriod === 1 ? '' : 's'} of ${c.timeouts.seconds} seconds per team in each half; none in extra time. A timeout stops the clock` : 'No timeouts',
    `Accumulated fouls (those penalised with a direct free kick or a penalty) count per half and reset at half time${c.extraTime.enabled ? '; second-half fouls carry into extra time' : ''}. From the ${ordinal(c.foulLimit + 1)} foul in a half, each one is a direct free kick from the 10 m mark without a wall. Record a foul and any card for it separately`,
    `A sent-off player's team plays a player short for ${c.sendOffMinutes} minutes of playing time, or until the other team scores while having more players; at level numbers a goal changes nothing`,
    'Rolling substitutions; 5 players on the court including the goalkeeper',
    c.extraTime.enabled ? `Extra time: 2×${c.extraTime.periodMinutes} minutes when level` : 'No extra time',
    c.shootout.enabled ? `Kicks from the penalty mark when level: ${c.shootout.kicks} each, then one each until there is a winner (kept separately from the match score)` : 'Draws stand',
  ],
  phases: phasesFor,
  phase: (c, id) => phasesFor(c).find((p) => p.id === id),
  allowedTransitions: (c, p) => periodTransitions(spec(c), p, { extraTime: c.extraTime.enabled, shootout: c.shootout.enabled }),
  eventTypes: () => EVENTS,
  initialProjection: (c) => ({ ...basePre('futsal', 'futsal-1', { home: {}, away: {} }), teamFouls: { home: 0, away: 0 }, timeouts: { home: c.timeouts.perPeriod, away: c.timeouts.perPeriod }, sendOffs: [] }),
  initialClocks: (c) => ({ main: createClock('main', c.clock.direction, c.clock.direction === 'down' ? regMs(c) : 0, 'scheduled', regMs(c)) }),

  validateFact(c, p, f, lineup) {
    const def = EVENTS.find((e) => e.type === f.type);
    if (!def) return err('UNKNOWN_EVENT', `Unsupported futsal event "${f.type}"`, 'type');
    const phase = phasesFor(c).find((x) => x.id === p.phase)!;
    if (!(def.phases ?? ['play']).includes(phase.kind)) return err('PHASE_NOT_ALLOWED', `${def.label} cannot be recorded during ${phase.label}`, 'type');
    if (f.type === 'shootout_kick' && p.phase !== 'shootout') return err('PHASE_NOT_ALLOWED', 'Penalty kicks of the shoot-out are only valid during the kicks from the penalty mark', 'type');
    if (p.phase === 'shootout' && (def.group === 'score' || f.type === 'foul' || f.type === 'timeout')) return err('PHASE_NOT_ALLOWED', 'Use penalty kicks during the kicks from the penalty mark; they never change the match score', 'type');
    if (def.requiresSide && !sideSchema.safeParse(f.side).success) return err('SIDE_REQUIRED', 'Choose a team', 'side');
    if (f.type === 'timeout') {
      if (periodOf(p.phase)?.kind !== 'reg') return err('PHASE_NOT_ALLOWED', 'There are no timeouts in extra time', 'type');
      if ((p.timeouts?.[f.side as Side] ?? 0) <= 0) return err('NO_TIMEOUTS_LEFT', 'This team has used its timeout for this half', 'side');
    }
    const schema = payloadSchemas[f.type];
    if (schema) {
      const r = schema.safeParse(f.payload ?? {});
      if (!r.success) return err('INVALID_PAYLOAD', r.error.issues[0]?.message ?? 'Invalid event details', 'payload');
    }
    const check = (id: unknown, field: string): Result<FactInput> | null =>
      id && lineup && f.side && !playerInLineup(lineup, f.side, String(id)) ? err('PLAYER_NOT_IN_LINEUP', 'Player is not in this team’s match lineup', field) : null;
    const e = check(f.playerId, 'playerId');
    if (e) return e;
    if (['goal', 'penalty_scored', 'ten_metre_scored'].includes(f.type)) {
      const pl = f.payload as { assistId?: string | null };
      if (pl.assistId && pl.assistId === f.playerId) return err('INVALID_ASSIST', 'The scorer cannot also be the assist', 'payload.assistId');
      const e2 = check(pl.assistId, 'payload.assistId');
      if (e2) return e2;
    }
    if (f.type === 'substitution' && f.side) {
      const pl = f.payload as { playerOutId?: string; playerInId?: string };
      const e3 = check(pl.playerOutId, 'payload.playerOutId') ?? check(pl.playerInId, 'payload.playerInId');
      if (e3) return e3;
      if (pl.playerOutId && pl.playerOutId === pl.playerInId) return err('INVALID_SUBSTITUTION', 'Player in and out must differ', 'payload');
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
    const tally = (id: string | null | undefined) => (id ? (p.players[id] ??= {}) : null);
    const at = futsalMatchMs(c, e.periodId, e.clockMs);
    const addGoal = (s: Side) => {
      p.score[s] += 1;
      const ps = (p.periodScores[e.periodId] ??= { home: 0, away: 0 });
      ps[s] += 1;
      bump(p.stats[s], 'goals');
      bump(p.counters, 'goals');
      goalEndsSendOff(c, p, s, at);
    };
    const sendOff = () => {
      if ((e.payload as { onCourt?: boolean }).onCourt === false) return;
      (p.sendOffs ??= []).push({ side, playerId: e.playerId ?? null, atMs: at ?? 0, endedBy: null, endedAtMs: null });
    };
    switch (e.type) {
      case 'goal':
      case 'penalty_scored':
      case 'ten_metre_scored': {
        addGoal(side);
        if (e.type === 'ten_metre_scored') bump(p.stats[side], 'ten_metre_kicks');
        if (e.playerId) tally(e.playerId)!.goals = (tally(e.playerId)!.goals ?? 0) + 1;
        const assistId = (e.payload as { assistId?: string | null }).assistId;
        if (assistId) {
          tally(assistId)!.assists = (tally(assistId)!.assists ?? 0) + 1;
          bump(p.stats[side], 'assists');
        }
        break;
      }
      case 'own_goal':
        // credits the other team; the player is kept on the fact but gets no goal
        addGoal(otherSide(side));
        break;
      case 'penalty_missed':
        break;
      case 'ten_metre_missed':
        bump(p.stats[side], 'ten_metre_kicks');
        break;
      case 'foul':
        p.teamFouls ??= { home: 0, away: 0 };
        p.teamFouls[side] += 1;
        bump(p.stats[side], 'fouls');
        if (e.playerId) tally(e.playerId)!.fouls = (tally(e.playerId)!.fouls ?? 0) + 1;
        bump(p.counters, 'fouls');
        break;
      case 'yellow_card':
        bump(p.stats[side], 'yellow_cards');
        if (e.playerId) tally(e.playerId)!.yellow = (tally(e.playerId)!.yellow ?? 0) + 1;
        bump(p.counters, 'cards');
        break;
      case 'second_yellow':
        bump(p.stats[side], 'yellow_cards');
        bump(p.stats[side], 'red_cards');
        if (e.playerId) Object.assign(tally(e.playerId)!, { yellow: 2, red: true, onCourt: false });
        bump(p.counters, 'cards');
        sendOff();
        break;
      case 'red_card':
        bump(p.stats[side], 'red_cards');
        if (e.playerId) Object.assign(tally(e.playerId)!, { red: true, onCourt: false });
        bump(p.counters, 'cards');
        sendOff();
        break;
      case 'substitution': {
        const pl = e.payload as { playerOutId?: string; playerInId?: string };
        if (pl.playerOutId) tally(pl.playerOutId)!.onCourt = false;
        if (pl.playerInId) tally(pl.playerInId)!.onCourt = true;
        bump(p.counters, 'substitutions');
        break;
      }
      case 'timeout':
        p.timeouts ??= { home: 0, away: 0 };
        p.timeouts[side] = Math.max(0, p.timeouts[side] - 1);
        bump(p.stats[side], 'timeouts_used');
        bump(p.counters, 'timeouts');
        break;
      case 'shot_on_target':
        bump(p.stats[side], 'shots_on_target');
        break;
      case 'shot_off_target':
        bump(p.stats[side], 'shots_off_target');
        break;
      case 'corner':
        bump(p.stats[side], 'corners');
        break;
      case 'save':
        bump(p.stats[side], 'saves');
        break;
      case 'stat_adjust': {
        const pl = e.payload as { stat: string; delta: number };
        adjustStat(p.stats[side], pl.stat, pl.delta);
        if (pl.stat === 'fouls' && p.teamFouls) p.teamFouls[side] = Math.max(0, p.teamFouls[side] + pl.delta);
        break;
      }
      case 'shootout_kick': {
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

  applyPhase(c, prev, to) {
    const p = cloneProjection(prev);
    p.phase = to;
    const per = periodOf(to);
    // fouls start again in each half; extra time carries on from the second half's
    if (per?.kind === 'reg') {
      p.teamFouls = { home: 0, away: 0 };
      p.timeouts = { home: c.timeouts.perPeriod, away: c.timeouts.perPeriod };
    }
    if (per?.kind === 'et') p.timeouts = { home: 0, away: 0 };
    if (to === 'shootout') p.shootout ??= { home: 0, away: 0, kicks: [] };
    return p;
  },
  clocksForPhase: (c, _from, to, clocks, at) => clocksForPeriodPhase({ direction: c.clock.direction, lengthMs: lengthMs(c) }, to, clocks, at),
  // a timeout stops the clock
  clocksForFact: (_c, f, clocks, at) => (f.type === 'timeout' && clocks.main?.running ? { ...clocks, main: applyClockAction(clocks.main, { type: 'pause', at }) } : clocks),

  display(c, p, clocks, now): DisplayModel {
    const ph = phasesFor(c).find((x) => x.id === p.phase)!;
    const main = clocks.main!;
    const ms = clockDisplayMs(main, now);
    const per = periodOf(p.phase);
    const alerts: string[] = [];
    const name = (s: Side) => (s === 'home' ? 'Home' : 'Away');
    const fouls = p.teamFouls ?? { home: 0, away: 0 };
    for (const s of ['home', 'away'] as const) {
      if (fouls[s] === c.foulLimit) alerts.push(`${name(s)}: ${c.foulLimit} accumulated fouls, the next one is a 10 m kick`);
      else if (fouls[s] > c.foulLimit) alerts.push(`${name(s)}: ${fouls[s]} accumulated fouls, 10 m kicks without a wall`);
    }
    // the send-off countdown runs on playing time; in a break it stands where the period ended
    const nowMatch = per ? futsalMatchMs(c, p.phase, ms) : matchMsAtBreak(c, p.phase);
    const shortHanded: NonNullable<DisplayModel['shortHanded']> = [];
    if (nowMatch != null && p.phase !== 'shootout') {
      const active = (s: Side) => (p.sendOffs ?? []).filter((x) => x.side === s && sendOffActive(c, x, nowMatch));
      const onCourt = (s: Side) => Math.max(MIN_ON_COURT, FUTSAL_ON_COURT - active(s).length);
      for (const s of ['home', 'away'] as const) {
        if (!active(s).length) continue;
        const remaining = Math.min(...active(s).map((x) => c.sendOffMinutes * 60_000 - (nowMatch - x.atMs)));
        shortHanded.push({ side: s, players: onCourt(s), remainingText: countdown(remaining) });
        alerts.push(`${name(s)} ${active(s).length > 1 ? 'two players' : 'a player'} short (${onCourt(s)} v ${onCourt(otherSide(s))}): ${countdown(remaining)} of playing time, or until ${name(otherSide(s)).toLowerCase()} score with more players`);
      }
    }
    if (ph.kind === 'play' && per) {
      const remaining = c.clock.direction === 'down' ? ms : Math.max(0, (per.kind === 'reg' ? regMs(c) : etMs(c)) - ms);
      if (c.clock.stopped === 'final_minutes' && remaining <= c.clock.finalMinutes * 60_000 && remaining > 0) alerts.push(`Final ${c.clock.finalMinutes} minutes: stop the clock whenever the ball is out of play`);
      if (clockExpired(main, now) || (c.clock.direction === 'up' && remaining === 0)) alerts.push('Half clock at the end: finish the half when the referees confirm');
    }
    return {
      periodLabel: ph.label,
      periodShort: ph.short,
      clockText: p.phase === 'shootout' ? 'PEN' : periodClockText(ph, formatClock(ms)),
      clockRunning: main.running,
      score: { ...p.score },
      shootout: p.shootout ? { home: p.shootout.home, away: p.shootout.away } : null,
      fouls: { ...fouls },
      // at the limit: the next foul is a 10 m kick
      bonus: { home: fouls.home >= c.foulLimit, away: fouls.away >= c.foulLimit },
      timeouts: p.timeouts ? { ...p.timeouts } : null,
      shortHanded: shortHanded.length ? shortHanded : null,
      alerts,
    };
  },

  capabilities: () => ({
    graphics: ['scorebug', 'ident', 'lineup', 'goal', 'card', 'substitution', 'timeout', 'period_banner', 'lower_third', 'player_card', 'stats', 'break_score', 'sponsor', 'full_frame', 'ticker', 'slate', 'league_table', 'fixtures', 'formation', 'match_summary', 'head_to_head', 'match_info', 'stat_compare', 'top_scorers', 'player_of_match', 'stinger', 'shootout'],
    scorebugFields: ['score', 'clock', 'period', 'fouls', 'timeouts', 'shootout'],
    // broadcast order: the first six are the default half-time / full-time panel
    statRows: [
      { key: 'shots_on_target', label: 'Shots on target' },
      { key: 'shots_off_target', label: 'Shots off target' },
      { key: 'fouls', label: 'Accumulated fouls' },
      { key: 'corners', label: 'Corners' },
      { key: 'saves', label: 'Saves' },
      { key: 'yellow_cards', label: 'Yellow cards' },
      { key: 'red_cards', label: 'Red cards' },
      { key: 'timeouts_used', label: 'Timeouts used' },
      { key: 'ten_metre_kicks', label: '10 m kicks' },
      { key: 'possession_pct', label: 'Possession', unit: '%' },
      { key: 'goals', label: 'Goals' },
    ],
  }),
  highlightDefaults: () => ['goal', 'own_goal', 'penalty_scored', 'ten_metre_scored', 'penalty_missed', 'ten_metre_missed', 'second_yellow', 'red_card', 'manual_moment'],
  knockout: {
    label: 'Extra time and kicks from the penalty mark when level',
    isOn: (c) => c.extraTime.enabled || c.shootout.enabled,
    set: (c, on) => (on && (c.extraTime.enabled || c.shootout.enabled) ? c : { ...c, extraTime: { ...c.extraTime, enabled: on }, shootout: { ...c.shootout, enabled: on } }),
  },
  // the minute of play, however the clock counts: 18:30 left in the first half is the 2nd minute
  minuteOf: (c, periodId, clockMs) => {
    const ms = futsalMatchMs(c, periodId, clockMs);
    return ms == null ? null : Math.floor(ms / 60_000) + 1;
  },
};
