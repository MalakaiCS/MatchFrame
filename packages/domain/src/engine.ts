import { z } from 'zod';
import { applyClockAction, ClockActionError, clockDisplayMs, type ClockState } from './clock';
import type { FactInput, LogEntry, SportAdapter } from './adapter';
import type { LineupSnapshot, MatchProjection, Side } from './types';
import { endPossessionSpell, POSSESSION_EVENT, trackPossession } from './possession';
import { footballAdapter } from './sports/football';
import { basketballAdapter } from './sports/basketball';
import { netballAdapter } from './sports/netball';
import { rugbyLeagueAdapter } from './sports/rugby-league';
import { aflAdapter } from './sports/afl';
import { hockeyAdapter } from './sports/hockey';
import { futsalAdapter } from './sports/futsal';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adapters: Record<string, SportAdapter<any>> = {
  football: footballAdapter,
  basketball: basketballAdapter,
  netball: netballAdapter,
  rugby_league: rugbyLeagueAdapter,
  afl: aflAdapter,
  hockey: hockeyAdapter,
  futsal: futsalAdapter,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAdapter(sport: string): SportAdapter<any> {
  const a = adapters[sport];
  if (!a) throw new Error(`Unsupported sport ${sport}`);
  return a;
}

export const sideEnum = z.enum(['home', 'away']);

export const commandPayloadSchemas = {
  ADD_FACT: z.object({
    type: z.string().min(1).max(40),
    side: sideEnum.nullable().optional(),
    playerId: z.string().uuid().nullable().optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
    occurredAt: z.number().int().positive(),
    clockMs: z.number().int().min(0).nullable().optional(),
    periodId: z.string().max(20).optional(),
  }),
  VOID_FACT: z.object({ factId: z.string().uuid(), reason: z.string().trim().min(1).max(300) }),
  CORRECT_FACT: z.object({
    factId: z.string().uuid(),
    reason: z.string().trim().min(1).max(300),
    changes: z.object({
      side: sideEnum.optional(),
      playerId: z.string().uuid().nullable().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  SET_PHASE: z.object({ to: z.string().min(1).max(30), reason: z.string().max(300).optional() }),
  CLOCK_ACTION: z.object({
    clockId: z.enum(['main', 'shot']),
    action: z.enum(['start', 'pause', 'resume', 'set', 'reset']),
    ms: z.number().int().min(0).max(4 * 3600_000).optional(),
    reason: z.string().max(300).optional(),
  }),
  ADJUST_SCORE: z.object({
    home: z.number().int().min(0).max(999),
    away: z.number().int().min(0).max(999),
    reason: z.string().trim().min(1).max(300),
  }),
  /** this match decides a level score (extra time, penalties, a shoot-out, golden point) or lets a draw stand */
  SET_KNOCKOUT: z.object({ on: z.boolean(), reason: z.string().max(300).optional() }),
} as const;

export type CommandType = keyof typeof commandPayloadSchemas;
export type CommandPayload<T extends CommandType> = z.infer<(typeof commandPayloadSchemas)[T]>;

export interface StoredFact extends LogEntry {
  id: string;
  occurredAt: number;
  revision: number;
}

export interface EngineState {
  projection: MatchProjection;
  clocks: Record<string, ClockState>;
  sequence: number;
}

export class DomainError extends Error {
  constructor(public code: string, message: string, public field?: string, public status = 422) {
    super(message);
  }
}

/**
 * Record when a phase and its break began on the projection. A break starts when the match enters a break phase
 * from a non-break one and lasts through the walk-out steps that follow ("Players entering (2nd half)"), so a
 * half-time countdown keeps its target; it clears when play resumes or the match ends.
 */
export function stampPhase<C>(adapter: SportAdapter<C>, cfg: C, prev: MatchProjection, next: MatchProjection, at: number | null): MatchProjection {
  const kind = adapter.phase(cfg, next.phase)?.kind;
  const wasBreak = adapter.phase(cfg, prev.phase)?.kind === 'break';
  next.phaseStartedAt = at;
  if (kind === 'break') {
    if (!wasBreak || prev.breakStartedAt == null) {
      next.breakStartedAt = at;
      next.breakPhase = next.phase;
    }
  } else {
    next.breakStartedAt = null;
    next.breakPhase = null;
  }
  return next;
}

/**
 * One event on the projection: the sport's rules, then possession by time and the per-team count of each event
 * (shared by every sport; the scorer's rows read the count when the event has no team statistic of its own).
 */
export function applyEvent<C>(adapter: SportAdapter<C>, cfg: C, p: MatchProjection, e: LogEntry): MatchProjection {
  const next = trackPossession(adapter.applyFact(cfg, p, e), e);
  if (e.side === 'home' || e.side === 'away') {
    next.tally ??= { home: {}, away: {} };
    next.tally[e.side][e.type] = (next.tally[e.side][e.type] ?? 0) + 1;
  }
  return next;
}

/** Rebuild the projection from the full ordered log (voids/corrections already applied to entries). */
/** The per-team count of each event in a log (what applyEvent keeps in `tally`), for a projection stored before it had one. */
export function tallyOf(log: { category: string; side?: string | null; type: string; voided?: boolean }[]): NonNullable<MatchProjection['tally']> {
  const tally: NonNullable<MatchProjection['tally']> = { home: {}, away: {} };
  for (const e of log) if (e.category === 'event' && !e.voided && (e.side === 'home' || e.side === 'away')) tally[e.side][e.type] = (tally[e.side][e.type] ?? 0) + 1;
  return tally;
}

export function replay<C>(adapter: SportAdapter<C>, cfg: C, log: LogEntry[]): MatchProjection {
  let p = adapter.initialProjection(cfg);
  for (const e of [...log].sort((a, b) => a.sequence - b.sequence)) {
    if (e.voided) continue;
    if (e.category === 'phase') p = stampPhase(adapter, cfg, p, endPossessionSpell(adapter.applyPhase(cfg, p, String(e.payload.to)), String(e.payload.from ?? p.phase), e.clockMs), e.occurredAt ?? null);
    else if (e.category === 'adjustment') {
      p = structuredClone(p);
      p.score.home += Number(e.payload.homeDelta ?? 0);
      p.score.away += Number(e.payload.awayDelta ?? 0);
    } else p = applyEvent(adapter, cfg, p, e);
    p.lastFactSequence = e.sequence;
  }
  return p;
}

export type EngineResult =
  | { kind: 'append'; entry: Omit<StoredFact, 'id'>; state: EngineState; clockChanged: boolean; phaseChanged?: { from: string; to: string } }
  | { kind: 'correction'; factId: string; correction: 'void' | 'correct'; updated: StoredFact; state: EngineState; reason: string }
  | { kind: 'clock'; state: EngineState; clockId: string }
  | { kind: 'rules'; state: EngineState; rulesConfig: unknown; knockout: boolean };

/**
 * Pure application of one validated command. The caller supplies the current state, the full fact log
 * (for corrections), the lineup snapshot and the server time. Throws DomainError on rule violations.
 */
export function applyCommand<C>(
  adapter: SportAdapter<C>,
  cfg: C,
  state: EngineState,
  log: StoredFact[],
  type: CommandType,
  rawPayload: unknown,
  now: number,
  lineup: LineupSnapshot | null,
): EngineResult {
  const parsed = commandPayloadSchemas[type].safeParse(rawPayload);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new DomainError('VALIDATION_FAILED', i?.message ?? 'Invalid command', i?.path.join('.'), 400);
  }
  const p = state.projection;
  const phaseDef = adapter.phase(cfg, p.phase);
  const terminal = phaseDef?.kind === 'terminal';
  switch (type) {
    case 'ADD_FACT': {
      const c = parsed.data as CommandPayload<'ADD_FACT'>;
      if (terminal) throw new DomainError('MATCH_CLOSED', 'This match is closed to new facts');
      if (c.type === POSSESSION_EVENT && phaseDef?.tags.includes('shootout')) throw new DomainError('PHASE_NOT_ALLOWED', 'Possession is not kept during the shoot-out', 'type');
      const clockMs = c.clockMs ?? (state.clocks.main ? clockDisplayMs(state.clocks.main, Math.min(c.occurredAt, now)) : null);
      const input: FactInput = { type: c.type, side: c.side ?? null, playerId: c.playerId ?? null, payload: c.payload, clockMs, periodId: c.periodId ?? p.phase };
      const v = adapter.validateFact(cfg, p, input, lineup);
      if (!v.ok) throw new DomainError(v.code, v.message, v.field);
      if (c.occurredAt > now + 5_000) throw new DomainError('OCCURRED_IN_FUTURE', 'Occurrence time is in the future', 'occurredAt');
      const entry: Omit<StoredFact, 'id'> = {
        sequence: state.sequence + 1,
        category: 'event',
        type: c.type,
        side: (c.side ?? null) as Side | null,
        playerId: c.playerId ?? null,
        payload: c.payload,
        periodId: c.periodId ?? p.phase,
        clockMs,
        occurredAt: c.occurredAt,
        revision: 1,
      };
      const projection = applyEvent(adapter, cfg, p, entry);
      const clocks = adapter.clocksForFact(cfg, input, state.clocks, now);
      return { kind: 'append', entry, state: { projection, clocks, sequence: entry.sequence }, clockChanged: clocks !== state.clocks };
    }
    case 'SET_PHASE': {
      const c = parsed.data as CommandPayload<'SET_PHASE'>;
      const allowed = adapter.allowedTransitions(cfg, p);
      if (!allowed.includes(c.to)) {
        throw new DomainError('INVALID_TRANSITION', `Cannot move from ${phaseDef?.label ?? p.phase} to ${adapter.phase(cfg, c.to)?.label ?? c.to}`, 'to', 409);
      }
      const entry: Omit<StoredFact, 'id'> = {
        sequence: state.sequence + 1,
        category: 'phase',
        type: 'phase_change',
        side: null,
        playerId: null,
        payload: { from: p.phase, to: c.to, reason: c.reason ?? null },
        periodId: c.to,
        clockMs: state.clocks.main ? clockDisplayMs(state.clocks.main, now) : null,
        occurredAt: now,
        revision: 1,
      };
      const projection = stampPhase(adapter, cfg, p, endPossessionSpell(adapter.applyPhase(cfg, p, c.to), p.phase, entry.clockMs), now);
      projection.lastFactSequence = entry.sequence;
      const clocks = adapter.clocksForPhase(cfg, p.phase, c.to, state.clocks, now);
      return { kind: 'append', entry, state: { projection, clocks, sequence: entry.sequence }, clockChanged: true, phaseChanged: { from: p.phase, to: c.to } };
    }
    case 'ADJUST_SCORE': {
      const c = parsed.data as CommandPayload<'ADJUST_SCORE'>;
      const entry: Omit<StoredFact, 'id'> = {
        sequence: state.sequence + 1,
        category: 'adjustment',
        type: 'score_adjustment',
        side: null,
        playerId: null,
        payload: { homeDelta: c.home - p.score.home, awayDelta: c.away - p.score.away, from: { ...p.score }, to: { home: c.home, away: c.away }, reason: c.reason },
        periodId: p.phase,
        clockMs: state.clocks.main ? clockDisplayMs(state.clocks.main, now) : null,
        occurredAt: now,
        revision: 1,
      };
      const projection = structuredClone(p);
      projection.score = { home: c.home, away: c.away };
      projection.lastFactSequence = entry.sequence;
      return { kind: 'append', entry, state: { projection, clocks: state.clocks, sequence: entry.sequence }, clockChanged: false };
    }
    case 'VOID_FACT':
    case 'CORRECT_FACT': {
      const c = parsed.data as CommandPayload<'CORRECT_FACT'> & CommandPayload<'VOID_FACT'>;
      const target = log.find((f) => f.id === c.factId);
      if (!target) throw new DomainError('FACT_NOT_FOUND', 'Fact not found on this match', 'factId', 404);
      if (target.voided) throw new DomainError('FACT_ALREADY_VOID', 'This fact has already been voided', 'factId', 409);
      if (target.category !== 'event') throw new DomainError('NOT_CORRECTABLE', 'Phase changes and adjustments are corrected with a new action', 'factId', 409);
      let updated: StoredFact;
      if (type === 'VOID_FACT') {
        updated = { ...target, voided: true, revision: target.revision + 1 };
      } else {
        updated = {
          ...target,
          side: c.changes.side ?? target.side,
          playerId: c.changes.playerId === undefined ? target.playerId : c.changes.playerId,
          payload: c.changes.payload ? { ...target.payload, ...c.changes.payload } : target.payload,
          revision: target.revision + 1,
        };
        // Validate the corrected fact against the projection *without* the original fact.
        const without = replay(adapter, cfg, log.filter((f) => f.id !== target.id && f.sequence < target.sequence));
        const atPhase = { ...without, phase: target.periodId && adapter.phase(cfg, target.periodId) ? target.periodId : without.phase };
        const v = adapter.validateFact(cfg, atPhase, { type: updated.type, side: updated.side, playerId: updated.playerId, payload: updated.payload, clockMs: updated.clockMs, periodId: updated.periodId }, lineup);
        if (!v.ok) throw new DomainError(v.code, v.message, v.field);
      }
      const newLog = log.map((f) => (f.id === target.id ? updated : f));
      const projection = replay(adapter, cfg, newLog);
      projection.lastFactSequence = state.sequence;
      return { kind: 'correction', factId: target.id, correction: type === 'VOID_FACT' ? 'void' : 'correct', updated, state: { projection, clocks: state.clocks, sequence: state.sequence }, reason: c.reason };
    }
    case 'SET_KNOCKOUT': {
      const c = parsed.data as CommandPayload<'SET_KNOCKOUT'>;
      const ko = adapter.knockout;
      if (!ko) throw new DomainError('NOT_SUPPORTED', `${adapter.label} always decides a level match`, 'on', 409);
      if (terminal || phaseDef?.kind === 'final') throw new DomainError('MATCH_CLOSED', 'The match is over; its rules can no longer change', 'on', 409);
      const deciding = phaseDef?.tags.some((t) => t === 'extra_time' || t === 'extra_time_interval' || t === 'shootout');
      if (!c.on && deciding) throw new DomainError('PHASE_NOT_ALLOWED', `${phaseDef!.label} is under way; finish it or end the match instead`, 'on', 409);
      const next = ko.set(cfg, c.on);
      if (!adapter.phase(next, p.phase)) throw new DomainError('PHASE_NOT_ALLOWED', `${phaseDef?.label ?? p.phase} does not exist under these rules`, 'on', 409);
      return { kind: 'rules', state, rulesConfig: next, knockout: ko.isOn(next) };
    }
    case 'CLOCK_ACTION': {
      const c = parsed.data as CommandPayload<'CLOCK_ACTION'>;
      const clk = state.clocks[c.clockId];
      if (!clk) throw new DomainError('NO_SUCH_CLOCK', `This sport has no ${c.clockId} clock`, 'clockId');
      if (c.clockId === 'main' && phaseDef?.kind !== 'play' && (c.action === 'start' || c.action === 'resume')) {
        throw new DomainError('PHASE_NOT_ALLOWED', 'The match clock only runs during a period of play', 'action', 409);
      }
      let next: ClockState;
      try {
        if (c.action === 'set') next = applyClockAction(clk, { type: 'set', at: now, ms: c.ms ?? 0, reason: c.reason ?? '' });
        else if (c.action === 'reset') next = applyClockAction(clk, { type: 'reset', at: now, ms: c.ms ?? clk.limitMs ?? 0 });
        else next = applyClockAction(clk, { type: c.action, at: now });
      } catch (e) {
        if (e instanceof ClockActionError) throw new DomainError(e.code, e.message, 'action', 409);
        throw e;
      }
      // Starting/pausing the game clock drives the shot clock with it when one exists.
      const clocks = { ...state.clocks, [c.clockId]: next };
      if (c.clockId === 'main' && clocks.shot && (c.action === 'pause' || c.action === 'start' || c.action === 'resume')) {
        const shot = clocks.shot;
        if (c.action === 'pause' && shot.running) clocks.shot = applyClockAction(shot, { type: 'pause', at: now });
        if (c.action !== 'pause' && !shot.running && shot.baseMs > 0) clocks.shot = applyClockAction(shot, { type: 'start', at: now });
      }
      return { kind: 'clock', state: { projection: p, clocks, sequence: state.sequence }, clockId: c.clockId };
    }
  }
}
