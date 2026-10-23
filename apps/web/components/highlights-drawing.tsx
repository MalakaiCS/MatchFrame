'use client';
// The graphics of a highlights package, drawn in the browser with the same renderer as the outputs: every frame
// where something changes, as a still at 1920×1080 with a transparent background, and the replay transition once.
// They go to the server in one file with the times they appear; the media worker lays them over the video.
import { useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import { FRAME_MS, ORIGIN, highlightFrames, stingerFrame, stingerMs, type HighlightFrames, type OverlayPublicState, type RenderData } from '@bs/graphics';
import { Keyframes, Renderer, Stage, THEMES } from '@bs/graphics/react';
import { freezeAnimations } from '@/lib/frame-export';

const SIZE = { width: 1920, height: 1080 };

type Shown = { data: RenderData; state: OverlayPublicState; now: number };

/** The hidden stage the frames are drawn from, and `draw`, which returns the file for the server. */
export function useHighlightsDrawing(): { node: ReactNode; draw: (src: HighlightFrames, o: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }) => Promise<Blob> } {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  const node = (
    <div aria-hidden style={{ position: 'fixed', left: -20000, top: 0, width: SIZE.width, height: SIZE.height, pointerEvents: 'none' }}>
      <Keyframes />
      <div ref={ref} style={{ position: 'absolute', left: 0, top: 0, width: SIZE.width, height: SIZE.height, overflow: 'hidden' }}>
        {shown ? <Stage format="16:9"><Renderer key={shown.now} still state={shown.state} data={shown.data} themes={THEMES} serverNow={() => shown.now} /></Stage> : null}
      </div>
    </div>
  );

  const draw = async (src: HighlightFrames, o: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }) => {
    // always animated, even when the look's motion is off for live outputs
    const data: RenderData = { ...src.data, format: '16:9', theme: { ...src.data.theme, motion: src.data.theme.motion === 'none' ? 'full' : src.data.theme.motion } };
    const frame = highlightFrames({ ...src, data });
    const main: { ms: number; f: Shown }[] = [];
    let last = '';
    for (let ms = 0; ms < src.plan.durationMs; ms += FRAME_MS) {
      const f = frame(ms);
      if (f.key === last) continue;
      last = f.key;
      main.push({ ms, f: { data: f.data, state: f.state, now: ORIGIN + ms } });
    }
    const stingerAt = src.plan.cues.filter((c) => c.templateKey === 'builtin:replay').map((c) => c.fromMs);
    const stinger: { ms: number; f: Shown }[] = [];
    if (stingerAt.length) for (let ms = 0; ms < stingerMs(); ms += FRAME_MS) stinger.push({ ms, f: stingerFrame(data, ms) });
    const total = main.length + stinger.length;
    await document.fonts.ready;
    let fontEmbedCSS: string | undefined;
    const pngs: Blob[] = [];
    try {
      for (const [i, x] of [...main, ...stinger].entries()) {
        if (o.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        flushSync(() => setShown(x.f));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const el = ref.current!;
        freezeAnimations(el);
        fontEmbedCSS ??= await getFontEmbedCSS(el);
        const canvas = await toCanvas(el, { width: SIZE.width, height: SIZE.height, canvasWidth: SIZE.width, canvasHeight: SIZE.height, pixelRatio: 1, fontEmbedCSS, skipAutoScale: true });
        pngs.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('A frame could not be drawn'))), 'image/png')));
        o.onProgress?.(i + 1, total);
      }
    } finally {
      setShown(null);
    }
    const sizes = pngs.map((b) => b.size);
    const header = new TextEncoder().encode(
      JSON.stringify({
        v: 1, ...SIZE, fps: 1000 / FRAME_MS, planKey: src.plan.key,
        tracks: {
          main: { durationMs: src.plan.durationMs, frames: main.map((x, i) => ({ atMs: Math.round(x.ms), bytes: sizes[i]! })) },
          ...(stinger.length ? { stinger: { durationMs: stingerMs(), frames: stinger.map((x, i) => ({ atMs: Math.round(x.ms), bytes: sizes[main.length + i]! })), at: stingerAt } } : {}),
        },
      }),
    );
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, header.length);
    return new Blob([new TextEncoder().encode('MFOV'), len, header, ...pngs], { type: 'application/octet-stream' });
  };

  return { node, draw };
}
