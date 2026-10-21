import type { ClockState } from './clock';

export const SPORTS = ['football', 'basketball', 'netball', 'rugby_league', 'afl', 'hockey', 'futsal'] as const;
export type Sport = (typeof SPORTS)[number];
export const SPORT_LABELS: Record<Sport, string> = { football: 'Football', basketball: 'Basketball', netball: 'Netball', rugby_league: 'Rugby League', afl: 'Australian Football', hockey: 'Hockey', futsal: 'Futsal' };
export const isSport = (v: unknown): v is Sport => typeof v === 'string' && (SPORTS as readonly string[]).includes(v);

/** A match official as entered by the operator (shown on straps and reports). */
export interface MatchOfficial {
  role: 'referee' | 'assistant_1' | 'assistant_2' | 'fourth' | 'video' | 'umpire' | 'touch_judge' | 'other';
  name: string;
}
export const OFFICIAL_ROLES: Record<MatchOfficial['role'], string> = { referee: 'Referee', assistant_1: 'Assistant 1', assistant_2: 'Assistant 2', fourth: 'Fourth official', video: 'Video referee', umpire: 'Umpire', touch_judge: 'Touch judge', other: 'Official' };

export interface MatchWeather {
  summary?: string | null;
  tempC?: number | null;
  condition?: 'sunny' | 'cloudy' | 'rain' | 'wind' | 'storm' | 'snow' | 'indoor' | null;
}
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
  assists?: number;
  points?: number;
  fouls?: number;
  yellow?: number;
  red?: boolean;
  /** explicit on/off state after a substitution or dismissal; undefined = as the lineup says */
  onCourt?: boolean;
  /** sport-specific scoring breakdown, e.g. AFL goals/behinds or rugby tries/goals */
  breakdown?: Record<string, number>;
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
  /** Basketball team fouls; futsal accumulated fouls (per half) */
  teamFouls?: { home: number; away: number };
  /** Futsal: send-offs that leave a team a player short (playing time in ms since kick-off) until they end */
  sendOffs?: { side: Side; playerId: string | null; atMs: number; endedBy: 'goal' | null; endedAtMs: number | null }[];
  timeouts?: { home: number; away: number };
  possession?: Side | null;
  stoppageMinutes?: number | null;
  /** when the current phase began (server ms) */
  phaseStartedAt?: number | null;
  /** when the current break began and the phase that began it ("half_time"), kept through the walk-out steps */
  breakStartedAt?: number | null;
  breakPhase?: string | null;
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
  /** sport-specific rendering of the score, e.g. AFL "12.7 (79)"; absent when the number says it all */
  scoreDetail?: { home: string; away: string } | null;
  shootout?: { home: number; away: number } | null;
  fouls?: { home: number; away: number } | null;
  timeouts?: { home: number; away: number } | null;
  possession?: Side | null;
  bonus?: { home: boolean; away: boolean } | null;
  /** a team playing short after a send-off: players on the court and the playing time left */
  shortHanded?: { side: Side; players: number; remainingText: string }[] | null;
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
