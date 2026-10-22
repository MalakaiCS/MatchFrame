// The scorer's two team columns: for each sport, what each team's column offers in order: the scoring buttons,
// then one row per statistic with its live count (the team statistic the event counts towards), possession
// where the sport keeps it, cards, and the rarer events under "More". Labels come from the sport's events.
import type { Sport } from './types';

export interface BoardRow {
  /** the event the row records */
  type: string;
  /** shown on the row, plural like the count it shows ("Shots on target") */
  label: string;
  /** the team statistic the row's count reads; none for events that are not counted */
  stat?: string;
}

export interface ScorerBoard {
  /** big buttons at the top of each column */
  scoring: string[];
  /** counted rows, in this order */
  rows: BoardRow[];
  /** the rest, behind "More" in each column */
  more: string[];
  /** possession by time: a row that marks who has the ball and shows the share */
  possession: boolean;
}

export const SCORER_BOARDS: Partial<Record<Sport, ScorerBoard>> = {
  football: {
    scoring: ['goal'],
    rows: [
      { type: 'shot_on_target', label: 'Shots on target', stat: 'shots_on_target' },
      { type: 'shot_off_target', label: 'Shots off target', stat: 'shots_off_target' },
      { type: 'foul', label: 'Fouls', stat: 'fouls' },
      { type: 'yellow_card', label: 'Yellow cards', stat: 'yellow_cards' },
      { type: 'red_card', label: 'Red cards', stat: 'red_cards' },
      { type: 'offside', label: 'Offsides', stat: 'offsides' },
      { type: 'corner', label: 'Corners', stat: 'corners' },
      { type: 'save', label: 'Saves', stat: 'saves' },
    ],
    more: ['penalty_scored', 'own_goal', 'penalty_missed', 'second_yellow', 'substitution'],
    possession: true,
  },
  futsal: {
    scoring: ['goal'],
    rows: [
      { type: 'shot_on_target', label: 'Shots on target', stat: 'shots_on_target' },
      { type: 'shot_off_target', label: 'Shots off target', stat: 'shots_off_target' },
      { type: 'foul', label: 'Fouls', stat: 'fouls' },
      { type: 'yellow_card', label: 'Yellow cards', stat: 'yellow_cards' },
      { type: 'red_card', label: 'Red cards', stat: 'red_cards' },
      { type: 'corner', label: 'Corners', stat: 'corners' },
      { type: 'save', label: 'Saves', stat: 'saves' },
    ],
    more: ['penalty_scored', 'ten_metre_scored', 'own_goal', 'penalty_missed', 'ten_metre_missed', 'second_yellow', 'substitution', 'timeout'],
    possession: true,
  },
  hockey: {
    scoring: ['goal'],
    rows: [
      { type: 'shot', label: 'Shots', stat: 'shots' },
      { type: 'penalty_corner', label: 'Penalty corners', stat: 'penalty_corners' },
      { type: 'circle_entry', label: 'Circle entries', stat: 'circle_entries' },
      { type: 'green_card', label: 'Green cards', stat: 'green_cards' },
      { type: 'yellow_card', label: 'Yellow cards', stat: 'yellow_cards' },
      { type: 'red_card', label: 'Red cards', stat: 'red_cards' },
    ],
    more: ['penalty_stroke_missed', 'substitution'],
    possession: true,
  },
  rugby_league: {
    scoring: ['try', 'conversion'],
    rows: [
      { type: 'penalty_goal', label: 'Penalty goals', stat: 'penalty_goals' },
      { type: 'field_goal', label: 'Field goals', stat: 'field_goals' },
      { type: 'line_break', label: 'Line breaks', stat: 'line_breaks' },
      { type: 'error', label: 'Errors', stat: 'errors' },
      { type: 'penalty_conceded', label: 'Penalties conceded', stat: 'penalties' },
      { type: 'six_again', label: 'Six agains', stat: 'six_agains' },
      { type: 'sin_bin', label: 'Sin bins', stat: 'sin_bins' },
      { type: 'send_off', label: 'Send offs', stat: 'send_offs' },
    ],
    more: ['penalty_try', 'conversion_missed', 'interchange'],
    possession: true,
  },
  afl: {
    scoring: ['goal', 'behind'],
    rows: [
      { type: 'mark', label: 'Marks', stat: 'marks' },
      { type: 'tackle', label: 'Tackles', stat: 'tackles' },
      { type: 'inside_50', label: 'Inside 50s', stat: 'inside_50s' },
      { type: 'clearance', label: 'Clearances', stat: 'clearances' },
      { type: 'free_kick', label: 'Free kicks', stat: 'free_kicks' },
    ],
    more: ['rushed_behind', 'interchange'],
    possession: false,
  },
  netball: {
    scoring: ['goal'],
    rows: [
      { type: 'goal_missed', label: 'Missed shots' },
      { type: 'intercept', label: 'Intercepts', stat: 'intercepts' },
      { type: 'rebound', label: 'Rebounds', stat: 'rebounds' },
      { type: 'turnover', label: 'Turnovers', stat: 'turnovers' },
      { type: 'penalty', label: 'Penalties', stat: 'penalties' },
    ],
    more: ['centre_pass', 'substitution'],
    possession: false,
  },
};

/** The board for a sport; basketball keeps its own court layout (points buttons, fouls by type, the arrow). */
export const scorerBoard = (sport: string): ScorerBoard | null => SCORER_BOARDS[sport as Sport] ?? null;
