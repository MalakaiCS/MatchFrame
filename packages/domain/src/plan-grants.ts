// How long a plan set by site staff lasts. Every staff change to an organisation's plan has an end: a number of
// days, calendar months, a chosen date, or Permanent (which has to be picked on purpose). When it ends the
// organisation goes back to the plan it pays for, or to no plan.

export const PLAN_GRANT_DURATIONS = [
  { key: '1d', label: '1 day', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '14d', label: '14 days', days: 14 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '60d', label: '60 days', days: 60 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '1m', label: '1 month', months: 1 },
  { key: '3m', label: '3 months', months: 3 },
  { key: '6m', label: '6 months', months: 6 },
  { key: '12m', label: '12 months', months: 12 },
  { key: 'date', label: 'Until a date' },
  { key: 'permanent', label: 'Permanent' },
] as const satisfies readonly { key: string; label: string; days?: number; months?: number }[];

export type PlanGrantDuration = (typeof PLAN_GRANT_DURATIONS)[number]['key'];
export const PLAN_GRANT_KEYS = PLAN_GRANT_DURATIONS.map((d) => d.key) as [PlanGrantDuration, ...PlanGrantDuration[]];

/** The furthest a chosen end date may be (anything longer is Permanent). */
export const PLAN_GRANT_MAX_YEARS = 5;

/** Calendar months later at the same time of day; the 31st becomes the month's last day when it has fewer days. */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export class PlanGrantError extends Error {}

/**
 * When a plan given now ends: a Date, or null for Permanent. 'date' takes the chosen moment, which must be later
 * than now and within PLAN_GRANT_MAX_YEARS.
 */
export function planGrantEnd(duration: PlanGrantDuration, now: Date, until?: string | Date | null): Date | null {
  if (duration === 'permanent') return null;
  if (duration === 'date') {
    const end = until ? new Date(until) : null;
    if (!end || Number.isNaN(end.getTime())) throw new PlanGrantError('Choose the date the plan ends');
    if (end.getTime() <= now.getTime()) throw new PlanGrantError('The end date has to be in the future');
    if (end.getTime() > addMonths(now, 12 * PLAN_GRANT_MAX_YEARS).getTime()) throw new PlanGrantError(`Choose a date within ${PLAN_GRANT_MAX_YEARS} years, or Permanent`);
    return end;
  }
  const d = PLAN_GRANT_DURATIONS.find((x) => x.key === duration);
  if (!d) throw new PlanGrantError('Choose how long the plan lasts');
  if ('days' in d) return new Date(now.getTime() + d.days * 86_400_000);
  if ('months' in d) return addMonths(now, d.months);
  throw new PlanGrantError('Choose how long the plan lasts');
}
