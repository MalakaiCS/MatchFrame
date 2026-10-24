// Where a penalty shoot-out stands, from its kicks: the round (kick N of the first five, or sudden death), who kicks
// next, whether the next kick can win it or must be scored to stay in, and when it is decided: as soon as one team
// can no longer be caught with the kicks it has left, or a sudden-death pair is split. Kicks alternate in the order
// the first one set; football, futsal and hockey use it alike.
import type { MatchProjection, Side } from './types';

type Kick = { side: Side; scored: boolean };
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

export interface ShootoutStatus {
  /** kicks each before sudden death */
  rounds: number;
  taken: Record<Side, number>;
  scored: Record<Side, number>;
  /** the team that kicked first (null before the first kick) */
  first: Side | null;
  /** who kicks next; null once decided or before the first kick */
  next: Side | null;
  /** the round the next kick belongs to, or of the last kick once decided (1-based; 0 before any kick) */
  round: number;
  suddenDeath: boolean;
  winner: Side | null;
  /** the next kick decides: scored wins it (`to_win`), or missed loses it (`to_survive`) */
  pressure: { side: Side; kind: 'to_win' | 'to_survive' } | null;
}

/** Kicks each before sudden death: the rules' own number (futsal), otherwise five. */
export const shootoutRounds = (rulesConfig: unknown): number => {
  const n = Number((rulesConfig as { shootout?: { kicks?: unknown } } | null)?.shootout?.kicks);
  return Number.isInteger(n) && n > 0 ? n : 5;
};

function decide(kicks: Kick[], rounds: number): Side | null {
  const taken = { home: 0, away: 0 };
  const scored = { home: 0, away: 0 };
  for (const k of kicks) {
    taken[k.side]++;
    if (k.scored) scored[k.side]++;
  }
  if (taken.home <= rounds && taken.away <= rounds) {
    const left = { home: rounds - taken.home, away: rounds - taken.away };
    if (scored.home + left.home < scored.away) return 'away';
    if (scored.away + left.away < scored.home) return 'home';
    return null;
  }
  // sudden death: decided when a pair is complete and split
  if (taken.home === taken.away && scored.home !== scored.away) return scored.home > scored.away ? 'home' : 'away';
  return null;
}

export function shootoutStatus(shootout: Pick<NonNullable<MatchProjection['shootout']>, 'kicks'> | null | undefined, rules: number | unknown = 5): ShootoutStatus {
  const rounds = typeof rules === 'number' ? rules : shootoutRounds(rules);
  const kicks: Kick[] = (shootout?.kicks ?? []).map((k) => ({ side: k.side, scored: k.scored }));
  const taken = { home: 0, away: 0 };
  const scored = { home: 0, away: 0 };
  // decided at the first kick that settles it; anything recorded after that does not reopen it
  let winner: Side | null = null;
  for (let i = 0; i < kicks.length && !winner; i++) {
    const k = kicks[i]!;
    taken[k.side]++;
    if (k.scored) scored[k.side]++;
    winner = decide(kicks.slice(0, i + 1), rounds);
  }
  for (const k of kicks.slice(taken.home + taken.away)) {
    taken[k.side]++;
    if (k.scored) scored[k.side]++;
  }
  const first = kicks[0]?.side ?? null;
  const next: Side | null = winner || !first ? null : taken.home === taken.away ? first : taken.home < taken.away ? 'home' : 'away';
  const round = next ? taken[next] + 1 : Math.max(taken.home, taken.away);
  let pressure: ShootoutStatus['pressure'] = null;
  if (next) {
    if (decide([...kicks, { side: next, scored: false }], rounds) === other(next)) pressure = { side: next, kind: 'to_survive' };
    else if (decide([...kicks, { side: next, scored: true }], rounds) === next) pressure = { side: next, kind: 'to_win' };
  }
  return { rounds, taken, scored, first, next, round, suddenDeath: round > rounds, winner, pressure };
}

/** One line on where the shoot-out stands, e.g. "Kick 4 of 5", "Sudden death · round 7", "France must score to stay in". */
export function shootoutLine(st: ShootoutStatus, names: Record<Side, string>): string {
  if (st.winner) return `${names[st.winner]} win ${Math.max(st.scored.home, st.scored.away)}–${Math.min(st.scored.home, st.scored.away)} on penalties`;
  if (!st.first) return `Best of ${st.rounds}, then sudden death`;
  if (st.pressure) return st.pressure.kind === 'to_survive' ? `${names[st.pressure.side]} must score to stay in` : `${names[st.pressure.side]} score to win`;
  return st.suddenDeath ? `Sudden death · round ${st.round}` : `Kick ${st.round} of ${st.rounds}`;
}
