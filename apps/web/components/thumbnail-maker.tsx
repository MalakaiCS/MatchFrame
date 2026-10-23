'use client';
// A match thumbnail as a PNG: drawn on a hidden stage at full size with the same engine as the outputs, then
// saved. The Thumbnails tab and the highlights packages both use it.
import { useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import type { RenderData } from '@bs/graphics';
import { MatchThumbnail, THUMBNAIL_SIZE, type ThumbnailOptions } from '@bs/graphics/react';

export const THUMBNAIL_SIZES = [
  { key: '1280', name: '1280 × 720 (YouTube)', width: 1280, height: 720 },
  { key: '1920', name: '1920 × 1080', width: 1920, height: 1080 },
] as const;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** "harbour-v-northgate-highlights.png" */
export function thumbnailName(data: RenderData, kind: string): string {
  const t = data.match.teams;
  return `${slug(t.home.shortName || t.home.name)}-v-${slug(t.away.shortName || t.away.name)}-${slug(kind)}.png`;
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The hidden stage, and `make`, which draws a thumbnail and returns it as a PNG. */
export function useThumbnailMaker(): { node: ReactNode; make: (data: RenderData, o: ThumbnailOptions, size?: { width: number; height: number }) => Promise<Blob> } {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<{ data: RenderData; o: ThumbnailOptions } | null>(null);
  const node = (
    <div aria-hidden style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }}>
      <div ref={ref} style={{ width: THUMBNAIL_SIZE.width, height: THUMBNAIL_SIZE.height }}>{shown ? <MatchThumbnail data={shown.data} {...shown.o} /> : null}</div>
    </div>
  );
  const make = async (data: RenderData, o: ThumbnailOptions, size: { width: number; height: number } = THUMBNAIL_SIZE) => {
    flushSync(() => setShown({ data, o }));
    try {
      const el = ref.current!;
      await document.fonts.ready;
      // the crests and the competition's logo are in before it is drawn
      await Promise.all([...el.querySelectorAll('img')].map((i) => (i.complete ? null : i.decode().catch(() => null))));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const fontEmbedCSS = await getFontEmbedCSS(el);
      const canvas = await toCanvas(el, { width: THUMBNAIL_SIZE.width, height: THUMBNAIL_SIZE.height, canvasWidth: size.width, canvasHeight: size.height, pixelRatio: 1, fontEmbedCSS, skipAutoScale: true, cacheBust: true });
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The thumbnail could not be drawn in this browser'))), 'image/png'));
    } finally {
      setShown(null);
    }
  };
  return { node, make };
}
