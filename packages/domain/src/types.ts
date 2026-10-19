import type { ClockState } from './clock';

export type Sport = 'football' | 'basketball';
export type Side = 'home' | 'away';
export const otherSide = (s: Side): Side => (s === 'home' ? 'away' : 'home');

export type PhaseKind = 'pre' | 'play' | 'break' | 'final' | 'terminal';

export interface PhaseDef {
  id: string;
  label: string;
  short: string;
  kind: PhaseKind;
  /** Logical trigger tags used by automation (e.g. 'period_start', 'half_time', 'full_time'). */
  tags: string[];
}

/** A canonical accepted match fact (sport-specific payload is validated by the adapter). */
export interface MatchFact {
  id: string;
  sequence: number;
  type: string; // sport event type, e.g. 'goal', 'score', 'foul'
  side?: Side | null;
  playerId?: string | null;
  payload: Record<string, unknown>;
  periodId: string;
  clockMs: number | null;
  occurredAt: number; // epoch ms (client/source occurrence)
  acceptedAt: number; // epoch ms (server)
  voided?: boolean;
  revision: number; // incremented on correction
}

export interface TeamSnapshot {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  primaryColor: string;
  secondaryColor: string;
  logoAssetId?: string | null;
}

export interface LineupPlayer {
  playerId: string;
  displayName: string;
  shortName?: string | null;
  number?: number | null;
  position?: string | null;
  photoAssetId?: string | null;
  starter: boolean;
  captain?: boolean;
}

export interface LineupSnapshot {
  home: LineupPlayer[];
  away: LineupPlayer[];
  formations?: { home?: string | null; away?: string | null };
}

export interface TeamStats {
  [stat: string]: number;
}

export interface PlayerTally {
  goals?: number;
  points?: number;
  fouls?: number;
  yellow?: number;
  red?: boolean;
  onCourt?: boolean;
}

/** Derived projection — never authoritative on its own; recomputed from facts + actions. */
export interface MatchProjection {
  sport: Sport;
  rulesVersion: string;
  phase: string;
  score: { home: number; away: number };
  periodScores: Record<string, { home: number; away: number }>;
  shootout: { home: number; away: number; kicks: { side: Side; scored: boolean; playerId?: string | null }[] } | null;
  stats: { home: TeamStats; away: TeamStats };
  players: Record<string, PlayerTally>;
  /** Basketball */
  teamFouls?: { home: number; away: number };
  timeouts?: { home: number; away: number };
  possession?: Side | null;
  stoppageMinutes?: number | null;
  lastFactSequence: number;
  /** count of eligible facts by type for milestone triggers */
  counters: Record<string, number>;
}

export interface MatchStateSnapshot {
  projection: MatchProjection;
  clocks: Record<string, ClockState>;
  stateVersion: number;
  sequence: number;
}

export interface EventTypeDef {
  type: string;
  label: string;
  group: 'score' | 'discipline' | 'change' | 'stat' | 'control' | 'shootout';
  requiresSide: boolean;
  playerField: 'optional' | 'required' | 'none';
  /** graphic capability, e.g. 'goal', 'card', 'substitution' */
  graphic?: string;
  highlightDefault: boolean;
  phases?: PhaseKind[]; // allowed in phase kinds (default play)
}

export interface DisplayModel {
  periodLabel: string;
  periodShort: string;
  clockText: string;
  clockRunning: boolean;
  stoppageText?: string | null;
  shotClockText?: string | null;
  score: { home: number; away: number };
  shootout?: { home: number; away: number } | null;
  fouls?: { home: number; away: number } | null;
  timeouts?: { home: number; away: number } | null;
  possession?: Side | null;
  bonus?: { home: boolean; away: boolean } | null;
  alerts: string[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string; field?: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(code: string, message: string, field?: string): Result<T> => ({
  ok: false,
  code,
  message,
  field,
});
