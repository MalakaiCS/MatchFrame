// Long-name resolution sequence (spec §9.2):
//   1. use the full name when it fits at the template font size;
//   2. otherwise use the approved short label;
//   3. otherwise reduce the font size, never below minFontPx;
//   4. otherwise truncate with an ellipsis at minFontPx (never overflowing into score or clock).
export type Measure = (text: string, fontPx: number) => number;

/** Approximate measure for tests/SSR: average glyph width ≈ 0.56em, uppercase/wide glyphs wider. */
export const approxMeasure: Measure = (text, px) => {
  let w = 0;
  for (const ch of text) w += /[MWmw@]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.66 : /[il.,'| ]/.test(ch) ? 0.3 : 0.55;
  return w * px;
};

export interface FitResult {
  text: string;
  fontPx: number;
  step: 'full' | 'short' | 'shrink' | 'truncate';
}

export function fitLabel(opts: { full: string; short?: string | null; maxWidth: number; fontPx: number; minFontPx: number; measure?: Measure }): FitResult {
  const m = opts.measure ?? approxMeasure;
  const full = opts.full.trim();
  if (m(full, opts.fontPx) <= opts.maxWidth) return { text: full, fontPx: opts.fontPx, step: 'full' };
  const short = opts.short?.trim();
  if (short && m(short, opts.fontPx) <= opts.maxWidth) return { text: short, fontPx: opts.fontPx, step: 'short' };
  const base = short || full;
  for (let px = opts.fontPx - 1; px >= opts.minFontPx; px--) if (m(base, px) <= opts.maxWidth) return { text: base, fontPx: px, step: 'shrink' };
  let t = base;
  while (t.length > 1 && m(`${t}…`, opts.minFontPx) > opts.maxWidth) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, fontPx: opts.minFontPx, step: 'truncate' };
}

/**
 * Canvas-based measure for browsers. A width measured while the look's web font is still loading (the fallback
 * font's width) is not kept, and everything is measured again once fonts finish loading, so a name fitted on the
 * first frame is not clipped when the real typeface arrives.
 */
export function canvasMeasure(fontFamily: string, weight = 700): Measure {
  if (typeof document === 'undefined') return approxMeasure;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return approxMeasure;
  const cache = new Map<string, number>();
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  fonts?.addEventListener?.('loadingdone', () => cache.clear());
  return (text, px) => {
    const k = `${px}|${text}`;
    let v = cache.get(k);
    if (v === undefined) {
      ctx.font = `${weight} ${px}px ${fontFamily}`;
      v = ctx.measureText(text).width;
      let ready = true;
      try {
        ready = !fonts || fonts.check(ctx.font, text);
      } catch {
        ready = true;
      }
      if (ready) cache.set(k, v);
      else void fonts?.load(ctx.font, text).catch(() => {});
    }
    return v;
  };
}
