// Team colours from a crest: the image's pixels (RGBA, as a canvas gives them) grouped into a few colours by how
// much of the crest each covers, with a plain background (the corners of a JPEG, say) and see-through pixels left
// out. The main colour is the most used colourful one, so a crest's white or black outline does not win over its
// red; the second is the next most used that reads clearly against it.
import { COLOUR_CLASH_THRESHOLD, colourDistance } from './data';

export interface CrestPalette {
  /** the colours found, most used first, each with its share of the crest (0..1) */
  colours: { hex: string; share: number }[];
  primary: string;
  secondary: string;
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Saturation (0..1) and lightness (0..1) of an RGB colour. */
function satLight(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}
const colourful = (c: { r: number; g: number; b: number }) => {
  const { s, l } = satLight(c.r, c.g, c.b);
  return s >= 0.28 && l >= 0.12 && l <= 0.9;
};

/**
 * The crest's colours from its pixels (`data` is RGBA, `width` × `height`). Returns null when nothing is opaque
 * enough to read, for example a fully transparent image.
 */
export function crestPalette(data: Uint8ClampedArray | Uint8Array, width: number, height: number): CrestPalette | null {
  const px = (i: number) => ({ r: data[i * 4]!, g: data[i * 4 + 1]!, b: data[i * 4 + 2]!, a: data[i * 4 + 3]! });
  const n = width * height;
  // a plain background: most of the border in one colour (JPEG crests on white, a square badge's backing)
  const border: { r: number; g: number; b: number }[] = [];
  for (let x = 0; x < width; x++) for (const y of [0, height - 1]) { const p = px(y * width + x); if (p.a >= 200) border.push(p); }
  for (let y = 1; y < height - 1; y++) for (const x of [0, width - 1]) { const p = px(y * width + x); if (p.a >= 200) border.push(p); }
  let background: string | null = null;
  if (border.length >= (2 * (width + height) - 4) * 0.6) {
    const avg = border.reduce((a, p) => ({ r: a.r + p.r / border.length, g: a.g + p.g / border.length, b: a.b + p.b / border.length }), { r: 0, g: 0, b: 0 });
    const bg = hex(avg.r, avg.g, avg.b);
    if (border.filter((p) => colourDistance(hex(p.r, p.g, p.b), bg) < 40).length >= border.length * 0.8) background = bg;
  }
  // a crest that fills its whole picture has no background to leave out: keep it when little else is left
  if (background) {
    let opaque = 0, other = 0;
    for (let i = 0; i < n; i++) {
      const p = px(i);
      if (p.a < 128) continue;
      opaque += 1;
      if (colourDistance(hex(p.r, p.g, p.b), background) >= 40) other += 1;
    }
    if (other < opaque * 0.05) background = null;
  }
  // count the opaque pixels in coarse bins (4 bits a channel), then join bins of the same colour; each colour is the
  // exact colour most used in its biggest bin, so the soft edges between two colours do not tint it
  const bins = new Map<number, { count: number; exact: Map<number, number> }>();
  let counted = 0;
  for (let i = 0; i < n; i++) {
    const p = px(i);
    if (p.a < 128) continue;
    if (background && colourDistance(hex(p.r, p.g, p.b), background) < 40) continue;
    const key = ((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4);
    const bin = bins.get(key) ?? { count: 0, exact: new Map<number, number>() };
    const rgb = (p.r << 16) | (p.g << 8) | p.b;
    bin.exact.set(rgb, (bin.exact.get(rgb) ?? 0) + 1);
    bin.count += 1;
    bins.set(key, bin);
    counted += 1;
  }
  if (!counted) return null;
  const groups: { r: number; g: number; b: number; count: number }[] = [];
  for (const bin of [...bins.values()].sort((a, b) => b.count - a.count)) {
    // the bin's colour: the exact colour most of its pixels have
    const [rgb] = [...bin.exact.entries()].reduce((best, e) => (e[1] > best[1] ? e : best));
    const c = { r: rgb >> 16, g: (rgb >> 8) & 255, b: rgb & 255 };
    const near = groups.find((g) => colourDistance(hex(g.r, g.g, g.b), hex(c.r, c.g, c.b)) < 48);
    if (near) near.count += bin.count;
    else groups.push({ ...c, count: bin.count });
  }
  // what is left after joining: colours that cover at least 3% of the crest (anti-aliased edges and noise drop out)
  const found = groups
    .sort((a, b) => b.count - a.count)
    .map((g) => ({ ...g, share: g.count / counted }))
    .filter((g, i) => g.share >= 0.03 || i === 0);
  const main = found.find(colourful) ?? found[0]!;
  const primary = hex(main.r, main.g, main.b);
  const second = found.find((g) => g !== main && colourDistance(hex(g.r, g.g, g.b), primary) >= COLOUR_CLASH_THRESHOLD);
  // with no second colour of its own: dark ink on a bright main colour (yellow, white), else white
  const bright = (0.2126 * main.r + 0.7152 * main.g + 0.0722 * main.b) / 255 > 0.6;
  const secondary = second ? hex(second.r, second.g, second.b) : bright ? '#0B1220' : '#FFFFFF';
  return { colours: found.slice(0, 6).map((g) => ({ hex: hex(g.r, g.g, g.b), share: Math.round(g.share * 1000) / 1000 })), primary, secondary };
}
