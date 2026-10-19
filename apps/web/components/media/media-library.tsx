'use client';
// Clips (automatic highlights and manual), recordings, compilations, export jobs and share links.
import { useState } from 'react';
import { Download, Film, Link2, Pencil, Pin, RotateCcw, Scissors, X } from 'lucide-react';
import { Button, Dialog, EmptyState, ErrorNotice, Field, Input, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs, type Tone } from '@bs/ui';
import { post, type ApiError } from '@/lib/api';
import { fmtDate, useGet } from '@/lib/hooks';
import { ClipEditor, type ClipRow } from './clip-editor';

interface Clip extends ClipRow { matchId: string | null; tags: string[]; thumbnailUrl: string | null; createdAt: string; highlight: { state: string; reason: string | null; confidence: string } | null; exports: { id: string; state: string; progress: number; error: string | null; params: { aspect?: string }; downloadUrl: string | null }[] }
interface Rec { id: string; matchId: string; matchLabel: string; title: string; kind: string; state: string; durationMs: number | null; bytes: number; pinned: boolean; retainUntil: string | null; createdAt: string; mediaUrl: string | null }
interface Job { id: string; kind: string; state: string; progress: number; error: string | null; attempts: number; createdAt: string; params: { title?: string; aspect?: string }; downloadUrl: string | null }
interface Share { id: string; resourceType: string; resourceId: string; publicId: string; expiresAt: string | null; revokedAt: string | null; accessCount: number; createdAt: string }

const TONE: Record<string, Tone> = { READY: 'healthy', COMPLETED: 'healthy', PROCESSING: 'primary', RUNNING: 'primary', QUEUED: 'neutral', STALE: 'warning', FAILED: 'offline', CANCELLED: 'neutral', PARTIAL: 'warning', RECORDING: 'live', NEEDS_ALIGNMENT: 'warning', WAITING_FOR_MEDIA: 'neutral', DELETED: 'offline' };
const secs = (ms: number | null) => (ms ? `${Math.round(ms / 1000)}s` : '—');

export function MediaLibrary({ matchId, tz }: { matchId?: string; tz: string }) {
  const q = matchId ? `?matchId=${matchId}` : '';
  const clips = useGet<Clip[]>(['clips', matchId], `clips${q}`, { refetchInterval: 4000 });
  const recs = useGet<Rec[]>(['recordings', matchId], `recordings${q}`, { refetchInterval: 8000 });
  const jobs = useGet<Job[]>(['jobs'], 'exports', { refetchInterval: 3000 });
  const shares = useGet<Share[]>(['shares'], 'shares');
  const highlights = useGet<{ id: string; label: string; state: string; reason: string | null; targetCaptureAt: string }[]>(['highlights', matchId], matchId ? `matches/${matchId}/highlights` : null, { refetchInterval: 4000 });
  const [edit, setEdit] = useState<Clip | null>(null);
  const [play, setPlay] = useState<{ title: string; url: string } | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [shareOut, setShareOut] = useState<{ watchUrl: string; embedUrl: string } | null>(null);
  const [mk, setMk] = useState<{ rec: Rec; inS: string; outS: string; title: string } | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await Promise.all([clips.refetch(), jobs.refetch(), shares.refetch(), recs.refetch()]);
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  const share = (resourceType: string, resourceId: string) => act(async () => setShareOut(await post('shares', { resourceType, resourceId, expiresInHours: 24 * 7 })));
  return (
    <div className="space-y-3">
      <ErrorNotice error={err} />
      <Tabs defaultValue="clips">
        <TabList className="mb-3"><Tab value="clips">Clips</Tab><Tab value="recordings">Recordings</Tab><Tab value="jobs">Exports</Tab><Tab value="shares">Share links</Tab></TabList>
        <TabPanel value="clips" className="space-y-3">
          {matchId && highlights.data?.some((h) => h.state !== 'READY') ? (
            <ul className="space-y-1 text-xs" aria-label="Highlight requests">
              {highlights.data.filter((h) => h.state !== 'READY').map((h) => <li key={h.id} className="flex items-center gap-2"><StatusPill tone={TONE[h.state] ?? 'neutral'}>{h.state.replace(/_/g, ' ').toLowerCase()}</StatusPill>{h.label} at {fmtDate(h.targetCaptureAt, tz, { timeStyle: 'medium' })}{h.reason ? <span className="text-muted">— {h.reason}</span> : null}</li>)}
            </ul>
          ) : null}
          {sel.length >= 2 ? <div className="flex items-center gap-2 text-sm"><span>{sel.length} clips selected</span><Button variant="primary" size="sm" onClick={() => void act(() => post('compilations', { title: `Highlights ${new Date().toLocaleDateString()}`, clipIds: sel, aspect: '16:9' }).then(() => setSel([])))}><Film className="size-3" /> Make compilation</Button><Button size="sm" variant="ghost" onClick={() => setSel([])}>Clear</Button></div> : null}
          {clips.isLoading ? <Spinner /> : !clips.data?.length ? <EmptyState title="No clips yet" body="Goals and other key events create highlight clips automatically from the recorded programme. You can also cut clips from recordings." /> : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {clips.data.map((c) => (
                <div key={c.id} className="rounded border border-border p-2 text-sm">
                  <button type="button" className="relative block aspect-video w-full overflow-hidden rounded bg-black" disabled={!c.mediaUrl} onClick={() => c.mediaUrl && setPlay({ title: c.title, url: c.mediaUrl })} aria-label={`Play ${c.title}`}>
                    {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="text-xs text-muted">{c.state.toLowerCase()}</span>}
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-xs text-white">{secs(c.outMs - c.inMs)}</span>
                  </button>
                  <div className="mt-1 flex items-center gap-2"><input type="checkbox" aria-label={`Select ${c.title}`} disabled={c.state !== 'READY'} checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} /><span className="truncate font-medium">{c.title}</span><StatusPill tone={TONE[c.state] ?? 'neutral'} className="ml-auto">{c.stale ? 'stale' : c.state.toLowerCase()}</StatusPill></div>
                  <div className="text-xs text-muted">{fmtDate(c.createdAt, tz, { dateStyle: 'short', timeStyle: 'short' })}{c.highlight ? ` · auto${c.highlight.confidence === 'uncalibrated' ? ' (uncalibrated sync)' : ''}` : ' · manual'}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" disabled={!c.mediaUrl} onClick={() => setEdit(c)}><Pencil className="size-3" /> Edit</Button>
                    <Button size="sm" variant="ghost" disabled={!c.mediaUrl} onClick={() => void share('clip', c.id)}><Link2 className="size-3" /> Share</Button>
                  </div>
                  {c.exports.length ? <ul className="mt-1 space-y-0.5 text-xs">{c.exports.slice(0, 3).map((e) => <li key={e.id} className="flex items-center gap-1"><StatusPill tone={TONE[e.state] ?? 'neutral'}>{e.params.aspect} {e.state.toLowerCase()}</StatusPill>{e.state === 'RUNNING' ? `${Math.round(e.progress * 100)}%` : null}{e.downloadUrl ? <a className="underline" href={e.downloadUrl}>Download</a> : null}</li>)}</ul> : null}
                </div>
              ))}
            </div>
          )}
        </TabPanel>
        <TabPanel value="recordings">
          <Table>
            <thead><tr><th>Recording</th><th>Match</th><th>State</th><th>Duration</th><th>Size</th><th>Retention</th><th /></tr></thead>
            <tbody>
              {recs.data?.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}<div className="text-xs text-muted">{r.kind} · {fmtDate(r.createdAt, tz)}</div></td>
                  <td>{r.matchLabel}</td>
                  <td><StatusPill tone={TONE[r.state] ?? 'neutral'}>{r.state.toLowerCase()}</StatusPill></td>
                  <td>{secs(r.durationMs)}</td>
                  <td>{r.bytes ? `${(r.bytes / 1024 / 1024).toFixed(0)} MB` : '—'}</td>
                  <td className="text-xs">{r.pinned ? 'pinned' : r.retainUntil ? `until ${fmtDate(r.retainUntil, tz, { dateStyle: 'medium' })}` : '—'}</td>
                  <td className="whitespace-nowrap">
                    {r.mediaUrl ? <Button size="sm" variant="ghost" onClick={() => setPlay({ title: r.title, url: r.mediaUrl! })}>Play</Button> : null}
                    {r.mediaUrl ? <Button size="sm" variant="ghost" onClick={() => setMk({ rec: r, inS: '0', outS: '15', title: `${r.matchLabel} clip` })}><Scissors className="size-3" /> Clip</Button> : null}
                    <Button size="sm" variant="ghost" aria-label={r.pinned ? 'Unpin' : 'Pin'} onClick={() => void act(() => post(`recordings/${r.id}/pin`, { pinned: !r.pinned }))}><Pin className="size-3" /></Button>
                    {r.mediaUrl ? <Button size="sm" variant="ghost" onClick={() => void share('recording', r.id)}><Link2 className="size-3" /></Button> : null}
                  </td>
                </tr>
              ))}
              {!recs.data?.length ? <tr><td colSpan={7} className="text-muted">No recordings yet. Outputs record automatically while streaming.</td></tr> : null}
            </tbody>
          </Table>
        </TabPanel>
        <TabPanel value="jobs">
          <Table>
            <thead><tr><th>Job</th><th>State</th><th>Progress</th><th>Created</th><th /></tr></thead>
            <tbody>
              {jobs.data?.filter((j) => j.kind !== 'asset_normalise').map((j) => (
                <tr key={j.id}>
                  <td>{j.kind.replace(/_/g, ' ')}{j.params.aspect ? ` · ${j.params.aspect}` : ''}{j.params.title ? ` · ${j.params.title}` : ''}{j.error ? <div className="text-xs text-live">{j.error}</div> : null}</td>
                  <td><StatusPill tone={TONE[j.state] ?? 'neutral'}>{j.state.toLowerCase()}</StatusPill>{j.attempts > 1 ? <span className="text-xs text-muted"> attempt {j.attempts}</span> : null}</td>
                  <td>{Math.round(j.progress * 100)}%</td>
                  <td className="text-xs">{fmtDate(j.createdAt, tz, { timeStyle: 'medium' })}</td>
                  <td className="whitespace-nowrap">
                    {['QUEUED', 'RUNNING'].includes(j.state) ? <Button size="sm" variant="ghost" onClick={() => void act(() => post(`exports/${j.id}/cancel`))}><X className="size-3" /> Cancel</Button> : null}
                    {['FAILED', 'CANCELLED'].includes(j.state) ? <Button size="sm" variant="ghost" onClick={() => void act(() => post(`exports/${j.id}/retry`))}><RotateCcw className="size-3" /> Retry</Button> : null}
                    {j.downloadUrl ? <><a className="inline-flex items-center gap-1 px-2 text-xs underline" href={j.downloadUrl}><Download className="size-3" /> Download</a><Button size="sm" variant="ghost" onClick={() => void share('export', j.id)}><Link2 className="size-3" /></Button></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TabPanel>
        <TabPanel value="shares">
          <Table>
            <thead><tr><th>Shared</th><th>Expires</th><th>Opens</th><th>Status</th><th /></tr></thead>
            <tbody>
              {shares.data?.map((s) => (
                <tr key={s.id}>
                  <td>{s.resourceType} · <span className="font-mono text-xs">{s.publicId}</span></td>
                  <td className="text-xs">{s.expiresAt ? fmtDate(s.expiresAt, tz) : 'never'}</td>
                  <td>{s.accessCount}</td>
                  <td><StatusPill tone={s.revokedAt ? 'offline' : s.expiresAt && new Date(s.expiresAt) < new Date() ? 'neutral' : 'healthy'}>{s.revokedAt ? 'revoked' : s.expiresAt && new Date(s.expiresAt) < new Date() ? 'expired' : 'active'}</StatusPill></td>
                  <td>{!s.revokedAt ? <Button size="sm" variant="ghost" onClick={() => void act(() => post(`shares/${s.id}/revoke`))}>Revoke</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TabPanel>
      </Tabs>
      {edit ? <ClipEditor clip={edit} onClose={() => setEdit(null)} onExported={() => void jobs.refetch()} /> : null}
      <Dialog wide open={!!play} onOpenChange={(o) => !o && setPlay(null)} title={play?.title ?? ''}>{play ? <video src={play.url} controls autoPlay className="aspect-video w-full bg-black" /> : null}</Dialog>
      <Dialog open={!!shareOut} onOpenChange={(o) => !o && setShareOut(null)} title="Share link created" description="Copy it now: the link contains a secret that is not shown again. Anyone with it can watch until it expires or you revoke it.">
        {shareOut ? <div className="space-y-2 text-xs"><Field label="Watch page" htmlFor="sw"><Input id="sw" readOnly value={shareOut.watchUrl} onFocus={(e) => e.target.select()} /></Field><Field label="Embed" htmlFor="se"><Input id="se" readOnly value={`<iframe src="${shareOut.embedUrl}" width="640" height="360" allowfullscreen></iframe>`} onFocus={(e) => e.target.select()} /></Field></div> : null}
      </Dialog>
      <Dialog open={!!mk} onOpenChange={(o) => !o && setMk(null)} title="Clip from recording" footer={<Button variant="primary" onClick={() => mk && void act(() => post('clips', { recordingId: mk.rec.id, title: mk.title, inMs: Math.round(Number(mk.inS) * 1000), outMs: Math.round(Number(mk.outS) * 1000) }).then(() => setMk(null)))}>Create clip</Button>}>
        {mk ? <div className="grid gap-2 sm:grid-cols-3"><Field label="Title" htmlFor="mt" className="sm:col-span-3"><Input id="mt" value={mk.title} onChange={(e) => setMk({ ...mk, title: e.target.value })} /></Field><Field label="In (s)" htmlFor="mi"><Input id="mi" inputMode="decimal" value={mk.inS} onChange={(e) => setMk({ ...mk, inS: e.target.value })} /></Field><Field label="Out (s)" htmlFor="mo"><Input id="mo" inputMode="decimal" value={mk.outS} onChange={(e) => setMk({ ...mk, outS: e.target.value })} /></Field><p className="text-xs text-muted sm:col-span-3">Times are positions in the recording ({secs(mk.rec.durationMs)} long).</p></div> : null}
      </Dialog>
    </div>
  );
}
