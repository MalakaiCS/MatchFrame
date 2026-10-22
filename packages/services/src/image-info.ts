// What an uploaded image really is, from its bytes: PNG, JPEG or WebP and its size in pixels. No FFmpeg, so the
// API can accept a logo or photo on its own; anything else (markup, scripts, other formats) is refused.

export interface ImageInfo {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

function png(b: Buffer): ImageInfo | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    // start of frame (baseline, progressive, …), not DHT / JPG / DAC
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { mime: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    if (marker === 0xd9 || marker === 0xda) return null;
    i += 2 + len;
  }
  return null;
}

function webp(b: Buffer): ImageInfo | null {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return { mime: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { mime: 'image/webp', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  return null;
}

/** The image's format and size, or null when the bytes are not a PNG, JPEG or WebP image. */
export function imageInfo(b: Buffer): ImageInfo | null {
  const r = png(b) ?? jpeg(b) ?? webp(b);
  return r && r.width > 0 && r.height > 0 ? r : null;
}
