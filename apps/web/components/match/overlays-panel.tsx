'use client';
// The match's graphics outputs, led by the OBS link. One output is created with every match; more are an
// explicit "Add another output" so most people never meet the concept.
import { OUTPUT_FORMATS } from '@bs/graphics';
import Link from 'next/link';
import { useState } from 'react';
import { Clapperboard, Copy, ExternalLink, Plus } from 'lucide-react';
import { Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, NativeSelect, Spinner, StatusPill, type Tone } from '@bs/ui';
import { post, put } from '@/lib/api';
import { useAction, useCopy, useGet } from '@/lib/hooks';
import { layerLabel } from '@/lib/labels';

export interface OverlayRow {
  id: string; name: string; kind: string; publicId: string; gamePlanVersionId: string | null; format: '16:9' | '9:16' | 'venue';
  theme: { id: string; profile: string; version: number } | null; pendingTheme: { id: string; version: number } | null;
  state: { revision: number; displayedRevision: number; displayedAt: string | null; mode: string; inhibited: boolean; scorebugVisible: boolean; onAir: string[] };
  renderers: { purpose: string; displayedRevision: number; lastSeenAt: string; reporting: boolean }[];
}

/** Is OBS (or the cloud compositor) showing this output, and is it up to date? */
export function obsStatus(o: OverlayRow): { connected: boolean; tone: Tone; text: string } {
  const prod = o.renderers.filter((r) => r.purpose === 'production' || r.purpose === 'compositor');
  if (!prod.length) return { connected: false, tone: 'offline', text: 'OBS not connected yet' };
  return o.state.displayedRevision >= o.state.revision ? { connected: true, tone: 'healthy', text: 'OBS connected · showing the latest' } : { connected: true, tone: 'warning', text: 'OBS connected · catching up' };
}

export function ObsLinkPanel({ matchId, canEdit }: { matchId: string; canEdit: boolean }) {
  const list = useGet<OverlayRow[]>(['overlays', matchId], `matches/${matchId}/overlays`, { refetchInterval: 5000 });
  const profiles = useGet<{ id: string; name: string; currentVersion: number }[]>(['theme-profiles'], 'theme-profiles');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: 'Second output', themeProfileId: '' });
  const createDefault = useAction(() => post(`matches/${matchId}/overlays`, { name: 'Main graphics' }), [['overlays', matchId]], { success: 'OBS link created' });
  const add = useAction(() => post(`matches/${matchId}/overlays`, { name: form.name, themeProfileId: form.themeProfileId || null }), [['overlays', matchId]], { success: 'Output added' });

  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={() => list.refetch()} />;
  const [primary, ...others] = list.data ?? [];
  if (!primary) {
    return (
      <EmptyState title="No OBS link yet" body="The OBS link is the address you paste into OBS (or vMix) as a Browser Source. It shows this match's graphics over your video."
        action={canEdit ? <Button variant="primary" loading={createDefault.isPending} onClick={() => createDefault.mutate(undefined)}>Create the OBS link</Button> : null} />
    );
  }
  return (
    <div className="grid gap-4">
      <OutputCard o={primary} matchId={matchId} canEdit={canEdit} primary />
      <details className="rounded-[var(--radius-card)] border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">More outputs {others.length ? `(${others.length})` : ''}</summary>
        <p className="mt-2 text-xs text-muted">A second output has its own OBS link and its own graphics state, for example a clean feed without a scorebug or a different look for a second screen.</p>
        <div className="mt-3 grid gap-3">
          {others.map((o) => <OutputCard key={o.id} o={o} matchId={matchId} canEdit={canEdit} />)}
          {canEdit ? <div><Button size="sm" onClick={() => setAddOpen(true)}><Plus className="size-4" /> Add another output</Button></div> : null}
        </div>
      </details>
      <Dialog open={addOpen} onOpenChange={setAddOpen} title="Add another output" description="It starts with the current published version of the look you choose."
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="primary" disabled={!form.name.trim()} loading={add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => setAddOpen(false) })}>Add output</Button></>}>
        <div className="grid gap-3">
          <Field label="Name" htmlFor="on"><Input id="on" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Look" htmlFor="op" hint="Defaults to the competition's look"><NativeSelect id="op" value={form.themeProfileId} onChange={(e) => setForm({ ...form, themeProfileId: e.target.value })}><option value="">Competition default</option>{profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.currentVersion})</option>)}</NativeSelect></Field>
          <ErrorNotice error={add.error} />
        </div>
      </Dialog>
    </div>
  );
}

function OutputCard({ o, matchId, canEdit, primary = false }: { o: OverlayRow; matchId: string; canEdit: boolean; primary?: boolean }) {
  const urls = useGet<{ production: string | null; monitor: string | null }>(['overlay-urls', o.id], `overlays/${o.id}/urls`);
  const copy = useCopy();
  const rotate = useAction(() => post(`overlays/${o.id}/rotate`, { purpose: 'production' }), [['overlay-urls', o.id], ['overlays', matchId]], { success: 'New OBS link created. Update the Browser Source in OBS.' });
  const apply = useAction(() => post(`overlays/${o.id}/apply-theme`), [['overlays', matchId]], { success: 'New version of the look applied' });
  const setFormat = useAction((format: string) => put(`overlays/${o.id}/format`, { format }), [['overlays', matchId]], { success: 'Output format changed. OBS picks it up on the next refresh.' });
  const starter = useAction(() => post(`overlays/${o.id}/starter-plan`), [['overlays', matchId], ['game-plans']], { success: 'Automation on: the pre-match graphics are going to air' });
  const [hk, setHk] = useState(false);
  const format = o.format ?? '16:9';
  const size = format === '9:16' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
  const st = obsStatus(o);
  const link = urls.data?.production ?? null;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{primary ? 'OBS link' : o.name}</h3>
        <StatusPill tone={st.tone}>{st.text}</StatusPill>
        {o.state.inhibited ? <StatusPill tone="live">Cleared (emergency)</StatusPill> : o.state.mode === 'manual' ? <StatusPill tone="warning">Manual mode</StatusPill> : null}
        <div className="ml-auto"><Button asChild variant="primary" size="sm"><Link href={`/app/matches/${matchId}/control/${o.id}`}><Clapperboard className="size-4" /> Control room</Link></Button></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input readOnly aria-label="OBS link" value={link ?? (urls.isLoading ? 'Loading…' : 'Not available for your role')} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="primary" disabled={!link} onClick={() => link && void copy(link, 'OBS link')}><Copy className="size-4" /> Copy link</Button>
        {urls.data?.monitor ? <Button asChild variant="ghost"><a href={urls.data.monitor} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Preview</a></Button> : null}
      </div>
      <p className="mt-2 text-xs text-muted">
        Look: {o.theme ? `${o.theme.profile} v${o.theme.version}` : 'default'} · On air now: {o.state.onAir.length ? o.state.onAir.map(layerLabel).join(', ') : 'nothing'}
      </p>
      {!o.gamePlanVersionId && o.kind === 'graphics' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/10 p-2 text-sm">
          No automation on this output, so OBS shows nothing until graphics are taken by hand.
          {canEdit ? <Button size="sm" variant="primary" loading={starter.isPending} onClick={() => starter.mutate(undefined)}>Use the starter flow</Button> : null}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Format</span>
        <NativeSelect aria-label="Output format" className="w-auto" value={format} disabled={!canEdit || setFormat.isPending} onChange={(e) => setFormat.mutate(e.target.value)}>
          {OUTPUT_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </NativeSelect>
        {format === '9:16' ? <span>Vertical stream: scorebug at the top, events at the bottom, boards scaled to the width.</span> : format === 'venue' ? <span>Big-screen layout: scorebug and events scaled up, no ticker needed.</span> : null}
      </div>
      {o.pendingTheme ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-sm text-warning">
          A newer version of this look (v{o.pendingTheme.version}) is published. This output keeps its current version until you apply it.
          {canEdit ? <Button size="sm" loading={apply.isPending} onClick={() => apply.mutate(undefined)}>Use the new version</Button> : null}
        </div>
      ) : null}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-primary">How to add it to OBS</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>In OBS, under <b className="text-text">Sources</b>, press <b className="text-text">+</b> and choose <b className="text-text">Browser</b>.</li>
          <li>Paste the link. Set width <b className="text-text">{size.w}</b> and height <b className="text-text">{size.h}</b>. Leave the custom CSS box empty: the background is already transparent.</li>
          <li>Untick <b className="text-text">Shutdown source when not visible</b>, so the graphics stay current. Move the source above your camera.</li>
        </ol>
        <p className="mt-2 text-xs text-muted">vMix: add a <b>Web Browser</b> input with the same link. The status above turns green once OBS or vMix is showing the page.</p>
      </details>
      <details className="mt-2 text-sm" onToggle={(e) => setHk((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-primary">Stream Deck, hotkeys and OBS scenes</summary>
        <div className="mt-2 grid gap-2 text-xs text-muted">
          <p className="flex flex-wrap items-center gap-2"><Button asChild size="sm"><a href={`/api/v1/matches/${matchId}/obs-scene-collection.json`} download>Download OBS scene collection</a></Button><span>Import it in OBS (Scene Collection → Import): one scene per output with the Browser Source already sized.</span></p>
          <p>Each row is a web request a Stream Deck (System → Website, or the API Request plugin) or any automation can send. Create an API key with the overlay.operate scope under Settings → API keys and send it as the Authorization header.</p>
          <HotkeyTable overlayId={o.id} enabled={hk} />
        </div>
      </details>
      {canEdit ? (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">Advanced</summary>
          <p className="mt-2">Anyone with this link can see the graphics. If it has been shared too widely,{' '}
            <button className="underline" disabled={rotate.isPending} onClick={() => confirm(`Create a new OBS link for "${o.name}"? The old link stops working straight away, so update OBS afterwards.`) && rotate.mutate(undefined)}>create a new link</button>.
          </p>
        </details>
      ) : null}
      <ErrorNotice error={urls.error ?? rotate.error ?? apply.error ?? setFormat.error ?? starter.error} />
    </Card>
  );
}

interface Hotkey { action: string; label: string; method: string; url: string; header: string }
function HotkeyTable({ overlayId, enabled }: { overlayId: string; enabled: boolean }) {
  const hotkeys = useGet<Hotkey[]>(['hotkeys', overlayId], enabled ? `hotkeys/${overlayId}` : null);
  const copy = useCopy();
  if (!enabled) return null;
  if (hotkeys.isLoading) return <Spinner />;
  if (hotkeys.error) return <ErrorNotice error={hotkeys.error} />;
  return (
    <table className="w-full text-xs"><thead><tr className="text-left text-muted"><th className="py-1">Button</th><th>Request</th><th /></tr></thead><tbody>
      {hotkeys.data?.map((h) => (
        <tr key={h.action} className="border-t border-border/60">
          <td className="py-1 text-text">{h.label}</td>
          <td className="break-all font-mono">{h.method} {h.url}</td>
          <td className="text-right"><Button size="sm" variant="ghost" aria-label={`Copy request for ${h.label}`} onClick={() => void copy(h.url, 'Request URL')}><Copy className="size-3.5" /></Button></td>
        </tr>
      ))}
    </tbody></table>
  );
}
