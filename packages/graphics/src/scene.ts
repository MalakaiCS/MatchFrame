// Constrained designer scene (spec §10): text, image, rectangle, group and sponsor-slot elements with
// position/size, anchor, alignment, typography, colours, opacity, z-order and simple entrance/exit.
import { z } from 'zod';
import { bindingSchema, validateBindingPath } from './bindings';
import { LAYERS, variableSchema } from './catalog';

const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Use #RRGGBB or #RRGGBBAA');
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const anim = z.enum(['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'wipe']);

const base = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  name: z.string().max(60),
  x: num(-1920, 3840),
  y: num(-1080, 2160),
  w: num(1, 1920),
  h: num(1, 1080),
  anchor: z.enum(['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']).default('tl'),
  opacity: num(0, 1).default(1),
  z: z.number().int().min(0).max(999).default(0),
  hidden: z.boolean().optional(),
  animation: z.object({ in: anim.default('fade'), out: anim.default('fade'), delayMs: num(0, 2000).default(0) }).default({ in: 'fade', out: 'fade', delayMs: 0 }),
};

const textEl = z.object({
  ...base,
  type: z.literal('text'),
  text: z.union([z.string().max(200), bindingSchema]),
  fontSize: num(8, 200),
  minFontSize: num(8, 200).optional(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]).default(700),
  color: z.union([color, bindingSchema]).default('#FFFFFF'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  uppercase: z.boolean().optional(),
});
const imageEl = z.object({ ...base, type: z.literal('image'), assetId: z.string().uuid().optional(), source: bindingSchema.optional(), fit: z.enum(['contain', 'cover']).default('contain') });
const rectEl = z.object({ ...base, type: z.literal('rect'), fill: z.union([color, bindingSchema]).default('#131F32'), radius: num(0, 200).default(0), stroke: color.optional(), strokeWidth: num(0, 20).optional() });
const slotEl = z.object({ ...base, type: z.literal('sponsor_slot'), placement: z.enum(['scorebug_logo', 'lower_third_banner', 'event_partner', 'detached_logo', 'full_frame_image']) });

export type SceneElement = z.infer<typeof textEl> | z.infer<typeof imageEl> | z.infer<typeof rectEl> | z.infer<typeof slotEl> | (z.infer<z.ZodObject<typeof base>> & { type: 'group'; children: SceneElement[] });

export const elementSchema: z.ZodType<SceneElement> = z.lazy(() =>
  z.union([textEl, imageEl, rectEl, slotEl, z.object({ ...base, type: z.literal('group'), children: z.array(elementSchema).max(50) })]),
) as z.ZodType<SceneElement>;

export const sceneSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(60),
  category: z.enum(['Scorebug', 'Match', 'Teams', 'Events', 'Stats', 'People', 'Sponsors', 'Media']),
  layer: z.enum(LAYERS),
  sports: z.array(z.enum(['football', 'basketball'])).min(1),
  entranceMs: num(0, 2000).default(300),
  holdMs: num(0, 600_000).nullable().default(null),
  exitMs: num(0, 2000).default(250),
  variables: z.array(variableSchema).max(20).default([]),
  elements: z.array(elementSchema).max(200),
});
export type Scene = z.infer<typeof sceneSchema>;

export interface SceneIssue {
  path: string;
  message: string;
}

function walk(els: SceneElement[], fn: (e: SceneElement, path: string) => void, prefix = 'elements') {
  els.forEach((e, i) => {
    fn(e, `${prefix}[${i}]`);
    if (e.type === 'group') walk(e.children, fn, `${prefix}[${i}].children`);
  });
}

/** Publish-time validation: schema, binding paths, variable references, ids, safe bounds and limits. */
export function validateScene(input: unknown): { ok: true; scene: Scene; warnings: SceneIssue[] } | { ok: false; issues: SceneIssue[] } {
  const r = sceneSchema.safeParse(input);
  if (!r.success) return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  const scene = r.data;
  const issues: SceneIssue[] = [];
  const warnings: SceneIssue[] = [];
  const ids = new Set<string>();
  const varKeys = scene.variables.map((v) => v.key);
  let count = 0;
  walk(scene.elements, (e, path) => {
    count++;
    if (ids.has(e.id)) issues.push({ path, message: `Duplicate element id "${e.id}"` });
    ids.add(e.id);
    const check = (b: unknown, field: string) => {
      if (b && typeof b === 'object' && 'binding' in (b as object)) {
        const err = validateBindingPath((b as { binding: string }).binding, varKeys);
        if (err) issues.push({ path: `${path}.${field}`, message: err });
      }
    };
    if (e.type === 'text') {
      check(e.text, 'text');
      check(e.color, 'color');
      if (e.minFontSize && e.minFontSize > e.fontSize) issues.push({ path, message: 'Minimum font size is larger than the font size' });
    }
    if (e.type === 'image') check(e.source, 'source');
    if (e.type === 'rect') check(e.fill, 'fill');
    const safe = 1920 * 0.05;
    const safeY = 1080 * 0.05;
    if (scene.layer !== 'fullframe' && scene.layer !== 'background' && (e.x < safe || e.y < safeY || e.x + e.w > 1920 - safe || e.y + e.h > 1080 - safeY)) {
      warnings.push({ path, message: `"${e.name}" extends outside the 5% title-safe area` });
    }
  });
  if (count > 200) issues.push({ path: 'elements', message: 'Too many elements (max 200)' });
  return issues.length ? { ok: false, issues } : { ok: true, scene, warnings };
}

export function emptyScene(name = 'New graphic'): Scene {
  return { version: 1, name, category: 'People', layer: 'lower', sports: ['football', 'basketball'], entranceMs: 300, holdMs: null, exitMs: 250, variables: [{ key: 'heading', label: 'Heading', type: 'text', required: true, maxLength: 48 }], elements: [
    { id: 'bg', name: 'Panel', type: 'rect', x: 96, y: 820, w: 900, h: 140, anchor: 'tl', opacity: 1, z: 0, fill: '#131F32', radius: 6, animation: { in: 'slide-left', out: 'fade', delayMs: 0 } },
    { id: 'title', name: 'Heading', type: 'text', x: 130, y: 850, w: 830, h: 80, anchor: 'tl', opacity: 1, z: 1, text: { binding: 'variables.heading', fallback: '' }, fontSize: 56, minFontSize: 32, fontWeight: 700, color: '#F3F6FB', align: 'left', animation: { in: 'fade', out: 'fade', delayMs: 80 } },
  ] };
}
