'use client';
// Match → Highlights: a highlights package made from a video of the match and the scorer's log, in the look of the
// match's OBS output. Upload the video, mark where each period kicked off in it, check the moments (goals and red
// cards go in; chances fill it to the length chosen), and make it: the browser draws the graphics, the media worker
// cuts the video, slows the replays and lays the graphics over it. The file is downloaded or shared from here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Download, Film, Image as ImageIcon, Pause, Play, Share2, Trash2, Upload } from 'lucide-react';
import { getAdapter, highlightOptionsDefaults, HIGHLIGHT_SPORTS, periodStarts, planHighlights, videoAt, type HighlightOptions, type StoredFact } from '@bs/domain';
import type { RenderData } from '@bs/graphics';
import { Button, Card, ErrorNotice, Field, Input, NativeSelect, Spinner, StatusPill, Switch } from '@bs/ui';
import { api, ApiError, del, post, put } from '@/lib/api';
import { useCopy, useGet } from '@/lib/hooks';
import { putWithProgress, uploadMatchVideo, type MatchVideo } from '@/lib/match-video-upload';
import { useHighlightsDrawing } from '@/components/highlights-drawing';
import { saveBlob, thumbnailName, useThumbnailMaker } from '@/components/thumbnail-maker';
import { HighlightsTitleExport } from './highlights-title-export';
import { useQueryClient } from '@tanstack/react-query';

type Source = { sport: string; rulesConfig: unknown; facts: StoredFact[]; videos: MatchVideo[] };
type Pkg = { id: string; state: string; progress: number; error: string | null; title: string; durationMs: number | null; bytes: number | null; createdAt: string; expiresAt: string | null; downloadUrl: string | null };
type Options = Omit<HighlightOptions, 'overrides'>;
type Step = { kind: 'idle' } | { kind: 'saving' } | { kind: 'drawing'; done: number; total: number } | { kind: 'sending'; sent: number; total: number } | { kind: 'sent' };

const mmss = (ms: number | null | undefined) => {
  if (ms == null) return '–';
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};
/** "25", "1:25" or "1:02:25" as ms; null when it is not a time. */
const parseTime = (t: string): number | null => {
  const parts = t.trim().split(':');
  if (!t.trim() || parts.length > 3 || parts.some((x) => !/^\d+$/.test(x))) return null;
  return parts.reduce((s, x) => s * 60 + Number(x), 0) * 1000;
};

/** A time in the video, typed (m:ss or h:mm:ss); applied when it is a time. */
function TimeInput({ label, value, onChange, disabled }: { label: string; value: number | null; onChange: (ms: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(value != null ? mmss(value) : '');
  useEffect(() => setText(value != null ? mmss(value) : ''), [value]);
  const apply = () => {
    const ms = parseTime(text);
    if (ms != null && ms !== value) onChange(ms);
    else setText(value != null ? mmss(value) : '');
  };
  return <Input aria-label={label} value={text} placeholder="m:ss" disabled={disabled} className="h-8 w-24 tabular-nums" onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />;
}

const mb = (b: number | null | undefined) => (b == null ? '' : b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, b / 1024 ** 2).toFixed(1)} MB`);
const LENGTHS = [2, 3, 4, 5, 6, 8, 10];
const PKG_STATE: Record<string, string> = { UPLOADING: 'Waiting for its graphics', QUEUED: 'Queued', RUNNING: 'Making the video', COMPLETED: 'Ready', FAILED: 'Failed', CANCELLED: 'Cancelled', EXPIRED: 'Expired' };

export function HighlightsPanel({ matchId, canEdit }: { matchId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const src = useGet<Source>(['highlights-source', matchId], `matches/${matchId}/highlights/source`, { refetchInterval: 5000 });
  const pkgs = useGet<Pkg[]>(['highlight-packages', matchId], `matches/${matchId}/highlight-packages`, { refetchInterval: 4000 });
  const overlays = useGet<{ id: string; name: string }[]>(['overlays', matchId], `matches/${matchId}/overlays`);
  const overlayId = overlays.data?.[0]?.id ?? null;
  const rd = useGet<{ data: RenderData }>(['render-data', overlayId], overlayId ? `overlays/${overlayId}/render-data` : null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const videos = src.data?.videos ?? [];
  const video = videos.find((v) => v.id === videoId) ?? videos[0] ?? null;
  const adapter = src.data ? getAdapter(src.data.sport as never) : null;
  const cfg = src.data?.rulesConfig as never;
  const offered = !!src.data && (HIGHLIGHT_SPORTS as readonly string[]).includes(src.data.sport);

  if (src.isLoading) return <Spinner />;
  if (src.error) return <ErrorNotice error={src.error} />;
  const titles = rd.data?.data ? <HighlightsTitleExport data={rd.data.data} /> : null;
  if (!offered)
    return (
      <div className="grid gap-4">
        <Card className="p-4 text-sm text-muted">Highlights packages are made from the scorer&apos;s goals, tries, cards and chances. They are not offered for {src.data?.sport} yet: it scores too often to pick the moments from the log. The title graphics below are, for a package you edit yourself.</Card>
        {titles}
      </div>
    );

  return (
    <div className="grid gap-4">
      <VideoCard matchId={matchId} canEdit={canEdit} videos={videos} video={video} onPick={setVideoId} refresh={() => void qc.invalidateQueries({ queryKey: ['highlights-source', matchId] })} />
      {video?.state === 'READY' && adapter ? (
        <Maker key={video.id} matchId={matchId} canEdit={canEdit} video={video} facts={src.data!.facts} adapter={adapter} cfg={cfg} renderData={rd.data?.data ?? null} renderError={rd.error ?? overlays.error} onDone={() => void qc.invalidateQueries({ queryKey: ['highlight-packages', matchId] })} onStale={() => void qc.invalidateQueries({ queryKey: ['highlights-source', matchId] })} />
      ) : null}
      <Packages pkgs={pkgs.data ?? []} canEdit={canEdit} renderData={rd.data?.data ?? null} refresh={() => void qc.invalidateQueries({ queryKey: ['highlight-packages', matchId] })} />
      {titles}
    </div>
  );
}

// ------------------------------------------------------------------ the video

function VideoCard({ matchId, canEdit, videos, video, onPick, refresh }: { matchId: string; canEdit: boolean; videos: MatchVideo[]; video: MatchVideo | null; onPick: (id: string) => void; refresh: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const abort = useRef<AbortController | null>(null);
  const stopped = video?.state === 'UPLOADING' && !progress ? video : null;
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const resume = stopped && stopped.name === file.name && stopped.bytes === file.size ? stopped : null;
      const v = await uploadMatchVideo(matchId, file, { resume, signal: ac.signal, onProgress: (sent, total) => setProgress({ sent, total }) });
      onPick(v.id);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr(e as Error);
    } finally {
      setProgress(null);
      abort.current = null;
      if (input.current) input.current.value = '';
      refresh();
    }
  };
  const remove = async (v: MatchVideo) => {
    if (!confirm(`Delete ${v.name}? Packages already made are kept.`)) return;
    await del(`match-videos/${v.id}`).catch((e: Error) => setErr(e));
    refresh();
  };
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Video of the match</h3>
          <p className="text-sm text-muted">The whole match as one file (MP4, MOV, MKV or WebM): the recording from OBS, your camera or the stream. It is kept as you upload it. If it already shows the scorebug, turn the scorebug off below.</p>
        </div>
        {canEdit ? (
          <>
            <input ref={input} type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm,.m4v" className="sr-only" aria-label="Video of the match" onChange={(e) => void choose(e.target.files?.[0])} />
            <Button variant={videos.length ? 'secondary' : 'primary'} disabled={!!progress} onClick={() => input.current?.click()}><Upload className="size-4" /> {stopped ? 'Carry on uploading' : videos.length ? 'Upload another video' : 'Upload the video'}</Button>
          </>
        ) : null}
      </div>
      {progress ? (
        <div role="status" aria-live="polite" className="grid gap-1 text-sm">
          <div className="h-2 overflow-hidden rounded bg-elevated"><div className="h-full bg-primary transition-all" style={{ width: `${(progress.sent / progress.total) * 100}%` }} /></div>
          <span className="flex justify-between text-muted"><span>Uploading: {mb(progress.sent)} of {mb(progress.total)} ({Math.floor((progress.sent / progress.total) * 100)}%). Keep this page open; if it stops, choose the same file again to carry on.</span><Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>Stop</Button></span>
        </div>
      ) : null}
      {stopped ? <p className="text-sm text-warning">The upload of {stopped.name} stopped at {Math.floor(((stopped.parts - stopped.missingParts.length) / stopped.parts) * 100)}%. Choose the same file to carry on.</p> : null}
      {videos.length ? (
        <ul className="grid gap-2" aria-label="Videos">
          {videos.map((v) => (
            <li key={v.id} className={`flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm ${v.id === video?.id ? 'border-primary' : 'border-border'}`}>
              {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" className="h-12 w-20 rounded object-cover" /> : <span className="grid h-12 w-20 place-items-center rounded bg-elevated"><Film className="size-5 text-muted" /></span>}
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onPick(v.id)}>
                <span className="block truncate font-medium">{v.name}</span>
                <span className="text-muted">{mb(v.bytes)}{v.durationMs ? ` · ${mmss(v.durationMs)}` : ''}{v.width ? ` · ${v.width}×${v.height}` : ''}</span>
              </button>
              <StatusPill tone={v.state === 'READY' ? 'healthy' : v.state === 'FAILED' ? 'live' : 'warning'}>{v.state === 'READY' ? 'Ready' : v.state === 'PROCESSING' ? 'Reading the video…' : v.state === 'UPLOADING' ? 'Uploading' : 'Failed'}</StatusPill>
              {v.error ? <span className="w-full text-live">{v.error}</span> : null}
              {canEdit ? <Button size="sm" variant="ghost" aria-label={`Delete ${v.name}`} onClick={() => void remove(v)}><Trash2 className="size-4" /></Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorNotice error={err} />
    </Card>
  );
}

// ------------------------------------------------------------------ sync, moments, options, make

function Maker({ matchId, canEdit, video, facts, adapter, cfg, renderData, renderError, onDone, onStale }: { matchId: string; canEdit: boolean; video: MatchVideo; facts: StoredFact[]; adapter: ReturnType<typeof getAdapter>; cfg: never; renderData: RenderData | null; renderError: Error | null; onDone: () => void; onStale: () => void }) {
  const player = useRef<HTMLVideoElement>(null);
  const [anchors, setAnchors] = useState<Record<string, number>>(video.sync);
  const [options, setOptions] = useState<Options>({ ...highlightOptionsDefaults });
  const [overrides, setOverrides] = useState<NonNullable<HighlightOptions['overrides']>>({});
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [err, setErr] = useState<Error | null>(null);
  const abort = useRef<AbortController | null>(null);
  const drawing = useHighlightsDrawing();
  useEffect(() => setAnchors(video.sync), [video.sync]);

  const starts = useMemo(() => periodStarts(adapter, cfg, facts), [adapter, cfg, facts]);
  const synced = Object.keys(anchors).length > 0;
  const dirty = JSON.stringify(anchors) !== JSON.stringify(video.sync);
  const plan = useMemo(() => planHighlights({ adapter, cfg, facts, video: { durationMs: video.durationMs ?? 0, anchors }, options: { ...options, overrides } }), [adapter, cfg, facts, video.durationMs, anchors, options, overrides]);
  const teams = renderData?.match.teams;
  const playerName = (id: string | null) => (id ? renderData?.players[id]?.displayName ?? null : null);
  const included = plan.moments.filter((m) => m.included);

  const seek = (ms: number, play = true) => {
    const el = player.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    if (play) void el.play();
  };
  const markHere = (periodId: string) => {
    const el = player.current;
    if (el) setAnchors((a) => ({ ...a, [periodId]: Math.round(el.currentTime * 1000) }));
  };
  const setOpt = <K extends keyof Options>(k: K, v: Options[K]) => setOptions((o) => ({ ...o, [k]: v }));
  const override = (id: string, o: { include?: boolean; shiftMs?: number }) => setOverrides((x) => ({ ...x, [id]: { ...x[id], ...o } }));

  const make = async () => {
    if (!renderData) return;
    setErr(null);
    const ac = new AbortController();
    abort.current = ac;
    try {
      if (dirty) {
        setStep({ kind: 'saving' });
        await put(`match-videos/${video.id}/sync`, { anchors });
      }
      const allOptions = { ...options, overrides };
      const r = await post<{ jobId: string; graphicsUrl: string }>(`matches/${matchId}/highlight-packages`, { videoId: video.id, planKey: plan.key, options: allOptions, title: `${teams ? `${teams.home.shortName || teams.home.name} v ${teams.away.shortName || teams.away.name}` : 'Match'} highlights` });
      onDone();
      const file = await drawing.draw({ plan, facts, overrides, data: renderData }, { signal: ac.signal, onProgress: (done, total) => setStep({ kind: 'drawing', done, total }) });
      await putWithProgress(r.graphicsUrl, file, (sent, total) => setStep({ kind: 'sending', sent, total }), ac.signal);
      setStep({ kind: 'sent' });
      onDone();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr(e as Error);
      if (e instanceof ApiError && e.code === 'PLAN_CHANGED') onStale();
      setStep({ kind: 'idle' });
    } finally {
      abort.current = null;
    }
  };
  const busy = step.kind === 'saving' || step.kind === 'drawing' || step.kind === 'sending';

  return (
    <Card className="grid gap-4 p-4">
      {drawing.node}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-2">
          {video.previewUrl ? <video ref={player} src={video.previewUrl} controls preload="metadata" className="aspect-video w-full rounded-md bg-black" aria-label="Match video" /> : null}
          <p className="text-xs text-muted">A small copy of your video for finding the moments; the package is made from the original.</p>
        </div>
        <section aria-label="Kick-off times" className="grid content-start gap-2">
          <h3 className="font-medium">Where the match is in the video</h3>
          <p className="text-sm text-muted">Play the video to the kick-off and press <em>Kick-off is here</em>, or type the time into the box. A period without its own mark follows the one before it (a recording that ran through half time); mark the second half too if the recording was stopped at the break.</p>
          <ul className="grid gap-2">
            {starts.map((s) => {
              const own = anchors[s.periodId];
              const follows = own == null ? videoAt(starts, { durationMs: video.durationMs ?? 0, anchors }, s.at) : null;
              return (
                <li key={s.periodId} className="rounded-md border border-border p-2 text-sm" data-period={s.periodId}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{adapter.phase(cfg, s.periodId)?.label ?? s.periodId}</span>
                    <span className="tabular-nums">{own != null ? mmss(own) : follows != null ? <span className="text-muted">{mmss(follows)} (follows)</span> : <span className="text-muted">not marked</span>}</span>
                  </div>
                  {canEdit ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <TimeInput label={`${adapter.phase(cfg, s.periodId)?.label ?? s.periodId} kick-off time`} value={own ?? null} onChange={(ms) => setAnchors((a) => ({ ...a, [s.periodId]: ms }))} />
                      <Button size="sm" variant="secondary" onClick={() => markHere(s.periodId)}>Kick-off is here</Button>
                      {own != null || follows != null ? <Button size="sm" variant="ghost" onClick={() => seek((own ?? follows)!)}>Go to it</Button> : null}
                      {own != null ? <Button size="sm" variant="ghost" onClick={() => setAnchors(({ [s.periodId]: _, ...rest }) => rest)}>Clear</Button> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!starts.length ? <p className="text-sm text-warning">No period of this match has started in the scorer yet.</p> : null}
          {canEdit && dirty ? <Button size="sm" variant="primary" onClick={() => void put(`match-videos/${video.id}/sync`, { anchors }).then(onStale).catch((e: Error) => setErr(e))}>Save kick-off times</Button> : null}
        </section>
      </div>

      <section aria-label="Moments" className="grid gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-medium">Moments</h3>
            <p className="text-sm text-muted">From the scorer&apos;s log. Goals, tries and red cards always go in, each goal with a slow-motion replay; chances fill the package to its length. Move a moment if the scorer recorded it early or late.</p>
          </div>
          <span className="text-sm" data-summary>{synced ? `${mmss(plan.durationMs)} · ${included.length} moment${included.length === 1 ? '' : 's'} · ${included.filter((m) => m.replay).length} replay${included.filter((m) => m.replay).length === 1 ? '' : 's'}` : 'Mark the kick-off to see the package'}</span>
        </div>
        <ul className="grid gap-1" aria-label="Moments">
          {plan.moments.map((m) => {
            const seg = plan.segments.find((s) => s.kind === 'clip' && s.factIds.includes(m.factId));
            const team = m.side && teams ? teams[m.side].shortName || teams[m.side].name : null;
            const who = playerName(m.playerId);
            return (
              <li key={m.factId} data-moment={m.type} data-included={m.included} className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${m.included ? 'border-border' : 'border-border/50 text-muted'}`}>
                <input type="checkbox" aria-label={`Include ${m.label}${m.minute != null ? ` ${m.minute}'` : ''}`} checked={m.included} disabled={!canEdit || m.videoMs == null} onChange={(e) => override(m.factId, { include: e.target.checked })} />
                <span className="w-10 tabular-nums">{m.minute != null ? `${m.minute}'` : ''}</span>
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{m.label}</span>{team ? ` · ${team}` : ''}{who ? ` · ${who}` : ''}</span>
                {m.reason && !m.included ? <span className="text-xs">{m.reason}</span> : null}
                <span className="tabular-nums text-xs text-muted">{m.videoMs != null ? mmss(m.videoMs) : ''}</span>
                {m.shiftMs ? <span className="tabular-nums text-xs">{m.shiftMs > 0 ? '+' : ''}{m.shiftMs / 1000} s</span> : null}
                {canEdit && m.videoMs != null ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label="Earlier" onClick={() => override(m.factId, { shiftMs: m.shiftMs - 2000 })}>−2 s</Button>
                    <Button size="sm" variant="ghost" aria-label="Later" onClick={() => override(m.factId, { shiftMs: m.shiftMs + 2000 })}>+2 s</Button>
                  </span>
                ) : null}
                {m.videoMs != null ? <Button size="sm" variant="ghost" aria-label={`Watch ${m.label}`} onClick={() => seek(seg?.videoFromMs ?? Math.max(0, m.videoMs! - 15_000))}><Play className="size-3.5" /></Button> : null}
              </li>
            );
          })}
        </ul>
        {!plan.moments.length ? <p className="text-sm text-muted">The scorer has not recorded any goals, cards or chances for this match.</p> : null}
      </section>

      <section aria-label="Package" className="grid gap-3 rounded-md border border-border p-3">
        <h3 className="font-medium">The package</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="About how long" htmlFor="hl-length"><NativeSelect id="hl-length" value={String(options.targetMs)} disabled={!canEdit} onChange={(e) => setOpt('targetMs', Number(e.target.value))}>{LENGTHS.map((n) => <option key={n} value={n * 60_000}>{n} minutes</option>)}</NativeSelect></Field>
          <Field label="Title" htmlFor="hl-title"><Input id="hl-title" maxLength={30} value={options.title} disabled={!canEdit} onChange={(e) => setOpt('title', e.target.value)} /></Field>
          <Field label="End board message" htmlFor="hl-end"><Input id="hl-end" maxLength={60} value={options.endMessage} disabled={!canEdit} onChange={(e) => setOpt('endMessage', e.target.value)} /></Field>
          <Field label="Replays" htmlFor="hl-speed"><NativeSelect id="hl-speed" value={String(options.replays ? options.replaySpeed : 0)} disabled={!canEdit} onChange={(e) => (Number(e.target.value) ? setOptions((o) => ({ ...o, replays: true, replaySpeed: Number(e.target.value) })) : setOpt('replays', false))}><option value="0.75">Slow motion (¾ speed)</option><option value="0.5">Slower (½ speed)</option><option value="1">Real speed</option><option value="0">No replays</option></NativeSelect></Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Switch label="Title panel" checked={options.intro} disabled={!canEdit} onCheckedChange={(v) => setOpt('intro', v)} />
          <Switch label="Scorebug (off when the video already shows one)" checked={options.scorebug} disabled={!canEdit} onCheckedChange={(v) => setOpt('scorebug', v)} />
          <Switch label="Replay transition before each replay" checked={options.stinger} disabled={!canEdit || !options.replays} onCheckedChange={(v) => setOpt('stinger', v)} />
          <Switch label="Full time with the final score" checked={options.fullTime} disabled={!canEdit} onCheckedChange={(v) => setOpt('fullTime', v)} />
          <Switch label="End board" checked={options.endCard} disabled={!canEdit} onCheckedChange={(v) => setOpt('endCard', v)} />
          <Switch label="Chances (shots on target, saves)" checked={options.kinds.chance} disabled={!canEdit} onCheckedChange={(v) => setOpt('kinds', { ...options.kinds, chance: v })} />
          <Switch label="Corners and shots off target" checked={options.kinds.minor} disabled={!canEdit} onCheckedChange={(v) => setOpt('kinds', { ...options.kinds, minor: v })} />
        </div>
        <p className="text-sm text-muted">In the look of this match&apos;s OBS output. 1920×1080 MP4.</p>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={busy} disabled={busy || !renderData || !synced || !plan.segments.length} onClick={() => void make()}><Clapperboard className="size-4" /> Make the highlights</Button>
            {busy ? <Button variant="ghost" onClick={() => abort.current?.abort()}><Pause className="size-4" /> Stop</Button> : null}
            <span className="text-sm text-muted" role="status" aria-live="polite">
              {step.kind === 'saving' ? 'Saving the kick-off times…' : step.kind === 'drawing' ? `Drawing the graphics: ${step.done} of ${step.total} frames. Keep this page open.` : step.kind === 'sending' ? `Sending the graphics: ${Math.floor((step.sent / Math.max(1, step.total)) * 100)}%` : step.kind === 'sent' ? 'The graphics are in: the video is being made below.' : !synced ? 'Mark the kick-off first.' : !renderData ? 'Loading the look…' : ''}
            </span>
          </div>
        ) : null}
        <ErrorNotice error={err ?? renderError} />
      </section>
    </Card>
  );
}

// ------------------------------------------------------------------ packages made

/** a package this long or longer gets the extended highlights thumbnail */
const EXTENDED_MS = 7 * 60_000;

function Packages({ pkgs, canEdit, renderData, refresh }: { pkgs: Pkg[]; canEdit: boolean; renderData: RenderData | null; refresh: () => void }) {
  const copy = useCopy();
  const thumbs = useThumbnailMaker();
  const [err, setErr] = useState<Error | null>(null);
  if (!pkgs.length) return null;
  const thumbnail = async (p: Pkg) => {
    if (!renderData) return;
    const kind = (p.durationMs ?? 0) >= EXTENDED_MS ? 'extended' : 'highlights';
    try {
      saveBlob(await thumbs.make(renderData, { kind }), thumbnailName(renderData, kind === 'extended' ? 'extended highlights' : 'highlights'));
    } catch (e) {
      setErr(e as Error);
    }
  };
  const share = async (p: Pkg) => {
    try {
      const s = await post<{ watchUrl: string }>('shares', { resourceType: 'export', resourceId: p.id, expiresInHours: 24 * 7 });
      void copy(s.watchUrl, 'Share link (7 days)');
    } catch (e) {
      setErr(e as Error);
    }
  };
  return (
    <Card className="grid gap-2 p-4">
      {thumbs.node}
      <h3 className="font-medium">Highlights made</h3>
      <ul className="grid gap-2" aria-label="Highlights made">
        {pkgs.map((p) => (
          <li key={p.id} data-package={p.state} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{p.title}</span>
              <span className="text-muted">{p.durationMs ? mmss(p.durationMs) : ''}{p.bytes ? ` · ${mb(p.bytes)}` : ''}{p.state === 'RUNNING' ? ` · ${Math.round(p.progress * 100)}%` : ''}</span>
            </span>
            <StatusPill tone={p.state === 'COMPLETED' ? 'healthy' : p.state === 'FAILED' ? 'live' : p.state === 'CANCELLED' || p.state === 'EXPIRED' ? 'neutral' : 'warning'}>{PKG_STATE[p.state] ?? p.state}</StatusPill>
            {p.error ? <span className="w-full text-live">{p.error}</span> : null}
            {p.downloadUrl ? <a className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" href={p.downloadUrl}><Download className="size-4" /> Download</a> : null}
            {p.downloadUrl && renderData ? <Button size="sm" variant="ghost" onClick={() => void thumbnail(p)}><ImageIcon className="size-4" /> Thumbnail</Button> : null}
            {p.downloadUrl && canEdit ? <Button size="sm" variant="ghost" onClick={() => void share(p)}><Share2 className="size-4" /> Share link</Button> : null}
            {canEdit && ['UPLOADING', 'QUEUED', 'RUNNING'].includes(p.state) ? <Button size="sm" variant="ghost" onClick={() => void api(`exports/${p.id}/cancel`, { method: 'POST', json: {} }).then(refresh).catch((e: Error) => setErr(e))}>Cancel</Button> : null}
          </li>
        ))}
      </ul>
      <ErrorNotice error={err} />
    </Card>
  );
}
