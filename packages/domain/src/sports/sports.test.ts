import { describe, expect, it } from 'vitest';
import { applyCommand, DomainError, replay, type EngineState, type StoredFact } from '../engine';
import { footballAdapter, type FootballConfig } from './football';
import { basketballAdapter, type BasketballConfig } from './basketball';
import type { SportAdapter } from '../adapter';
import { clockDisplayMs } from '../clock';
import type { LineupSnapshot } from '../types';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lineup: LineupSnapshot = {
  home: [1, 2, 3].map((n) => ({ playerId: uuid(n), displayName: `Home ${n}`, starter: n < 3 })),
  away: [11, 12, 13].map((n) => ({ playerId: uuid(n), displayName: `Away ${n}`, starter: n < 13 })),
};

/** Minimal in-memory harness mirroring what the DB service persists. */
function harness<C>(adapter: SportAdapter<C>, cfg: C) {
  let state: EngineState = { projection: adapter.initialProjection(cfg), clocks: adapter.initialClocks(cfg), sequence: 0 };
  const log: StoredFact[] = [];
  let id = 100;
  const run = (type: Parameters<typeof applyCommand>[4], payload: unknown, now: number) => {
    const r = applyCommand(adapter, cfg, state, log, type, payload, now, lineup);
    if (r.kind === 'append') log.push({ ...r.entry, id: uuid(id++) });
    if (r.kind === 'correction') log.splice(log.findIndex((f) => f.id === r.factId), 1, r.updated);
    state = r.state;
    return r;
  };
  const phase = (to: string, now: number) => run('SET_PHASE', { to }, now);
  const fact = (type: string, side: 'home' | 'away' | null, now: number, extra: Record<string, unknown> = {}) =>
    run('ADD_FACT', { type, side, occurredAt: now, payload: {}, ...extra }, now);
  return { run, phase, fact, get state() { return state; }, log };
}

describe('football adapter (A07)', () => {
  const cfg = footballAdapter.defaultConfig as FootballConfig;

  it('plays a full match with own goal, penalty, cards, subs, extra time and shootout', () => {
    const h = harness(footballAdapter, cfg);
    let t = 1_000_000;
    for (const p of ['ready', 'pre_match', 'players_entering', 'about_to_start', 'first_half']) h.phase(p, (t += 1000));
    expect(h.state.clocks.main!.running).toBe(true);
    h.fact('goal', 'home', (t += 600_000), { playerId: uuid(1) });
    h.fact('own_goal', 'home', (t += 60_000), { playerId: uuid(2) }); // credits away
    h.fact('yellow_card', 'away', (t += 1000), { playerId: uuid(11) });
    h.fact('second_yellow', 'away', (t += 1000), { playerId: uuid(11) });
    h.phase('half_time', (t += 1000));
    expect(h.state.clocks.main!.running).toBe(false);
    h.phase('second_half', (t += 900_000));
    expect(clockDisplayMs(h.state.clocks.main!, t)).toBe(45 * 60_000);
    h.fact('substitution', 'home', (t += 1000), { payload: { playerOutId: uuid(1), playerInId: uuid(3) } });
    h.fact('penalty_scored', 'home', (t += 1000), { playerId: uuid(3) });
    h.fact('goal', 'away', (t += 1000));
    expect(h.state.projection.score).toEqual({ home: 2, away: 2 });
    // level after 90 minutes: extra time is the next step, then penalties; full time stays available
    expect(footballAdapter.allowedTransitions(cfg, h.state.projection)).toEqual(['extra_time_break', 'shootout', 'full_time', 'abandoned']);
    for (const p of ['extra_time_break', 'et_first_half', 'et_half_time', 'et_second_half']) h.phase(p, (t += 1000));
    expect(clockDisplayMs(h.state.clocks.main!, t)).toBe(105 * 60_000);
    h.phase('shootout', (t += 1000));
    // A normal goal is not allowed during the shootout
    expect(() => h.fact('goal', 'home', (t += 1000))).toThrow(DomainError);
    h.fact('shootout_kick', 'home', (t += 1000), { payload: { scored: true } });
    h.fact('shootout_kick', 'away', (t += 1000), { payload: { scored: false } });
    h.fact('shootout_kick', 'home', (t += 1000), { payload: { scored: true } });
    h.phase('full_time', (t += 1000));
    const p = h.state.projection;
    expect(p.score).toEqual({ home: 2, away: 2 }); // shootout never changes the match score
    expect(p.shootout).toMatchObject({ home: 2, away: 0 });
    expect(p.stats.away.red_cards).toBe(1);
    expect(p.players[uuid(11)]).toMatchObject({ yellow: 2, red: true });
    expect(p.players[uuid(2)]?.goals ?? 0).toBe(0); // own goal: responsible player preserved but no goal
    expect(p.players[uuid(3)]?.goals).toBe(1);
    // Replaying the stored log produces the same projection
    expect(replay(footballAdapter, cfg, h.log)).toEqual(p);
    // Full time is final
    expect(() => h.phase('first_half', (t += 1))).toThrow(/Cannot move/);
  });

  it('rejects impermissible transitions and out-of-phase facts', () => {
    const h = harness(footballAdapter, cfg);
    expect(() => h.phase('second_half', 1)).toThrow(/Cannot move/);
    expect(() => h.fact('goal', 'home', 2)).toThrow(/cannot be recorded/);
  });

  it('does not offer extra time when a team is ahead, and shows stoppage', () => {
    const h = harness(footballAdapter, cfg);
    h.phase('first_half', 0);
    h.fact('goal', 'home', 1000);
    const d = footballAdapter.display(cfg, h.state.projection, h.state.clocks, 47 * 60_000 + 12_000);
    expect(d.clockText).toBe('45:00');
    expect(d.stoppageText).toBe('+2:12');
    h.phase('half_time', 2_900_000);
    h.phase('second_half', 3_000_000);
    expect(footballAdapter.allowedTransitions(cfg, h.state.projection)).toEqual(['full_time', 'abandoned']);
  });

  it('allows an urgent goal without a player and rejects players outside the lineup', () => {
    const h = harness(footballAdapter, cfg);
    h.phase('first_half', 0);
    expect(() => h.fact('goal', 'home', 10)).not.toThrow();
    expect(() => h.fact('goal', 'home', 20, { playerId: uuid(11) })).toThrow(/lineup/);
  });

  it('voids and corrects facts with replay', () => {
    const h = harness(footballAdapter, cfg);
    h.phase('first_half', 0);
    const g = h.fact('goal', 'home', 10);
    h.fact('goal', 'away', 20);
    const goalId = h.log.find((f) => f.sequence === (g as { entry: { sequence: number } }).entry.sequence)!.id;
    h.run('CORRECT_FACT', { factId: goalId, reason: 'wrong team', changes: { side: 'away' } }, 30);
    expect(h.state.projection.score).toEqual({ home: 0, away: 2 });
    h.run('VOID_FACT', { factId: goalId, reason: 'disallowed by VAR' }, 40);
    expect(h.state.projection.score).toEqual({ home: 0, away: 1 });
    expect(() => h.run('VOID_FACT', { factId: goalId, reason: 'again' }, 50)).toThrow(/already been voided/);
    expect(h.log.find((f) => f.id === goalId)).toMatchObject({ voided: true, revision: 3 });
  });

  it('records explicit score adjustments as deltas', () => {
    const h = harness(footballAdapter, cfg);
    h.phase('first_half', 0);
    h.run('ADJUST_SCORE', { home: 3, away: 1, reason: 'scorer joined late' }, 10);
    h.fact('goal', 'home', 20);
    expect(h.state.projection.score).toEqual({ home: 4, away: 1 });
    expect(replay(footballAdapter, cfg, h.log).score).toEqual({ home: 4, away: 1 });
  });
});

describe('basketball adapter (A08)', () => {
  const cfg = basketballAdapter.defaultConfig as BasketballConfig;

  it('runs quarters, overtime, fouls, timeouts and shot clock with no unexpected clock mutation', () => {
    const h = harness(basketballAdapter, cfg);
    let t = 0;
    h.phase('p1', (t += 1000));
    expect(h.state.clocks.main!.running).toBe(false); // period clock waits for tip-off
    expect(clockDisplayMs(h.state.clocks.main!, t)).toBe(600_000);
    h.run('CLOCK_ACTION', { clockId: 'main', action: 'start' }, (t += 1000));
    expect(h.state.clocks.shot!.running).toBe(true);
    h.fact('score', 'home', (t += 10_000), { playerId: uuid(1), payload: { points: 3, resetShotClock: true } });
    expect(clockDisplayMs(h.state.clocks.shot!, t)).toBe(24_000);
    expect(clockDisplayMs(h.state.clocks.main!, t)).toBe(590_000); // main clock untouched by score
    const mainVersion = h.state.clocks.main!.version;
    h.fact('foul', 'away', (t += 1000), { playerId: uuid(11), payload: { foulType: 'personal' } });
    h.run('CLOCK_ACTION', { clockId: 'main', action: 'pause' }, (t += 1000));
    h.fact('timeout', 'away', (t += 1000));
    expect(h.state.clocks.main!.version).toBe(mainVersion + 1); // only the explicit pause changed it
    expect(h.state.projection.timeouts!.away).toBe(1);
    h.fact('timeout', 'away', (t += 1000));
    expect(() => h.fact('timeout', 'away', (t += 1000))).toThrow(/No timeouts/);
    for (let i = 0; i < 4; i++) h.fact('foul', 'home', (t += 100), { payload: { foulType: 'personal' } });
    expect(basketballAdapter.display(cfg, h.state.projection, h.state.clocks, t).bonus).toEqual({ home: true, away: false });
    h.phase('break_1', (t += 1000));
    h.phase('p2', (t += 1000));
    expect(h.state.projection.teamFouls).toEqual({ home: 0, away: 0 });
    h.phase('half_time', (t += 1000));
    h.phase('p3', (t += 1000));
    expect(h.state.projection.timeouts).toEqual({ home: 3, away: 3 });
    h.phase('break_3', (t += 1000));
    h.phase('p4', (t += 1000));
    h.fact('score', 'away', (t += 1000), { payload: { points: 2, resetShotClock: false } });
    h.fact('score', 'away', (t += 1000), { payload: { points: 1, resetShotClock: false } });
    expect(h.state.projection.score).toEqual({ home: 3, away: 3 });
    expect(basketballAdapter.allowedTransitions(cfg, h.state.projection)).toEqual(['break_ot1', 'abandoned']);
    h.phase('break_ot1', (t += 1000));
    h.phase('ot1', (t += 1000));
    expect(clockDisplayMs(h.state.clocks.main!, t)).toBe(300_000);
    h.fact('score', 'home', (t += 1000), { payload: { points: 2, resetShotClock: true } });
    h.phase('full_time', (t += 1000));
    expect(h.state.projection.score).toEqual({ home: 5, away: 3 });
    expect(h.state.projection.periodScores.ot1).toEqual({ home: 2, away: 0 });
    expect(replay(basketballAdapter, cfg, h.log)).toEqual(h.state.projection);
  });

  it('alerts at 0:00 but does not end the period', () => {
    const h = harness(basketballAdapter, cfg);
    h.phase('p1', 0);
    h.run('CLOCK_ACTION', { clockId: 'main', action: 'start' }, 0);
    const d = basketballAdapter.display(cfg, h.state.projection, h.state.clocks, 700_000);
    expect(d.clockText).toBe('0.0');
    expect(d.alerts.join(' ')).toMatch(/0:00/);
    expect(h.state.projection.phase).toBe('p1');
  });

  it('supports 2-half format', () => {
    const halves = basketballAdapter.presets.find((p) => p.id === 'halves-2x20')!.config;
    const h = harness(basketballAdapter, halves);
    h.phase('p1', 0);
    h.phase('half_time', 1);
    h.phase('p2', 2);
    expect(clockDisplayMs(h.state.clocks.main!, 2)).toBe(20 * 60_000);
    expect(basketballAdapter.allowedTransitions(halves, h.state.projection)).toContain('break_ot1');
  });

  it('validates score payloads', () => {
    const h = harness(basketballAdapter, cfg);
    h.phase('p1', 0);
    expect(() => h.fact('score', 'home', 1, { payload: { points: 4, resetShotClock: false } })).toThrow(DomainError);
    expect(() => h.fact('score', 'home', 1, { payload: { points: 2 } })).toThrow(DomainError);
  });
});
