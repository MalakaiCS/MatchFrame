// Possession by time: the scorer taps the team that has the ball, and the match clock between taps counts for that
// team. Clock time, not wall time, so stoppages and breaks never count; a period change closes the running spell
// and possession is unknown until the next tap. Kept on the projection and replayed like any fact.
import type { LogEntry } from './adapter';
import type { MatchProjection, Side } from './types';

export const POSSESSION_EVENT = 'possession_change';

export interface PossessionTime {
  /** who has the ball now; null before the first tap of a period */
  side: Side | null;
  /** match-clock reading when the current spell began */
  sinceMs: number | null;
  /** the period the current spell is in */
  periodId: string | null;
  /** clock time each team has had the ball */
  ms: { home: number; away: number };
}

const empty = (): PossessionTime => ({ side: null, sinceMs: null, periodId: null, ms: { home: 0, away: 0 } });

/** Whole-number percentages that add up to 100; null before anyone has had the ball. */
export function possessionPercent(ms: { home: number; away: number }): { home: number; away: number } | null {
  const total = ms.home + ms.away;
  if (total <= 0) return null;
  const home = Math.round((ms.home / total) * 100);
  return { home, away: 100 - home };
}

function close(pos: PossessionTime, clockMs: number | null | undefined, periodId: string) {
  if (pos.side && pos.sinceMs != null && clockMs != null && pos.periodId === periodId) pos.ms[pos.side] += Math.abs(clockMs - pos.sinceMs);
}

function write(p: MatchProjection, pos: PossessionTime) {
  p.possessionTime = pos;
  p.possession = pos.side;
  const pct = possessionPercent(pos.ms);
  if (pct) {
    p.stats.home.possession_pct = pct.home;
    p.stats.away.possession_pct = pct.away;
  }
}

/** After an event: a possession tap ends the running spell and starts the tapped team's. Mutates `p` (already a copy). */
export function trackPossession(p: MatchProjection, e: Pick<LogEntry, 'type' | 'side' | 'clockMs' | 'periodId'>): MatchProjection {
  if (e.type !== POSSESSION_EVENT || !e.side) return p;
  const pos = structuredClone(p.possessionTime ?? empty());
  close(pos, e.clockMs, e.periodId);
  pos.side = e.side;
  pos.sinceMs = e.clockMs ?? null;
  pos.periodId = e.periodId;
  write(p, pos);
  return p;
}

/** At a phase change: the running spell ends at the clock reading of the change (`from` is the phase being left). */
export function endPossessionSpell(p: MatchProjection, from: string, clockMs: number | null | undefined): MatchProjection {
  if (!p.possessionTime) return p;
  const pos = structuredClone(p.possessionTime);
  close(pos, clockMs, from);
  pos.side = null;
  pos.sinceMs = null;
  pos.periodId = null;
  write(p, pos);
  return p;
}

/** Live share including the spell still running at `clockMs` (the clock now), for the scorer's display. */
export function possessionShare(p: MatchProjection, clockMs: number | null): { home: number; away: number } | null {
  const pos = p.possessionTime;
  if (!pos) return null;
  const ms = { ...pos.ms };
  if (pos.side && pos.sinceMs != null && clockMs != null && pos.periodId === p.phase) ms[pos.side] += Math.abs(clockMs - pos.sinceMs);
  return possessionPercent(ms);
}
