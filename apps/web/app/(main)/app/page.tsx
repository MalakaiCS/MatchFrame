'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Clapperboard, Copy, Plus, Radio, Smartphone, Upload, X } from 'lucide-react';
import { Button, Card, CheckRow, ErrorNotice, PageHeader, Spinner, StatusPill } from '@bs/ui';
import { get } from '@/lib/api';
import { fmtDate, useCopy, useGet } from '@/lib/hooks';
import { isFull, streamingOn, useMe } from '@/lib/session';
import { MatchTable, streamTone, type MatchRow } from '@/components/match-table';
import { DemoButton } from '@/components/demo-button';

interface StreamRow { id: string; matchId: string; matchLabel: string; state: string; error: { message?: string } | null }
const UNHEALTHY = ['DEGRADED', 'WAITING_FOR_INPUT', 'FAILED'];
/** A match still "live" with no scoring activity for this long was probably never closed. */
const STALE_MS = 3 * 3600_000;
const DISMISS_KEY = 'bs.setup.dismissed';

const relative = (iso: string, now: Date) => {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3600_000);
  const m = Math.round((abs % 3600_000) / 60_000);
  const span = h ? `${h} h${m ? ` ${m} min` : ''}` : `${Math.max(1, m)} min`;
  if (abs > 36 * 3600_000) return null;
  return diff > 0 ? `Kick-off in ${span}` : `Kick-off was ${span} ago`;
};

export default function Dashboard() {
  const me = useMe();
  const tz = me.data?.activeOrganisation?.timezone ?? 'Australia/Brisbane';
  const now = new Date();
  const live = useGet<{ items: MatchRow[] }>(['matches', 'live'], 'matches?status=live&pageSize=20', { refetchInterval: 10_000 });
  const upcoming = useGet<{ items: MatchRow[]; total: number }>(['matches', 'upcoming'], `matches?status=scheduled&from=${encodeURIComponent(new Date(now.getTime() - 3600_000).toISOString())}&pageSize=8`);
  const streaming = streamingOn(me.data);
  const overview = useGet<{ sessions: StreamRow[] }>(['streams-overview'], 'streams', { refetchInterval: 10_000, enabled: !!me.data && streaming });
  const unhealthy = overview.data?.sessions.filter((s) => UNHEALTHY.includes(s.state));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const usage = useGet<{ totals: { module: string; unit: string; total: number }[] }>(['usage-month'], `usage/ledger?from=${encodeURIComponent(monthStart)}`);
  const full = isFull(me.data?.role);

  const stale = (m: MatchRow) => !!m.stateUpdatedAt && now.getTime() - new Date(m.stateUpdatedAt).getTime() > STALE_MS;
  const liveNow = (live.data?.items ?? []).filter((m) => !stale(m));
  const needsClosing = (live.data?.items ?? []).filter(stale);
  const next = liveNow[0] ?? upcoming.data?.items[0] ?? null;

  return (
    <>
      <PageHeader title={`Welcome, ${me.data?.user.name.split(' ')[0] ?? ''}`} subtitle={me.data?.activeOrganisation?.name}
        actions={full ? <>
          <Button asChild><Link href="/app/matches?import=1"><Upload className="size-4" /> Import fixtures</Link></Button>
          <Button asChild variant="primary"><Link href="/app/matches?new=1"><Plus className="size-4" /> New fixture</Link></Button>
        </> : null} />
      {full ? <FirstRun hasMatches={!!(liveNow.length || upcoming.data?.total)} /> : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="xl:col-span-2">
          {next ? <NextMatch m={next} tz={tz} now={now} /> : null}
          <h2 className="mb-2 flex items-center gap-2 font-medium"><Radio className="size-4 text-live" /> Live now</h2>
          <ErrorNotice error={live.error} onRetry={() => live.refetch()} />
          {live.isLoading ? <Spinner /> : liveNow.length ? <MatchTable rows={liveNow} tz={tz} view="cards" /> : <Card className="p-4 text-sm text-muted">No live matches.</Card>}
          {needsClosing.length ? (
            <Card className="mt-3 p-3">
              <h3 className="text-sm font-medium">Needs closing ({needsClosing.length})</h3>
              <p className="mb-2 text-xs text-muted">Still marked live, but nothing has been recorded for hours. Open the scorer and move the match to Full Time.</p>
              <ul className="grid gap-1 text-sm">{needsClosing.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-2"><span>{m.home?.name} v {m.away?.name}</span><span className="text-xs text-muted">{fmtDate(m.scheduledAt, tz)}</span><Button asChild size="sm" variant="ghost"><Link href={`/score/${m.id}`}>Open scorer</Link></Button></li>)}</ul>
            </Card>
          ) : null}
          <h2 className="mb-2 mt-6 font-medium">Upcoming fixtures</h2>
          {upcoming.isLoading ? <Spinner /> : <MatchTable rows={upcoming.data?.items ?? []} tz={tz} />}
        </section>
        <aside className="grid content-start gap-4">
          {streaming ? <Card className="p-4">
            <h2 className="mb-2 font-medium">Stream health</h2>
            {overview.error ? <p className="text-sm text-muted">Unavailable</p> : overview.isLoading ? <Spinner /> : unhealthy?.length ? (
              <ul className="grid gap-2">{unhealthy.map((s) => <li key={s.id} className="text-sm"><Link href={`/app/matches/${s.matchId}?tab=streams`} className="hover:text-primary">{s.matchLabel}</Link> <StatusPill tone={streamTone(s.state)}>{s.state.toLowerCase()}</StatusPill>{s.error?.message ? <span className="block text-xs text-muted">{s.error.message}</span> : null}</li>)}</ul>
            ) : <p className="text-sm text-healthy">All streams healthy or idle.</p>}
          </Card> : null}
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Usage this month</h2>
            {usage.data?.totals.length ? <ul className="text-sm">{usage.data.totals.map((u) => <li key={u.module + u.unit} className="flex justify-between"><span className="text-muted">{u.module}</span><span className="tabular">{u.total.toFixed(1)} {u.unit}</span></li>)}</ul> : <p className="text-sm text-muted">No measured usage yet.</p>}
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Quick actions</h2>
            <div className="grid gap-2">
              <Button asChild size="sm"><Link href="/app/control-rooms"><Clapperboard className="size-4" /> Control rooms</Link></Button>
              {streaming ? <Button asChild size="sm"><Link href="/app/streams">Streams</Link></Button> : null}
              <Button asChild size="sm"><Link href="/app/media">Media library</Link></Button>
              {full ? <DemoButton /> : null}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}

/** The one match that matters right now, with the three things people need from it. */
function NextMatch({ m, tz, now }: { m: MatchRow; tz: string; now: Date }) {
  const copy = useCopy();
  const ov = m.overlays[0];
  const copyObs = async () => {
    if (!ov) return;
    const u = await get<{ production: string | null }>(`overlays/${ov.id}/urls`).catch(() => null);
    if (u?.production) await copy(u.production, 'OBS link');
  };
  const rel = m.status === 'live' ? null : relative(m.scheduledAt, now);
  return (
    <Card className="mb-5 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">{m.status === 'live' ? 'Live now' : 'Next match'} · {m.competition.shortName ?? m.competition.name}{m.round ? ` · ${m.round}` : ''}</div>
          <Link href={`/app/matches/${m.id}`} className="mt-1 block text-xl font-semibold hover:text-primary">{m.home?.name} v {m.away?.name}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {m.status === 'live' ? <StatusPill tone="live">LIVE · {m.phase.replace(/_/g, ' ')} · {m.score.home}–{m.score.away}</StatusPill> : <StatusPill tone="primary">{rel ?? fmtDate(m.scheduledAt, tz)}</StatusPill>}
            <span>{fmtDate(m.scheduledAt, tz)}{m.venue ? ` · ${m.venue.name}` : ''}</span>
            {m.scorer?.name ? <span>· Scoring: {m.scorer.name}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="primary"><Link href={`/score/${m.id}`}><Smartphone className="size-4" /> Open scorer</Link></Button>
          <Button asChild><Link href={ov ? `/app/matches/${m.id}/control/${ov.id}` : `/app/matches/${m.id}?tab=overlays`}><Clapperboard className="size-4" /> Control room</Link></Button>
          {ov ? <Button onClick={() => void copyObs()}><Copy className="size-4" /> Copy OBS link</Button> : <Button asChild><Link href={`/app/matches/${m.id}?tab=overlays`}><Copy className="size-4" /> OBS link</Link></Button>}
        </div>
      </div>
    </Card>
  );
}

/** Set-up steps for a new organisation; disappears once everything is in place or when dismissed. */
function FirstRun({ hasMatches }: { hasMatches: boolean }) {
  const comps = useGet<{ id: string }[]>(['competitions'], 'competitions');
  const profiles = useGet<{ id: string; currentVersion: number }[]>(['theme-profiles'], 'theme-profiles');
  const plans = useGet<{ id: string; currentVersion: number }[]>(['game-plans'], 'game-plans');
  const members = useGet<{ id: string; status: string }[]>(['members'], 'members');
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1'); } catch { setDismissed(false); }
  }, []);
  if (dismissed || comps.isLoading || profiles.isLoading || plans.isLoading || members.isLoading) return null;
  const steps = [
    { done: !!comps.data?.length, label: 'Add a competition and its teams', href: '/app/competitions', detail: 'Teams, players and venues live under Assets.' },
    { done: hasMatches, label: 'Add your fixtures', href: '/app/matches?new=1', detail: 'One at a time, or import a CSV.' },
    { done: !!profiles.data?.some((p) => p.currentVersion > 0), label: 'Choose a graphics look', href: '/app/themes', detail: 'Pick a style, set your colours, add a logo, publish it.' },
    { done: !!plans.data?.some((p) => p.currentVersion > 0), label: 'Create an automation plan', href: '/app/automation', detail: 'Start from the starter plan; it follows a normal match.' },
    { done: (members.data?.filter((m) => m.status === 'active').length ?? 0) > 1, label: 'Invite your scorer', href: '/app/settings', detail: 'They score from a phone; the graphics follow.' },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ } setDismissed(true); };
  return (
    <Card className="mb-5 p-4">
      <div className="flex items-center gap-3">
        <h2 className="font-medium">Get set up</h2>
        <StatusPill tone="primary">{steps.length - left} of {steps.length} done</StatusPill>
        <button className="ml-auto text-muted hover:text-text" aria-label="Hide the set-up steps" onClick={dismiss}><X className="size-4" /></button>
      </div>
      <ul className="mt-1 divide-y divide-border">
        {steps.map((s) => <CheckRow key={s.label} done={s.done} label={s.label} detail={s.done ? undefined : s.detail} action={s.done ? null : <Button asChild size="sm"><Link href={s.href}>Go</Link></Button>} />)}
      </ul>
    </Card>
  );
}
