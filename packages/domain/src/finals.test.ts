import { describe, expect, it } from 'vitest';
import { firstFinalsRound, knockoutWinner, nextFinalsRound, type FinalsFixture, type PlayedFinal } from './finals';
import { applyCommand, DomainError, getAdapter, type EngineState } from './engine';
import { SPORTS } from './types';
import { footballAdapter, type FootballConfig } from './sports/football';
import { futsalAdapter, type FutsalConfig } from './sports/futsal';
import type { SportAdapter } from './adapter';

const ladder = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'];
const pairs = (fx: FinalsFixture[]) => fx.map((f) => `${f.round}: ${f.homeTeamId} v ${f.awayTeamId}`);
/** every match won by the given side */
const play = (fx: FinalsFixture[], win: (f: FinalsFixture) => 'home' | 'away' = () => 'home'): PlayedFinal[] => fx.map((f) => ({ ...f, winner: win(f) }));

describe('finals series', () => {
  it('top 8: quarter-finals 1v8, 4v5, 2v7, 3v6, then semi-finals of neighbouring winners, then the Grand Final', () => {
    const qf = firstFinalsRound('top8', ladder);
    expect(pairs(qf)).toEqual(['Quarter-final: t1 v t8', 'Quarter-final: t4 v t5', 'Quarter-final: t2 v t7', 'Quarter-final: t3 v t6']);
    // the 8th and 5th placed teams cause upsets: the better-placed team still plays at home
    const sfNext = nextFinalsRound('top8', play(qf, (f) => (f.bracket.slot <= 2 ? 'away' : 'home')), ladder);
    expect(sfNext.kind).toBe('round');
    const sf = (sfNext as { fixtures: FinalsFixture[] }).fixtures;
    expect(pairs(sf)).toEqual(['Semi-final: t5 v t8', 'Semi-final: t2 v t3']);
    expect(sf[0]!.bracket).toMatchObject({ week: 2, slot: 1, seeds: { home: 5, away: 8 } });
    const gfNext = nextFinalsRound('top8', [...play(qf, (f) => (f.bracket.slot <= 2 ? 'away' : 'home')), ...play(sf, () => 'away')], ladder);
    const gf = (gfNext as { fixtures: FinalsFixture[] }).fixtures;
    expect(pairs(gf)).toEqual(['Grand Final: t3 v t8']);
    expect(nextFinalsRound('top8', [...play(qf), ...play(sf), ...play(gf, () => 'away')], ladder)).toEqual({ kind: 'done', championTeamId: 't8' });
  });

  it('top 4 semi-finals, top 2 straight to the Grand Final', () => {
    expect(pairs(firstFinalsRound('top4', ladder))).toEqual(['Semi-final: t1 v t4', 'Semi-final: t2 v t3']);
    const gf = nextFinalsRound('top4', play(firstFinalsRound('top4', ladder)), ladder);
    expect(pairs((gf as { fixtures: FinalsFixture[] }).fixtures)).toEqual(['Grand Final: t1 v t2']);
    expect(pairs(firstFinalsRound('top2', ladder))).toEqual(['Grand Final: t1 v t2']);
  });

  it('top 6: elimination finals 3v6 and 4v5; 1st meets the lower-placed winner, 2nd the other', () => {
    const ef = firstFinalsRound('top6', ladder);
    expect(pairs(ef)).toEqual(['Elimination final: t3 v t6', 'Elimination final: t4 v t5']);
    const sf = nextFinalsRound('top6', play(ef, (f) => (f.bracket.slot === 1 ? 'away' : 'home')), ladder);
    expect(pairs((sf as { fixtures: FinalsFixture[] }).fixtures)).toEqual(['Semi-final: t1 v t6', 'Semi-final: t2 v t4']);
  });

  it('waits for every match of the round to have a winner; a level score goes to the shoot-out', () => {
    const qf = firstFinalsRound('top8', ladder);
    const played = play(qf);
    played[2] = { ...played[2]!, winner: knockoutWinner({ home: 1, away: 1 }, null) };
    const r = nextFinalsRound('top8', played, ladder);
    expect(r.kind).toBe('waiting');
    expect((r as { unresolved: PlayedFinal[] }).unresolved.map((f) => f.homeTeamId)).toEqual(['t2']);
    expect(knockoutWinner({ home: 1, away: 1 }, { home: 3, away: 4 })).toBe('away');
    expect(knockoutWinner({ home: 2, away: 1 }, null)).toBe('home');
  });

  it('needs enough teams on the ladder', () => {
    expect(() => firstFinalsRound('top8', ladder.slice(0, 6))).toThrow(/needs 8 teams/);
  });
});

describe('knockout rules (a level score is decided)', () => {
  it('every sport but basketball has them; turning them on keeps rules that already decide a draw', () => {
    for (const sport of SPORTS) {
      const a = getAdapter(sport) as SportAdapter<Record<string, unknown>>;
      if (sport === 'basketball') {
        expect(a.knockout).toBeUndefined();
        continue;
      }
      const league = a.knockout!.set(a.defaultConfig, false);
      expect(a.knockout!.isOn(league), sport).toBe(false);
      const ko = a.knockout!.set(league, true);
      expect(a.knockout!.isOn(ko), sport).toBe(true);
      expect(a.configSchema.safeParse(ko).success, sport).toBe(true);
    }
    const shootoutOnly: FootballConfig = { ...footballAdapter.defaultConfig, extraTime: { ...footballAdapter.defaultConfig.extraTime, enabled: false }, shootout: { enabled: true } };
    expect(footballAdapter.knockout!.set(shootoutOnly, true)).toBe(shootoutOnly);
  });

  const run = <C>(adapter: SportAdapter<C>, cfg: C, state: EngineState, type: Parameters<typeof applyCommand>[4], payload: unknown) => applyCommand(adapter, cfg, state, [], type, payload, 2_000_000, null);

  it('a league match level at full time: knockout on makes extra time the next step', () => {
    const league: FootballConfig = footballAdapter.knockout!.set(footballAdapter.defaultConfig, false);
    const state: EngineState = { projection: { ...footballAdapter.initialProjection(league), phase: 'second_half', score: { home: 1, away: 1 } }, clocks: footballAdapter.initialClocks(league), sequence: 9 };
    expect(footballAdapter.allowedTransitions(league, state.projection)[0]).toBe('full_time');
    const r = run(footballAdapter, league, state, 'SET_KNOCKOUT', { on: true });
    expect(r).toMatchObject({ kind: 'rules', knockout: true, state });
    const ko = (r as { rulesConfig: FootballConfig }).rulesConfig;
    expect(footballAdapter.allowedTransitions(ko, state.projection)).toEqual(['extra_time_break', 'shootout', 'full_time', 'abandoned']);
  });

  it('futsal: the extra-time phases appear when knockout is turned on; it cannot be turned off during extra time or after the match', () => {
    const league: FutsalConfig = futsalAdapter.defaultConfig;
    const level = { ...futsalAdapter.initialProjection(league), phase: 'p2', score: { home: 2, away: 2 } };
    expect(futsalAdapter.allowedTransitions(league, level)).toEqual(['full_time', 'abandoned']);
    const r = run(futsalAdapter, league, { projection: level, clocks: futsalAdapter.initialClocks(league), sequence: 3 }, 'SET_KNOCKOUT', { on: true });
    const ko = (r as { rulesConfig: FutsalConfig }).rulesConfig;
    expect(futsalAdapter.allowedTransitions(ko, level)).toEqual(['extra_time_break', 'shootout', 'full_time', 'abandoned']);
    const inEt = { projection: { ...level, phase: 'et1' }, clocks: futsalAdapter.initialClocks(ko), sequence: 4 };
    expect(() => run(futsalAdapter, ko, inEt, 'SET_KNOCKOUT', { on: false })).toThrow(DomainError);
    const over = { projection: { ...level, phase: 'full_time' }, clocks: futsalAdapter.initialClocks(ko), sequence: 5 };
    expect(() => run(futsalAdapter, ko, over, 'SET_KNOCKOUT', { on: false })).toThrow(/match is over/);
    const bb = getAdapter('basketball');
    expect(() => run(bb, bb.defaultConfig, { projection: bb.initialProjection(bb.defaultConfig), clocks: bb.initialClocks(bb.defaultConfig), sequence: 0 }, 'SET_KNOCKOUT', { on: true })).toThrow(/always decides/);
  });
});
