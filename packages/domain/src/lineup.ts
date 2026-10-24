// Who is on the field. The lineup says who started; substitutions and dismissals in the projection move players
// on and off. Used by the scorer to offer only valid substitutions and by adapters to validate them.
import type { LineupSnapshot, MatchProjection, Side } from './types';

export interface FieldState {
  /** currently on the field (starters not yet replaced or dismissed, plus players brought on) */
  on: string[];
  /** on the bench and available */
  off: string[];
  /** dismissed or already replaced: cannot come back on */
  unavailable: string[];
}

export function onField(lineup: LineupSnapshot | null | undefined, projection: MatchProjection, side: Side): FieldState {
  const players = lineup?.[side] ?? [];
  const on: string[] = [];
  const off: string[] = [];
  const unavailable: string[] = [];
  const explicitlyOn = new Set(Object.entries(projection.players).filter(([, t]) => t.onCourt === true).map(([id]) => id));
  const explicitlyOff = new Set(Object.entries(projection.players).filter(([, t]) => t.onCourt === false).map(([id]) => id));
  const dismissed = new Set(Object.entries(projection.players).filter(([, t]) => t.red).map(([id]) => id));
  for (const p of players) {
    if (dismissed.has(p.playerId)) unavailable.push(p.playerId);
    else if (explicitlyOn.has(p.playerId)) on.push(p.playerId);
    else if (explicitlyOff.has(p.playerId)) unavailable.push(p.playerId); // replaced: rolling subs are a sport rule, handled by the adapter when allowed
    else if (p.starter) on.push(p.playerId);
    else off.push(p.playerId);
  }
  return { on, off, unavailable };
}

/** Reason a substitution is not allowed, or null when it is. Rolling-substitution sports pass `rolling`. */
export function substitutionProblem(field: FieldState, playerOutId: string | null | undefined, playerInId: string | null | undefined, rolling = false): string | null {
  if (playerOutId && !field.on.includes(playerOutId)) return 'The player coming off is not on the field';
  if (playerInId) {
    if (field.on.includes(playerInId)) return 'The player coming on is already on the field';
    if (!rolling && field.unavailable.includes(playerInId)) return 'That player has already been replaced or sent off';
  }
  return null;
}
