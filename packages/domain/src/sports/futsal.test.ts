import { describe, expect, it } from 'vitest';
import { applyCommand, type EngineState, type StoredFact } from '../engine';
import type { LineupSnapshot } from '../types';
import { clockDisplayMs } from '../clock';
import { futsalAdapter, futsalMatchMs, type FutsalConfig } from './futsal';
import { simulateRehearsal, syntheticTimeline } from '../rehearsal';
import { FUTSAL_STARTER } from '../starter-plans';
import { validateGamePlan } from '../automation';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// fourteen a side, five starting (the goalkeeper and four outfield players)
const lineup: LineupSnapshot = {
  home: Array.from({ length: 14 }, (_, i) => ({ playerId: uuid(i + 1), displayName: `Home ${i + 1}`, starter: i < 5 })),
  away: Array.from({ length: 14 }, (_, i) => ({ playerId: uuid(i + 21), displayName: `Away ${i + 21}`, starter: i < 5 })),
};
const STANDARD = futsalAdapter.defaultConfig;
const KNOCKOUT = futsalAdapter.presets.find((p) => p.id === 'knockout')!.config;

function harness(cfg: FutsalConfig) {
  let state: EngineState = { projection: futsalAdapter.initialProjection(cfg), clocks: futsalAdapter.initialClocks(cfg), sequence: 0 };
  const log: StoredFact[] = [];
  let id = 100;
  const run = (type: Parameters<typeof applyCommand>[4], payload: unknown, now: number) => {
    const r = applyCommand(futsalAdapter, cfg, state, log, type, payload, now, lineup);
    if (r.kind === 'append') log.push({ ...r.entry, id: uuid(id++) });
    state = r.state;
    return r;
  };
  const phase = (to: string, now: number) => run('SET_PHASE', { to }, now);
  const fact = (type: string, side: 'home' | 'away' | null, now: number, extra: Record<string, unknown> = {}) => run('ADD_FACT', { type, side, occurredAt: now, payload: {}, ...extra }, now);
  const clock = (action: 'start' | 'pause', now: number) => run('CLOCK_ACTION', { clockId: 'main', action }, now);
  const display = (now: number) => futsalAdapter.display(cfg, state.projection, state.clocks, now);
  /** kick-off, ready for the half */
  const toFirstHalf = (now: number) => {
    phase('pre_match', now);
    phase('players_entering', now);
    phase('about_to_start', now);
    phase('p1', now);
  };
  return { run, phase, fact, clock, display, toFirstHalf, get state() { return state; } };
}

describe('futsal', () => {
  it('two count-down halves with football’s walk-out steps; extra time and kicks from the penalty mark only when the competition needs a winner', () => {
    const ids = futsalAdapter.phases(STANDARD).map((p) => p.id);
    expect(ids).toEqual(['scheduled', 'ready', 'pre_match', 'players_entering', 'about_to_start', 'p1', 'half_time', 'second_half_entering', 'second_half_ready', 'p2', 'full_time', 'postponed', 'abandoned', 'cancelled']);
    expect(futsalAdapter.phases(KNOCKOUT).map((p) => p.id)).toEqual(expect.arrayContaining(['extra_time_break', 'et1', 'et_break_1', 'et2', 'shootout']));
    expect(futsalAdapter.phase(KNOCKOUT, 'shootout')?.label).toBe('Kicks from the penalty mark');
    const level = { ...futsalAdapter.initialProjection(KNOCKOUT), phase: 'p2' };
    expect(futsalAdapter.allowedTransitions(KNOCKOUT, level)).toEqual(['extra_time_break', 'shootout', 'full_time', 'abandoned']);
    expect(futsalAdapter.allowedTransitions(STANDARD, level)).toEqual(['full_time', 'abandoned']);

    const h = harness(STANDARD);
    const t = 1_000_000;
    h.toFirstHalf(t);
    expect(h.state.clocks.main).toMatchObject({ direction: 'down', running: true });
    expect(h.display(t + 65_000).clockText).toBe('18:55');
    expect(futsalAdapter.describeRules(STANDARD).join(' ')).toMatch(/2×20-minute halves.*stopped clock/);
  });

  it('accumulated fouls: at five the next is a 10 m kick, from the sixth every one is; they reset for the second half and carry into extra time', () => {
    const h = harness(KNOCKOUT);
    let t = 1_000_000;
    h.toFirstHalf(t);
    for (let i = 0; i < 5; i++) h.fact('foul', 'home', (t += 10_000), { playerId: uuid(2) });
    expect(h.display(t).fouls).toEqual({ home: 5, away: 0 });
    expect(h.display(t).bonus).toEqual({ home: true, away: false });
    expect(h.display(t).alerts).toContain('Home: 5 accumulated fouls, the next one is a 10 m kick');
    h.fact('foul', 'home', (t += 10_000));
    expect(h.display(t).alerts).toContain('Home: 6 accumulated fouls, 10 m kicks without a wall');
    h.fact('ten_metre_scored', 'away', (t += 10_000), { playerId: uuid(23) });
    expect(h.state.projection.score).toEqual({ home: 0, away: 1 });
    expect(h.state.projection.stats.away.ten_metre_kicks).toBe(1);
    expect(h.state.projection.players[uuid(2)]!.fouls).toBe(5);

    h.phase('half_time', (t += 10_000));
    expect(h.display(t).fouls).toEqual({ home: 6, away: 0 }); // still the first half's count at the break
    h.phase('second_half_entering', (t += 10_000));
    h.phase('p2', (t += 10_000));
    expect(h.display(t).fouls).toEqual({ home: 0, away: 0 });
    expect(h.state.projection.stats.home.fouls).toBe(6); // the match total is kept for the stats board
    h.fact('foul', 'away', (t += 10_000));
    h.fact('foul', 'away', (t += 10_000));
    h.fact('goal', 'home', (t += 10_000));
    h.phase('extra_time_break', (t += 10_000));
    h.phase('et1', (t += 10_000));
    expect(h.display(t).fouls).toEqual({ home: 0, away: 2 });
    h.fact('foul', 'away', (t += 10_000));
    expect(h.display(t).fouls!.away).toBe(3);
  });

  it('one timeout per team in each half, which stops the clock; none in extra time', () => {
    const h = harness(KNOCKOUT);
    let t = 1_000_000;
    h.toFirstHalf(t);
    expect(h.display(t).timeouts).toEqual({ home: 1, away: 1 });
    h.fact('timeout', 'home', (t += 30_000));
    expect(h.state.clocks.main!.running).toBe(false);
    const at = clockDisplayMs(h.state.clocks.main!, t);
    expect(clockDisplayMs(h.state.clocks.main!, t + 60_000)).toBe(at);
    expect(h.display(t).timeouts).toEqual({ home: 0, away: 1 });
    expect(() => h.fact('timeout', 'home', (t += 1000))).toThrow(/used its timeout for this half/);
    h.clock('start', (t += 60_000));
    h.phase('half_time', (t += 1000));
    h.phase('p2', (t += 1000));
    expect(h.display(t).timeouts).toEqual({ home: 1, away: 1 });
    h.phase('extra_time_break', (t += 1000));
    h.phase('et1', (t += 1000));
    expect(h.display(t).timeouts).toEqual({ home: 0, away: 0 });
    expect(() => h.fact('timeout', 'away', (t += 1000))).toThrow(/no timeouts in extra time/);
  });

  it('a send-off: the team plays a player short for two minutes of playing time, and the countdown stands while the clock is stopped', () => {
    const h = harness(STANDARD);
    let t = 1_000_000;
    h.toFirstHalf(t);
    h.fact('red_card', 'away', (t += 60_000), { playerId: uuid(22) });
    expect(h.display(t).shortHanded).toEqual([{ side: 'away', players: 4, remainingText: '2:00' }]);
    expect(h.display(t + 30_000).shortHanded![0]!.remainingText).toBe('1:30');
    // stopped clock: no playing time passes
    h.clock('pause', (t += 30_000));
    expect(h.display(t + 90_000).shortHanded![0]!.remainingText).toBe('1:30');
    h.clock('start', (t += 90_000));
    expect(h.display(t + 89_000).shortHanded![0]!.remainingText).toBe('0:01');
    expect(h.display(t + 90_000).shortHanded).toBeNull();
    expect(h.state.projection.players[uuid(22)]).toMatchObject({ red: true, onCourt: false });
  });

  it('a goal by the team with more players lets the short team bring a player back; at level numbers, or when the short team scores, nothing changes', () => {
    // 5 v 4: the full team scores, the short team is completed
    let h = harness(STANDARD);
    let t = 1_000_000;
    h.toFirstHalf(t);
    h.fact('red_card', 'away', (t += 60_000));
    h.fact('goal', 'away', (t += 10_000));
    expect(h.display(t).shortHanded).toHaveLength(1); // the short team scoring changes nothing
    h.fact('goal', 'home', (t += 10_000));
    expect(h.display(t).shortHanded).toBeNull();

    // 4 v 4: both short, a goal leaves both short
    h = harness(STANDARD);
    t = 1_000_000;
    h.toFirstHalf(t);
    h.fact('red_card', 'away', (t += 60_000));
    h.fact('second_yellow', 'home', (t += 5_000));
    h.fact('goal', 'home', (t += 5_000));
    expect(h.display(t).shortHanded!.map((s) => [s.side, s.players])).toEqual([['home', 4], ['away', 4]]);

    // 5 v 3: the full team scores, the team with three gains one player
    h = harness(STANDARD);
    t = 1_000_000;
    h.toFirstHalf(t);
    h.fact('red_card', 'away', (t += 60_000));
    h.fact('red_card', 'away', (t += 5_000));
    expect(h.display(t).shortHanded).toEqual([{ side: 'away', players: 3, remainingText: '1:55' }]);
    h.fact('goal', 'home', (t += 5_000));
    expect(h.display(t).shortHanded).toEqual([{ side: 'away', players: 4, remainingText: '1:55' }]);

    // a substitute sent off from the bench leaves the team at full strength
    h = harness(STANDARD);
    t = 1_000_000;
    h.toFirstHalf(t);
    h.fact('red_card', 'home', (t += 60_000), { playerId: uuid(9), payload: { onCourt: false } });
    expect(h.display(t).shortHanded).toBeNull();
  });

  it('a send-off late in the first half carries on into the second', () => {
    const h = harness(STANDARD);
    let t = 1_000_000;
    h.toFirstHalf(t);
    h.fact('red_card', 'home', (t += 19 * 60_000));
    h.phase('half_time', (t += 60_000)); // the half ran its full 20 minutes
    expect(h.display(t).shortHanded).toEqual([{ side: 'home', players: 4, remainingText: '1:00' }]);
    h.phase('second_half_entering', (t += 600_000));
    h.phase('p2', (t += 60_000));
    expect(h.display(t + 30_000).shortHanded![0]!.remainingText).toBe('0:30');
    expect(h.display(t + 60_000).shortHanded).toBeNull();
  });

  it('kicks from the penalty mark never change the match score', () => {
    const h = harness(KNOCKOUT);
    let t = 1_000_000;
    h.toFirstHalf(t);
    h.phase('half_time', (t += 1000));
    h.phase('p2', (t += 1000));
    h.phase('shootout', (t += 1000));
    h.fact('shootout_kick', 'home', (t += 1000), { payload: { scored: true } });
    h.fact('shootout_kick', 'away', (t += 1000), { payload: { scored: false } });
    expect(h.state.projection.score).toEqual({ home: 0, away: 0 });
    expect(h.display(t)).toMatchObject({ clockText: 'PEN', shootout: { home: 1, away: 0 } });
    expect(() => h.fact('goal', 'home', (t += 1000))).toThrow(/penalty kicks during the kicks from the penalty mark/);
  });

  it('a running clock stopped only at the end, and a clock counting up, keep the same playing time', () => {
    const community = futsalAdapter.presets.find((p) => p.id === 'community')!.config;
    const h = harness(community);
    let t = 1_000_000;
    h.toFirstHalf(t);
    expect(h.display(t + 17 * 60_000).alerts.some((a) => a.startsWith('Final 2 minutes'))).toBe(false);
    expect(h.display(t + 18 * 60_000 + 1000).alerts).toContain('Final 2 minutes: stop the clock whenever the ball is out of play');
    expect(h.display((t += 20 * 60_000)).alerts).toContain('Half clock at the end: finish the half when the referees confirm');
    const up: FutsalConfig = { ...STANDARD, clock: { ...STANDARD.clock, direction: 'up' } };
    expect(futsalMatchMs(up, 'p2', 90_000)).toBe(futsalMatchMs(STANDARD, 'p2', 20 * 60_000 - 90_000));
    expect(futsalMatchMs(KNOCKOUT, 'et2', 4 * 60_000)).toBe(45 * 60_000 + 60_000);
    // the minute of play for graphics: 18:30 left in the first half is the 2nd minute, 5:00 left in the second the 36th
    expect(futsalAdapter.minuteOf!(STANDARD, 'p1', 18 * 60_000 + 30_000)).toBe(2);
    expect(futsalAdapter.minuteOf!(STANDARD, 'p2', 5 * 60_000)).toBe(36);
    expect(futsalAdapter.minuteOf!(STANDARD, 'half_time', 0)).toBeNull();
  });

  it('the futsal starter flow follows football’s match flow, puts goals, cards and timeouts on air and nothing for a rolling substitution', () => {
    const layers = { 'builtin:backdrop': 'background', 'builtin:ident': 'fullframe', 'builtin:lineup': 'fullframe', 'builtin:stats': 'fullframe', 'builtin:goal': 'event', 'builtin:card': 'event', 'builtin:timeout': 'event', 'builtin:period_banner': 'lower', 'builtin:shootout': 'lower' };
    const eventTypes = futsalAdapter.eventTypes(STANDARD).map((e) => e.type);
    const v = validateGamePlan(FUTSAL_STARTER, { templateKeys: Object.keys(layers), templateLayers: layers, eventTypes });
    expect(v.ok).toBe(true);
    expect(FUTSAL_STARTER.playlists.some((p) => p.triggers.some((t) => t.type === 'event' && t.eventTypes.includes('substitution')))).toBe(false);
    const r = simulateRehearsal(FUTSAL_STARTER, STANDARD, syntheticTimeline('futsal'), { templateLayers: layers });
    const fired = r.decisions.filter((d) => d.outcome === 'fired').map((d) => d.playlistId);
    expect(fired).toEqual(expect.arrayContaining(['pre_match', 'players_entering', 'about_to_start', 'kickoff', 'goal', 'card', 'timeout', 'half_time', 'half_time_boards', 'second_half_entering', 'full_time']));
    const to = r.cues.filter((c) => c.playlistId === 'timeout' && c.action === 'show').map((c) => c.templateKey);
    expect(to).toEqual(['builtin:timeout', 'builtin:stats']);
  });
});
