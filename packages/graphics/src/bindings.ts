// Constrained data bindings for designer templates (spec §10). No user JavaScript, HTML, CSS URLs or
// free expressions: a binding is a whitelisted path plus a bounded list of typed transforms.
import { z } from 'zod';
import { formatClock, getAdapter } from '@bs/domain';
import type { RenderData } from './data';

export const BINDING_PATHS = {
  'match.homeTeam.name': 'text',
  'match.homeTeam.shortName': 'text',
  'match.homeTeam.abbreviation': 'text',
  'match.homeTeam.primaryColor': 'color',
  'match.homeTeam.logo': 'image',
  'match.awayTeam.name': 'text',
  'match.awayTeam.shortName': 'text',
  'match.awayTeam.abbreviation': 'text',
  'match.awayTeam.primaryColor': 'color',
  'match.awayTeam.logo': 'image',
  'match.score.home': 'number',
  'match.score.away': 'number',
  'match.periodLabel': 'text',
  'match.clock': 'text',
  'match.competition.name': 'text',
  'match.venue': 'text',
  'variables.*': 'any',
  'player.displayName': 'text',
  'player.number': 'number',
  'player.photo': 'image',
} as const;

export const transformSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('uppercase') }),
  z.object({ type: z.literal('lowercase') }),
  z.object({ type: z.literal('number'), style: z.enum(['integer', 'one_decimal', 'percent']) }),
  z.object({ type: z.literal('format'), template: z.string().max(60).refine((t) => (t.match(/\{value\}/g) ?? []).length === 1 && !/[{}<>]/.test(t.replace('{value}', '')), 'Use exactly one {value} placeholder') }),
  z.object({ type: z.literal('fallback'), value: z.string().max(60) }),
]);

export const bindingSchema = z.object({
  binding: z.string().max(80),
  fallback: z.string().max(60).optional(),
  transforms: z.array(transformSchema).max(5).optional(),
});
export type Binding = z.infer<typeof bindingSchema>;

export function validateBindingPath(path: string, variableKeys: string[]): string | null {
  if (path.startsWith('variables.')) {
    const k = path.slice('variables.'.length);
    return variableKeys.includes(k) ? null : `Unknown variable "${k}"`;
  }
  return path in BINDING_PATHS ? null : `Unsupported binding "${path}"`;
}

export interface BindingContext {
  data: RenderData;
  variables: Record<string, unknown>;
  now: number;
  playerId?: string | null;
}

function raw(path: string, c: BindingContext): unknown {
  const m = c.data.match;
  const team = (s: 'home' | 'away') => m.teams[s];
  const disp = () => getAdapter(m.sport).display(m.rulesConfig as never, m.projection, m.clocks, c.now);
  switch (path) {
    case 'match.homeTeam.name': return team('home').name;
    case 'match.homeTeam.shortName': return team('home').shortName;
    case 'match.homeTeam.abbreviation': return team('home').abbreviation;
    case 'match.homeTeam.primaryColor': return team('home').primaryColor;
    case 'match.homeTeam.logo': return team('home').logoUrl;
    case 'match.awayTeam.name': return team('away').name;
    case 'match.awayTeam.shortName': return team('away').shortName;
    case 'match.awayTeam.abbreviation': return team('away').abbreviation;
    case 'match.awayTeam.primaryColor': return team('away').primaryColor;
    case 'match.awayTeam.logo': return team('away').logoUrl;
    case 'match.score.home': return m.projection.score.home;
    case 'match.score.away': return m.projection.score.away;
    case 'match.periodLabel': return disp().periodShort;
    case 'match.clock': return disp().clockText;
    case 'match.competition.name': return m.competition.name;
    case 'match.venue': return m.venue;
  }
  if (path.startsWith('variables.')) return c.variables[path.slice(10)];
  const pl = c.playerId ? c.data.players[c.playerId] : null;
  if (path === 'player.displayName') return pl?.displayName;
  if (path === 'player.number') return pl?.number;
  if (path === 'player.photo') return pl?.photoUrl;
  return undefined;
}

export function resolveBinding(b: Binding, c: BindingContext): string {
  let v: unknown = raw(b.binding, c);
  for (const t of b.transforms ?? []) {
    if (t.type === 'fallback' && (v == null || v === '')) v = t.value;
  }
  if (v == null || v === '') v = b.fallback ?? '';
  let s = typeof v === 'number' ? String(v) : String(v);
  for (const t of b.transforms ?? []) {
    if (t.type === 'uppercase') s = s.toUpperCase();
    if (t.type === 'lowercase') s = s.toLowerCase();
    if (t.type === 'number') {
      const n = Number(s);
      if (Number.isFinite(n)) s = t.style === 'integer' ? String(Math.round(n)) : t.style === 'one_decimal' ? n.toFixed(1) : `${Math.round(n)}%`;
    }
    if (t.type === 'format') s = t.template.replace('{value}', s);
  }
  return s.slice(0, 200);
}

export { formatClock };
