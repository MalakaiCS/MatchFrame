// The editable settings of a sport's rules, read from its config schema, so one form edits every sport's rules
// (period lengths, breaks, timeouts, extra time…) and saves them as a competition's rules or a preset of its own.
import { z } from 'zod';
import { getAdapter } from './engine';
import type { Sport } from './types';

export interface RulesField {
  /** dotted path into the config, e.g. "extraTime.periodMinutes" */
  path: string;
  label: string;
  kind: 'number' | 'boolean' | 'select' | 'text';
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  /** shown only when this boolean setting is on (e.g. the extra-time length when extra time is on) */
  dependsOn?: string;
}

const LABELS: Record<string, string> = {
  label: 'Name of these rules',
  periodMinutes: 'Period length (minutes)',
  halfTimeMinutes: 'Half-time break (minutes)',
  quarterBreakMinutes: 'Quarter-time break (minutes)',
  format: 'Format',
  overtimeMinutes: 'Overtime length (minutes)',
  maxOvertimes: 'Most overtimes',
  'extraTime.enabled': 'Extra time when level',
  'extraTime.periodMinutes': 'Extra-time period length (minutes)',
  'shootout.enabled': 'Shoot-out when level',
  'shootout.kicks': 'Shoot-out kicks each before sudden death',
  'shotClock.enabled': 'Shot clock',
  'shotClock.fullSeconds': 'Shot clock (seconds)',
  'shotClock.resetSeconds': 'Shot clock reset (seconds)',
  'timeouts.firstHalf': 'Timeouts in the first half',
  'timeouts.secondHalf': 'Timeouts in the second half',
  'timeouts.overtime': 'Timeouts per overtime',
  'timeouts.perPeriod': 'Timeouts per team in each half',
  'timeouts.seconds': 'Timeout length (seconds)',
  teamFoulLimit: 'Team fouls before the bonus',
  playerFoulLimit: 'Fouls before a player fouls out',
  superShot: 'Super shot (two-point goals in the power period)',
  'goldenPoint.enabled': 'Golden point when level',
  'goldenPoint.periodMinutes': 'Golden point period (minutes)',
  interchangeLimit: 'Interchanges per team',
  'clock.direction': 'The clock counts',
  'clock.stopped': 'Stopped clock',
  'clock.finalMinutes': 'Stopped in the final … minutes of each half',
  foulLimit: 'Accumulated fouls in a half before every further one is a 10 m kick',
  sendOffMinutes: 'Send-off: minutes of playing time a player short',
  sinBinMinutes: 'Sin bin: minutes of playing time off the field',
};
// where "period" means a half or a quarter
const PERIOD_WORD: Partial<Record<Sport, string>> = { football: 'Half length (minutes)', futsal: 'Half length (minutes)', rugby_league: 'Half length (minutes)', netball: 'Quarter length (minutes)', afl: 'Quarter length (minutes)', hockey: 'Quarter length (minutes)' };
const OPTION_LABELS: Record<string, string> = {
  quarters: 'Quarters',
  halves: 'Halves',
  down: 'Down',
  up: 'Up',
  always: 'Always (stop it whenever the ball is out of play)',
  final_minutes: 'Only in the final minutes of each half',
  never: 'Never (a running clock)',
};

const unwrap = (s: z.ZodType): z.ZodType => (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable ? unwrap(s.unwrap() as z.ZodType) : s);

/** The settings a sport's rules have, in the order its schema lists them. */
export function rulesFields(sport: Sport): RulesField[] {
  const out: RulesField[] = [];
  const walk = (schema: z.ZodType, prefix: string) => {
    const s = unwrap(schema);
    if (!(s instanceof z.ZodObject)) return;
    const shape = s.shape as Record<string, z.ZodType>;
    const enabled = 'enabled' in shape ? `${prefix}enabled` : undefined;
    for (const [key, raw] of Object.entries(shape)) {
      const path = `${prefix}${key}`;
      const f = unwrap(raw);
      const label = (key === 'periodMinutes' && !prefix ? PERIOD_WORD[sport] : undefined) ?? LABELS[path] ?? LABELS[key] ?? key;
      const dependsOn = enabled && path !== enabled ? enabled : undefined;
      if (f instanceof z.ZodObject) walk(f, `${path}.`);
      else if (f instanceof z.ZodNumber) out.push({ path, label, kind: 'number', min: f.minValue ?? undefined, max: f.maxValue ?? undefined, dependsOn });
      else if (f instanceof z.ZodBoolean) out.push({ path, label, kind: 'boolean', dependsOn });
      else if (f instanceof z.ZodEnum) out.push({ path, label, kind: 'select', options: (f.options as string[]).map((v) => ({ value: v, label: OPTION_LABELS[v] ?? v })), dependsOn });
      else if (f instanceof z.ZodString) out.push({ path, label, kind: 'text', max: f.maxLength ?? undefined });
    }
  };
  walk(getAdapter(sport).configSchema as z.ZodType, '');
  // the name first, then the rules
  return [...out.filter((x) => x.path === 'label'), ...out.filter((x) => x.path !== 'label')];
}

export function getRulesValue(config: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), config);
}

/** A copy of the config with one setting changed. */
export function setRulesValue(config: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const next = structuredClone(config);
  const keys = path.split('.');
  let o = next as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
  return next;
}
