import { isFull, type Me } from './session';

/** What this person may do on a match from the phone: full scoring, statistics only, or follow along. */
export type ScorerAccess = 'score' | 'stats' | 'view';

/**
 * UI hinting only; the server enforces every permission. Without an account snapshot (offline before the first
 * sync) the usual case is assumed so queued actions are kept, and the server decides once they are sent.
 */
export function scorerAccess(me: Me | null | undefined, match: { id: string; competition?: { id?: string | null } | null } | null | undefined): ScorerAccess {
  if (!me?.role) return 'score';
  if (isFull(me.role)) return 'score';
  const has = (action: string) =>
    me.grants.some(
      (g) =>
        g.action === action &&
        (g.scopeType === 'organisation' || (g.scopeType === 'match' && g.scopeId === match?.id) || (g.scopeType === 'competition' && !!match?.competition?.id && g.scopeId === match.competition.id)),
    );
  if (has('match.score')) return 'score';
  if (has('match.stats')) return 'stats';
  return 'view';
}

export const ACCESS_LABEL: Record<ScorerAccess, string> = { score: 'Scorer', stats: 'Statistics only', view: 'View only' };
