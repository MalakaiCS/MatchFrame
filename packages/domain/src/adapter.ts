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
}
