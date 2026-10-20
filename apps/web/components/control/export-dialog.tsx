'use client';
// Social exports: a still (PNG) or a short clip (WebM) of a graphic, drawn by the same engine at the output's
// native size. Everything happens in the browser; nothing leaves the operator's machine until they share it.
import { useMemo, useRef, useState } from 'react';
import { toCanvas, toPng } from 'html-to-image';
import { formatSize, type Cue, type OverlayPublicState, type RenderData, type TemplateDef } from '@bs/graphics';
import { Renderer, Stage, THEMES, renderCustomScene } from '@bs/graphics/react';
import { Button, Dialog, Field, NativeSelect } from '@bs/ui';

export interface ExportSource { key: string; label: string; state: OverlayPublicState }
const PREVIEW_W = 640;

export function ExportDialog({ sources, data, custom, serverNow, onClose, fileBase }: { sources: ExportSource[]; data: RenderData; custom: TemplateDef[]; serverNow: () => number; onClose: () => void; fileBase: string }) {
  const [source, setSource] = useState(sources[0]?.key ?? '');
  const [kind, setKind] = useState<'png' | 'webm'>('png');
  const [seconds, setSeconds] = useState(4);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** when recording, every live cue is restarted at this instant so the clip shows the animation in */
  const [animateFrom, setAnimateFrom] = useState<number | null>(null);
  const node = useRef<HTMLDivElement>(null);
  const format = data.format ?? '16:9';
  const dims = formatSize(format);
  const previewH = Math.round((PREVIEW_W * dims.height) / dims.width);
  const base = sources.find((s) => s.key === source)?.state ?? sources[0]?.state;

  const exportState: OverlayPublicState | null = useMemo(() => {
    if (!base) return null;
    if (animateFrom == null) return base;
    const layers = Object.fromEntries(Object.entries(base.layers).map(([l, c]) => [l, Object.assign({}, c as Cue, { startedAt: animateFrom, outAt: undefined })])) as OverlayPublicState['layers'];
    return { ...base, layers };
  }, [base, animateFrom]);

  const download = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  };
  const exportPng = async () => {
    if (!node.current) return;
    setBusy('png');
    setErr(null);
    try {
      download(await toPng(node.current, { canvasWidth: dims.width, canvasHeight: dims.height, pixelRatio: 1, cacheBust: true }), `${fileBase}.png`);
    } catch (e) {
      setErr((e as Error).message || 'The image could not be rendered in this browser.');
    } finally {
      setBusy(null);
    }
  };
  const exportWebm = async () => {
    if (!node.current) return;
    setBusy('webm');
    setErr(null);
    try {
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
      if (!mime) throw new Error('This browser cannot record WebM. Use Chrome or Edge, or export a PNG.');
      const canvas = document.createElement('canvas');
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const done = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });
      setAnimateFrom(serverNow());
      await new Promise((r) => setTimeout(r, 60)); // let React paint the restarted cues
      rec.start();
      const until = Date.now() + seconds * 1000;
      while (Date.now() < until) {
        const frame = await toCanvas(node.current, { canvasWidth: dims.width, canvasHeight: dims.height, pixelRatio: 1 });
        ctx.clearRect(0, 0, dims.width, dims.height);
        ctx.drawImage(frame, 0, 0, dims.width, dims.height);
        track.requestFrame();
      }
      rec.stop();
      download(URL.createObjectURL(await done), `${fileBase}.webm`);
    } catch (e) {
      setErr((e as Error).message || 'The clip could not be recorded in this browser.');
    } finally {
      setAnimateFrom(null);
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="Export for social" description={`Rendered at ${dims.width}×${dims.height} in the output's look with a transparent background. The still shows the settled graphic; the clip records the animation in.`}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button>{kind === 'png' ? <Button variant="primary" loading={busy === 'png'} disabled={!!busy} onClick={exportPng}>Download PNG</Button> : <Button variant="primary" loading={busy === 'webm'} disabled={!!busy} onClick={exportWebm}>Record {seconds} s clip</Button>}</>}>
      <div className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Which graphics" htmlFor="esrc"><NativeSelect id="esrc" value={source} onChange={(e) => setSource(e.target.value)}>{sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</NativeSelect></Field>
          <Field label="Export" htmlFor="ek"><NativeSelect id="ek" value={kind} onChange={(e) => setKind(e.target.value as 'png' | 'webm')}><option value="png">Still image (PNG)</option><option value="webm">Short clip (WebM)</option></NativeSelect></Field>
          {kind === 'webm' ? <Field label="Length" htmlFor="es"><NativeSelect id="es" value={String(seconds)} onChange={(e) => setSeconds(Number(e.target.value))}>{[3, 4, 6, 8, 10].map((n) => <option key={n} value={n}>{n} seconds</option>)}</NativeSelect></Field> : null}
        </div>
        <div ref={node} className="relative mx-auto overflow-hidden bg-[repeating-conic-gradient(#222b3a_0%_25%,#171e2a_0%_50%)] bg-[length:20px_20px]" style={{ width: PREVIEW_W, height: previewH }}>
          {exportState ? <Stage format={format}><Renderer state={exportState} data={data} themes={THEMES} serverNow={serverNow} customDefs={custom} renderCustom={renderCustomScene} /></Stage> : null}
        </div>
        <p className="text-xs text-muted">{busy === 'webm' ? 'Recording… keep this window in front until the download starts.' : 'The checkerboard is not exported. Drop the file over your own photo or video in your social tool. Clips are recorded by the browser at a reduced frame rate; for broadcast-quality video use the programme output.'}</p>
        {err ? <p role="alert" className="text-sm text-live">{err}</p> : null}
      </div>
    </Dialog>
  );
}
