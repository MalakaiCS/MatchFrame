// Frame-accurate export of an animated graphic. For every frame the graphic is remounted at that instant (`setTime`),
// its CSS animations are held exactly there and written inline, and the node is drawn to a canvas with a
// transparent background. The frames (PNG with alpha) go to the API, which encodes them with FFmpeg: browsers can
// record video, but not frame by frame and not with an alpha channel.
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import { ApiError } from './api';

/** Hold every animation inside `root` at its start (the remount put it at the frame's instant) and make it still. */
export function freezeAnimations(root: HTMLElement) {
  for (const a of root.getAnimations({ subtree: true })) {
    a.pause();
    a.currentTime = 0;
    const el = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
    try {
      a.commitStyles();
    } catch {
      // not rendered (display: none): nothing to hold
    }
    a.cancel();
    if (el) el.style.animation = 'none';
  }
}

export interface FrameRender {
  /** the element to draw, laid out at the design size */
  node: HTMLElement;
  design: { width: number; height: number };
  /** the output size */
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  /** remount the graphic at `ms` and resolve once it is on the page */
  setTime: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export const frameCount = (durationMs: number, fps: number) => Math.round((durationMs / 1000) * fps) + 1;

/** Every frame, in order, as PNG files one after another in one blob. */
export async function renderFrames(o: FrameRender): Promise<Blob> {
  const total = frameCount(o.durationMs, o.fps);
  await document.fonts.ready;
  let fontEmbedCSS: string | undefined;
  const parts: Blob[] = [];
  for (let i = 0; i < total; i++) {
    if (o.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    await o.setTime(Math.min(o.durationMs, (i * 1000) / o.fps));
    freezeAnimations(o.node);
    fontEmbedCSS ??= await getFontEmbedCSS(o.node);
    const canvas = await toCanvas(o.node, { width: o.design.width, height: o.design.height, canvasWidth: o.width, canvasHeight: o.height, pixelRatio: 1, fontEmbedCSS, skipAutoScale: true });
    parts.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('A frame could not be drawn'))), 'image/png')));
    o.onProgress?.(i + 1, total);
  }
  return new Blob(parts, { type: 'application/vnd.matchframe.png-sequence' });
}

/** Send the frames to be encoded as a VP9 WebM with alpha; returns the file. */
export async function encodeWebm(frames: Blob, q: { fps: number; size: string; name: string }, signal?: AbortSignal): Promise<{ file: Blob; frames: number }> {
  const r = await fetch(`/api/v1/transitions/encode?${new URLSearchParams({ fps: String(q.fps), size: q.size, name: q.name })}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/vnd.matchframe.png-sequence' },
    body: frames,
    signal,
  }).catch((e: Error) => {
    throw e.name === 'AbortError' ? e : new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and retry.');
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(r.status, body?.error?.code ?? `HTTP_${r.status}`, body?.error?.message ?? `Encoding failed (${r.status})`);
  }
  return { file: await r.blob(), frames: Number(r.headers.get('x-frames')) || 0 };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
