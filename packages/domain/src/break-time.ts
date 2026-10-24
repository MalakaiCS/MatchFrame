// How long a break lasts, from the competition's rules, and how long is left of it: the half-time interval, the
// break between quarters, before and between extra-time (or golden-point) periods, and before each basketball
// overtime. Used for "2ND HALF IN 4:12" on the graphics and on the scorer's phone.
import { getAdapter } from './engine';
import type { MatchProjection, Sport } from './types';

const minutes = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);

/** The length of a break phase in minutes, or null when the rules do not set one. */
export function breakMinutes(config: Record<string, unknown>, breakPhase: string, tags: string[] = []): number | null {
  const extra = (config.extraTime ?? config.goldenPoint) as { breakMinutes?: unknown; intervalMinutes?: unknown } | undefined;
  if (breakPhase === 'extra_time_break') return minutes(extra?.breakMinutes);
  if (breakPhase === 'et_half_time' || /^et_break_\d+$/.test(breakPhase)) return minutes(extra?.intervalMinutes);
  if (/^break_ot\d+$/.test(breakPhase)) return minutes(config.overtimeBreakMinutes);
  if (breakPhase === 'half_time' || tags.includes('half_time')) return minutes(config.halfTimeMinutes);
  if (tags.includes('extra_time_interval')) return null; // a break of extra time the rules give no length
  return minutes(config.quarterBreakMinutes) ?? minutes(config.breakMinutes);
}

/**
 * What is left of the break the match is in: the next period's name ("2nd Half") and the time until it is due,
 * from when the break began. Null outside a break, when the rules give it no length, or once the time is up.
 */
export function breakCountdown(sport: Sport, config: Record<string, unknown>, p: MatchProjection, now: number): { next: string; msLeft: number; minutes: number } | null {
  if (p.breakStartedAt == null) return null;
  const adapter = getAdapter(sport);
  const cfg = config as never;
  const phaseId = p.breakPhase ?? p.phase;
  const def = adapter.phase(cfg, phaseId);
  const mins = breakMinutes(config, phaseId, def?.tags ?? []);
  if (!mins) return null;
  const msLeft = p.breakStartedAt + mins * 60_000 - now;
  if (!(msLeft > 0)) return null;
  const next = adapter.allowedTransitions(cfg, p).map((id) => adapter.phase(cfg, id)).find((x) => x?.kind === 'play');
  return { next: next?.label ?? 'Restart', msLeft, minutes: mins };
}
