'use client';
import Link from 'next/link';
import { useState } from 'react';
import { BUILTIN_TEMPLATES } from '@bs/graphics';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, PageHeader, Spinner, StatusPill, Table } from '@bs/ui';
import { del, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import type { MatchRow } from '@/components/match-table';

interface Layout { id: string; name: string; config: { sections: { title: string; templateKeys: string[] }[]; favourites: string[] } }

export default function ControlRooms() {
  const me = useMe();
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const live = useGet<{ items: MatchRow[] }>(['matches', 'live'], 'matches?status=live&pageSize=50', { refetchInterval: 10_000 });
  const upcoming = useGet<{ items: MatchRow[] }>(['matches', 'upcoming-cr'], `matches?status=scheduled&from=${encodeURIComponent(new Date(Date.now() - 6 * 3600_000).toISOString())}&pageSize=20`);
  const layouts = useGet<Layout[]>(['layouts'], 'control-room-layouts');
  const [name, setName] = useState('');
  const [favs, setFavs] = useState<string[]>([]);
  const save = useAction(() => post('control-room-layouts', { name, config: { sections: [{ title: 'Favourites', templateKeys: favs }], favourites: favs, shortcuts: {} } }), [['layouts']]);
  const remove = useAction((id: string) => del(`control-room-layouts/${id}`), [['layouts']]);
  const rows = [...(live.data?.items ?? []), ...(upcoming.data?.items ?? [])].filter((m) => m.overlays.length);

  return (
    <>
      <PageHeader title="Control rooms" subtitle="Open the production desk for any overlay. Each overlay has independent graphics state." />
      <ErrorNotice error={live.error ?? upcoming.error} />
      {live.isLoading ? <Spinner /> : !rows.length ? <EmptyState title="No overlays on live or upcoming matches" body="Add an overlay from a match's Overlays tab." action={<Button asChild><Link href="/app/matches">Go to matches</Link></Button>} /> : (
        <Table><thead><tr><th>Match</th><th>Kick-off</th><th>Status</th><th>Overlays</th></tr></thead><tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>{m.home?.name} v {m.away?.name}<span className="block text-xs text-muted">{m.competition.name}</span></td>
              <td className="whitespace-nowrap text-sm">{fmtDate(m.scheduledAt, tz)}</td>
              <td><StatusPill tone={m.status === 'live' ? 'live' : 'neutral'}>{m.status}</StatusPill></td>
              <td><div className="flex flex-wrap gap-2">{m.overlays.map((o) => <Button key={o.id} asChild size="sm" variant="primary"><Link href={`/app/matches/${m.id}/control/${o.id}`}>{o.name} · {o.inhibited ? 'cleared' : o.mode}</Link></Button>)}</div></td>
            </tr>
          ))}
        </tbody></Table>
      )}
      <h2 className="mb-2 mt-8 font-medium">Section layouts</h2>
      <p className="mb-3 text-sm text-muted">Reusable catalogue sections and favourites, assignable through a theme profile.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {layouts.data?.map((l) => <Card key={l.id} className="p-3"><div className="flex justify-between"><span className="font-medium">{l.name}</span>{isFull(me.data?.role) ? <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.id)}>Delete {l.name}</Button> : null}</div><p className="text-xs text-muted">{l.config.favourites.length} favourites</p></Card>)}
        {isFull(me.data?.role) ? (
          <Card className="p-3">
            <Field label="New layout name" htmlFor="ln"><Input id="ln" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="my-2 flex flex-wrap gap-1">{BUILTIN_TEMPLATES.map((t) => <button key={t.key} onClick={() => setFavs(favs.includes(t.key) ? favs.filter((x) => x !== t.key) : [...favs, t.key])} aria-pressed={favs.includes(t.key)} className={`rounded border px-2 py-1 text-xs ${favs.includes(t.key) ? 'border-primary text-primary' : 'border-border text-muted'}`}>{t.name}</button>)}</div>
            <Button size="sm" variant="primary" disabled={!name} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { setName(''); setFavs([]); } })}>Save layout</Button>
            <ErrorNotice error={save.error} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
