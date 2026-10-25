// Video reviews (rugby league's video referee, the captain's challenge): what is being checked, and the words the
// review graphic and the scorer phone use while it is checked and once the decision is given.

export const REVIEW_SUBJECTS = ['try', 'captains_challenge'] as const;
export type ReviewSubject = (typeof REVIEW_SUBJECTS)[number];
export type ReviewOutcome = 'awarded' | 'denied';

interface ReviewWords {
  /** the title over the graphic */
  title: string;
  /** while the video referee checks it */
  pending: string;
  awarded: string;
  denied: string;
  /** the scorer's two decision buttons */
  buttons: Record<ReviewOutcome, string>;
}

const WORDS: Record<ReviewSubject, ReviewWords> = {
  try: { title: 'VIDEO REVIEW', pending: 'TRY?', awarded: 'TRY', denied: 'NO TRY', buttons: { awarded: 'Try', denied: 'No try' } },
  captains_challenge: { title: "CAPTAIN'S CHALLENGE", pending: 'CHALLENGE', awarded: 'SUCCESSFUL', denied: 'UNSUCCESSFUL', buttons: { awarded: 'Successful', denied: 'Unsuccessful' } },
};

export const REVIEW_SUBJECT_LABELS: Record<ReviewSubject, string> = { try: 'Try', captains_challenge: "Captain's challenge" };

/** The words for a review (an unknown subject reads as a try review). */
export const reviewWords = (subject: string | null | undefined): ReviewWords => WORDS[(subject as ReviewSubject) in WORDS ? (subject as ReviewSubject) : 'try'];

/** The headline for where a review stands: "TRY?" while checked, then "TRY" or "NO TRY". */
export function reviewHeadline(subject: string | null | undefined, outcome: ReviewOutcome | null | undefined): string {
  const w = reviewWords(subject);
  return outcome === 'awarded' ? w.awarded : outcome === 'denied' ? w.denied : w.pending;
}
