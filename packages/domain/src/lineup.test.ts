import { describe, expect, it } from 'vitest';
import { onField, substitutionProblem } from './lineup';
import type { LineupSnapshot, MatchProjection } from './types';

const lineup: LineupSnapshot = {
  home: [
    { playerId: 'h1', displayName: 'One', starter: true },
    { playerId: 'h2', displayName: 'Two', starter: true },
    { playerId: 'h12', displayName: 'Twelve', starter: false },
    { playerId: 'h13', displayName: 'Thirteen', starter: false },
  ],
  away: [],
};
const proj = (players: MatchProjection['players']): MatchProjection => ({ sport: 'football', rulesVersion: 'x', phase: 'first_half', score: { home: 0, away: 0 }, periodScores: {}, shootout: null, stats: { home: {}, away: {} }, players, lastFactSequence: 0, counters: {} });

describe('on-field tracking', () => {
  it('starts with the starters on and the bench off', () => {
    expect(onField(lineup, proj({}), 'home')).toEqual({ on: ['h1', 'h2'], off: ['h12', 'h13'], unavailable: [] });
  });
  it('moves players with substitutions and removes dismissed players', () => {
    const f = onField(lineup, proj({ h1: { onCourt: false }, h12: { onCourt: true }, h2: { red: true } }), 'home');
    expect(f).toEqual({ on: ['h12'], off: ['h13'], unavailable: ['h1', 'h2'] });
  });
  it('explains an invalid substitution', () => {
    const f = onField(lineup, proj({ h1: { onCourt: false }, h12: { onCourt: true } }), 'home');
    expect(substitutionProblem(f, 'h1', 'h13')).toMatch(/not on the field/);
    expect(substitutionProblem(f, 'h2', 'h12')).toMatch(/already on the field/);
    expect(substitutionProblem(f, 'h2', 'h1')).toMatch(/already been replaced/);
    expect(substitutionProblem(f, 'h2', 'h1', true)).toBeNull(); // rolling subs may return
    expect(substitutionProblem(f, 'h2', 'h13')).toBeNull();
  });
});
