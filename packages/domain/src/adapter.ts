import type { z } from 'zod';
import type { ClockState } from './clock';
import type {
  DisplayModel,
  EventTypeDef,
  LineupSnapshot,
  MatchProjection,
  PhaseDef,
  Result,
  Side,
  Sport,
} from './types';

/** One ordered entry of the authoritative match log (facts, phase changes, adjustments). */
export interface LogEntry {
  sequence: number;
  category: 'event' | 'phase' | 'adjustment';
  type: string;
  side?: Side | null;
  playerId?: string | null;
  payload: Record<string, unknown>;
  periodId: string;
  clockMs?: number | null;
  voided?: boolean;
  /** server ms the entry happened; phase entries use it to time breaks (absent in older call sites) */
  occurredAt?: number;
}

export interface FactInput {
  type: string;
  side?: Side | null;
  playerId?: string | null;
  payload: Record<string, unknown>;
}

export interface GraphicCapabilities {
  /** graphic types this sport can drive, e.g. ['scorebug','goal','card','substitution'] */
  graphics: string[];
  scorebugFields: string[];
  statRows: { key: string; label: string; unit?: string }[];
}

/**
 * Typed contract every sport implements. UI, API and workers read capabilities from the adapter instead of
 * branching on sport names. Implementations must be pure and deterministic.
 */
export interface SportAdapter<C = unknown> {
  sport: Sport;
  label: string;
  rulesVersion: string;
  configSchema: z.ZodType<C>;
  defaultConfig: C;
  presets: { id: string; label: string; config: C }[];
  describeRules(cfg: C): string[];
  phases(cfg: C): PhaseDef[];
  phase(cfg: C, id: string): PhaseDef | undefined;
  allowedTransitions(cfg: C, p: MatchProjection): string[];
  eventTypes(cfg: C): EventTypeDef[];
  initialProjection(cfg: C): MatchProjection;
  initialClocks(cfg: C): Record<string, ClockState>;
  /** Validate a fact against the *current* projection and lineup (does not mutate). */
  validateFact(cfg: C, p: MatchProjection, f: FactInput, lineup?: LineupSnapshot | null): Result<FactInput>;
  applyFact(cfg: C, p: MatchProjection, e: LogEntry): MatchProjection;
  applyPhase(cfg: C, p: MatchProjection, to: string): MatchProjection;
  /** Clock changes produced by a phase transition (e.g. reset + start first half). */
  clocksForPhase(cfg: C, from: string, to: string, clocks: Record<string, ClockState>, at: number): Record<string, ClockState>;
  /** Clock side-effects of a fact (e.g. basketball shot-clock reset). Main clock must not change unexpectedly. */
  clocksForFact(cfg: C, f: FactInput, clocks: Record<string, ClockState>, at: number): Record<string, ClockState>;
  display(cfg: C, p: MatchProjection, clocks: Record<string, ClockState>, now: number): DisplayModel;
  capabilities(cfg: C): GraphicCapabilities;
  /** Event types that create highlight requests by default. */
  highlightDefaults(cfg: C): string[];
  /** Minute of play (1-based) at a clock reading, for sports whose clock does not count up through the match (futsal). */
  minuteOf?(cfg: C, periodId: string, clockMs: number | null): number | null;
  /**
   * The rules that decide a level match (extra time, penalties, a shoot-out, golden point), turned on for knockout
   * and finals matches. Absent when the sport always decides one (basketball plays overtime).
   */
  knockout?: KnockoutRules<C>;
}

export interface KnockoutRules<C> {
  /** what a level match goes to, e.g. "Extra time and penalties when level" */
  label: string;
  isOn(cfg: C): boolean;
  /** the same rules with deciding a level match on or off; turning it on keeps rules that already decide one */
  set(cfg: C, on: boolean): C;
}
