// Minimal RGBA PNG encoder for generated demo artwork (original shapes only, no third-party marks).
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export type Pixel = (x: number, y: number) => [number, number, number, number];

export function encodePng(width: number, height: number, px: Pixel): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width * 4 + 1);
    raw[o] = 0;
    for (let x = 0; x < width; x++) raw.set(px(x, y), o + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** A simple geometric mark: rounded panel with a disc and bars, in two colours. Transparent outside. */
export function demoMark(width: number, height: number, bg: string, fg: string): Buffer {
  const [br, bgc, bb] = hex(bg);
  const [fr, fgc, fb] = hex(fg);
  const r = Math.min(width, height) * 0.18;
  const cy = height / 2;
  const cx = height * 0.55;
  const disc = height * 0.3;
  return encodePng(width, height, (x, y) => {
    const dx = Math.max(r - x, x - (width - 1 - r), 0);
    const dy = Math.max(r - y, y - (height - 1 - r), 0);
    if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
    const inDisc = (x - cx) ** 2 + (y - cy) ** 2 < disc * disc;
    const bar = x > height * 1.05 && x < width - height * 0.3 && [0.3, 0.47, 0.64].some((f, i) => Math.abs(y - height * f) < height * 0.05 && x < width - height * (0.3 + i * 0.6));
    return inDisc || bar ? [fr, fgc, fb, 255] : [br, bgc, bb, 255];
  });
}
