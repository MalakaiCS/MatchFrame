import { describe, expect, it } from 'vitest';
import { footballAdapter } from '@bs/domain';
import { identInfo, restartCountdown } from './common';
import type { GraphicProps } from './stage';

const cfg = footballAdapter.defaultConfig; // 15-minute half time
const KO = Date.UTC(2026, 9, 24, 4, 0); // 3:00 pm in Melbourne
const props = (phase: string, over: { now?: number; variables?: Record<string, unknown>; breakStartedAt?: number | null; breakPhase?: string | null; score?: [number, number] } = {}) =>
  ({
    cue: { cueId: 'c1', variables: over.variables ?? { showCountdown: true } },
    now: over.now ?? KO - 12 * 60_000,
    display: { periodLabel: footballAdapter.phase(cfg, phase)?.label ?? phase, score: { home: over.score?.[0] ?? 0, away: over.score?.[1] ?? 0 }, shootout: null },
    data: {
      theme: { wording: {} },
      match: {
        sport: 'football', rulesConfig: cfg, venue: 'Bayside Oval', timezone: 'Australia/Melbourne', scheduledAt: new Date(KO).toISOString(),
        projection: { ...footballAdapter.initialProjection(cfg), phase, breakStartedAt: over.breakStartedAt ?? null, breakPhase: over.breakPhase ?? null },
      },
    },
  }) as unknown as GraphicProps;

describe('match header wording', () => {
  it('before kick-off: VS, the ground and time, and the kick-off countdown', () => {
    const i = identInfo(props('pre_match'));
    expect(i).toMatchObject({ started: false, centre: 'VS', countdown: { label: 'KICK-OFF IN', text: '12:00' }, message: null });
    expect(i.line).toMatch(/^Bayside Oval · Saturday 24 October(?: at)?,? 3:00\s?pm$/i);
  });

  it('at half time: the score, HALF TIME and a countdown to the second half from when the break began', () => {
    const htAt = KO + 50 * 60_000;
    const p = props('half_time', { now: htAt + 4 * 60_000 + 30_000, breakStartedAt: htAt, breakPhase: 'half_time', score: [2, 1] });
    expect(identInfo(p)).toMatchObject({ started: true, centre: '2–1', line: 'HALF TIME', countdown: { label: '2ND HALF IN', text: '10:30' } });
    // the walk-out step still reads as half time, and the countdown keeps going
    const walk = props('second_half_entering', { now: htAt + 14 * 60_000, breakStartedAt: htAt, breakPhase: 'half_time', score: [2, 1] });
    expect(identInfo(walk)).toMatchObject({ line: 'HALF TIME', countdown: { text: '1:00' } });
    // past the scheduled restart: no negative countdown
    expect(restartCountdown(props('half_time', { now: htAt + 16 * 60_000, breakStartedAt: htAt, breakPhase: 'half_time' }))).toBeNull();
    // no recorded break start (an old match): no guess
    expect(restartCountdown(props('half_time', { now: htAt }))).toBeNull();
  });

  it('at full time: the final score, FULL TIME and the thank-you message, with no countdown', () => {
    const i = identInfo(props('full_time', { now: KO + 2 * 3600_000, variables: { showCountdown: false, message: 'Thank you for watching' }, score: [3, 2] }));
    expect(i).toEqual({ started: true, centre: '3–2', line: 'FULL TIME', countdown: null, message: 'Thank you for watching' });
  });
});
