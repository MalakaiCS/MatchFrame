import { describe, expect, it } from 'vitest';
import { applyClockAction, clockDisplayMs, createClock, estimateServerOffset, formatClock } from './clock';

describe('clock model', () => {
  it('derives up-clock time from the anchor, independent of render cadence', () => {
    let c = createClock('main', 'up', 0, 'first_half');
    c = applyClockAction(c, { type: 'start', at: 1_000 });
    expect(clockDisplayMs(c, 1_000)).toBe(0);
    expect(clockDisplayMs(c, 61_000)).toBe(60_000);
    // A refresh/restart only needs the persisted anchor
    const restored = JSON.parse(JSON.stringify(c));
    expect(clockDisplayMs(restored, 91_500)).toBe(90_500);
  });

  it('freezes on pause and resumes without losing time', () => {
    let c = applyClockAction(createClock('main', 'up', 0, 'p'), { type: 'start', at: 0 });
    c = applyClockAction(c, { type: 'pause', at: 30_000 });
    expect(clockDisplayMs(c, 999_999)).toBe(30_000);
    c = applyClockAction(c, { type: 'resume', at: 100_000 });
    expect(clockDisplayMs(c, 110_000)).toBe(40_000);
    expect(c.version).toBe(3);
  });

  it('counts down and clamps at zero', () => {
    let c = applyClockAction(createClock('main', 'down', 10_000, 'p1'), { type: 'start', at: 0 });
    expect(clockDisplayMs(c, 4_000)).toBe(6_000);
    expect(clockDisplayMs(c, 50_000)).toBe(0);
    c = applyClockAction(c, { type: 'pause', at: 50_000 });
    expect(c.baseMs).toBe(0);
    expect(() => applyClockAction(c, { type: 'start', at: 50_001 })).toThrow(/zero/);
  });

  it('requires a reason for corrections and never goes negative', () => {
    const c = createClock('main', 'up', 0, 'p');
    expect(() => applyClockAction(c, { type: 'set', at: 0, ms: 5, reason: '' })).toThrow(/reason/);
    expect(() => applyClockAction(c, { type: 'set', at: 0, ms: -1, reason: 'x' })).toThrow(/negative/);
    expect(applyClockAction(c, { type: 'set', at: 0, ms: 600_000, reason: 'ref' }).baseMs).toBe(600_000);
  });

  it('rejects double start', () => {
    const c = applyClockAction(createClock('main', 'up', 0, 'p'), { type: 'start', at: 0 });
    expect(() => applyClockAction(c, { type: 'start', at: 1 })).toThrow(/already running/);
  });

  it('two clients with different local clocks agree once offsets are applied (A13)', () => {
    const c = applyClockAction(createClock('main', 'up', 0, 'p'), { type: 'start', at: 1_000_000 });
    const serverNow = 1_065_432;
    const clientA = { skew: 3_210 }; // client clock 3.2 s ahead
    const clientB = { skew: -870 };
    const offA = estimateServerOffset([{ sentAt: serverNow + clientA.skew - 40, serverAt: serverNow, receivedAt: serverNow + clientA.skew + 40 }]);
    const offB = estimateServerOffset([{ sentAt: serverNow + clientB.skew - 120, serverAt: serverNow, receivedAt: serverNow + clientB.skew + 100 }]);
    const a = clockDisplayMs(c, serverNow + clientA.skew + offA);
    const b = clockDisplayMs(c, serverNow + clientB.skew + offB);
    expect(Math.abs(a - b)).toBeLessThan(250);
  });

  it('formats clocks', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(5_430_000)).toBe('90:30');
    expect(formatClock(12_345, { tenths: true })).toBe('12.3');
  });
});
