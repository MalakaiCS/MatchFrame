// Server-owned clock model. Only clock *actions* are persisted; display time is derived from an anchor.
// up:   displayMs = baseMs + max(0, now - anchorAt)        while running
// down: displayMs = max(0, baseMs - max(0, now - anchorAt)) while running

export type ClockDirection = 'up' | 'down';

export interface ClockState {
  id: string; // 'main' | 'shot'
  direction: ClockDirection;
  baseMs: number; // accumulated (up) or remaining (down) value at anchorAt / when paused
  anchorAt: number | null; // server epoch ms when the clock last started running
  running: boolean;
  periodId: string;
  version: number;
  limitMs?: number | null; // nominal period length (up clocks: stoppage begins after; down: start value)
}

export type ClockAction =
  | { type: 'start'; at: number }
  | { type: 'pause'; at: number }
  | { type: 'resume'; at: number }
  | { type: 'set'; at: number; ms: number; reason: string } // reasoned correction
  | { type: 'reset'; at: number; ms: number; periodId?: string; limitMs?: number | null; direction?: ClockDirection };

export function createClock(
  id: string,
  direction: ClockDirection,
  baseMs: number,
  periodId: string,
  limitMs: number | null = null,
): ClockState {
  return { id, direction, baseMs, anchorAt: null, running: false, periodId, version: 0, limitMs };
}

export function clockDisplayMs(c: ClockState, nowMs: number): number {
  if (!c.running || c.anchorAt == null) return Math.max(0, c.baseMs);
  const delta = Math.max(0, nowMs - c.anchorAt);
  return c.direction === 'up' ? c.baseMs + delta : Math.max(0, c.baseMs - delta);
}

/** Has a running down-clock reached zero? Raises an alert only; never infers a period end. */
export function clockExpired(c: ClockState, nowMs: number): boolean {
  return c.direction === 'down' && clockDisplayMs(c, nowMs) === 0;
}

export class ClockActionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function applyClockAction(c: ClockState, a: ClockAction): ClockState {
  const next = { ...c, version: c.version + 1 };
  switch (a.type) {
    case 'start':
    case 'resume':
      if (c.running) throw new ClockActionError('CLOCK_ALREADY_RUNNING', 'Clock is already running');
      if (c.direction === 'down' && c.baseMs <= 0) throw new ClockActionError('CLOCK_AT_ZERO', 'Clock is at zero');
      return { ...next, running: true, anchorAt: a.at };
    case 'pause':
      if (!c.running) throw new ClockActionError('CLOCK_NOT_RUNNING', 'Clock is not running');
      return { ...next, running: false, baseMs: clockDisplayMs(c, a.at), anchorAt: null };
    case 'set':
      if (!a.reason?.trim()) throw new ClockActionError('REASON_REQUIRED', 'A clock correction needs a reason');
      if (a.ms < 0) throw new ClockActionError('INVALID_CLOCK_VALUE', 'Clock value cannot be negative');
      return { ...next, baseMs: a.ms, anchorAt: c.running ? a.at : null };
    case 'reset':
      return {
        ...next,
        running: false,
        anchorAt: null,
        baseMs: a.ms,
        periodId: a.periodId ?? c.periodId,
        limitMs: a.limitMs === undefined ? c.limitMs : a.limitMs,
        direction: a.direction ?? c.direction,
      };
  }
}

/** Client-side interpolation with a measured server offset (serverNow ≈ performanceNowEpoch + offset). */
export function estimateServerOffset(samples: { sentAt: number; serverAt: number; receivedAt: number }[]): number {
  if (samples.length === 0) return 0;
  // Use the lowest round-trip samples (least queueing) and take their median offset.
  const scored = samples
    .map((s) => ({ rtt: s.receivedAt - s.sentAt, offset: s.serverAt - (s.sentAt + (s.receivedAt - s.sentAt) / 2) }))
    .sort((a, b) => a.rtt - b.rtt)
    .slice(0, Math.max(1, Math.ceil(samples.length / 2)))
    .map((s) => s.offset)
    .sort((a, b) => a - b);
  return scored[Math.floor(scored.length / 2)]!;
}

export function formatClock(ms: number, opts: { tenths?: boolean } = {}): string {
  const total = Math.max(0, ms);
  if (opts.tenths && total < 60_000) {
    const s = Math.floor(total / 1000);
    const t = Math.floor((total % 1000) / 100);
    return `${s}.${t}`;
  }
  const totalSec = Math.floor(total / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
