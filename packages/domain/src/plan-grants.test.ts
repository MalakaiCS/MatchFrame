import { describe, expect, it } from 'vitest';
import { PLAN_GRANT_DURATIONS, PlanGrantError, addMonths, planGrantEnd } from './plan-grants';

const now = new Date('2026-01-31T09:30:00Z');

describe('plan grant durations', () => {
  it('offers days, months, a date and permanent', () => {
    expect(PLAN_GRANT_DURATIONS.map((d) => d.label)).toEqual(['1 day', '7 days', '14 days', '30 days', '60 days', '90 days', '1 month', '3 months', '6 months', '12 months', 'Until a date', 'Permanent']);
  });

  it('adds days to the minute', () => {
    expect(planGrantEnd('1d', now)!.toISOString()).toBe('2026-02-01T09:30:00.000Z');
    expect(planGrantEnd('30d', now)!.toISOString()).toBe('2026-03-02T09:30:00.000Z');
    expect(planGrantEnd('90d', now)!.toISOString()).toBe('2026-05-01T09:30:00.000Z');
  });

  it('adds calendar months, ending on the last day of a shorter month', () => {
    expect(planGrantEnd('1m', now)!.toISOString()).toBe('2026-02-28T09:30:00.000Z');
    expect(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(planGrantEnd('12m', now)!.toISOString()).toBe('2027-01-31T09:30:00.000Z');
    expect(planGrantEnd('3m', new Date('2026-11-30T12:00:00Z'))!.toISOString()).toBe('2027-02-28T12:00:00.000Z');
  });

  it('permanent has no end', () => {
    expect(planGrantEnd('permanent', now)).toBeNull();
  });

  it('a chosen date must be in the future and within five years', () => {
    expect(planGrantEnd('date', now, '2026-03-15T00:00:00Z')!.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(() => planGrantEnd('date', now)).toThrow(PlanGrantError);
    expect(() => planGrantEnd('date', now, '2026-01-01T00:00:00Z')).toThrow('in the future');
    expect(() => planGrantEnd('date', now, '2032-01-01T00:00:00Z')).toThrow('within 5 years');
    expect(() => planGrantEnd('date', now, 'not a date')).toThrow(PlanGrantError);
  });
});
