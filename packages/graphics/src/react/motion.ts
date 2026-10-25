// Keyframe animations worked out in JavaScript, for drawing a still frame at an exact instant (the WebM export).
// The @keyframes text the live outputs play is read back and sampled, so a frame is plain styles and never depends
// on how a browser holds a paused or finished CSS animation: one held a finished exit at its time modulo its length,
// so a part that had left came back and left again until the end of the file.
import type { CSSProperties } from 'react';

interface Stop {
  at: number;
  decl: Record<string, string>;
}
export type KeyframeTable = Map<string, Stop[]>;

/** `@keyframes name{from{a:b}20%{…}to{…}}…` → the stops of each animation, in order */
export function parseKeyframes(css: string): KeyframeTable {
  const table: KeyframeTable = new Map();
  const head = /@keyframes\s+([\w-]+)\s*\{/g;
  for (let m = head.exec(css); m; m = head.exec(css)) {
    let i = head.lastIndex;
    for (let depth = 1; i < css.length && depth > 0; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    const stops: Stop[] = [];
    for (const [, sel, body] of css.slice(head.lastIndex, i - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decl: Record<string, string> = {};
      for (const d of body!.split(';')) {
        const k = d.indexOf(':');
        if (k > 0) decl[d.slice(0, k).trim()] = d.slice(k + 1).trim();
      }
      for (const s of sel!.split(',').map((x) => x.trim())) stops.push({ at: s === 'from' ? 0 : s === 'to' ? 1 : Number.parseFloat(s) / 100, decl });
    }
    table.set(m[1]!, stops.sort((a, b) => a.at - b.at));
    head.lastIndex = i;
  }
  return table;
}

const KEYWORDS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** A CSS timing function (cubic-bezier or a keyword) as a function of the time fraction. */
export function easing(fn: string): (x: number) => number {
  const m = /cubic-bezier\(([^)]*)\)/.exec(fn);
  const [x1, y1, x2, y2] = m ? (m[1]!.split(',').map(Number) as [number, number, number, number]) : (KEYWORDS[fn.trim()] ?? KEYWORDS.ease!);
  if (x1 === y1 && x2 === y2) return (x) => x;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const curveX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const curveY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0 || x >= 1) return x <= 0 ? 0 : 1;
    let t = x;
    for (let n = 0; n < 8; n++) {
      const e = curveX(t) - x;
      if (Math.abs(e) < 1e-7) return curveY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    // Newton did not settle: bisect
    let lo = 0, hi = 1;
    t = x;
    for (let n = 0; n < 40; n++) {
      if (curveX(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return curveY(t);
  };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const mix = (a: number, b: number, p: number) => a + (b - a) * p;

interface Fn {
  name: string;
  v: number;
  unit: string;
}
/** `translateX(-60px) scale(.85)` → its functions; null when a function has more than one argument */
function parseFns(s: string): Fn[] | null {
  if (s === 'none') return [];
  const fns: Fn[] = [];
  const rest = s.replace(/([a-zA-Z]+[a-zA-Z0-9]*)\(\s*(-?[\d.]+)([a-z%]*)\s*\)/g, (_, name: string, v: string, unit: string) => {
    fns.push({ name, v: Number(v), unit });
    return '';
  });
  return rest.trim() ? null : fns;
}
const identity = (f: Fn): Fn => ({ ...f, v: /^(scale|brightness|contrast|saturate)/.test(f.name) ? 1 : f.name === 'perspective' ? f.v : 0 });

/** transform and filter lists: function by function when they line up (`none` is the identity), else discrete */
function mixFns(a: string, b: string, p: number): string {
  const A = parseFns(a), B = parseFns(b);
  if (!A || !B) return p < 0.5 ? a : b;
  const fa = A.length ? A : B.map(identity), fb = B.length ? B : A.map(identity);
  if (fa.length !== fb.length || fa.some((f, i) => f.name !== fb[i]!.name || f.unit !== fb[i]!.unit)) return p < 0.5 ? a : b;
  return fa.length ? fa.map((f, i) => `${f.name}(${round(mix(f.v, fb[i]!.v, p))}${f.unit})`).join(' ') : 'none';
}

/** `inset(0 100% 0 0)` → four lengths in % (a bare 0 counts as 0%) */
function parseInset(s: string): number[] | null {
  const m = /^inset\(([^)]*)\)$/.exec(s.trim());
  if (!m) return null;
  const v = m[1]!.trim().split(/\s+/).map((x) => (/^-?[\d.]+%$/.test(x) || /^-?0*\.?0+$/.test(x) ? Number.parseFloat(x) : Number.NaN));
  if (v.some(Number.isNaN) || v.length < 1 || v.length > 4) return null;
  const [t, r = t, b = t, l = r] = v as [number, number?, number?, number?];
  return [t, r, b, l];
}

/** the value of the property where neither neighbouring keyframe gives it: the element's own (assumed default) */
const UNDERLYING: Record<string, string> = { opacity: '1', transform: 'none', filter: 'none', 'clip-path': 'none' };

function mixValue(prop: string, a: string | undefined, b: string | undefined, p: number): string | undefined {
  if (a === b) return a;
  const va = a ?? UNDERLYING[prop], vb = b ?? UNDERLYING[prop];
  if (va === undefined || vb === undefined) return p < 0.5 ? a : b;
  if (prop === 'opacity') return String(round(Math.min(1, Math.max(0, mix(Number(va), Number(vb), p)))));
  if (prop === 'transform' || prop === 'filter') return mixFns(va, vb, p);
  if (prop === 'clip-path') {
    const ia = parseInset(va), ib = parseInset(vb);
    if (ia && ib) return `inset(${ia.map((x, i) => `${round(mix(x, ib[i]!, p))}%`).join(' ')})`;
  }
  return p < 0.5 ? a : b;
}

const camel = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * The styles of keyframe animation `name` at time fraction `x` of one iteration (fill both: the first keyframe
 * before it starts, the last after it ends), each property between the keyframes that give it, eased per interval
 * as CSS does. A property left to the element's own value is not written.
 */
export function sampleKeyframes(table: KeyframeTable, name: string, x: number, timing: string): CSSProperties {
  const stops = table.get(name);
  if (!stops?.length) return {};
  const ease = easing(timing);
  const props = [...new Set(stops.flatMap((s) => Object.keys(s.decl)))];
  const out: Record<string, string> = {};
  for (const prop of props) {
    const own = stops.filter((s) => prop in s.decl).map((s) => ({ at: s.at, v: s.decl[prop] as string | undefined }));
    if (own[0]!.at > 0) own.unshift({ at: 0, v: undefined });
    if (own[own.length - 1]!.at < 1) own.push({ at: 1, v: undefined });
    let v: string | undefined;
    if (x <= 0) v = own[0]!.v;
    else if (x >= 1) v = own[own.length - 1]!.v;
    else {
      const i = Math.max(0, own.findIndex((s, n) => n + 1 < own.length && x >= s.at && x <= own[n + 1]!.at));
      const [a, b] = [own[i]!, own[i + 1]!];
      v = mixValue(prop, a.v, b.v, ease(b.at > a.at ? (x - a.at) / (b.at - a.at) : 1));
    }
    if (v !== undefined) out[camel(prop)] = v;
  }
  return out as CSSProperties;
}
