'use client';
// Team colours from the crest. The logo is read in the browser (drawn small on a canvas; it is served from the app's
// own address, so its pixels can be read), the colours it uses are worked out (`crestPalette`), and they are
// offered as swatches with "Use crest colours", which sets the main and second colour at once.
import { useEffect, useState } from 'react';
import { crestPalette, type CrestPalette } from '@bs/graphics';
import { Button } from '@bs/ui';

/** The crest's colours, or null while it loads, without a logo, or when it cannot be read. */
export function useCrestPalette(assetId: string | null | undefined): CrestPalette | null {
  const [palette, setPalette] = useState<CrestPalette | null>(null);
  useEffect(() => {
    setPalette(null);
    if (!assetId) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live || !img.naturalWidth) return;
      const scale = Math.min(1, 96 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      try {
        setPalette(crestPalette(ctx.getImageData(0, 0, w, h).data, w, h));
      } catch {
        // a picture the browser will not let the page read: no suggestions
      }
    };
    img.src = `/api/v1/assets/${assetId}/preview`;
    return () => {
      live = false;
    };
  }, [assetId]);
  return palette;
}

/** The crest's colours as swatches (a swatch sets the main colour) and "Use crest colours" for both. */
export function CrestColours({ palette, primary, secondary, onPick, disabled }: { palette: CrestPalette | null; primary: string; secondary: string; onPick: (c: { primaryColor: string; secondaryColor?: string }) => void; disabled?: boolean }) {
  if (!palette) return null;
  const applied = palette.primary === primary.toUpperCase() && palette.secondary === secondary.toUpperCase();
  return (
    <div role="group" aria-label="Colours from the crest" className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>From the crest:</span>
      {palette.colours.map((c) => (
        <button key={c.hex} type="button" disabled={disabled} title={`${c.hex}: use as the main colour`} aria-label={`Main colour ${c.hex}`} onClick={() => onPick({ primaryColor: c.hex })}
          className="size-6 rounded border border-border disabled:opacity-50" style={{ background: c.hex }} />
      ))}
      <Button size="sm" disabled={disabled || applied} onClick={() => onPick({ primaryColor: palette.primary, secondaryColor: palette.secondary })}>{applied ? 'Crest colours in use' : 'Use crest colours'}</Button>
    </div>
  );
}
