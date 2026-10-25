import { describe, expect, it } from 'vitest';
import { computeStandings, formGuide, headToHead, standingsRules, type StandingsResult } from './standings';

const r = (id: string, h: string, a: string, hs: number, as: number, day: number): StandingsResult => ({ matchId: id, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as, playedAt: `2026-03-${String(day).padStart(2, '0')}T10:00:00Z` });
const results = [r('m1', 'A', 'B', 2, 0, 1), r('m2', 'C', 'D', 1, 1, 1), r('m3', 'B', 'C', 0, 3, 8), r('m4', 'D', 'A', 1, 2, 8), r('m5', 'A', 'C', 1, 1, 15)];
const names = { A: 'Albion', B: 'Bears', C: 'City', D: 'Dynamo' };

describe('standings', () => {
  it('awards football points and orders by points, difference, goals for', () => {
    const t = computeStandings(['A', 'B', 'C', 'D'], results, standingsRules('football', null), names);
    expect(t.map((x) => x.teamId)).toEqual(['A', 'C', 'D', 'B']);
    const a = t[0]!;
    expect(a).toMatchObject({ position: 1, played: 3, won: 2, drawn: 1, lost: 0, for: 5, against: 2, difference: 3, points: 7 });
    expect(a.form).toEqual(['W', 'W', 'D']);
    expect(t[3]).toMatchObject({ teamId: 'B', played: 2, lost: 2, points: 0, streak: -2 });
  });
  it('ranks basketball ladders by win percentage and AFL by percentage', () => {
    const bb = computeStandings(['A', 'B', 'C', 'D'], results, standingsRules('basketball', null), names);
    expect(bb[0]!.teamId).toBe('A');
    expect(bb[0]!.winPct).toBeCloseTo(0.8333, 3);
    const afl = computeStandings(['A', 'B', 'C', 'D'], results, standingsRules('afl', null), names);
    expect(afl[0]).toMatchObject({ teamId: 'A', points: 10, percentage: 250 });
    expect(afl.find((x) => x.teamId === 'C')!.percentage).toBe(250); // 5 for, 2 against
  });
  it('honours a competition override and byes', () => {
    const rules = standingsRules('rugby_league', { win: 3 });
    const withBye: StandingsResult[] = [...results, { matchId: 'bye', homeTeamId: 'B', awayTeamId: '', homeScore: 0, awayScore: 0, playedAt: '2026-03-20T00:00:00Z', bye: true }];
    const t = computeStandings(['A', 'B', 'C', 'D'], withBye, rules, names);
    expect(t.find((x) => x.teamId === 'A')!.points).toBe(7); // 2 wins × 3 + draw
    expect(t.find((x) => x.teamId === 'B')).toMatchObject({ byes: 1, points: 2, played: 2 });
  });
  it('lists teams with no results so a pre-season table is complete', () => {
    const t = computeStandings(['A', 'Z'], [], standingsRules('hockey', null), { A: 'Albion', Z: 'Zebras' });
    expect(t.map((x) => [x.teamId, x.played, x.position])).toEqual([['A', 0, 1], ['Z', 0, 2]]);
  });
  it('builds a form guide (oldest first) and head-to-head', () => {
    expect(formGuide('C', results).map((f) => f.result)).toEqual(['D', 'W', 'D']);
    const h = headToHead('A', 'C', results);
    expect(h).toMatchObject({ played: 1, aWins: 0, bWins: 0, draws: 1, aFor: 1, bFor: 1 });
    expect(h.meetings[0]!.matchId).toBe('m5');
  });
});
