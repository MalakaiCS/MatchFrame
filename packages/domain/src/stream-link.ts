// Stream links: one OBS link that follows a day of back-to-back matches. Which match it shows now, from today's
// matches in its place (pure, so the rule is tested without a database):
//  1. the intermission or a match an operator put on by hand;
//  2. a match under way (live, or its run-down begun with Pre-match, Players entering…), the latest kick-off first,
//     leaving out matches nobody has touched for hours (forgotten at "live");
//  3. between matches, the one that just finished (its full time and thank-you) for `intermissionAfterMs`, then the
//     intermission screen (the next match, today's results and what is still to come), until the next kick-off is
//     `switchBeforeMs` away; then the next match (its background and header with the countdown);
//  4. before the first match, the first match; after the last, the last.

export interface DayMatch {
  id: string;
  scheduledAt: number;
  /** matches.status: scheduled | live | completed | postponed | cancelled | abandoned | archived */
  status: string;
  /** match_state.phase; "scheduled" until the scorer starts the run-down */
  phase: string;
  /** when the match state last changed (a finished match: about when it finished) */
  stateUpdatedAt: number;
  /** the match has a graphics output to show */
  hasOutput: boolean;
}

export type CurrentReason = 'pinned' | 'pinned_intermission' | 'under_way' | 'just_finished' | 'intermission' | 'next' | 'last' | 'none';

/** The intermission screen, not the match's own graphics (drawn with the match's look and today's data). */
export const isIntermission = (reason: CurrentReason) => reason === 'intermission' || reason === 'pinned_intermission';

const FINISHED = ['completed', 'abandoned'];
const OFF = ['postponed', 'cancelled', 'archived'];

export interface PickOptions {
  now: number;
  /** a match put on by hand */
  pinnedId?: string | null;
  /** the intermission put on by hand */
  pinnedIntermission?: boolean;
  /** move on from a finished match this long before the next kick-off */
  switchBeforeMs: number;
  /** a match still "live" with nothing recorded for this long was forgotten */
  staleMs: number;
  /** the intermission comes on this long after a match finishes (null: no intermission, the finished match stays) */
  intermissionAfterMs?: number | null;
}

export function pickCurrentMatch(list: DayMatch[], o: PickOptions): { id: string | null; reason: CurrentReason } {
  const usable = list.filter((m) => m.hasOutput && !OFF.includes(m.status));
  const underWay = usable
    .filter((m) => !FINISHED.includes(m.status) && (m.status === 'live' || m.phase !== 'scheduled') && o.now - m.stateUpdatedAt < o.staleMs)
    .sort((a, b) => b.scheduledAt - a.scheduledAt);
  const finished = usable.filter((m) => FINISHED.includes(m.status)).sort((a, b) => b.stateUpdatedAt - a.stateUpdatedAt)[0];
  const next = usable.filter((m) => m.status === 'scheduled' && m.phase === 'scheduled').sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
  // the intermission is drawn with the next match's output (its look, today's matches with it highlighted)
  if (o.pinnedIntermission) {
    const via = next ?? underWay[0] ?? finished ?? usable[0];
    return via ? { id: via.id, reason: 'pinned_intermission' } : { id: null, reason: 'none' };
  }
  if (o.pinnedId && usable.some((m) => m.id === o.pinnedId)) return { id: o.pinnedId, reason: 'pinned' };
  if (underWay[0]) return { id: underWay[0].id, reason: 'under_way' };
  if (next && (!finished || o.now >= next.scheduledAt - o.switchBeforeMs)) return { id: next.id, reason: 'next' };
  if (finished && next && o.intermissionAfterMs != null && o.now >= finished.stateUpdatedAt + o.intermissionAfterMs) return { id: next.id, reason: 'intermission' };
  if (finished) return { id: finished.id, reason: next ? 'just_finished' : 'last' };
  return { id: null, reason: 'none' };
}
