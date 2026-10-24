import { describe, expect, it } from 'vitest';
import { getAdapter } from './engine';
import { getRulesValue, rulesFields, setRulesValue } from './rules-fields';
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
});
