import { describe, expect, it } from 'vitest';
import { breakCountdown, breakMinutes } from './break-time';
import { getAdapter } from './engine';
import type { MatchProjection, Sport } from './types';

const at = Date.parse('2026-10-24T05:00:00Z');
const inBreak = (sport: Sport, phase: string, extra: Partial<MatchProjection> = {}): MatchProjection => ({ ...getAdapter(sport).initialProjection(getAdapter(sport).defaultConfig as never), phase, breakStartedAt: at, breakPhase: phase, ...extra });

describe('break lengths and the countdown to the restart', () => {
  it('half time and quarter breaks come from the rules', () => {
    const b = getAdapter('basketball').defaultConfig as Record<string, unknown>;
    expect(breakMinutes(b, 'half_time', ['half_time'])).toBe(15);
    expect(breakMinutes(b, 'break_1', ['interval', 'period_break'])).toBe(2);
    expect(breakMinutes(b, 'break_ot1', ['interval', 'period_break'])).toBe(2);
    const futsal = { ...(getAdapter('futsal').defaultConfig as Record<string, unknown>), halfTimeMinutes: 5 };
    expect(breakCountdown('futsal', futsal, inBreak('futsal', 'half_time'), at + 60_000)).toEqual({ next: '2nd Half', msLeft: 4 * 60_000, minutes: 5 });
    expect(breakCountdown('futsal', futsal, inBreak('futsal', 'half_time'), at + 5 * 60_000)).toBeNull(); // time is up
  });

  it('extra time: the break before it and the one between its halves', () => {
    const football = getAdapter('football').defaultConfig as Record<string, unknown>;
    expect(breakMinutes(football, 'extra_time_break', ['extra_time_interval', 'interval'])).toBe(5);
    expect(breakMinutes(football, 'et_half_time', ['extra_time_interval', 'interval'])).toBe(1);
    const level = { score: { home: 1, away: 1 } };
    expect(breakCountdown('football', football, inBreak('football', 'extra_time_break', level), at + 2 * 60_000)).toMatchObject({ msLeft: 3 * 60_000, minutes: 5 });
    const rl = getAdapter('rugby_league').defaultConfig as Record<string, unknown>;
    const gp = { ...rl, goldenPoint: { enabled: true, periodMinutes: 5, breakMinutes: 3, intervalMinutes: 0 } };
    expect(breakMinutes(gp, 'extra_time_break', [])).toBe(3);
    expect(breakMinutes(gp, 'et_break_1', ['extra_time_interval'])).toBeNull(); // no break when ends change
  });

  it('rules saved before break lengths existed give no countdown rather than a wrong one', () => {
    expect(breakMinutes({ periodMinutes: 45, extraTime: { enabled: true, periodMinutes: 15 } }, 'extra_time_break', [])).toBeNull();
    expect(breakMinutes({ format: 'quarters', periodMinutes: 10 }, 'break_ot1', [])).toBeNull();
    expect(breakCountdown('futsal', getAdapter('futsal').defaultConfig as Record<string, unknown>, { ...inBreak('futsal', 'half_time'), breakStartedAt: null }, at)).toBeNull();
  });
});
