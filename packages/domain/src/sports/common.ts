import { z } from 'zod';
import type { LineupSnapshot, MatchProjection, Side, Sport, TeamStats } from '../types';

export const sideSchema = z.enum(['home', 'away']);

export function basePre(sport: Sport, rulesVersion: string, stats: { home: TeamStats; away: TeamStats }): MatchProjection {
  return {
    sport,
    rulesVersion,
    phase: 'scheduled',
    score: { home: 0, away: 0 },
    periodScores: {},
    shootout: null,
    stats,
    players: {},
    possession: null,
    stoppageMinutes: null,
    lastFactSequence: 0,
    counters: {},
  };
}

export function cloneProjection(p: MatchProjection): MatchProjection {
  return structuredClone(p);
}

export function bump(obj: Record<string, number>, key: string, by = 1) {
  obj[key] = (obj[key] ?? 0) + by;
}

export function adjustStat(obj: TeamStats, key: string, delta: number) {
  obj[key] = Math.max(0, (obj[key] ?? 0) + delta);
}

export function playerInLineup(lineup: LineupSnapshot, side: Side, playerId: string): boolean {
  return lineup[side].some((p) => p.playerId === playerId);
}
