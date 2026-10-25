// Finals series after the regular season: the top of the ladder plays knockout rounds (quarter-finals, semi-finals,
// a grand final…) and each round comes from the winners of the one before. The better-placed team is at home.
// Pure: the services read the ladder and the finals played so far and create the matches this returns.

export const FINALS_FORMATS = ['top2', 'top4', 'top6', 'top8'] as const;
export type FinalsFormat = (typeof FINALS_FORMATS)[number];

export const FINALS_FORMAT_INFO: Record<FinalsFormat, { label: string; teams: number; rounds: string[] }> = {
  top2: { label: 'Top 2: Grand Final', teams: 2, rounds: ['Grand Final'] },
  top4: { label: 'Top 4: semi-finals, then the Grand Final', teams: 4, rounds: ['Semi-final', 'Grand Final'] },
  top6: { label: 'Top 6: elimination finals (1st and 2nd have the week off), semi-finals, Grand Final', teams: 6, rounds: ['Elimination final', 'Semi-final', 'Grand Final'] },
  top8: { label: 'Top 8: quarter-finals, semi-finals, Grand Final', teams: 8, rounds: ['Quarter-final', 'Semi-final', 'Grand Final'] },
};

/** Names for a finals match added by hand. */
export const FINALS_ROUND_NAMES = ['Elimination final', 'Qualifying final', 'Quarter-final', 'Semi-final', 'Preliminary final', 'Third place play-off', 'Grand Final', 'Final'] as const;

/** Where a finals match sits in the series; kept on the match. */
export interface FinalsBracket {
  format: FinalsFormat | 'manual';
  /** 1 for the first finals round, 2 for the next… */
  week: number;
  /** order within the week: Semi-final 1, Semi-final 2 */
  slot: number;
  /** ladder positions of the two teams (1 = top) */
  seeds: { home: number; away: number };
}

export interface FinalsFixture {
  round: string;
  bracket: FinalsBracket;
  homeTeamId: string;
  awayTeamId: string;
}

export interface PlayedFinal {
  bracket: FinalsBracket;
  homeTeamId: string;
  awayTeamId: string;
  /** null while it is unplayed, or level with nothing to separate the teams */
  winner: 'home' | 'away' | null;
}

/** The winner of a finished knockout match: the score, then the shoot-out. Null when nothing separates them. */
export function knockoutWinner(score: { home: number; away: number }, shootout?: { home: number; away: number } | null): 'home' | 'away' | null {
  if (score.home !== score.away) return score.home > score.away ? 'home' : 'away';
  if (shootout && shootout.home !== shootout.away) return shootout.home > shootout.away ? 'home' : 'away';
  return null;
}

type Pair = [number, number];
/** seeds that meet in week 1 */
const FIRST: Record<FinalsFormat, Pair[]> = {
  top2: [[1, 2]],
  top4: [[1, 4], [2, 3]],
  top6: [[3, 6], [4, 5]],
  // 1 and 2 are on opposite sides of the draw, so they can only meet in the Grand Final
  top8: [[1, 8], [4, 5], [2, 7], [3, 6]],
};

function fixture(format: FinalsFormat, week: number, slot: number, a: { seed: number; teamId: string }, b: { seed: number; teamId: string }): FinalsFixture {
  const [home, away] = a.seed <= b.seed ? [a, b] : [b, a];
  // the round is the same for every match of the week ("Semi-final"), so fixtures group under it
  return { round: FINALS_FORMAT_INFO[format].rounds[week - 1]!, bracket: { format, week, slot, seeds: { home: home.seed, away: away.seed } }, homeTeamId: home.teamId, awayTeamId: away.teamId };
}

/** Week 1 of the finals from the ladder (team ids, top first). */
export function firstFinalsRound(format: FinalsFormat, ladder: string[]): FinalsFixture[] {
  const need = FINALS_FORMAT_INFO[format].teams;
  if (ladder.length < need) throw new Error(`${FINALS_FORMAT_INFO[format].label} needs ${need} teams on the ladder; there are ${ladder.length}`);
  const pairs = FIRST[format];
  return pairs.map(([x, y], i) => fixture(format, 1, i + 1, { seed: x, teamId: ladder[x - 1]! }, { seed: y, teamId: ladder[y - 1]! }));
}

export type NextFinals =
  | { kind: 'round'; week: number; fixtures: FinalsFixture[] }
  | { kind: 'waiting'; week: number; unresolved: PlayedFinal[] }
  | { kind: 'done'; championTeamId: string | null };

/**
 * What comes after the finals played so far (all of one format): the next round once every match of the latest
 * week has a winner; otherwise the matches still to be decided; or the champion after the last round.
 */
export function nextFinalsRound(format: FinalsFormat, played: PlayedFinal[], ladder: string[] = []): NextFinals {
  const mine = played.filter((f) => f.bracket.format === format);
  const week = Math.max(0, ...mine.map((f) => f.bracket.week));
  if (!week) return { kind: 'round', week: 1, fixtures: firstFinalsRound(format, ladder) };
  const latest = mine.filter((f) => f.bracket.week === week).sort((a, b) => a.bracket.slot - b.bracket.slot);
  const unresolved = latest.filter((f) => !f.winner);
  if (unresolved.length) return { kind: 'waiting', week, unresolved };
  const winners = latest.map((f) => (f.winner === 'home' ? { seed: f.bracket.seeds.home, teamId: f.homeTeamId } : { seed: f.bracket.seeds.away, teamId: f.awayTeamId }));
  const rounds = FINALS_FORMAT_INFO[format].rounds.length;
  if (week >= rounds) return { kind: 'done', championTeamId: winners.length === 1 ? winners[0]!.teamId : null };
  const next = week + 1;
  if (format === 'top6' && week === 1) {
    // 1st plays the lower-placed elimination-final winner, 2nd plays the other
    const [hi, lo] = [...winners].sort((a, b) => a.seed - b.seed) as [typeof winners[0], typeof winners[0]];
    const top = { seed: 1, teamId: ladder[0] ?? '' };
    const second = { seed: 2, teamId: ladder[1] ?? '' };
    if (!top.teamId || !second.teamId) throw new Error('The ladder is needed to place 1st and 2nd in the semi-finals');
    return { kind: 'round', week: next, fixtures: [fixture(format, next, 1, top, lo), fixture(format, next, 2, second, hi)] };
  }
  // winners of neighbouring matches meet: slot 1 v slot 2, slot 3 v slot 4
  const fixtures: FinalsFixture[] = [];
  for (let i = 0; i + 1 < winners.length; i += 2) fixtures.push(fixture(format, next, i / 2 + 1, winners[i]!, winners[i + 1]!));
  return { kind: 'round', week: next, fixtures };
}

/**
 * Rules for a competition's finals: its own finals rules when it has them, otherwise its rules with a level score
 * decided (extra time and penalties, a shoot-out, golden point: whatever the sport uses).
 */
export function finalsRules<C>(adapter: { knockout?: { set(cfg: C, on: boolean): C } }, rulesConfig: C, finalsRulesConfig?: C | null): C {
  if (finalsRulesConfig) return finalsRulesConfig;
  return adapter.knockout ? adapter.knockout.set(rulesConfig, true) : rulesConfig;
}
