'use client';
// Stream links on the Live page: one OBS link for a day of back-to-back matches at a ground (or in a competition).
// Add it to OBS once; it moves from match to match by itself (the match under way, then the one just finished with
// its thank-you and the matches today board, then the next match shortly before its kick-off). Today's order shows
// which match is on and why, and a match can be put on by hand.
import { useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { Copy, MoreHorizontal, Plus, Radio } from 'lucide-react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, StatusPill, cx } from '@bs/ui';
import { del, get, patch, post } from '@/lib/api';
import { fmtDate, useAction, useCopy, useGet } from '@/lib/hooks';

interface LinkMatch { id: string; home: string; away: string; scheduledAt: string; status: string; phase: string; score: { home: number; away: number } | null; hasOutput: boolean }
export interface StreamLink {
  id: string;
  name: string;
  venue: { id: string; name: string } | null;
  competition: { id: string; name: string } | null;
  switchBeforeMinutes: number;
  pinnedMatchId: string | null;
  connected: boolean;
  current: { id: string | null; reason: string };
  matches: LinkMatch[];
}

const WHY: Record<string, string> = {
  pinned: 'put on by hand',
  under_way: 'under way',
  just_finished: 'just finished: the thank-you and today’s matches until the next comes on',
  next: 'next up',
  last: 'the day’s last match',
  none: 'no matches today',
};

function Form({ initial, onSave, saving, error }: { initial: { name: string; venueId: string; competitionId: string; switchBeforeMinutes: number }; onSave: (v: typeof initial) => void; saving: boolean; error: unknown }) {
  const venues = useGet<{ id: string; name: string }[]>(['venues'], 'venues');
  const comps = useGet<{ id: string; name: string }[]>(['competitions'], 'competitions');
  const [f, setF] = useState(initial);
  return (
    <form id="stream-link-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Name" htmlFor="sl-name" hint="What you call this stream, e.g. Court 1 or Northgate Arena livestream"><Input id="sl-name" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Ground" htmlFor="sl-venue" hint="Today’s matches at this ground"><NativeSelect id="sl-venue" value={f.venueId} onChange={(e) => setF({ ...f, venueId: e.target.value })}><option value="">Any ground</option>{venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</NativeSelect></Field>
        <Field label="Competition" htmlFor="sl-comp" hint="Leave as any to take every competition"><NativeSelect id="sl-comp" value={f.competitionId} onChange={(e) => setF({ ...f, competitionId: e.target.value })}><option value="">Any competition</option>{comps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
      </div>
      <Field label="Move to the next match (minutes before its kick-off)" htmlFor="sl-before" hint="Or as soon as its scorer starts the run-down"><Input id="sl-before" type="number" inputMode="numeric" min={0} max={120} value={String(f.switchBeforeMinutes)} onChange={(e) => setF({ ...f, switchBeforeMinutes: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} /></Field>
      <ErrorNotice error={error as never} />
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={saving} disabled={!f.name.trim()}>Save</Button></div>
    </form>
  );
}

function LinkCard({ l, tz, canSetUp }: { l: StreamLink; tz: string; canSetUp: boolean }) {
  const copy = useCopy();
  const [editing, setEditing] = useState(false);
  const pin = useAction((matchId: string | null) => post(`stream-links/${l.id}/pin`, { matchId }), [['stream-links']], { success: (_r, v) => (v ? 'Put on now. It stays on until you go back to automatic.' : 'Back to automatic: the link follows the day again') });
  const rotate = useAction(() => post<{ url: string }>(`stream-links/${l.id}/rotate`), [['stream-links']], { success: 'New OBS link made: the old one has stopped. Paste the new one into OBS.' });
  const save = useAction((v: { name: string; venueId: string; competitionId: string; switchBeforeMinutes: number }) => patch(`stream-links/${l.id}`, { name: v.name, venueId: v.venueId || null, competitionId: v.competitionId || null, switchBeforeMinutes: v.switchBeforeMinutes }), [['stream-links']], { success: 'Stream link saved' });
  const remove = useAction(() => del(`stream-links/${l.id}`), [['stream-links']], { success: 'Stream link removed' });
  const copyLink = async () => {
    const r = await get<{ url: string }>(`stream-links/${l.id}/url`).catch(() => null);
    if (r?.url) await copy(r.url, 'Stream link');
  };
  const on = l.matches.find((m) => m.id === l.current.id);
  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated';
  return (
    <Card className="p-4" data-stream-link-card={l.name}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-semibold"><Radio className="size-4 text-primary" aria-hidden /> {l.name}</h3>
          <p className="text-xs text-muted">{[l.venue?.name ?? 'Any ground', l.competition?.name ?? 'any competition'].join(' · ')}</p>
        </div>
        <StatusPill tone={l.connected ? 'healthy' : 'neutral'}>{l.connected ? 'OBS has it open' : 'OBS not connected'}</StatusPill>
        <Button size="sm" onClick={() => void copyLink()}><Copy className="size-4" /> Copy OBS link</Button>
        <DM.Root modal={false}>
          <DM.Trigger asChild><Button size="sm" variant="ghost" aria-label={`More for ${l.name}`}><MoreHorizontal className="size-4" /></Button></DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-xl border border-border bg-panel p-1.5 text-sm shadow-pop">
              {canSetUp ? <DM.Item className={item} onSelect={() => setEditing(true)}>Edit</DM.Item> : null}
              <DM.Item className={item} onSelect={() => window.confirm('Make a new OBS link? The current one stops working straight away.') && rotate.mutate(undefined)}>Make a new OBS link</DM.Item>
              {canSetUp ? <DM.Item className={cx(item, 'text-live')} onSelect={() => window.confirm(`Remove the stream link “${l.name}”? OBS stops showing graphics from it.`) && remove.mutate(undefined)}>Remove</DM.Item> : null}
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>
      <p className="mt-3 text-sm" aria-live="polite">
        <span className="text-muted">On now: </span>
        {on ? <strong className="font-semibold">{on.home} v {on.away}</strong> : <span className="text-muted">nothing</span>}
        <span className="text-muted"> · {WHY[l.current.reason] ?? l.current.reason}</span>
        {l.pinnedMatchId ? <Button size="sm" variant="ghost" className="ml-2" loading={pin.isPending} onClick={() => pin.mutate(null)}>Back to automatic</Button> : null}
      </p>
      {l.matches.length ? (
        <ol className="mt-3 divide-y divide-border rounded-lg border border-border" aria-label={`Today on ${l.name}`}>
          {l.matches.map((m) => {
            const isOn = m.id === l.current.id;
            return (
              <li key={m.id} className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm', isOn && 'bg-primary/10')} data-on={isOn ? 'true' : undefined}>
                <span className="w-16 shrink-0 tabular text-muted">{fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{m.home} v {m.away}</span>
                <span className="text-xs text-muted">{m.status === 'live' ? `${m.phase} · ${m.score?.home ?? 0}–${m.score?.away ?? 0}` : m.status === 'completed' ? `FT · ${m.score?.home ?? 0}–${m.score?.away ?? 0}` : m.status === 'scheduled' ? (m.phase === 'Scheduled' ? 'to come' : m.phase) : m.status}</span>
                {isOn ? <StatusPill tone="live">on now</StatusPill> : m.hasOutput ? <Button size="sm" variant="ghost" loading={pin.isPending && pin.variables === m.id} onClick={() => pin.mutate(m.id)}>Put on now</Button> : <span className="text-xs text-muted">no output</span>}
              </li>
            );
          })}
        </ol>
      ) : <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted">No matches here today. It picks them up as soon as they are scheduled for today.</p>}
      <ErrorNotice error={pin.error ?? rotate.error ?? remove.error} />
      <Dialog open={editing} onOpenChange={setEditing} title={`Edit ${l.name}`}>
        <Form initial={{ name: l.name, venueId: l.venue?.id ?? '', competitionId: l.competition?.id ?? '', switchBeforeMinutes: l.switchBeforeMinutes }} saving={save.isPending} error={save.error} onSave={(v) => save.mutate(v, { onSuccess: () => setEditing(false) })} />
      </Dialog>
    </Card>
  );
}

export function StreamLinks({ tz, canSetUp }: { tz: string; canSetUp: boolean }) {
  const links = useGet<StreamLink[]>(['stream-links'], 'stream-links', { refetchInterval: 10_000 });
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<{ name: string; url: string } | null>(null);
  const create = useAction((v: { name: string; venueId: string; competitionId: string; switchBeforeMinutes: number }) => post<{ id: string; name: string; url: string }>('stream-links', { name: v.name, venueId: v.venueId || null, competitionId: v.competitionId || null, switchBeforeMinutes: v.switchBeforeMinutes }), [['stream-links']]);
  if (!links.data?.length && !canSetUp) return null;
  return (
    <section aria-labelledby="stream-links" className="mb-8">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="stream-links" className="font-semibold">Stream links</h2>
          <p className="text-sm text-muted">Streaming several matches back to back? Add one stream link to OBS for the whole day. It moves from match to match by itself and shows today’s matches in between.</p>
        </div>
        {canSetUp ? <Button onClick={() => { setMade(null); setOpen(true); }}><Plus className="size-4" /> New stream link</Button> : null}
      </div>
      <ErrorNotice error={links.error} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{links.data?.map((l) => <LinkCard key={l.id} l={l} tz={tz} canSetUp={canSetUp} />)}</div>
      <Dialog open={open} onOpenChange={setOpen} title={made ? 'Your stream link' : 'New stream link'} description={made ? undefined : 'One OBS link for the day’s matches at a ground. The graphics follow the scorer of whichever match is on.'}>
        {made ? (
          <div className="grid gap-3 text-sm">
            <p>Add this to OBS once as a Browser Source (1920×1080), in place of each match’s own OBS link. It stays the same every day.</p>
            <div className="flex gap-2"><Input readOnly value={made.url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Stream link" /><Button onClick={() => void copy(made.url, 'Stream link')}><Copy className="size-4" /> Copy</Button></div>
            <div className="flex justify-end"><Button variant="primary" onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <Form initial={{ name: '', venueId: '', competitionId: '', switchBeforeMinutes: 10 }} saving={create.isPending} error={create.error} onSave={(v) => create.mutate(v, { onSuccess: (r) => setMade({ name: r.name, url: r.url }) })} />
        )}
      </Dialog>
    </section>
  );
}
