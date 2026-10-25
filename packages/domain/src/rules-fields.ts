// The editable settings of a sport's rules, read from its config schema, so one form edits every sport's rules
// (period lengths, breaks, timeouts, extra time…) and saves them as a competition's rules or a preset of its own.
// Each setting belongs to a group (the match's timing, what happens when the scores are level, everything else),
// and regulationTimeline lays the match's periods and breaks out in order for a picture of the timing.
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
  /** shown only when another setting has this value (the quarter break when the sport plays quarters) */
  visibleWhen?: { path: string; equals: string };
  group: RulesGroup;
  /** the value used when saved rules do not have this setting yet */
  defaultValue?: unknown;
}

export type RulesGroup = 'name' | 'timing' | 'level' | 'other';
export const RULES_GROUP_LABELS: Record<Exclude<RulesGroup, 'name'>, string> = { timing: 'Match timing', level: 'When the scores are level', other: 'Other rules' };

const TIMING = /^(format|periodMinutes|quarterBreakMinutes|halfTimeMinutes|clock\..+)$/;
const LEVEL = /^(extraTime|goldenPoint|shootout)\.|^(overtimeMinutes|overtimeBreakMinutes|maxOvertimes)$/;
const groupOf = (path: string): RulesGroup => (path === 'label' ? 'name' : TIMING.test(path) ? 'timing' : LEVEL.test(path) ? 'level' : 'other');

const LABELS: Record<string, string> = {
  label: 'Name of these rules',
  periodMinutes: 'Period length (minutes)',
  halfTimeMinutes: 'Half-time break (minutes)',
  quarterBreakMinutes: 'Break between quarters (minutes)',
  format: 'Halves or quarters',
  overtimeBreakMinutes: 'Break before each overtime (minutes)',
  'extraTime.breakMinutes': 'Break before extra time (minutes)',
  'extraTime.intervalMinutes': 'Break between the extra-time halves (minutes)',
  'goldenPoint.breakMinutes': 'Break before golden point (minutes)',
  'goldenPoint.intervalMinutes': 'Break when ends change in golden point (minutes)',
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
/** The default a setting has in the schema (for rules saved before the setting existed). */
const defaultOf = (s: z.ZodType): unknown => (s instanceof z.ZodDefault ? (s as unknown as { parse: (v: unknown) => unknown }).parse(undefined) : s instanceof z.ZodOptional || s instanceof z.ZodNullable ? defaultOf(s.unwrap() as z.ZodType) : undefined);

/** The settings a sport's rules have, in the order its schema lists them. */
export function rulesFields(sport: Sport): RulesField[] {
  const out: RulesField[] = [];
  const walk = (schema: z.ZodType, prefix: string) => {
    const s = unwrap(schema);
    if (!(s instanceof z.ZodObject)) return;
    const shape = s.shape as Record<string, z.ZodType>;
    const enabled = 'enabled' in shape ? `${prefix}enabled` : undefined;
    const hasFormat = !prefix && 'format' in shape;
    for (const [key, raw] of Object.entries(shape)) {
      const path = `${prefix}${key}`;
      const f = unwrap(raw);
      const label = (key === 'periodMinutes' && !prefix ? (hasFormat ? 'Period length (minutes)' : PERIOD_WORD[sport]) : undefined) ?? LABELS[path] ?? LABELS[key] ?? key;
      const common = {
        path,
        label,
        group: groupOf(path),
        ...(enabled && path !== enabled ? { dependsOn: enabled } : {}),
        ...(hasFormat && key === 'quarterBreakMinutes' ? { visibleWhen: { path: 'format', equals: 'quarters' } } : {}),
        ...(defaultOf(raw) !== undefined ? { defaultValue: defaultOf(raw) } : {}),
      };
      if (f instanceof z.ZodObject) walk(f, `${path}.`);
      else if (f instanceof z.ZodNumber) out.push({ ...common, kind: 'number', min: f.minValue ?? undefined, max: f.maxValue ?? undefined });
      else if (f instanceof z.ZodBoolean) out.push({ ...common, kind: 'boolean' });
      else if (f instanceof z.ZodEnum) out.push({ ...common, kind: 'select', options: (f.options as string[]).map((v) => ({ value: v, label: OPTION_LABELS[v] ?? v })) });
      else if (f instanceof z.ZodString) out.push({ ...common, kind: 'text', max: f.maxLength ?? undefined });
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

/** Is a setting shown, given the other settings (extra-time lengths only with extra time, quarter breaks only with quarters)? */
export function rulesFieldVisible(f: RulesField, config: Record<string, unknown>): boolean {
  if (f.dependsOn && !getRulesValue(config, f.dependsOn)) return false;
  if (f.visibleWhen && (getRulesValue(config, f.visibleWhen.path) ?? 'quarters') !== f.visibleWhen.equals) return false;
  return true;
}

export interface TimelineStep {
  kind: 'play' | 'break';
  /** "1st Half", "Half Time", "Quarter Time"… */
  label: string;
  minutes: number;
}

/**
 * The match as its rules lay it out: each regulation period and the break after it, in order, with their lengths
 * ("1st Half 18 · Half Time 5 · 2nd Half 18"), and the totals. Extra time, overtime and shoot-outs only happen when
 * the scores are level and are left out. Null when the rules are not valid.
 */
export function regulationTimeline(sport: Sport, config: Record<string, unknown>): { steps: TimelineStep[]; playMinutes: number; totalMinutes: number } | null {
  const adapter = getAdapter(sport);
  const parsed = adapter.configSchema.safeParse(config);
  if (!parsed.success) return null;
  const c = parsed.data as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const phases = adapter.phases(parsed.data as never);
  const extra = (tags: string[]) => tags.some((t) => t === 'extra_time' || t === 'overtime' || t === 'shootout' || t === 'extra_time_interval');
  const playIdx = phases.map((p, i) => (p.kind === 'play' && !extra(p.tags) ? i : -1)).filter((i) => i >= 0);
  if (!playIdx.length) return null;
  const steps: TimelineStep[] = [];
  for (let i = playIdx[0]!; i <= playIdx[playIdx.length - 1]!; i++) {
    const p = phases[i]!;
    if (p.kind === 'play') steps.push({ kind: 'play', label: p.label, minutes: num(c.periodMinutes) });
    else if (p.kind === 'break' && !p.tags.includes('players_entering') && !p.tags.includes('about_to_start'))
      steps.push({ kind: 'break', label: p.label, minutes: num(p.tags.includes('half_time') ? c.halfTimeMinutes : c.quarterBreakMinutes) });
  }
  const playMinutes = steps.filter((s) => s.kind === 'play').reduce((a, s) => a + s.minutes, 0);
  return { steps, playMinutes, totalMinutes: steps.reduce((a, s) => a + s.minutes, 0) };
}
