// Live matches that are really live: a match still "live" with nothing recorded for hours was probably never moved
// to Full Time, so Home and the Live page list it apart, under "Needs closing", instead of among the live ones.
import type { MatchRow } from '@/components/match-table';

export const STALE_MS = 3 * 3600_000;

export const isStale = (m: Pick<MatchRow, 'stateUpdatedAt'>, now = Date.now()) => !!m.stateUpdatedAt && now - new Date(m.stateUpdatedAt).getTime() > STALE_MS;
