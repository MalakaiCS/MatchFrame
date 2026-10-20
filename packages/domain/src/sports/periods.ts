// Shared phase model for period-based sports (quarters or halves): the pre-match walk-out, the periods and
// their breaks, the second-half walk-out, optional extra time and shootout, then full time. Football and
// basketball keep their own hand-written models; netball, rugby league, AFL and hockey build on this.
import { applyClockAction, type ClockDirection, type ClockState } from '../clock';
import type { MatchProjection, PhaseDef } from '../types';

export interface PeriodSpec {
  /** regulation periods: 2 (halves) or 4 (quarters) */
  count: number;
  period: (n: number) => { label: string; short: string };
  /** label of the break after period n (half marks the long interval) */
  interval: (n: number, half: boolean) => { label: string; short: string };
  extra: { count: number; period: (n: number) => { label: string; short: string }; beforeLabel: string } | null;
  shootout: { label: string; short: string } | null;
  final: { label: string; short: string };
}

export const halfOf = (spec: PeriodSpec) => Math.floor(spec.count / 2);

export function periodPhases(spec: PeriodSpec): PhaseDef[] {
  const out: PhaseDef[] = [
    { id: 'scheduled', label: 'Scheduled', short: 'SCH', kind: 'pre', tags: [] },
    { id: 'ready', label: 'Ready', short: 'RDY', kind: 'pre', tags: [] },
    { id: 'pre_match', label: 'Pre-match', short: 'PRE', kind: 'pre', tags: ['pre_match'] },
    { id: 'players_entering', label: 'Players entering', short: 'ENT', kind: 'pre', tags: ['players_entering'] },
    { id: 'about_to_start', label: 'About to start', short: 'KO', kind: 'pre', tags: ['about_to_start'] },
  ];
  const half = halfOf(spec);
  for (let i = 1; i <= spec.count; i++) {
    const { label, short } = spec.period(i);
    out.push({ id: `p${i}`, label, short, kind: 'play', tags: i === 1 ? ['period_start', 'first_period'] : ['period_start'] });
    if (i < spec.count) {
      const isHalf = i === half;
      const b = spec.interval(i, isHalf);
      out.push({ id: isHalf ? 'half_time' : `break_${i}`, label: b.label, short: b.short, kind: 'break', tags: isHalf ? ['half_time', 'interval', 'period_break'] : ['interval', 'period_break'] });
      if (isHalf) {
        out.push({ id: 'second_half_entering', label: 'Players entering (2nd half)', short: 'ENT', kind: 'break', tags: ['players_entering', 'second_half_entering'] });
        out.push({ id: 'second_half_ready', label: 'About to start (2nd half)', short: 'KO', kind: 'break', tags: ['about_to_start', 'second_half_ready'] });
      }
    }
  }
  if (spec.extra) {
    out.push({ id: 'extra_time_break', label: spec.extra.beforeLabel, short: 'ET', kind: 'break', tags: ['extra_time_interval', 'interval'] });
    for (let k = 1; k <= spec.extra.count; k++) {
      const { label, short } = spec.extra.period(k);
      out.push({ id: `et${k}`, label, short, kind: 'play', tags: ['period_start', 'extra_time'] });
      if (k < spec.extra.count) out.push({ id: `et_break_${k}`, label: 'Extra Time Break', short: 'ETB', kind: 'break', tags: ['extra_time_interval', 'interval'] });
    }
  }
  if (spec.shootout) out.push({ id: 'shootout', label: spec.shootout.label, short: spec.shootout.short, kind: 'play', tags: ['shootout'] });
  out.push(
    { id: 'full_time', label: spec.final.label, short: spec.final.short, kind: 'final', tags: ['full_time'] },
    { id: 'postponed', label: 'Postponed', short: 'PPD', kind: 'terminal', tags: [] },
    { id: 'abandoned', label: 'Abandoned', short: 'ABD', kind: 'terminal', tags: [] },
    { id: 'cancelled', label: 'Cancelled', short: 'CAN', kind: 'terminal', tags: [] },
  );
  return out;
}

/** Index of a play phase: regulation `p3` → { kind: 'reg', n: 3 }; `et2` → { kind: 'et', n: 2 }. */
export function periodOf(phase: string): { kind: 'reg' | 'et'; n: number } | null {
  let m = /^p(\d+)$/.exec(phase);
  if (m) return { kind: 'reg', n: Number(m[1]) };
  m = /^et(\d+)$/.exec(phase);
  if (m) return { kind: 'et', n: Number(m[1]) };
  return null;
}

export function periodTransitions(spec: PeriodSpec, p: MatchProjection, opts: { extraTime: boolean; shootout: boolean }): string[] {
  const tied = p.score.home === p.score.away;
  const half = halfOf(spec);
  const pre: Record<string, string[]> = {
    scheduled: ['ready', 'pre_match', 'p1', 'postponed', 'cancelled'],
    ready: ['pre_match', 'players_entering', 'about_to_start', 'p1', 'postponed', 'cancelled'],
    pre_match: ['players_entering', 'about_to_start', 'p1', 'postponed', 'abandoned', 'cancelled'],
    players_entering: ['about_to_start', 'p1', 'abandoned'],
    about_to_start: ['p1', 'abandoned'],
    half_time: ['second_half_entering', 'second_half_ready', `p${half + 1}`, 'abandoned'],
    second_half_entering: ['second_half_ready', `p${half + 1}`, 'abandoned'],
    second_half_ready: [`p${half + 1}`, 'abandoned'],
    extra_time_break: ['et1', 'abandoned'],
    shootout: ['full_time', 'abandoned'],
    postponed: ['scheduled', 'cancelled'],
  };
  if (pre[p.phase]) return pre[p.phase]!;
  const per = periodOf(p.phase);
  const endOfRegulation = () => {
    const out = ['full_time'];
    if (tied && opts.extraTime && spec.extra) out.push('extra_time_break');
    if (tied && opts.shootout && spec.shootout) out.push('shootout');
    return [...out, 'abandoned'];
  };
  if (per?.kind === 'reg') return per.n < spec.count ? [per.n === half ? 'half_time' : `break_${per.n}`, 'abandoned'] : endOfRegulation();
  if (per?.kind === 'et' && spec.extra) {
    if (per.n < spec.extra.count) return [`et_break_${per.n}`, 'abandoned'];
    return tied && opts.shootout && spec.shootout ? ['full_time', 'shootout', 'abandoned'] : ['full_time', 'abandoned'];
  }
  let m = /^break_(\d+)$/.exec(p.phase);
  if (m) return [`p${Number(m[1]) + 1}`, 'abandoned'];
  m = /^et_break_(\d+)$/.exec(p.phase);
  if (m) return [`et${Number(m[1]) + 1}`, 'abandoned'];
  return [];
}

export const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor((n % 100) / 10) === 1 ? 0 : n % 10]}`;

/** Main-clock handling shared by period sports: play phases reset (and start) the clock, breaks pause it. */
export function clocksForPeriodPhase(
  opts: { direction: ClockDirection; lengthMs: (phase: string) => number | null; cumulativeBaseMs?: (phase: string) => number },
  to: string,
  clocks: Record<string, ClockState>,
  at: number,
): Record<string, ClockState> {
  const main = clocks.main!;
  const len = opts.lengthMs(to);
  if (len != null) {
    const base = opts.direction === 'down' ? len : (opts.cumulativeBaseMs?.(to) ?? 0);
    const limit = opts.direction === 'down' ? len : base + len;
    const reset = applyClockAction(main, { type: 'reset', at, ms: base, periodId: to, limitMs: limit });
    return { ...clocks, main: applyClockAction(reset, { type: 'start', at }) };
  }
  if (main.running) return { ...clocks, main: { ...applyClockAction(main, { type: 'pause', at }), periodId: to } };
  return { ...clocks, main: { ...main, periodId: to } };
}

/** Phase-kind aware clock text for the scorebug: FT / HT / the break's short code, else the running time. */
export function periodClockText(phase: PhaseDef, runningText: string): string {
  if (phase.kind === 'final') return 'FT';
  if (phase.id.startsWith('second_half_')) return 'HT';
  if (phase.kind === 'break') return phase.short;
  if (phase.kind === 'pre') return runningText;
  return runningText;
}
