import { describe, expect, it } from 'vitest';
import { applyCommand, type EngineState, type StoredFact } from '../engine';
import type { SportAdapter } from '../adapter';
import type { LineupSnapshot } from '../types';
import { clockDisplayMs } from '../clock';
import { netballAdapter, type NetballConfig } from './netball';
import { rugbyLeagueAdapter, type RugbyLeagueConfig } from './rugby-league';
import { aflAdapter, aflScoreLine, type AflConfig } from './afl';
import { hockeyAdapter, type HockeyConfig } from './hockey';
import { periodPhases, periodTransitions } from './periods';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lineup: LineupSnapshot = {
  home: [1, 2, 3].map((n) => ({ playerId: uuid(n), displayName: `Home ${n}`, starter: n < 3 })),
  away: [11, 12, 13].map((n) => ({ playerId: uuid(n), displayName: `Away ${n}`, starter: n < 13 })),
};

function harness<C>(adapter: SportAdapter<C>, cfg: C) {
  let state: EngineState = { projection: adapter.initialProjection(cfg), clocks: adapter.initialClocks(cfg), sequence: 0 };
  const log: StoredFact[] = [];
  let id = 100;
  const run = (type: Parameters<typeof applyCommand>[4], payload: unknown, now: number) => {
    const r = applyCommand(adapter, cfg, state, log, type, payload, now, lineup);
    if (r.kind === 'append') log.push({ ...r.entry, id: uuid(id++) });
    state = r.state;
    return r;
  };
  const phase = (to: string, now: number) => run('SET_PHASE', { to }, now);
  const fact = (type: string, side: 'home' | 'away' | null, now: number, extra: Record<string, unknown> = {}) => run('ADD_FACT', { type, side, occurredAt: now, payload: {}, ...extra }, now);
  const display = (now: number) => adapter.display(cfg, state.projection, state.clocks, now);
  return { run, phase, fact, display, get state() { return state; } };
}

describe('period phase model', () => {
  it('builds quarters with a second-half walk-out and offers extra time only when level', () => {
    const spec = { count: 4, period: (n: number) => ({ label: `Q${n}`, short: `Q${n}` }), interval: (n: number, half: boolean) => ({ label: half ? 'HT' : `B${n}`, short: half ? 'HT' : `B${n}` }), extra: { count: 2, period: (k: number) => ({ label: `ET${k}`, short: `ET${k}` }), beforeLabel: 'Before ET' }, shootout: null, final: { label: 'FT', short: 'FT' } };
    const ids = periodPhases(spec).map((p) => p.id);
    expect(ids).toEqual(['scheduled', 'ready', 'pre_match', 'players_entering', 'about_to_start', 'p1', 'break_1', 'p2', 'half_time', 'second_half_entering', 'second_half_ready', 'p3', 'break_3', 'p4', 'extra_time_break', 'et1', 'et_break_1', 'et2', 'full_time', 'postponed', 'abandoned', 'cancelled']);
    const base = netballAdapter.initialProjection({} as never);
    expect(periodTransitions(spec, { ...base, phase: 'p4', score: { home: 1, away: 1 } }, { extraTime: true, shootout: false })).toEqual(['extra_time_break', 'full_time', 'abandoned']);
    expect(periodTransitions(spec, { ...base, phase: 'p4', score: { home: 2, away: 1 } }, { extraTime: true, shootout: false })).toEqual(['full_time', 'abandoned']);
    expect(periodTransitions(spec, { ...base, phase: 'half_time' }, { extraTime: true, shootout: false })).toEqual(['second_half_entering', 'second_half_ready', 'p3', 'abandoned']);
  });
});

describe('netball', () => {
  it('counts down, scores one or two, and refuses the super shot when the competition does not use it', () => {
    const cfg = netballAdapter.defaultConfig as NetballConfig;
    const h = harness(netballAdapter, cfg);
    let t = 1_000_000;
    h.phase('p1', (t += 1000));
    expect(h.state.clocks.main!.running).toBe(true);
    expect(clockDisplayMs(h.state.clocks.main!, t + 60_000)).toBe(14 * 60_000);
    h.fact('goal', 'home', (t += 5000), { playerId: uuid(1) });
    h.fact('goal_missed', 'home', (t += 5000));
    expect(() => h.fact('goal', 'away', (t += 5000), { payload: { points: 2 } })).toThrow(/super shot/);
    expect(h.state.projection.stats.home).toMatchObject({ goals: 1, attempts: 2 });
    const ss = harness(netballAdapter, { ...cfg, superShot: true });
    ss.phase('p1', 1);
    ss.fact('goal', 'away', 2, { payload: { points: 2 } });
    expect(ss.state.projection.score).toEqual({ home: 0, away: 2 });
    expect(ss.state.projection.stats.away).toMatchObject({ goals: 2, super_shots: 1, attempts: 1 });
    expect(ss.display(1).clockText).toBe('15:00');
  });
});

describe('rugby league', () => {
  it('scores tries, conversions and field goals, caps interchange and offers golden point when level', () => {
    const cfg = { ...(rugbyLeagueAdapter.defaultConfig as RugbyLeagueConfig), interchangeLimit: 1, goldenPoint: { ...(rugbyLeagueAdapter.defaultConfig as RugbyLeagueConfig).goldenPoint, enabled: true, periodMinutes: 5 } };
    const h = harness(rugbyLeagueAdapter, cfg);
    let t = 1_000_000;
    h.phase('p1', (t += 1000));
    h.fact('try', 'home', (t += 1000), { playerId: uuid(1) });
    h.fact('conversion', 'home', (t += 1000), { playerId: uuid(2) });
    h.fact('field_goal', 'away', (t += 1000), { payload: { points: 2 } });
    h.fact('penalty_goal', 'away', (t += 1000));
    h.fact('penalty_goal', 'away', (t += 1000));
    expect(h.state.projection.score).toEqual({ home: 6, away: 6 });
    expect(h.state.projection.players[uuid(1)]).toMatchObject({ points: 4, breakdown: { tries: 1 } });
    expect(h.fact('interchange', 'home', (t += 1000), { payload: { playerOutId: uuid(1), playerInId: uuid(3) } }).kind).toBe('append');
    expect(() => h.fact('interchange', 'home', (t += 1000), { payload: { playerOutId: uuid(3), playerInId: uuid(1) } })).toThrow(/interchanges have been used/);
    h.fact('sin_bin', 'away', (t += 1000), { playerId: uuid(11) });
    h.phase('half_time', (t += 1000));
    h.phase('p2', (t += 1000));
    expect(clockDisplayMs(h.state.clocks.main!, t)).toBe(40 * 60_000); // second half counts on from 40:00
    expect(rugbyLeagueAdapter.allowedTransitions(cfg, h.state.projection)).toEqual(['extra_time_break', 'full_time', 'abandoned']);
  });
});

describe('AFL', () => {
  it('reads goals.behinds (total) and keeps the time-on clock counting', () => {
    const cfg = aflAdapter.defaultConfig as AflConfig;
    const h = harness(aflAdapter, cfg);
    let t = 1_000_000;
    h.phase('p1', (t += 1000));
    const start = t;
    h.fact('goal', 'home', (t += 1000), { playerId: uuid(1) });
    h.fact('goal', 'home', (t += 1000), { playerId: uuid(1) });
    h.fact('behind', 'home', (t += 1000), { playerId: uuid(2) });
    h.fact('rushed_behind', 'away', (t += 1000));
    expect(h.state.projection.score).toEqual({ home: 13, away: 1 });
    expect(h.display(t).scoreDetail).toEqual({ home: '2.1 (13)', away: '0.1 (1)' });
    expect(aflScoreLine(12, 7)).toBe('12.7 (79)');
    expect(h.state.projection.players[uuid(1)]).toMatchObject({ goals: 2, points: 12 });
    expect(h.display(start + 25 * 60_000).clockText).toBe('25:00'); // time-on keeps running past 20:00
    expect(h.display(t).periodShort).toBe('Q1');
  });
});

describe('hockey', () => {
  it('handles cards, penalty corners, rolling substitutions and a shoot-out', () => {
    const cfg = { ...(hockeyAdapter.defaultConfig as HockeyConfig), shootout: { enabled: true } };
    const h = harness(hockeyAdapter, cfg);
    let t = 1_000_000;
    for (const p of ['p1', 'break_1', 'p2', 'half_time', 'p3', 'break_3', 'p4']) h.phase(p, (t += 1000));
    h.fact('goal', 'home', (t += 1000), { playerId: uuid(1), payload: { goalType: 'penalty_corner', assistId: uuid(2) } });
    h.fact('goal', 'away', (t += 1000), { playerId: uuid(11) });
    h.fact('green_card', 'away', (t += 1000), { playerId: uuid(12) });
    h.fact('penalty_corner', 'home', (t += 1000));
    expect(h.fact('substitution', 'home', (t += 1000), { payload: { playerOutId: uuid(1), playerInId: uuid(3) } }).kind).toBe('append');
    expect(h.fact('substitution', 'home', (t += 1000), { payload: { playerOutId: uuid(3), playerInId: uuid(1) } }).kind).toBe('append'); // rolling: may return
    expect(h.state.projection.players[uuid(2)]).toMatchObject({ assists: 1 });
    expect(h.state.projection.stats.away).toMatchObject({ green_cards: 1 });
    expect(hockeyAdapter.allowedTransitions(cfg, h.state.projection)).toEqual(['shootout', 'full_time', 'abandoned']);
    h.phase('shootout', (t += 1000));
    expect(() => h.fact('goal', 'home', (t += 1000))).toThrow(/shoot-out/);
    h.fact('shootout_stroke', 'home', (t += 1000), { payload: { scored: true } });
    h.fact('shootout_stroke', 'away', (t += 1000), { payload: { scored: false } });
    expect(h.display(t)).toMatchObject({ clockText: 'SO', shootout: { home: 1, away: 0 }, score: { home: 1, away: 1 } });
  });
});

describe('football assists and on-field rules', () => {
  it('records an assist, refuses the scorer as assist, and blocks a replaced player returning', async () => {
    const { footballAdapter } = await import('./football');
    const h = harness(footballAdapter, footballAdapter.defaultConfig);
    let t = 1_000_000;
    h.phase('first_half', (t += 1000));
    expect(() => h.fact('goal', 'home', (t += 1000), { playerId: uuid(1), payload: { assistId: uuid(1) } })).toThrow(/cannot also be the assist/);
    h.fact('goal', 'home', (t += 1000), { playerId: uuid(1), payload: { assistId: uuid(2), goalType: 'header' } });
    expect(h.state.projection.players[uuid(2)]).toMatchObject({ assists: 1 });
    expect(h.state.projection.stats.home).toMatchObject({ goals: 1, assists: 1 });
    h.fact('substitution', 'home', (t += 1000), { payload: { playerOutId: uuid(1), playerInId: uuid(3) } });
    expect(() => h.fact('substitution', 'home', (t += 1000), { payload: { playerOutId: uuid(3), playerInId: uuid(1) } })).toThrow(/already been replaced/); // no rolling subs
    expect(() => h.fact('substitution', 'home', (t += 1000), { payload: { playerOutId: uuid(2), playerInId: uuid(3) } })).toThrow(/already on the field/);
  });
});
