'use client';
// Replay transition for OBS or vMix: the look's replay transition, plain or with the match's teams, exported as a
// transparent WebM (VP9 with alpha) to use as a stinger. The preview plays it on a loop; the export draws every
// frame at its exact instant at full size, and the server encodes them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Film } from 'lucide-react';
import { REPLAY_TRANSITION, findTemplate, type OverlayPublicState, type RenderData } from '@bs/graphics';
import { Keyframes, Renderer, Stage, THEMES } from '@bs/graphics/react';
import { Button, Dialog, ErrorNotice, Field, Input, NativeSelect } from '@bs/ui';
import type { ApiError } from '@/lib/api';
import { downloadBlob, encodeWebm, frameCount, renderFrames } from '@/lib/frame-export';

const replay = findTemplate('builtin:replay')!;
const DESIGN = { width: 1920, height: 1080 };
/** any fixed instant: the cue's timeline is relative to it */
const ORIGIN = 1_000_000;
const SIZES = [
  { value: '1920x1080', label: '1920 × 1080 (Full HD)' },
  { value: '1280x720', label: '1280 × 720 (HD)' },
];
const RATES = [25, 30, 50, 60];

function replayState(withTeams: boolean, text: string, startedAt: number): OverlayPublicState {
  return {
    revision: 1, mode: 'manual', inhibited: false, scorebugVisible: false, themeVersionId: null, themeProfileVersionId: null, slots: {},
    layers: { transition: { cueId: 'replay-export', templateKey: 'builtin:replay', layer: 'transition', variables: { teams: withTeams, ...(text.trim() ? { text: text.trim() } : {}) }, startedAt, durationMs: replay.holdMs, outAt: null, source: 'operator' } },
  };
}

type Step = { kind: 'idle' } | { kind: 'drawing'; done: number; total: number } | { kind: 'encoding' } | { kind: 'done'; name: string; bytes: number; frames: number };

/** The export dialog. `teams` offers the version with the teams (on a match); `fileBase` names the download. */
export function ReplayExportDialog({ open, onOpenChange, data, teams, fileBase, lookName }: { open: boolean; onOpenChange: (o: boolean) => void; data: RenderData; teams?: { home: string; away: string }; fileBase: string; lookName: string }) {
  const [withTeams, setWithTeams] = useState(!!teams);
  const [text, setText] = useState('');
  const [size, setSize] = useState('1920x1080');
  const [fps, setFps] = useState(30);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [err, setErr] = useState<ApiError | Error | null>(null);
  const abort = useRef<AbortController | null>(null);
  const capture = useRef<HTMLDivElement>(null);
  const [frameAt, setFrameAt] = useState<number | null>(null);

  // the export always animates, even when the look's motion is turned off for live outputs
  const exportData = useMemo<RenderData>(() => ({ ...data, format: '16:9', theme: { ...data.theme, motion: data.theme.motion === 'none' ? 'full' : data.theme.motion } }), [data]);
  // preview: replays every 2.4 s
  const [run, setRun] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setRun(Date.now()), REPLAY_TRANSITION.totalMs + 800);
    return () => clearInterval(id);
  }, [open]);
  const preview = useMemo(() => replayState(withTeams, text, run), [withTeams, text, run]);
  const frozen = useMemo(() => replayState(withTeams, text, ORIGIN), [withTeams, text]);

  const close = (o: boolean) => {
    if (!o) abort.current?.abort();
    onOpenChange(o);
    if (!o) {
      setStep({ kind: 'idle' });
      setErr(null);
    }
  };

  const exportFile = async () => {
    if (!capture.current) return;
    const ac = new AbortController();
    abort.current = ac;
    setErr(null);
    const [w, h] = size.split('x').map(Number) as [number, number];
    const name = `${fileBase}${withTeams ? '' : '-plain'}-${w}x${h}-${fps}fps`;
    try {
      const frames = await renderFrames({
        node: capture.current,
        design: DESIGN,
        width: w,
        height: h,
        fps,
        durationMs: REPLAY_TRANSITION.totalMs,
        signal: ac.signal,
        setTime: async (ms) => {
          flushSync(() => setFrameAt(ms));
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        },
        onProgress: (done, total) => setStep({ kind: 'drawing', done, total }),
      });
      setStep({ kind: 'encoding' });
      const r = await encodeWebm(frames, { fps, size, name }, ac.signal);
      downloadBlob(r.file, `${name}.webm`);
      setStep({ kind: 'done', name: `${name}.webm`, bytes: r.file.size, frames: r.frames });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr(e as Error);
      setStep({ kind: 'idle' });
    } finally {
      setFrameAt(null);
      abort.current = null;
    }
  };

  const busy = step.kind === 'drawing' || step.kind === 'encoding';
  const total = frameCount(REPLAY_TRANSITION.totalMs, fps);
  const point = REPLAY_TRANSITION.transitionPointMs;

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title="Replay transition for OBS or vMix"
      description={`${lookName} look, ${(REPLAY_TRANSITION.totalMs / 1000).toFixed(1)} s, transparent WebM (VP9 with alpha) to use as a stinger.`}
      footer={<><Button variant="ghost" onClick={() => close(false)}>{busy ? 'Cancel' : 'Close'}</Button><Button variant="primary" loading={busy} disabled={busy} onClick={() => void exportFile()}><Film className="size-4" /> Export WebM</Button></>}
    >
      <div className="grid gap-3">
        <Keyframes />
        <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-[repeating-conic-gradient(#222b3a_0%_25%,#171e2a_0%_50%)] bg-[length:20px_20px]" data-testid="replay-preview">
          {open ? <Stage format="16:9"><Renderer state={preview} data={exportData} themes={THEMES} serverNow={Date.now} /></Stage> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {teams ? (
            <Field label="Version" htmlFor="rx-version">
              <NativeSelect id="rx-version" value={withTeams ? 'teams' : 'plain'} onChange={(e) => setWithTeams(e.target.value === 'teams')} disabled={busy}>
                <option value="teams">This match: {teams.home} v {teams.away}</option>
                <option value="plain">Plain (the look only)</option>
              </NativeSelect>
            </Field>
          ) : null}
          <Field label="Text" htmlFor="rx-text" hint="Leave empty for REPLAY">
            <Input id="rx-text" value={text} maxLength={20} placeholder="REPLAY" onChange={(e) => setText(e.target.value)} disabled={busy} />
          </Field>
          <Field label="Size" htmlFor="rx-size">
            <NativeSelect id="rx-size" value={size} onChange={(e) => setSize(e.target.value)} disabled={busy}>{SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</NativeSelect>
          </Field>
          <Field label="Frame rate" htmlFor="rx-fps" hint="The same as your OBS or vMix output">
            <NativeSelect id="rx-fps" value={String(fps)} onChange={(e) => setFps(Number(e.target.value))} disabled={busy}>{RATES.map((r) => <option key={r} value={r}>{r} fps</option>)}</NativeSelect>
          </Field>
        </div>
        <div className="rounded-md border border-border bg-elevated/40 p-3 text-sm" aria-label="How to use it">
          <p className="font-medium">Cut at {point} ms</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            <li><span className="text-text">OBS:</span> Scene Transitions → + → Stinger, choose this file, Transition Point Type <em>Time</em>, Transition Point {point} ms.</li>
            <li><span className="text-text">vMix:</span> set a Stinger transition to this file and its transition point (delay) to {point} ms.</li>
          </ul>
        </div>
        <p className="text-sm text-muted" role="status" aria-live="polite">
          {step.kind === 'drawing' ? `Drawing frame ${step.done} of ${step.total}…` : step.kind === 'encoding' ? 'Encoding the WebM…' : step.kind === 'done' ? `Downloaded ${step.name} (${(step.bytes / 1024 / 1024).toFixed(1)} MB, ${step.frames} frames).` : `${total} frames at ${fps} fps. Drawing takes a few seconds; keep this window open.`}
        </p>
        <ErrorNotice error={err} />
      </div>
      {/* the full-size stage the frames are drawn from, out of sight */}
      {open ? (
        <div aria-hidden style={{ position: 'fixed', left: -20000, top: 0, width: DESIGN.width, height: DESIGN.height, pointerEvents: 'none' }}>
          <div ref={capture} style={{ position: 'absolute', left: 0, top: 0, width: DESIGN.width, height: DESIGN.height, overflow: 'hidden' }}>
            {frameAt != null ? <Stage format="16:9"><Renderer key={frameAt} state={frozen} data={exportData} themes={THEMES} serverNow={() => ORIGIN + frameAt} /></Stage> : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
