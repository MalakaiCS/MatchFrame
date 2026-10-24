// The scorer's event pad: for each sport, its sections from top to bottom (scoring first, then the run of play, the
// officials, discipline and the team's own changes). Each row records one event for either team and shows how many
// each has: the team statistic the event counts towards when there is one, otherwise how many times it was
// recorded. Cards are a row of their own kinds; possession is a row that marks who has the ball. Labels come from
// the sport's events.
import type { Sport } from './types';

export type SheetRow =
  /** one event; `stat` is the team statistic its count reads (none: the times it was recorded) */
  | { kind: 'event'; type: string; stat?: string }
  /** the cards (yellow and red; hockey also green; rugby league's sin bin and send-off) */
  | { kind: 'cards'; cards: { type: string; stat?: string }[] }
  /** who has the ball, timed by the match clock (see possession.ts) */
  | { kind: 'possession' };

/** A titled group of rows on the pad. */
export interface SheetSection {
  title: string;
  rows: SheetRow[];
}

const ev = (type: string, stat?: string): SheetRow => ({ kind: 'event', type, stat });
const POSSESSION: SheetSection = { title: 'Possession', rows: [{ kind: 'possession' }] };
const section = (title: string, ...rows: SheetRow[]): SheetSection => ({ title, rows });

export const SCORER_SHEETS: Partial<Record<Sport, SheetSection[]>> = {
  football: [
    section('Score', ev('goal'), ev('own_goal'), ev('penalty_scored'), ev('penalty_missed')),
    POSSESSION,
    section('Attack', ev('shot_on_target', 'shots_on_target'), ev('shot_off_target', 'shots_off_target'), ev('corner', 'corners'), ev('offside', 'offsides')),
    section('Defence', ev('save', 'saves'), ev('foul', 'fouls')),
    section('Discipline', { kind: 'cards', cards: [{ type: 'yellow_card', stat: 'yellow_cards' }, { type: 'red_card', stat: 'red_cards' }] }),
    section('Team', ev('substitution')),
  ],
  futsal: [
    section('Score', ev('goal'), ev('own_goal'), ev('penalty_scored'), ev('penalty_missed'), ev('ten_metre_scored'), ev('ten_metre_missed')),
    POSSESSION,
    section('Attack', ev('shot_on_target', 'shots_on_target'), ev('shot_off_target', 'shots_off_target'), ev('corner', 'corners')),
    section('Defence', ev('save', 'saves'), ev('foul', 'fouls')),
    section('Discipline', { kind: 'cards', cards: [{ type: 'yellow_card', stat: 'yellow_cards' }, { type: 'red_card', stat: 'red_cards' }] }),
    section('Team', ev('timeout'), ev('substitution')),
  ],
  hockey: [
    section('Score', ev('goal', 'goals'), ev('penalty_stroke_missed')),
    POSSESSION,
    section('Attack', ev('shot', 'shots'), ev('penalty_corner', 'penalty_corners'), ev('circle_entry', 'circle_entries')),
    section('Discipline', { kind: 'cards', cards: [{ type: 'green_card', stat: 'green_cards' }, { type: 'yellow_card', stat: 'yellow_cards' }, { type: 'red_card', stat: 'red_cards' }] }),
    section('Team', ev('substitution')),
  ],
  rugby_league: [
    section('Score', ev('try'), ev('penalty_try'), ev('conversion'), ev('conversion_missed'), ev('penalty_goal'), ev('field_goal')),
    POSSESSION,
    section('Play', ev('line_break', 'line_breaks'), ev('error', 'errors'), ev('penalty_conceded', 'penalties'), ev('six_again', 'six_agains')),
    section('Officials', ev('video_review')),
    section('Discipline', { kind: 'cards', cards: [{ type: 'sin_bin', stat: 'sin_bins' }, { type: 'send_off', stat: 'send_offs' }] }),
    section('Team', ev('interchange')),
  ],
  afl: [
    section('Score', ev('goal'), ev('behind'), ev('rushed_behind')),
    section('Play', ev('mark', 'marks'), ev('tackle', 'tackles'), ev('inside_50', 'inside_50s'), ev('clearance', 'clearances'), ev('free_kick', 'free_kicks')),
    section('Team', ev('interchange')),
  ],
  netball: [
    section('Score', ev('goal'), ev('goal_missed')),
    section('Play', ev('centre_pass'), ev('intercept', 'intercepts'), ev('rebound', 'rebounds'), ev('turnover', 'turnovers'), ev('penalty', 'penalties')),
    section('Team', ev('substitution')),
  ],
};

/** The pad for a sport; basketball keeps its court layout (points buttons, fouls by type, the arrow). */
export const scorerSheet = (sport: string): SheetSection[] | null => SCORER_SHEETS[sport as Sport] ?? null;

/** Every row of a pad, in order. */
export const sheetRows = (sections: SheetSection[]): SheetRow[] => sections.flatMap((x) => x.rows);

/** The events a sheet records, in order. */
export const sheetEvents = (rows: SheetRow[]): string[] => rows.flatMap((r) => (r.kind === 'event' ? [r.type] : r.kind === 'cards' ? r.cards.map((c) => c.type) : []));

/** A row's count for one team: its statistic, else how many times the event was recorded. */
export function sheetCount(p: { stats: Record<'home' | 'away', Record<string, number>>; tally?: Record<'home' | 'away', Record<string, number>> }, side: 'home' | 'away', type: string, stat?: string): number {
  return stat ? (p.stats[side]?.[stat] ?? 0) : (p.tally?.[side]?.[type] ?? 0);
}
