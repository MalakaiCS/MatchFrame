import { describe, expect, it } from 'vitest';
import { localDayBounds, pickCurrentMatch, type DayMatch } from './index';

const H = 3600_000;
const M = 60_000;
const base = Date.UTC(2026, 9, 25, 0, 0); // 10:00 in Brisbane
const day = (over: Partial<DayMatch>[]): DayMatch[] =>
  over.map((o, i) => ({ id: `m${i + 1}`, scheduledAt: base + i * 2 * H, status: 'scheduled', phase: 'scheduled', stateUpdatedAt: base - 24 * H, hasOutput: true, ...o }));
const opts = (now: number, pinnedId: string | null = null) => ({ now, pinnedId, switchBeforeMs: 10 * M, staleMs: 3 * H });

describe('stream link: which match is on', () => {
  it('before the first match: the first match (its header counts down)', () => {
    expect(pickCurrentMatch(day([{}, {}, {}]), opts(base - H))).toEqual({ id: 'm1', reason: 'next' });
  });

  it('a match under way, from its run-down to full time', () => {
    const list = day([{ phase: 'pre_match', stateUpdatedAt: base - 5 * M }, {}, {}]);
    expect(pickCurrentMatch(list, opts(base - 4 * M))).toEqual({ id: 'm1', reason: 'under_way' });
    list[0] = { ...list[0]!, status: 'live', phase: 'second_half', stateUpdatedAt: base + 80 * M };
    expect(pickCurrentMatch(list, opts(base + 81 * M))).toEqual({ id: 'm1', reason: 'under_way' });
  });

  it('between matches: the one just finished (thank-you, matches today) until 10 minutes before the next kick-off', () => {
    const list = day([{ status: 'completed', phase: 'full_time', stateUpdatedAt: base + 100 * M }, {}, {}]);
    expect(pickCurrentMatch(list, opts(base + 101 * M))).toEqual({ id: 'm1', reason: 'just_finished' });
    expect(pickCurrentMatch(list, opts(base + 2 * H - 11 * M))).toEqual({ id: 'm1', reason: 'just_finished' });
    expect(pickCurrentMatch(list, opts(base + 2 * H - 10 * M))).toEqual({ id: 'm2', reason: 'next' });
  });

  it('the next match as soon as its scorer starts the run-down, even early', () => {
    const list = day([{ status: 'completed', phase: 'full_time', stateUpdatedAt: base + 100 * M }, { phase: 'pre_match', stateUpdatedAt: base + 102 * M }, {}]);
    expect(pickCurrentMatch(list, opts(base + 103 * M))).toEqual({ id: 'm2', reason: 'under_way' });
  });

  it('a match forgotten at "live" for hours does not hold the link; the latest match under way wins', () => {
    const list = day([{ status: 'live', phase: 'second_half', stateUpdatedAt: base + 90 * M }, { status: 'live', phase: 'first_half', stateUpdatedAt: base + 2 * H + 20 * M }]);
    expect(pickCurrentMatch(list, opts(base + 2 * H + 21 * M))).toEqual({ id: 'm2', reason: 'under_way' });
    const stale = day([{ status: 'live', phase: 'second_half', stateUpdatedAt: base }, {}]);
    expect(pickCurrentMatch(stale, opts(base + 4 * H))).toEqual({ id: 'm2', reason: 'next' });
  });

  it('after the last match: it stays on; postponed matches and matches without an output are passed over', () => {
    const list = day([{ status: 'completed', phase: 'full_time', stateUpdatedAt: base + 100 * M }, { status: 'postponed', phase: 'postponed' }, { hasOutput: false }]);
    expect(pickCurrentMatch(list, opts(base + 6 * H))).toEqual({ id: 'm1', reason: 'last' });
  });

  it('a match put on by hand wins until it is cleared', () => {
    const list = day([{ status: 'live', phase: 'first_half', stateUpdatedAt: base + 10 * M }, {}]);
    expect(pickCurrentMatch(list, opts(base + 11 * M, 'm2'))).toEqual({ id: 'm2', reason: 'pinned' });
    expect(pickCurrentMatch(list, opts(base + 11 * M, 'gone'))).toEqual({ id: 'm1', reason: 'under_way' });
  });

  it('nothing today: no match', () => {
    expect(pickCurrentMatch([], opts(base))).toEqual({ id: null, reason: 'none' });
  });
});

describe('localDayBounds', () => {
  it("is the ground's own calendar day", () => {
    // 23:30 UTC on the 24th is 09:30 on the 25th in Brisbane (UTC+10)
    const b = localDayBounds(Date.UTC(2026, 9, 24, 23, 30), 'Australia/Brisbane');
    expect(b.from.toISOString()).toBe('2026-10-24T14:00:00.000Z');
    expect(b.to.toISOString()).toBe('2026-10-25T14:00:00.000Z');
  });

  it('a day with a daylight-saving change is 23 or 25 hours long', () => {
    // Sydney moves to daylight time on Sunday 4 October 2026
    const b = localDayBounds(Date.UTC(2026, 9, 4, 2, 0), 'Australia/Sydney');
    expect(b.from.toISOString()).toBe('2026-10-03T14:00:00.000Z');
    expect((b.to.getTime() - b.from.getTime()) / 3600_000).toBe(23);
  });
});
