'use client';
// Match → Highlights → Title graphics for your edit: the highlights title panel (Match Highlights, Extended Match
// Highlights) in this match's look, with the competition, both teams, the round, the ground, the date and the kick-off
// time, to lay over your own edit. A video with transparency (ProRes 4444 MOV for Premiere, Final Cut and DaVinci
// Resolve, or a VP9 WebM) or a transparent PNG. Every frame is drawn at its instant as a still and the server encodes
// them, as the replay transition is.
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Download } from 'lucide-react';
import { findTemplate, type OverlayPublicState, type RenderData } from '@bs/graphics';
import { Keyframes, Renderer, Stage, THEMES } from '@bs/graphics/react';
import { Button, Card, ErrorNotice, Field, Input, NativeSelect } from '@bs/ui';
import { downloadBlob, encodeVideo, frameCount, renderFrames, renderStill } from '@/lib/frame-export';

const intro = findTemplate('builtin:highlights_intro')!;
const DESIGN = { width: 1920, height: 1080 };
/** any fixed instant: the cue's timeline is relative to it */
const ORIGIN = 1_000_000;
/** the still: every part in and settled */
const SETTLED_MS = 1_500;
const KINDS = [
  { key: 'match', name: 'Match Highlights', title: 'MATCH HIGHLIGHTS' },
  { key: 'extended', name: 'Extended Match Highlights', title: 'EXTENDED MATCH HIGHLIGHTS' },
] as const;
type Kind = (typeof KINDS)[number]['key'];
const FORMATS = [
  { value: 'mov', label: 'MOV, ProRes 4444 with transparency (Premiere, Final Cut, DaVinci Resolve)' },
  { value: 'webm', label: 'WebM, VP9 with transparency' },
  { value: 'png', label: 'PNG still, transparent' },
] as const;
type Format = (typeof FORMATS)[number]['value'];
const SIZES = [
  { value: '1920x1080', label: '1920 × 1080 (Full HD)' },
  { value: '1280x720', label: '1280 × 720 (HD)' },
];
const RATES = [25, 30, 50, 60];
const HOLDS = [3, 4, 5, 6, 8, 10];

function titleState(title: string, startedAt: number, holdMs: number): OverlayPublicState {
  return {
    revision: 1, mode: 'manual', inhibited: false, scorebugVisible: false, themeVersionId: null, themeProfileVersionId: null, slots: {},
    layers: { fullframe: { cueId: 'title-export', templateKey: intro.key, layer: 'fullframe', variables: { title }, startedAt, durationMs: holdMs, outAt: null, source: 'operator' } },
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

type Step = { kind: 'idle' } | { kind: 'drawing'; which: Kind; done: number; total: number } | { kind: 'encoding'; which: Kind } | { kind: 'done'; name: string; bytes: number };

/** One title, playing on a loop over a see-through checkerboard. */
function Preview({ data, title, holdMs }: { data: RenderData; title: string; holdMs: number }) {
  const [run, setRun] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setRun(Date.now()), holdMs + intro.exitMs + 1_000);
    return () => clearInterval(id);
  }, [holdMs]);
  const state = useMemo(() => titleState(title, run, holdMs), [title, run, holdMs]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-[repeating-conic-gradient(#222b3a_0%_25%,#171e2a_0%_50%)] bg-[length:20px_20px]">
      <Stage format="16:9"><Renderer state={state} data={data} themes={THEMES} serverNow={Date.now} /></Stage>
    </div>
  );
}

export function HighlightsTitleExport({ data }: { data: RenderData }) {
  const [titles, setTitles] = useState<Record<Kind, string>>({ match: KINDS[0].title, extended: KINDS[1].title });
  const [format, setFormat] = useState<Format>('mov');
  const [size, setSize] = useState('1920x1080');
  const [fps, setFps] = useState(25);
  const [holdS, setHoldS] = useState(5);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [err, setErr] = useState<Error | null>(null);
  const capture = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [frame, setFrame] = useState<{ title: string; at: number } | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  // the export always animates, even when the look's motion is turned off for live outputs
  const exportData = useMemo<RenderData>(() => ({ ...data, format: '16:9', theme: { ...data.theme, motion: data.theme.motion === 'none' ? 'full' : data.theme.motion } }), [data]);
  const holdMs = holdS * 1000;
  // in whole frames, so the last one falls after the exit has finished and is clear
  const durationMs = (Math.ceil(((holdMs + intro.exitMs) * fps) / 1000) * 1000) / fps;
  const t = data.match.teams;
  const busy = step.kind === 'drawing' || step.kind === 'encoding';

  const exportTitle = async (which: Kind) => {
    if (!capture.current) return;
    const ac = new AbortController();
    abort.current = ac;
    setErr(null);
    const title = titles[which].trim() || KINDS.find((k) => k.key === which)!.title;
    const [w, h] = size.split('x').map(Number) as [number, number];
    const base = `${slug(t.home.shortName || t.home.name)}-v-${slug(t.away.shortName || t.away.name)}-${slug(title)}`;
    const setTime = async (ms: number) => {
      flushSync(() => setFrame({ title, at: ms }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    };
    try {
      if (format === 'png') {
        setStep({ kind: 'drawing', which, done: 0, total: 1 });
        const png = await renderStill({ node: capture.current, design: DESIGN, width: w, height: h, atMs: Math.min(SETTLED_MS, holdMs), setTime });
        const name = `${base}-${w}x${h}.png`;
        downloadBlob(png, name);
        setStep({ kind: 'done', name, bytes: png.size });
        return;
      }
      const frames = await renderFrames({ node: capture.current, design: DESIGN, width: w, height: h, fps, durationMs, signal: ac.signal, setTime, onProgress: (done, total) => setStep({ kind: 'drawing', which, done, total }) });
      setStep({ kind: 'encoding', which });
      const name = `${base}-${w}x${h}-${fps}fps`;
      const r = await encodeVideo(frames, { fps, size, name, format }, ac.signal);
      downloadBlob(r.file, `${name}.${format}`);
      setStep({ kind: 'done', name: `${name}.${format}`, bytes: r.file.size });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr(e as Error);
      setStep({ kind: 'idle' });
    } finally {
      setFrame(null);
      abort.current = null;
    }
  };

  const frames = frameCount(durationMs, fps);
  return (
    <Card role="region" className="grid gap-3 p-4" aria-labelledby="title-export-heading">
      <Keyframes />
      <div>
        <h3 id="title-export-heading" className="font-medium">Title graphics for your edit</h3>
        <p className="text-sm text-muted">The title panel on its own, in this match&apos;s look, with the competition, both teams, the round, the ground, the date and the kick-off time. The rest of the frame is see-through, so it sits over your footage in an editing program. Change the ground or kick-off time on the match and the title follows.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="File" htmlFor="tx-format"><NativeSelect id="tx-format" value={format} onChange={(e) => setFormat(e.target.value as Format)} disabled={busy}>{FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</NativeSelect></Field>
        <Field label="Size" htmlFor="tx-size"><NativeSelect id="tx-size" value={size} onChange={(e) => setSize(e.target.value)} disabled={busy}>{SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</NativeSelect></Field>
        {format !== 'png' ? (
          <>
            <Field label="Frame rate" htmlFor="tx-fps" hint="The same as your edit"><NativeSelect id="tx-fps" value={String(fps)} onChange={(e) => setFps(Number(e.target.value))} disabled={busy}>{RATES.map((r) => <option key={r} value={r}>{r} fps</option>)}</NativeSelect></Field>
            <Field label="On screen for" htmlFor="tx-hold" hint="Before it animates out"><NativeSelect id="tx-hold" value={String(holdS)} onChange={(e) => setHoldS(Number(e.target.value))} disabled={busy}>{HOLDS.map((s) => <option key={s} value={s}>{s} seconds</option>)}</NativeSelect></Field>
          </>
        ) : null}
      </div>
      <ul aria-label="Title graphics" className="grid gap-4 md:grid-cols-2">
        {KINDS.map((k) => (
          <li key={k.key} data-title-export={k.key} className="grid gap-2">
            <Preview data={exportData} title={titles[k.key] || k.title} holdMs={holdMs} />
            <Field label={`${k.name}: title`} htmlFor={`tx-title-${k.key}`}><Input id={`tx-title-${k.key}`} maxLength={30} value={titles[k.key]} onChange={(e) => setTitles((x) => ({ ...x, [k.key]: e.target.value }))} disabled={busy} /></Field>
            <Button variant="secondary" loading={busy && 'which' in step && step.which === k.key} disabled={busy} onClick={() => void exportTitle(k.key)}><Download className="size-4" /> Download {k.name} ({format.toUpperCase()})</Button>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted" role="status" aria-live="polite">
        {step.kind === 'drawing' ? (format === 'png' ? 'Drawing the picture…' : `Drawing frame ${step.done} of ${step.total}…`) : step.kind === 'encoding' ? `Encoding the ${format.toUpperCase()}…` : step.kind === 'done' ? `Downloaded ${step.name} (${(step.bytes / 1024 / 1024).toFixed(1)} MB).` : format === 'png' ? 'One picture with everything in place.' : `${(durationMs / 1000).toFixed(2)} s: it animates in, stays ${holdS} s from the start, then animates out; ${frames} frames at ${fps} fps. Keep this page open while it draws.`}
      </p>
      <ErrorNotice error={err} />
      {/* the full-size stage the frames are drawn from, out of sight */}
      <div aria-hidden style={{ position: 'fixed', left: -20000, top: 0, width: DESIGN.width, height: DESIGN.height, pointerEvents: 'none' }}>
        <div ref={capture} style={{ position: 'absolute', left: 0, top: 0, width: DESIGN.width, height: DESIGN.height, overflow: 'hidden' }}>
          {frame ? <Stage format="16:9"><Renderer key={frame.at} still state={titleState(frame.title, ORIGIN, holdMs)} data={exportData} themes={THEMES} serverNow={() => ORIGIN + frame.at} /></Stage> : null}
        </div>
      </div>
    </Card>
  );
}
