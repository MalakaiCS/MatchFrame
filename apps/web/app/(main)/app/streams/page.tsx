'use client';
// Streams: encoder inputs (RTMP URL/key, reveal/rotate, health), live sessions with capacity, and multiview.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Copy, Eye, Plus, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { Button, Dialog, EmptyState, ErrorNotice, Field, Input, NativeSelect, PageHeader, StatusPill, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import { HlsPlayer } from '@/components/stream/hls-player';
import { STATE_TONE } from '@/components/match/streams-panel';

interface InputRow { id: string; name: string; status: string; boundSessionId: string | null; keyVersion: number; serverUrl: string | null; streamKeyMasked: string | null; transport: string; lastHealth: { state?: string; video?: { width?: number; height?: number; fps?: number }; bitrateKbps?: number | null; checkedAt?: string } }
interface Overview { demo: boolean; configured: boolean; capacity: { used: number; max: number }; sessions: { id: string; matchId: string; matchLabel: string; state: string; error: { message?: string } | null; demo: boolean; startedAt: string | null; outputs: { id: string; mode: string; name: string; state: string; hlsUrl: string | null }[] }[] }

export default function StreamsPage() {
  const me = useMe();
  const full = isFull(me.data?.role);
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const inputs = useGet<InputRow[]>(['inputs'], 'inputs', { refetchInterval: 5000 });
  const ov = useGet<Overview>(['streams-overview'], 'streams', { refetchInterval: 3000 });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = useAction(() => post('inputs', { name }), [['inputs']]);
  const [revealed, setRevealed] = useState<{ id: string; serverUrl: string | null; streamKey: string } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const reveal = async (id: string) => {
    setErr(null);
    try {
      setRevealed({ id, ...(await post<{ serverUrl: string | null; streamKey: string }>(`inputs/${id}/reveal`)) });
    } catch (e) {
      setErr(e);
    }
  };
  const rotate = async (id: string) => {
    if (!confirm('Rotate this key? Encoders using the old key stop working immediately.')) return;
    setErr(null);
    try {
      await post(`inputs/${id}/rotate`);
      setRevealed(null);
      await inputs.refetch();
    } catch (e) {
      setErr(e);
    }
  };
  const live = ov.data?.sessions.filter((s) => !['STOPPED', 'FAILED'].includes(s.state)) ?? [];
  return (
    <>
      <PageHeader title="Streams" subtitle="Encoder inputs, live sessions and multiview." actions={full ? <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> New input</Button> : null} />
      {ov.data && !ov.data.configured ? <ErrorNotice error={{ message: 'Streaming is not configured on this deployment.' }} /> : null}
      {ov.data?.demo ? <div className="mb-3"><StatusPill tone="warning">Demo media mode — no real video</StatusPill></div> : null}
      <ErrorNotice error={(err ?? inputs.error) as never} />
      <Tabs defaultValue="sessions">
        <TabList className="mb-3"><Tab value="sessions">Sessions ({live.length})</Tab><Tab value="inputs">Inputs</Tab><Tab value="multiview">Multiview</Tab></TabList>
        <TabPanel value="sessions" className="space-y-3">
          {ov.data ? <p className="text-sm text-muted">Capacity: {ov.data.capacity.used} of {ov.data.capacity.max} outputs in use (measured limit for this deployment).</p> : null}
          <Table>
            <thead><tr><th>Match</th><th>Session</th><th>Outputs</th><th>Started</th></tr></thead>
            <tbody>
              {ov.data?.sessions.map((s) => (
                <tr key={s.id}>
                  <td><Link className="underline" href={`/app/matches/${s.matchId}`}>{s.matchLabel}</Link></td>
                  <td><StatusPill tone={STATE_TONE[s.state] ?? 'neutral'}>{s.state}</StatusPill>{s.error?.message ? <div className="text-xs text-warning">{s.error.message}</div> : null}</td>
                  <td className="text-xs">{s.outputs.map((o) => `${o.name}: ${o.state}`).join(' · ')}</td>
                  <td className="text-xs">{fmtDate(s.startedAt, tz, { timeStyle: 'medium' })}</td>
                </tr>
              ))}
              {!ov.data?.sessions.length ? <tr><td colSpan={4} className="text-muted">No sessions in the last 6 hours.</td></tr> : null}
            </tbody>
          </Table>
        </TabPanel>
        <TabPanel value="inputs">
          {!inputs.data?.length ? <EmptyState title="No inputs yet" body="Create an RTMP input and paste its URL and key into OBS or your encoder." /> : (
            <Table>
              <thead><tr><th>Input</th><th>Status</th><th>Server URL</th><th>Stream key</th><th>Health</th><th /></tr></thead>
              <tbody>
                {inputs.data.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}<div className="text-xs text-muted">{i.transport} · key v{i.keyVersion}</div></td>
                    <td><StatusPill tone={i.status === 'receiving' ? 'healthy' : i.status === 'bound' ? 'warning' : 'neutral'}>{i.status}</StatusPill></td>
                    <td className="font-mono text-xs">{i.serverUrl ?? '—'}</td>
                    <td className="font-mono text-xs">{revealed?.id === i.id ? <span className="flex items-center gap-1">{revealed.streamKey}<Button size="sm" variant="ghost" aria-label="Copy key" onClick={() => void navigator.clipboard.writeText(revealed.streamKey)}><Copy className="size-3" /></Button></span> : i.streamKeyMasked}</td>
                    <td className="text-xs">{i.lastHealth.video?.width ? `${i.lastHealth.video.width}×${i.lastHealth.video.height}${i.lastHealth.video.fps ? `@${i.lastHealth.video.fps}` : ''}` : 'no video'} · bitrate {i.lastHealth.bitrateKbps ? `${i.lastHealth.bitrateKbps} kbps` : 'Unavailable'}{i.lastHealth.checkedAt ? <div className="text-muted">checked {fmtDate(i.lastHealth.checkedAt, tz, { timeStyle: 'medium' })}</div> : null}</td>
                    <td className="whitespace-nowrap">{full ? <><Button size="sm" variant="ghost" onClick={() => void reveal(i.id)}><Eye className="size-3" /> Reveal</Button><Button size="sm" variant="ghost" disabled={!!i.boundSessionId} onClick={() => void rotate(i.id)}><RefreshCw className="size-3" /> Rotate</Button></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </TabPanel>
        <TabPanel value="multiview"><Multiview sessions={live} /></TabPanel>
      </Tabs>
      <Dialog open={open} onOpenChange={setOpen} title="New RTMP input" description="RTMP ingest is unencrypted on this deployment. Use a private network or VPN for encoders when possible." footer={<Button variant="primary" disabled={!name || create.isPending} onClick={async () => { await create.mutateAsync(undefined as never); setOpen(false); setName(''); }}>Create</Button>}>
        <Field label="Name" htmlFor="in-name"><Input id="in-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bayside Oval camera 1" /></Field>
        <ErrorNotice error={create.error} />
      </Dialog>
    </>
  );
}

function Multiview({ sessions }: { sessions: Overview['sessions'] }) {
  const tiles = sessions.flatMap((s) => s.outputs.filter((o) => o.hlsUrl).map((o) => ({ key: o.id, label: `${s.matchLabel} · ${o.name}`, src: o.hlsUrl!, state: o.state })));
  const [count, setCount] = useState(4);
  const [audio, setAudio] = useState<string | null>(null);
  if (!tiles.length) return <EmptyState title="Nothing live" body="Tiles appear when outputs produce HLS." />;
  const cols = count <= 2 ? 2 : count <= 4 ? 2 : 3;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">Tiles <NativeSelect className="w-auto" value={count} onChange={(e) => setCount(Number(e.target.value))}>{[2, 3, 4, 6, 9].map((n) => <option key={n}>{n}</option>)}</NativeSelect><span className="text-xs text-muted">All tiles start muted; one audio monitor at a time. Offscreen tiles pause.</span></label>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {tiles.slice(0, count).map((t) => <Tile key={t.key} label={t.label} src={t.src} state={t.state} audible={audio === t.key} onAudio={() => setAudio(audio === t.key ? null : t.key)} />)}
      </div>
    </div>
  );
}

function Tile({ label, src, state, audible, onAudio }: { label: string; src: string; state: string; audible: boolean; onAudio: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting));
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="rounded border border-border">
      <HlsPlayer src={src} muted={!audible} paused={!visible} />
      <div className="flex items-center gap-2 px-2 py-1 text-xs">
        <StatusPill tone={STATE_TONE[state] ?? 'neutral'}>{state === 'LIVE' ? 'healthy' : state === 'DEGRADED' ? 'warning' : state}</StatusPill>
        <span className="truncate">{label}</span>
        <Button size="sm" variant="ghost" className="ml-auto" aria-label={audible ? 'Mute' : 'Listen'} onClick={onAudio}>{audible ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}</Button>
      </div>
    </div>
  );
}
