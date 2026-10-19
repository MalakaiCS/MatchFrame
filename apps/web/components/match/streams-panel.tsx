'use client';
// Match streaming: programme/clean outputs, input binding, destinations (≤3), start/stop and real status.
import { useState } from 'react';
import { Play, Plus, Square, Trash2 } from 'lucide-react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, StatusPill, type Tone } from '@bs/ui';
import { del, post, put } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { HlsPlayer } from '@/components/stream/hls-player';
import { InputPreview } from '@/components/stream/input-preview';

interface Dest { id: string; name: string; platform: string; serverUrl: string; streamKeyMasked: string; enabled: boolean; lastStatus: { status?: string; error?: string | null; at?: string } }
interface Out { id: string; mode: 'PROGRAMME' | 'CLEAN'; name: string; inputId: string | null; preset: string; record: boolean; hls: boolean; autoSchedule: boolean; prerollSeconds: number; postrollSeconds: number; input: { id: string; name: string; status: string; lastHealth: Record<string, unknown> } | null; destinations: Dest[]; session: { id: string; state: string; error: { message?: string } | null; liveAt: string | null; hlsUrl: string | null } | null; recording: { id: string; state: string }[] }
interface Streams { demo: boolean; configured: boolean; outputs: Out[]; session: { id: string; state: string; error: { code?: string; message?: string } | null; startedAt: string | null; endedAt: string | null; demo: boolean } | null }

export const STATE_TONE: Record<string, Tone> = { LIVE: 'live', DEGRADED: 'warning', STARTING: 'primary', WAITING_FOR_INPUT: 'warning', STOPPING: 'neutral', STOPPED: 'offline', FAILED: 'offline', PENDING: 'neutral', active: 'healthy', failed: 'offline', starting: 'primary', finished: 'neutral' };
const ACTIVE = ['SCHEDULED', 'WAITING_FOR_INPUT', 'STARTING', 'LIVE', 'DEGRADED', 'STOPPING'];

export function StreamsPanel({ matchId, canEdit, tz }: { matchId: string; canEdit: boolean; tz: string }) {
  const s = useGet<Streams>(['streams', matchId], `matches/${matchId}/streams`, { refetchInterval: 3000 });
  const inputs = useGet<{ id: string; name: string; status: string; boundSessionId: string | null }[]>(['inputs'], 'inputs');
  const [err, setErr] = useState<unknown>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', platform: 'custom', serverUrl: '', streamKey: '' });
  const addDest = useAction(() => post(`outputs/${dest}/destinations`, form), [['streams', matchId]]);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await s.refetch();
    } catch (e) {
      setErr(e);
    }
  };
  if (!s.data) return <ErrorNotice error={s.error} />;
  const live = s.data.session && ACTIVE.includes(s.data.session.state);
  const modes = s.data.outputs.map((o) => o.mode);
  return (
    <div className="space-y-4">
      {!s.data.configured ? <ErrorNotice error={{ message: 'Streaming is not configured on this deployment. Outputs cannot go live.' }} /> : null}
      {s.data.demo ? <StatusPill tone="warning">Demo media mode — no real video is produced</StatusPill> : null}
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm font-medium">Session</span>
        <StatusPill tone={STATE_TONE[s.data.session?.state ?? ''] ?? 'neutral'}>{s.data.session?.state ?? 'not started'}</StatusPill>
        {s.data.session?.error?.message ? <span className="text-xs text-warning">{s.data.session.error.message}</span> : null}
        {s.data.session?.startedAt ? <span className="text-xs text-muted">started {fmtDate(s.data.session.startedAt, tz, { timeStyle: 'medium' })}</span> : null}
        {canEdit ? (
          <div className="ml-auto flex gap-2">
            {!live ? <Button variant="primary" disabled={!s.data.outputs.length} onClick={() => void run(() => post(`matches/${matchId}/session/start`, {}))}><Play className="size-4" /> Start stream</Button> : <Button variant="danger" disabled={s.data.session?.state === 'STOPPING'} onClick={() => void run(() => post(`matches/${matchId}/session/stop`, {}))}><Square className="size-4" /> Stop stream</Button>}
          </div>
        ) : null}
      </Card>
      <ErrorNotice error={err as never} />
      <div className="grid gap-4 xl:grid-cols-2">
        {s.data.outputs.map((o) => (
          <Card key={o.id} className="space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{o.name}</h3>
              <StatusPill tone="neutral">{o.mode === 'PROGRAMME' ? 'with graphics' : 'clean, no graphics'}</StatusPill>
              <StatusPill tone={STATE_TONE[o.session?.state ?? ''] ?? 'neutral'}>{o.session?.state ?? 'idle'}</StatusPill>
              {o.recording[0] ? <StatusPill tone={o.recording[0].state === 'RECORDING' ? 'live' : 'neutral'}>rec {o.recording[0].state}</StatusPill> : null}
            </div>
            {o.session?.error?.message ? <p className="text-xs text-warning">{o.session.error.message}</p> : null}
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Input" htmlFor={`in-${o.id}`}>
                <NativeSelect id={`in-${o.id}`} disabled={!canEdit || !!live} value={o.inputId ?? ''} onChange={(e) => void run(() => put(`matches/${matchId}/outputs`, { ...pick(o), inputId: e.target.value || null }))}>
                  <option value="">Choose input…</option>
                  {inputs.data?.map((i) => <option key={i.id} value={i.id}>{i.name}{i.boundSessionId ? ' (in use)' : ''}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Preset" htmlFor={`pr-${o.id}`}>
                <NativeSelect id={`pr-${o.id}`} disabled={!canEdit || !!live} value={o.preset} onChange={(e) => void run(() => put(`matches/${matchId}/outputs`, { ...pick(o), preset: e.target.value }))}>{['720p25', '720p30', '1080p25', '1080p30'].map((p) => <option key={p}>{p}</option>)}</NativeSelect>
              </Field>
              <label className="mt-6 flex items-center gap-2 text-xs"><input type="checkbox" disabled={!canEdit} checked={o.autoSchedule} onChange={(e) => void run(() => put(`matches/${matchId}/outputs`, { ...pick(o), autoSchedule: e.target.checked }))} /> Auto start {Math.round(o.prerollSeconds / 60)} min before kickoff, stop {Math.round(o.postrollSeconds / 60)} min after full time</label>
            </div>
            {o.input ? <p className="text-xs text-muted">Input {o.input.name}: {o.input.status}{(o.input.lastHealth as { video?: { width?: number; height?: number; fps?: number } }).video?.width ? ` · ${(o.input.lastHealth as { video: { width: number; height: number; fps?: number } }).video.width}×${(o.input.lastHealth as { video: { width: number; height: number; fps?: number } }).video.height}${(o.input.lastHealth as { video: { fps?: number } }).video.fps ? `@${(o.input.lastHealth as { video: { fps?: number } }).video.fps}` : ''}` : ''} · bitrate {(o.input.lastHealth as { bitrateKbps?: number }).bitrateKbps ? `${(o.input.lastHealth as { bitrateKbps?: number }).bitrateKbps} kbps` : 'Unavailable'}</p> : null}
            <div>
              <div className="mb-1 flex items-center justify-between text-sm"><span>Destinations ({o.destinations.length}/3)</span>{canEdit && o.destinations.length < 3 ? <Button size="sm" onClick={() => { setForm({ name: '', platform: 'custom', serverUrl: '', streamKey: '' }); setDest(o.id); }}><Plus className="size-3" /> Add</Button> : null}</div>
              <ul className="space-y-1 text-xs">
                {o.destinations.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 rounded border border-border px-2 py-1">
                    <span className="font-medium">{d.name}</span><span className="text-muted">{d.platform} · {d.serverUrl} · key {d.streamKeyMasked}</span>
                    <span className="ml-auto">{d.lastStatus.status ? <StatusPill tone={STATE_TONE[d.lastStatus.status] ?? 'neutral'}>{d.lastStatus.status}</StatusPill> : <span className="text-muted">not started</span>}</span>
                    {d.lastStatus.error ? <span className="text-warning" title={d.lastStatus.error}>!</span> : null}
                    {canEdit && !live ? <Button size="sm" variant="ghost" aria-label={`Remove ${d.name}`} onClick={() => void run(() => del(`destinations/${d.id}`))}><Trash2 className="size-3" /></Button> : null}
                  </li>
                ))}
                {!o.destinations.length ? <li className="text-muted">No destinations. HLS preview and recording still work.</li> : null}
              </ul>
            </div>
            {o.session?.hlsUrl && ACTIVE.includes(o.session.state) ? <HlsPlayer src={o.session.hlsUrl} /> : null}
          </Card>
        ))}
      </div>
      {canEdit && modes.length < 2 ? (
        <div className="flex gap-2">
          {!modes.includes('PROGRAMME') ? <Button onClick={() => void run(() => put(`matches/${matchId}/outputs`, { mode: 'PROGRAMME' }))}><Plus className="size-4" /> Programme output</Button> : null}
          {!modes.includes('CLEAN') ? <Button variant="secondary" onClick={() => void run(() => put(`matches/${matchId}/outputs`, { mode: 'CLEAN', inputId: s.data!.outputs[0]?.inputId ?? null }))}><Plus className="size-4" /> Clean output</Button> : null}
        </div>
      ) : null}
      {live ? <InputPreview matchId={matchId} /> : null}
      <Dialog open={!!dest} onOpenChange={(o) => !o && setDest(null)} title="Add RTMP destination" description="YouTube, Facebook and Twitch: paste the server URL and stream key from the platform. Keys are encrypted and masked." footer={<Button variant="primary" disabled={!form.name || !form.serverUrl || !form.streamKey || addDest.isPending} onClick={async () => { await addDest.mutateAsync(undefined as never); setDest(null); }}>Add destination</Button>}>
        <div className="space-y-3">
          <Field label="Name" htmlFor="d-name"><Input id="d-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Platform" htmlFor="d-pl"><NativeSelect id="d-pl" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}><option value="youtube">YouTube</option><option value="facebook">Facebook</option><option value="twitch">Twitch</option><option value="custom">Custom RTMP</option></NativeSelect></Field>
          <Field label="Server URL" htmlFor="d-url" hint="rtmp:// or rtmps:// — private network addresses are rejected"><Input id="d-url" value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })} placeholder="rtmps://a.rtmp.youtube.com/live2" /></Field>
          <Field label="Stream key" htmlFor="d-key"><Input id="d-key" type="password" autoComplete="off" value={form.streamKey} onChange={(e) => setForm({ ...form, streamKey: e.target.value })} /></Field>
          <ErrorNotice error={addDest.error} />
        </div>
      </Dialog>
    </div>
  );
}

const pick = (o: Out) => ({ mode: o.mode, name: o.name, inputId: o.inputId, preset: o.preset, record: o.record, hls: o.hls, prerollSeconds: o.prerollSeconds, postrollSeconds: o.postrollSeconds, autoSchedule: o.autoSchedule });
