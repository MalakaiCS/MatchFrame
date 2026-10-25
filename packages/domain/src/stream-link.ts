// Stream links: one OBS link that follows a day of back-to-back matches. Which match it shows now, from today's
// matches in its place (pure, so the rule is tested without a database):
//  1. a match an operator put on by hand;
//  2. a match under way (live, or its run-down begun with Pre-match, Players entering…), the latest kick-off first,
//     leaving out matches nobody has touched for hours (forgotten at "live");
//  3. between matches, the one that just finished (its thank-you and the "Matches today" board), until the next
//     kick-off is `switchBeforeMs` away; then the next match (its background and header with the countdown);
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

export type CurrentReason = 'pinned' | 'under_way' | 'just_finished' | 'next' | 'last' | 'none';

const FINISHED = ['completed', 'abandoned'];
const OFF = ['postponed', 'cancelled', 'archived'];

export function pickCurrentMatch(list: DayMatch[], o: { now: number; pinnedId?: string | null; switchBeforeMs: number; staleMs: number }): { id: string | null; reason: CurrentReason } {
  const usable = list.filter((m) => m.hasOutput && !OFF.includes(m.status));
  if (o.pinnedId && usable.some((m) => m.id === o.pinnedId)) return { id: o.pinnedId, reason: 'pinned' };
  const underWay = usable
    .filter((m) => !FINISHED.includes(m.status) && (m.status === 'live' || m.phase !== 'scheduled') && o.now - m.stateUpdatedAt < o.staleMs)
    .sort((a, b) => b.scheduledAt - a.scheduledAt);
  if (underWay[0]) return { id: underWay[0].id, reason: 'under_way' };
  const finished = usable.filter((m) => FINISHED.includes(m.status)).sort((a, b) => b.stateUpdatedAt - a.stateUpdatedAt)[0];
  const next = usable.filter((m) => m.status === 'scheduled' && m.phase === 'scheduled').sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
  if (next && (!finished || o.now >= next.scheduledAt - o.switchBeforeMs)) return { id: next.id, reason: 'next' };
  if (finished) return { id: finished.id, reason: next ? 'just_finished' : 'last' };
  return { id: null, reason: 'none' };
}
