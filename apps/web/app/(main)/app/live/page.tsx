'use client';
// Live: every live match and today's fixtures on one screen (what were the Control rooms list and the Producer
// board). One card per match with its desk for each graphics output, the scorer and the commentator view, and only
// the state worth acting on: no scorer on a live match, OBS not showing the output, cues waiting for approval.
// Matches still marked live but quiet for hours sit apart under "Needs closing"; desk layouts are at the bottom.
// Stream links (one OBS link for back-to-back matches) are at the top.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Mic, Smartphone } from 'lucide-react';
import { BUILTIN_TEMPLATES } from '@bs/graphics';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, PageHeader, Spinner, StatusPill, cx, type Tone } from '@bs/ui';
import { del, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { layerLabel } from '@/lib/labels';
import { isStale } from '@/lib/live';
import { isFull, useMe } from '@/lib/session';
import { phaseTone, type MatchRow } from '@/components/match-table';
import { useAwaiting } from '@/components/control/approvals';
import { StreamLinks } from '@/components/live/stream-links';

type Output = MatchRow['overlays'][number] & { onAir?: string[] };
interface Layout { id: string; name: string; config: { sections: { title: string; templateKeys: string[] }[]; favourites: string[] } }

function obsState(o: Output): { tone: Tone; text: string } | null {
  if (o.inhibited) return { tone: 'live', text: 'Output cleared' };
  if (!o.displayedRevision) return { tone: 'warning', text: 'OBS not connected' };
  return (o.displayedRevision ?? 0) >= (o.revision ?? 0) ? null : { tone: 'warning', text: 'OBS catching up' };
}

/** One graphics output: its desk, and only the state worth acting on. */
function OutputLine({ matchId, o, single }: { matchId: string; o: Output; single: boolean }) {
  const awaiting = useAwaiting(o.id);
  const st = obsState(o);
  const n = awaiting.data?.length ?? 0;
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <Button asChild size="sm" variant={n ? 'live' : 'primary'}><Link href={`/app/matches/${matchId}/control/${o.id}`}><Clapperboard className="size-4" /> {single ? 'Desk' : `Desk: ${o.name}`}</Link></Button>
      {st ? <StatusPill tone={st.tone}>{st.text}</StatusPill> : null}
      {o.mode === 'manual' ? <StatusPill tone="warning">manual</StatusPill> : null}
      {n ? <StatusPill tone="warning">{n} waiting for approval</StatusPill> : null}
      {o.onAir?.length ? <span className="text-xs text-muted">On air: {o.onAir.map(layerLabel).join(', ')}</span> : null}
    </li>
  );
}

function MatchCard({ m, tz }: { m: MatchRow; tz: string }) {
  const outputs = m.overlays as Output[];
  const live = m.status === 'live';
  return (
    <Card className={cx('p-4', live && 'border-live/60')}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: m.home?.primaryColor }} aria-hidden />
            <Link href={`/app/matches/${m.id}`} className="truncate hover:underline">{m.home?.name} v {m.away?.name}</Link>
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: m.away?.primaryColor }} aria-hidden />
          </div>
          <div className="text-xs text-muted">{m.competition.name}{m.round ? ` · ${m.round}` : ''}{live ? ` · ${fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}` : ''}{m.venue ? ` · ${m.venue.name}` : ''}</div>
        </div>
        {live ? <span className="text-2xl font-semibold tabular">{m.score.home}–{m.score.away}</span> : null}
        <StatusPill tone={phaseTone(m.status)}>{live ? m.phase.replace(/_/g, ' ') : fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}</StatusPill>
        {m.isDemo ? <StatusPill tone="warning">Demo</StatusPill> : null}
      </div>
      <ul className="mt-3 grid gap-2">
        {outputs.map((o) => <OutputLine key={o.id} matchId={m.id} o={o} single={outputs.length === 1} />)}
        {!outputs.length ? <li className="text-sm text-muted">No OBS link yet. <Link href={`/app/matches/${m.id}?tab=graphics`} className="font-medium text-primary hover:underline">Create it</Link></li> : null}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
        {m.scorer?.name ? <span className="text-muted"><Smartphone className="mr-1 inline size-3.5" aria-hidden />Scoring: {m.scorer.name}</span> : live ? <StatusPill tone="warning"><Smartphone className="size-3" /> No scorer connected</StatusPill> : <span className="text-muted">No scorer yet</span>}
        <Button asChild size="sm" variant="ghost" className="ml-auto"><Link href={`/score/${m.id}`}><Smartphone className="size-4" /> Scorer</Link></Button>
        <Button asChild size="sm" variant="ghost"><Link href={`/app/matches/${m.id}/commentary`}><Mic className="size-4" /> Commentator</Link></Button>
      </div>
    </Card>
  );
}

/** Reusable catalogue sections and favourites for the desk, assignable through a look. */
function DeskLayouts() {
  const me = useMe();
  const layouts = useGet<Layout[]>(['layouts'], 'control-room-layouts');
  const [name, setName] = useState('');
  const [favs, setFavs] = useState<string[]>([]);
  const save = useAction(() => post('control-room-layouts', { name, config: { sections: [{ title: 'Favourites', templateKeys: favs }], favourites: favs, shortcuts: {} } }), [['layouts']]);
  const remove = useAction((id: string) => del(`control-room-layouts/${id}`), [['layouts']]);
  const full = isFull(me.data?.role);
  return (
    <details className="mt-8 rounded-[var(--radius-card)] border border-border p-4">
      <summary className="cursor-pointer font-medium">Desk layouts {layouts.data?.length ? `(${layouts.data.length})` : ''}</summary>
      <p className="mb-3 mt-1 text-sm text-muted">Favourite graphics shown first on the desk. Give a layout to a look to use it for that look’s matches.</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {layouts.data?.map((l) => <Card key={l.id} className="p-3"><div className="flex justify-between"><span className="font-medium">{l.name}</span>{full ? <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.id)}>Delete {l.name}</Button> : null}</div><p className="text-xs text-muted">{l.config.favourites.length} favourites</p></Card>)}
        {full ? (
          <Card className="p-3">
            <Field label="New layout name" htmlFor="ln"><Input id="ln" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="my-2 flex flex-wrap gap-1">{BUILTIN_TEMPLATES.map((t) => <button key={t.key} type="button" onClick={() => setFavs(favs.includes(t.key) ? favs.filter((x) => x !== t.key) : [...favs, t.key])} aria-pressed={favs.includes(t.key)} className={cx('rounded border px-2 py-1 text-xs', favs.includes(t.key) ? 'border-primary text-primary' : 'border-border text-muted')}>{t.name}</button>)}</div>
            <Button size="sm" variant="primary" disabled={!name} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { setName(''); setFavs([]); } })}>Save layout</Button>
            <ErrorNotice error={save.error ?? remove.error} />
          </Card>
        ) : null}
      </div>
    </details>
  );
}

export default function LivePage() {
  const me = useMe();
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const now = Date.now();
  // newest first, so the matches really under way are on the page whatever is left over from before
  const live = useGet<{ items: MatchRow[]; total: number }>(['matches', 'board-live'], 'matches?status=live&sort=-scheduledAt&pageSize=100', { refetchInterval: 5000 });
  const today = useGet<{ items: MatchRow[] }>(['matches', 'board-today'], `matches?status=scheduled&from=${encodeURIComponent(new Date(now - 6 * 3600_000).toISOString())}&to=${encodeURIComponent(new Date(now + 18 * 3600_000).toISOString())}&sort=scheduledAt&pageSize=50`, { refetchInterval: 15_000 });
  const liveRows = (live.data?.items ?? []).filter((m) => !isStale(m, now));
  const stale = (live.data?.items ?? []).filter((m) => isStale(m, now));
  const staleTotal = (live.data?.total ?? 0) - liveRows.length;
  const later = (today.data?.items ?? []).filter((m) => m.status !== 'live');
  const outputs = [...liveRows, ...later].flatMap((m) => m.overlays as Output[]);
  const disconnected = outputs.filter((o) => !o.displayedRevision).length;
  const noScorer = liveRows.filter((m) => !m.scorer?.name).length;
  // Home's "Close them" link lands on the list, opened
  const closing = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (stale.length && closing.current && window.location.hash === '#needs-closing') {
      closing.current.open = true;
      closing.current.scrollIntoView({ block: 'start' });
    }
  }, [stale.length]);

  return (
    <>
      <PageHeader title="Live" subtitle="Every live match and today’s fixtures, each with its desk, scorer and commentator view. Refreshes itself." />
      <div className="mb-5 flex flex-wrap gap-2 text-sm">
        <StatusPill tone={liveRows.length ? 'live' : 'neutral'}>{liveRows.length} live</StatusPill>
        {later.length ? <StatusPill tone="primary">{later.length} later today</StatusPill> : null}
        {noScorer ? <StatusPill tone="warning">{noScorer} live without a scorer</StatusPill> : null}
        {disconnected ? <StatusPill tone="warning">{disconnected} output{disconnected > 1 ? 's' : ''} not in OBS yet</StatusPill> : outputs.length ? <StatusPill tone="healthy">Every output is in OBS</StatusPill> : null}
      </div>
      <StreamLinks tz={tz} canSetUp={isFull(me.data?.role)} />
      <ErrorNotice error={live.error ?? today.error} />
      {live.isLoading || today.isLoading ? <Spinner /> : !liveRows.length && !later.length && !stale.length ? (
        <EmptyState title="Nothing on today" body="Live matches and today’s fixtures appear here, each with its desk." action={<Button asChild><Link href="/app/matches">Go to matches</Link></Button>} />
      ) : (
        <>
          {liveRows.length ? (
            <section aria-labelledby="live-now" className="mb-8">
              <h2 id="live-now" className="mb-3 font-semibold">Live now</h2>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{liveRows.map((m) => <MatchCard key={m.id} m={m} tz={tz} />)}</div>
            </section>
          ) : null}
          {later.length ? (
            <section aria-labelledby="later-today" className="mb-8">
              <h2 id="later-today" className="mb-3 font-semibold">Later today</h2>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{later.map((m) => <MatchCard key={m.id} m={m} tz={tz} />)}</div>
            </section>
          ) : null}
          {stale.length ? (
            <details ref={closing} id="needs-closing" className="rounded-[var(--radius-card)] border border-warning/50 p-4">
              <summary className="cursor-pointer font-medium">Needs closing ({staleTotal})</summary>
              <p className="mt-1 text-sm text-muted">Still marked live, but nothing has been recorded for hours. Open the scorer and move each match to Full Time.</p>
              <ul className="mt-3 divide-y divide-border">
                {stale.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link href={`/app/matches/${m.id}`} className="font-medium hover:underline">{m.home?.name} v {m.away?.name}</Link>
                    <span className="text-xs text-muted">{m.competition.name} · {fmtDate(m.scheduledAt, tz)} · {m.score.home}–{m.score.away}</span>
                    <Button asChild size="sm" variant="ghost" className="ml-auto"><Link href={`/score/${m.id}`}>Open scorer</Link></Button>
                  </li>
                ))}
              </ul>
              {staleTotal > stale.length ? <p className="mt-2 text-xs text-muted">The {stale.length} most recent are listed; find older ones under Matches → Status: live.</p> : null}
            </details>
          ) : null}
        </>
      )}
      <DeskLayouts />
    </>
  );
}
