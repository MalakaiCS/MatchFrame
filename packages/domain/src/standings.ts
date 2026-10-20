// League tables, form guides and head-to-head records, computed from completed results. Pure: callers load the
// results (and the competition's rules override) and get rows back. Nothing here is persisted.
import type { Sport } from './types';

export type TieBreaker = 'points' | 'win_pct' | 'difference' | 'for' | 'percentage' | 'wins' | 'head_to_head' | 'name';

export interface StandingsRules {
  win: number;
  draw: number;
  loss: number;
  /** points awarded for a bye (rugby league, AFL) */
  bye: number;
  /** rank by competition points (most sports) or by win percentage (basketball ladders) */
  rankBy: 'points' | 'win_pct';
  order: TieBreaker[];
  /** label used for the "for / against" columns */
  unit: 'goals' | 'points';
}

/** The conventions of each code's top-flight ladder. */
export const DEFAULT_STANDINGS_RULES: Record<Sport, StandingsRules> = {
  football: { win: 3, draw: 1, loss: 0, bye: 0, rankBy: 'points', order: ['points', 'difference', 'for', 'wins', 'head_to_head', 'name'], unit: 'goals' },
  basketball: { win: 2, draw: 0, loss: 0, bye: 0, rankBy: 'win_pct', order: ['win_pct', 'wins', 'head_to_head', 'difference', 'name'], unit: 'points' },
  netball: { win: 4, draw: 2, loss: 0, bye: 0, rankBy: 'points', order: ['points', 'percentage', 'difference', 'for', 'name'], unit: 'goals' },
  rugby_league: { win: 2, draw: 1, loss: 0, bye: 2, rankBy: 'points', order: ['points', 'difference', 'for', 'wins', 'name'], unit: 'points' },
  afl: { win: 4, draw: 2, loss: 0, bye: 4, rankBy: 'points', order: ['points', 'percentage', 'for', 'name'], unit: 'points' },
  hockey: { win: 3, draw: 1, loss: 0, bye: 0, rankBy: 'points', order: ['points', 'difference', 'for', 'wins', 'name'], unit: 'goals' },
};

export function standingsRules(sport: Sport, override: Partial<StandingsRules> | null | undefined): StandingsRules {
  const base = DEFAULT_STANDINGS_RULES[sport];
  const o = override ?? {};
  return { ...base, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) } as StandingsRules;
}

/** One completed (or forfeited) match as the table sees it. */
export interface StandingsResult {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  playedAt: string; // ISO
  round?: string | null;
  /** a bye is a result with awayTeamId === null */
  bye?: boolean;
}

export type Outcome = 'W' | 'D' | 'L';

export interface FormEntry {
  matchId: string;
  result: Outcome;
  opponentId: string;
  home: boolean;
  scored: number;
  conceded: number;
  playedAt: string;
}

export interface StandingRow {
  position: number;
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  byes: number;
  for: number;
  against: number;
  difference: number;
  /** for ÷ against × 100, as AFL and netball ladders print it (for ÷ 1 when nothing conceded) */
  percentage: number;
  points: number;
  winPct: number;
  /** most recent last */
  form: Outcome[];
  /** +N winning streak, -N losing streak, 0 after a draw */
  streak: number;
}

const outcome = (scored: number, conceded: number): Outcome => (scored > conceded ? 'W' : scored < conceded ? 'L' : 'D');

/** The results a team took part in, most recent first. */
export function teamResults(teamId: string, results: StandingsResult[]): FormEntry[] {
  return results
    .filter((r) => !r.bye && (r.homeTeamId === teamId || r.awayTeamId === teamId))
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt))
    .map((r) => {
      const home = r.homeTeamId === teamId;
      const scored = home ? r.homeScore : r.awayScore;
      const conceded = home ? r.awayScore : r.homeScore;
      return { matchId: r.matchId, result: outcome(scored, conceded), opponentId: home ? r.awayTeamId : r.homeTeamId, home, scored, conceded, playedAt: r.playedAt };
    });
}

/** Last `n` results, oldest first (the way a form strip reads). */
export function formGuide(teamId: string, results: StandingsResult[], n = 5): FormEntry[] {
  return teamResults(teamId, results).slice(0, n).reverse();
}

export interface HeadToHead {
  played: number;
  aWins: number;
  bWins: number;
  draws: number;
  aFor: number;
  bFor: number;
  /** most recent first */
  meetings: StandingsResult[];
}

export function headToHead(a: string, b: string, results: StandingsResult[], limit = 5): HeadToHead {
  const meetings = results
    .filter((r) => !r.bye && ((r.homeTeamId === a && r.awayTeamId === b) || (r.homeTeamId === b && r.awayTeamId === a)))
    .sort((x, y) => y.playedAt.localeCompare(x.playedAt));
  const h: HeadToHead = { played: meetings.length, aWins: 0, bWins: 0, draws: 0, aFor: 0, bFor: 0, meetings: meetings.slice(0, limit) };
  for (const m of meetings) {
    const aScore = m.homeTeamId === a ? m.homeScore : m.awayScore;
    const bScore = m.homeTeamId === a ? m.awayScore : m.homeScore;
    h.aFor += aScore;
    h.bFor += bScore;
    if (aScore > bScore) h.aWins++;
    else if (bScore > aScore) h.bWins++;
    else h.draws++;
  }
  return h;
}

function compareRows(x: StandingRow, y: StandingRow, rules: StandingsRules, results: StandingsResult[], names: Record<string, string>): number {
  for (const key of rules.order) {
    let d = 0;
    switch (key) {
      case 'points':
        d = y.points - x.points;
        break;
      case 'win_pct':
        d = y.winPct - x.winPct;
        break;
      case 'difference':
        d = y.difference - x.difference;
        break;
      case 'for':
        d = y.for - x.for;
        break;
      case 'percentage':
        d = y.percentage - x.percentage;
        break;
      case 'wins':
        d = y.won - x.won;
        break;
      case 'head_to_head': {
        const h = headToHead(x.teamId, y.teamId, results, 1000);
        d = h.bWins - h.aWins; // the team with more wins over the other ranks first
        break;
      }
      case 'name':
        d = (names[x.teamId] ?? x.teamId).localeCompare(names[y.teamId] ?? y.teamId);
        break;
    }
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Build the table for `teamIds` from `results`. Teams with no results appear with zeros so a pre-season table is
 * complete. `names` is used only for the final alphabetical tie-break.
 */
export function computeStandings(teamIds: string[], results: StandingsResult[], rules: StandingsRules, names: Record<string, string> = {}): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const id of teamIds)
    rows.set(id, { position: 0, teamId: id, played: 0, won: 0, drawn: 0, lost: 0, byes: 0, for: 0, against: 0, difference: 0, percentage: 0, points: 0, winPct: 0, form: [], streak: 0 });
  const chrono = [...results].sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const touch = (id: string) => {
    if (!rows.has(id)) rows.set(id, { position: 0, teamId: id, played: 0, won: 0, drawn: 0, lost: 0, byes: 0, for: 0, against: 0, difference: 0, percentage: 0, points: 0, winPct: 0, form: [], streak: 0 });
    return rows.get(id)!;
  };
  for (const r of chrono) {
    if (r.bye) {
      const t = touch(r.homeTeamId);
      t.byes++;
      t.points += rules.bye;
      continue;
    }
    const h = touch(r.homeTeamId);
    const a = touch(r.awayTeamId);
    const apply = (t: StandingRow, scored: number, conceded: number) => {
      t.played++;
      t.for += scored;
      t.against += conceded;
      const o = outcome(scored, conceded);
      if (o === 'W') {
        t.won++;
        t.points += rules.win;
        t.streak = t.streak > 0 ? t.streak + 1 : 1;
      } else if (o === 'L') {
        t.lost++;
        t.points += rules.loss;
        t.streak = t.streak < 0 ? t.streak - 1 : -1;
      } else {
        t.drawn++;
        t.points += rules.draw;
        t.streak = 0;
      }
      t.form.push(o);
    };
    apply(h, r.homeScore, r.awayScore);
    apply(a, r.awayScore, r.homeScore);
  }
  const out = [...rows.values()].map((t) => ({
    ...t,
    difference: t.for - t.against,
    percentage: t.against === 0 ? (t.for === 0 ? 0 : t.for * 100) : Math.round((t.for / t.against) * 10000) / 100,
    winPct: t.played === 0 ? 0 : Math.round(((t.won + t.drawn / 2) / t.played) * 10000) / 10000,
    form: t.form.slice(-5),
  }));
  const order = rules.rankBy === 'win_pct' && rules.order[0] !== 'win_pct' ? { ...rules, order: ['win_pct' as TieBreaker, ...rules.order] } : rules;
  out.sort((x, y) => compareRows(x, y, order, results, names));
  return out.map((t, i) => ({ ...t, position: i + 1 }));
}
