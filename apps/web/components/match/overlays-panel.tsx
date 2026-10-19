'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Copy, Eye, KeyRound, Plus, Clapperboard } from 'lucide-react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, Spinner, StatusPill } from '@bs/ui';
import { get, post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';

interface OverlayRow {
  id: string; name: string; kind: string; publicId: string;
  theme: { profile: string; version: number } | null; pendingTheme: { id: string; version: number } | null;
  state: { revision: number; displayedRevision: number; displayedAt: string | null; mode: string; inhibited: boolean; scorebugVisible: boolean; onAir: string[] };
  renderers: { purpose: string; displayedRevision: number; lastSeenAt: string; reporting: boolean }[];
}

export function OverlaysPanel({ matchId, canEdit }: { matchId: string; sport: string; canEdit: boolean }) {
  const list = useGet<OverlayRow[]>(['overlays', matchId], `matches/${matchId}/overlays`, { refetchInterval: 5000 });
  const profiles = useGet<{ id: string; name: string; currentVersion: number }[]>(['theme-profiles'], 'theme-profiles');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: 'Main graphics', themeProfileId: '' });
  const create = useAction(() => post('matches/' + matchId + '/overlays', { name: form.name, themeProfileId: form.themeProfileId || null }), [['overlays', matchId]]);
  const [urls, setUrls] = useState<{ id: string; production: string; monitor: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const rotate = useAction((id: string) => post(`overlays/${id}/rotate`, { purpose: 'production' }), [['overlays', matchId]]);
  const apply = useAction((id: string) => post(`overlays/${id}/apply-theme`), [['overlays', matchId]]);

  const showUrls = async (id: string) => setUrls({ id, ...(await get<{ production: string; monitor: string }>(`overlays/${id}/urls`)) });
  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  if (list.isLoading) return <Spinner />;
  return (
    <div className="grid gap-3">
      <ErrorNotice error={list.error ?? rotate.error ?? apply.error} />
      {canEdit ? <div className="flex justify-end"><Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> New overlay</Button></div> : null}
      {!list.data?.length ? <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">No overlays yet. An overlay is one independent graphics output: a browser source for OBS/vMix, or the graphics of a cloud programme.</p> : null}
      {list.data?.map((o) => {
        const prod = o.renderers.filter((r) => r.purpose === 'production' || r.purpose === 'compositor');
        const inSync = o.state.displayedRevision >= o.state.revision;
        return (
          <Card key={o.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{o.name}</h3>
              <StatusPill tone={o.state.inhibited ? 'live' : o.state.mode === 'manual' ? 'warning' : 'primary'}>{o.state.inhibited ? 'Emergency cleared' : o.state.mode === 'manual' ? 'Manual' : 'Auto'}</StatusPill>
              <StatusPill tone={prod.length ? 'healthy' : 'offline'}>{prod.length ? `${prod.length} output renderer(s)` : 'No output renderer connected'}</StatusPill>
              {prod.length ? <StatusPill tone={inSync ? 'healthy' : 'warning'}>{inSync ? `Displaying rev ${o.state.displayedRevision}` : `Rev ${o.state.revision} not yet displayed`}</StatusPill> : null}
              <span className="text-xs text-muted">{o.theme ? `${o.theme.profile} v${o.theme.version}` : 'Default theme'}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button asChild variant="primary" size="sm"><Link href={`/app/matches/${matchId}/control/${o.id}`}><Clapperboard className="size-4" /> Control room</Link></Button>
                <Button size="sm" onClick={() => showUrls(o.id)}><Eye className="size-4" /> URLs</Button>
                {canEdit ? <Button size="sm" variant="ghost" loading={rotate.isPending} onClick={() => confirm(`Rotate the production URL for "${o.name}"? Browser sources using the old URL stop immediately.`) && rotate.mutate(o.id)}><KeyRound className="size-4" /> Rotate URL</Button> : null}
              </div>
            </div>
            {o.pendingTheme ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-sm text-warning">
                Theme v{o.pendingTheme.version} is published. This overlay stays on its pinned version until you apply it.
                <Button size="sm" loading={apply.isPending} onClick={() => apply.mutate(o.id)}>Apply now</Button>
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted">On air: {o.state.onAir.length ? o.state.onAir.join(', ') : 'nothing'}</p>
          </Card>
        );
      })}
      <Dialog open={open} onOpenChange={setOpen} title="New overlay" description="Pins the current published theme version. Later theme changes need an explicit apply." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => setOpen(false) })}>Create</Button></>}>
        <div className="grid gap-3">
          <Field label="Name" htmlFor="on"><Input id="on" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Theme profile" htmlFor="op" hint="Defaults to the competition's profile"><NativeSelect id="op" value={form.themeProfileId} onChange={(e) => setForm({ ...form, themeProfileId: e.target.value })}><option value="">Competition default</option>{profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.currentVersion})</option>)}</NativeSelect></Field>
          <ErrorNotice error={create.error} />
        </div>
      </Dialog>
      <Dialog open={!!urls} onOpenChange={(o) => !o && setUrls(null)} wide title="Output URLs" description="Production URLs are read-only capabilities. Anyone with the link can view this output's graphics, so share them only with your production machine.">
        {urls ? (
          <div className="grid gap-4 text-sm">
            {(['production', 'monitor'] as const).map((k) => (
              <div key={k}>
                <div className="mb-1 font-medium capitalize">{k}{k === 'monitor' ? ' (checkerboard background, diagnostics)' : ' (transparent, for OBS/vMix)'}</div>
                <div className="flex gap-2"><Input readOnly value={urls[k]} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} /><Button onClick={() => copy(urls[k], k)}><Copy className="size-4" />{copied === k ? 'Copied' : 'Copy'}</Button></div>
              </div>
            ))}
            <div className="rounded-md bg-bg p-3 text-xs text-muted">
              <p className="mb-1 font-medium text-text">OBS browser source</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Add a <b>Browser</b> source and paste the production URL.</li>
                <li>Set width <b>1920</b> and height <b>1080</b> (graphics scale to other sizes without moving).</li>
                <li>Leave custom CSS empty; the page background is already transparent.</li>
                <li>Untick “Shutdown source when not visible” so graphics stay current. If the source is hidden or reloaded, it reconnects and shows the current state without replaying old animations.</li>
              </ol>
              <p className="mt-2">Other software with an HTML/browser input (for example vMix Web Browser input) can use the same URL; we have tested OBS behaviour only.</p>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
