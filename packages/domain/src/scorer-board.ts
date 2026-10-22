// The scorer's sheet: for each sport, the rows of the live screen from top to bottom. Each row records one event
// for either team (home on the left half, away on the right) and shows how many each has: the team statistic the
// event counts towards when there is one, otherwise how many times it was recorded. Cards share one row; possession
// is a row that marks who has the ball. Labels come from the sport's events.
import type { Sport } from './types';

export type SheetRow =
  /** one event; `stat` is the team statistic its count reads (none: the times it was recorded) */
  | { kind: 'event'; type: string; stat?: string }
  /** the cards, side by side in one row (yellow and red; hockey also green) */
  | { kind: 'cards'; cards: { type: string; stat?: string }[] }
  /** who has the ball, timed by the match clock (see possession.ts) */
  | { kind: 'possession' };

const ev = (type: string, stat?: string): SheetRow => ({ kind: 'event', type, stat });
const POSSESSION: SheetRow = { kind: 'possession' };

export const SCORER_SHEETS: Partial<Record<Sport, SheetRow[]>> = {
  football: [
    ev('goal'),
    POSSESSION,
    ev('shot_off_target', 'shots_off_target'),
    ev('shot_on_target', 'shots_on_target'),
    ev('save', 'saves'),
    ev('corner', 'corners'),
    ev('foul', 'fouls'),
    ev('penalty_scored'),
    ev('penalty_missed'),
    { kind: 'cards', cards: [{ type: 'yellow_card', stat: 'yellow_cards' }, { type: 'red_card', stat: 'red_cards' }] },
    ev('offside', 'offsides'),
    ev('substitution'),
    ev('own_goal'),
  ],
  futsal: [
    ev('goal'),
    POSSESSION,
    ev('shot_off_target', 'shots_off_target'),
    ev('shot_on_target', 'shots_on_target'),
    ev('save', 'saves'),
    ev('corner', 'corners'),
    ev('foul', 'fouls'),
    ev('penalty_scored'),
    ev('penalty_missed'),
    ev('ten_metre_scored'),
    ev('ten_metre_missed'),
    { kind: 'cards', cards: [{ type: 'yellow_card', stat: 'yellow_cards' }, { type: 'red_card', stat: 'red_cards' }] },
    ev('timeout'),
    ev('substitution'),
    ev('own_goal'),
  ],
  hockey: [
    ev('goal', 'goals'),
    POSSESSION,
    ev('shot', 'shots'),
    ev('penalty_corner', 'penalty_corners'),
    ev('circle_entry', 'circle_entries'),
    ev('penalty_stroke_missed'),
    { kind: 'cards', cards: [{ type: 'green_card', stat: 'green_cards' }, { type: 'yellow_card', stat: 'yellow_cards' }, { type: 'red_card', stat: 'red_cards' }] },
    ev('substitution'),
  ],
  rugby_league: [
    ev('try'),
    ev('conversion'),
    ev('conversion_missed'),
    ev('penalty_goal'),
    ev('field_goal'),
    POSSESSION,
    ev('line_break', 'line_breaks'),
    ev('error', 'errors'),
    ev('penalty_conceded', 'penalties'),
    ev('six_again', 'six_agains'),
    { kind: 'cards', cards: [{ type: 'sin_bin', stat: 'sin_bins' }, { type: 'send_off', stat: 'send_offs' }] },
    ev('interchange'),
    ev('penalty_try'),
  ],
  afl: [
    ev('goal'),
    ev('behind'),
    ev('rushed_behind'),
    ev('mark', 'marks'),
    ev('tackle', 'tackles'),
    ev('inside_50', 'inside_50s'),
    ev('clearance', 'clearances'),
    ev('free_kick', 'free_kicks'),
    ev('interchange'),
  ],
  netball: [
    ev('goal'),
    ev('goal_missed'),
    ev('intercept', 'intercepts'),
    ev('rebound', 'rebounds'),
    ev('turnover', 'turnovers'),
    ev('penalty', 'penalties'),
    ev('centre_pass'),
    ev('substitution'),
  ],
};

/** The sheet for a sport; basketball keeps its court layout (points buttons, fouls by type, the arrow). */
export const scorerSheet = (sport: string): SheetRow[] | null => SCORER_SHEETS[sport as Sport] ?? null;

/** The events a sheet records, in order. */
export const sheetEvents = (rows: SheetRow[]): string[] => rows.flatMap((r) => (r.kind === 'event' ? [r.type] : r.kind === 'cards' ? r.cards.map((c) => c.type) : []));

/** A row's count for one team: its statistic, else how many times the event was recorded. */
export function sheetCount(p: { stats: Record<'home' | 'away', Record<string, number>>; tally?: Record<'home' | 'away', Record<string, number>> }, side: 'home' | 'away', type: string, stat?: string): number {
  return stat ? (p.stats[side]?.[stat] ?? 0) : (p.tally?.[side]?.[type] ?? 0);
}
