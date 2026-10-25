import { describe, expect, it } from 'vitest';
import { crestPalette } from './palette';

type RGBA = [number, number, number, number];
/** a w×h image painted by `at(x, y)` */
function image(w: number, h: number, at: (x: number, y: number) => RGBA) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(at(x, y), (y * w + x) * 4);
  return d;
}
const W = 64;
const inCircle = (x: number, y: number, r: number) => (x - W / 2) ** 2 + (y - W / 2) ** 2 <= r * r;
const RED: RGBA = [214, 32, 40, 255];
const WHITE: RGBA = [255, 255, 255, 255];
const BLACK: RGBA = [12, 12, 14, 255];
const CLEAR: RGBA = [0, 0, 0, 0];

describe('team colours from a crest', () => {
  it('on a plain white background (a JPEG): the white is left out, red first, then the black outline', () => {
    const img = image(W, W, (x, y) => (inCircle(x, y, 24) ? RED : inCircle(x, y, 28) ? BLACK : WHITE));
    const p = crestPalette(img, W, W)!;
    expect(p.primary).toBe('#D62028');
    expect(p.secondary).toBe('#0C0C0E');
    expect(p.colours.map((c) => c.hex)).not.toContain('#FFFFFF');
  });

  it('on a transparent background: the colourful one wins over a bigger white field', () => {
    // 60% white shield with a blue band, see-through around it
    const img = image(W, W, (x, y) => (x < 6 || x > 57 ? CLEAR : y > 24 && y < 40 ? [20, 70, 200, 255] : WHITE));
    const p = crestPalette(img, W, W)!;
    expect(p.primary).toBe('#1446C8');
    expect(p.secondary).toBe('#FFFFFF');
    expect(p.colours[0]!.hex).toBe('#FFFFFF');
    expect(p.colours[0]!.share).toBeGreaterThan(0.6);
  });

  it('a black-and-white crest: black, with white as the second colour', () => {
    const img = image(W, W, (x, y) => (inCircle(x, y, 20) ? WHITE : inCircle(x, y, 30) ? BLACK : CLEAR));
    expect(crestPalette(img, W, W)).toMatchObject({ primary: '#0C0C0E', secondary: '#FFFFFF' });
  });

  it('one colour only: a second that reads against it', () => {
    expect(crestPalette(image(W, W, () => [250, 220, 40, 255]), W, W)).toMatchObject({ primary: '#FADC28', secondary: '#0B1220' });
    expect(crestPalette(image(W, W, () => [20, 40, 120, 255]), W, W)).toMatchObject({ primary: '#142878', secondary: '#FFFFFF' });
  });

  it('noise and anti-aliased edges do not become colours of their own; shades of one colour are one colour', () => {
    let seed = 7;
    const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 21) - 10;
    const img = image(W, W, (x, y) => (inCircle(x, y, 22) ? [200 + noise(), 30 + noise(), 40 + noise(), 255] : x % 9 === 0 ? [128, 128, 128, 255] : [250 + noise() / 2, 250 + noise() / 2, 250 + noise() / 2, 255]));
    const p = crestPalette(img, W, W)!;
    expect(p.colours.filter((c) => /^#[CD]/.test(c.hex) && c.hex.slice(3, 5) < '40').length).toBe(1);
    expect(p.primary.slice(0, 2)).toBe('#C');
  });

  it('nothing to read in a see-through image', () => {
    expect(crestPalette(image(8, 8, () => CLEAR), 8, 8)).toBeNull();
  });
});
