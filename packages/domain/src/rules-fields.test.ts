import { describe, expect, it } from 'vitest';
import { getAdapter } from './engine';
import { getRulesValue, regulationTimeline, rulesFields, rulesFieldVisible, setRulesValue } from './rules-fields';
import { SPORTS } from './types';

const leaves = (o: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));

describe('rules fields', () => {
  it('every setting of every sport’s rules has a field, with its limits and a label', () => {
    for (const sport of SPORTS) {
      const fields = rulesFields(sport);
      const cfg = getAdapter(sport).defaultConfig as Record<string, unknown>;
      expect(fields.map((f) => f.path).sort(), sport).toEqual(leaves(cfg).sort());
      for (const f of fields) expect(f.label, `${sport} ${f.path}`).not.toBe(f.path.split('.').pop());
      expect(fields[0]!.path).toBe('label');
    }
  });

  it('futsal: 2×18-minute halves with a 5-minute break, saved and checked by the futsal rules', () => {
    const fields = rulesFields('futsal');
    expect(fields.find((f) => f.path === 'periodMinutes')).toMatchObject({ label: 'Half length (minutes)', kind: 'number', min: 5, max: 30 });
    expect(fields.find((f) => f.path === 'halfTimeMinutes')).toMatchObject({ kind: 'number', min: 0, max: 20 });
    expect(fields.find((f) => f.path === 'extraTime.periodMinutes')).toMatchObject({ dependsOn: 'extraTime.enabled' });
    expect(fields.find((f) => f.path === 'clock.stopped')!.options!.map((o) => o.value)).toEqual(['always', 'final_minutes', 'never']);
    const a = getAdapter('futsal');
    let cfg = structuredClone(a.defaultConfig) as Record<string, unknown>;
    cfg = setRulesValue(cfg, 'periodMinutes', 18);
    cfg = setRulesValue(cfg, 'halfTimeMinutes', 5);
    cfg = setRulesValue(cfg, 'label', '2×18, 5-minute half time');
    expect(getRulesValue(cfg, 'periodMinutes')).toBe(18);
    expect(a.configSchema.safeParse(cfg).success).toBe(true);
    expect(a.describeRules(a.configSchema.parse(cfg))[0]).toMatch(/^2×18-minute halves.*half time up to 5 minutes/);
    expect(a.configSchema.safeParse(setRulesValue(cfg, 'periodMinutes', 45)).success).toBe(false);
    expect(getRulesValue(a.defaultConfig as Record<string, unknown>, 'periodMinutes')).toBe(20); // the original is untouched
  });

  it('timing settings are grouped apart from extra time and the other rules', () => {
    const group = (sport: Parameters<typeof rulesFields>[0], path: string) => rulesFields(sport).find((f) => f.path === path)?.group;
    expect(group('futsal', 'periodMinutes')).toBe('timing');
    expect(group('futsal', 'halfTimeMinutes')).toBe('timing');
    expect(group('futsal', 'clock.direction')).toBe('timing');
    expect(group('futsal', 'extraTime.breakMinutes')).toBe('level');
    expect(group('basketball', 'overtimeBreakMinutes')).toBe('level');
    expect(group('futsal', 'foulLimit')).toBe('other');
    expect(group('futsal', 'label')).toBe('name');
  });

  it('a quarter break shows only when the sport plays quarters; extra-time breaks only with extra time', () => {
    const hockey = getAdapter('hockey').defaultConfig as Record<string, unknown>;
    const qb = rulesFields('hockey').find((f) => f.path === 'quarterBreakMinutes')!;
    expect(rulesFieldVisible(qb, hockey)).toBe(true);
    expect(rulesFieldVisible(qb, setRulesValue(hockey, 'format', 'halves'))).toBe(false);
    const football = getAdapter('football').defaultConfig as Record<string, unknown>;
    const etBreak = rulesFields('football').find((f) => f.path === 'extraTime.breakMinutes')!;
    expect(etBreak).toMatchObject({ label: 'Break before extra time (minutes)', defaultValue: 5, min: 0 });
    expect(rulesFieldVisible(etBreak, football)).toBe(true);
    expect(rulesFieldVisible(etBreak, setRulesValue(football, 'extraTime.enabled', false))).toBe(false);
  });

  it('rules saved before the new timing settings still load, with the usual lengths', () => {
    const old = { format: 'quarters', periodMinutes: 10, overtimeMinutes: 5, maxOvertimes: 9, shotClock: { enabled: true, fullSeconds: 24, resetSeconds: 14 }, timeouts: { firstHalf: 2, secondHalf: 3, overtime: 1 }, teamFoulLimit: 4, playerFoulLimit: 5, label: 'Old' };
    expect(getAdapter('basketball').configSchema.parse(old)).toMatchObject({ quarterBreakMinutes: 2, halfTimeMinutes: 15, overtimeBreakMinutes: 2 });
    expect(getAdapter('hockey').configSchema.parse({ periodMinutes: 15, quarterBreakMinutes: 2, halfTimeMinutes: 10, shootout: { enabled: false }, label: 'Old' })).toMatchObject({ format: 'quarters' });
    expect(getAdapter('football').configSchema.parse({ periodMinutes: 45, halfTimeMinutes: 15, extraTime: { enabled: true, periodMinutes: 15 }, shootout: { enabled: true }, label: 'Old' })).toMatchObject({ extraTime: { breakMinutes: 5, intervalMinutes: 1 } });
    expect(getAdapter('netball').configSchema.parse({ periodMinutes: 15, quarterBreakMinutes: 4, halfTimeMinutes: 12, superShot: false, extraTime: { enabled: true, periodMinutes: 7 }, label: 'Old' })).toMatchObject({ format: 'quarters', extraTime: { breakMinutes: 4, intervalMinutes: 1 } });
  });

  it('the timeline of a match: periods and breaks in order, with the totals', () => {
    const futsal = setRulesValue(setRulesValue(getAdapter('futsal').defaultConfig as Record<string, unknown>, 'periodMinutes', 18), 'halfTimeMinutes', 5);
    expect(regulationTimeline('futsal', futsal)).toEqual({
      steps: [{ kind: 'play', label: '1st Half', minutes: 18 }, { kind: 'break', label: 'Half Time', minutes: 5 }, { kind: 'play', label: '2nd Half', minutes: 18 }],
      playMinutes: 36,
      totalMinutes: 41,
    });
    const basketball = regulationTimeline('basketball', getAdapter('basketball').defaultConfig as Record<string, unknown>)!;
    expect(basketball.steps.map((s) => `${s.label} ${s.minutes}`)).toEqual(['1st Quarter 10', 'End of Q1 2', '2nd Quarter 10', 'Half Time 15', '3rd Quarter 10', 'End of Q3 2', '4th Quarter 10']);
    expect(basketball.totalMinutes).toBe(59);
    const football = regulationTimeline('football', getAdapter('football').defaultConfig as Record<string, unknown>)!;
    expect(football.steps.map((s) => s.label)).toEqual(['1st Half', 'Half Time', '2nd Half']); // the walk-out steps are not breaks of their own
    expect(football.totalMinutes).toBe(105);
    expect(regulationTimeline('football', { periodMinutes: 500 })).toBeNull();
  });
});

describe('halves or quarters', () => {
  it('hockey and netball can play two halves: the phases, the clock and the description follow', () => {
    for (const sport of ['hockey', 'netball'] as const) {
      const a = getAdapter(sport);
      const cfg = a.configSchema.parse(setRulesValue(a.defaultConfig as Record<string, unknown>, 'format', 'halves')) as never;
      const ids = a.phases(cfg).filter((p) => p.kind === 'play' || p.id === 'half_time').map((p) => p.id);
      expect(ids.slice(0, 3), sport).toEqual(['p1', 'half_time', 'p2']);
      expect(ids, sport).not.toContain('p3');
      expect(a.phase(cfg, 'p2')?.label, sport).toBe('2nd Half');
      expect(a.describeRules(cfg)[0], sport).toMatch(/^2×\d+-minute halves/);
      expect(regulationTimeline(sport, cfg as never)!.steps.map((s) => s.label), sport).toEqual(['1st Half', 'Half Time', '2nd Half']);
    }
  });
});

