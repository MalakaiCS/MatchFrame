'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BadgeCheck, CalendarDays, Clapperboard, Copy, Film, Plus, Radio, Smartphone, Upload, X } from 'lucide-react';
import { PRICE_PLANS } from '@bs/domain';
import { Button, Card, CheckRow, ErrorNotice, PageHeader, Spinner, StatusPill } from '@bs/ui';
import { get } from '@/lib/api';
import { fmtDate, useCopy, useGet } from '@/lib/hooks';
import { isFull, streamingOn, useMe } from '@/lib/session';
import { MatchTable, streamTone, type MatchRow } from '@/components/match-table';
import { DemoButton } from '@/components/demo-button';
import { forgetPlan, intendedPlan, type IntendedPlan } from '@/lib/sign-in';

interface StreamRow { id: string; matchId: string; matchLabel: string; state: string; error: { message?: string } | null }
const UNHEALTHY = ['DEGRADED', 'WAITING_FOR_INPUT', 'FAILED'];
/** A match still "live" with no scoring activity for this long was probably never closed. */
const STALE_MS = 3 * 3600_000;
const DISMISS_KEY = 'bs.setup.dismissed';

const USAGE_NAMES: Record<string, string> = { media_jobs: 'Media processing', storage: 'Storage', programme: 'Cloud production', recording: 'Recording', egress: 'Streaming out' };
const usageName = (m: string) => USAGE_NAMES[m] ?? m.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
/** Usage in words people read: minutes rather than job seconds, MB or GB rather than bytes. */
function usageAmount(total: number, unit: string) {
  if (unit === 'bytes') return total >= 1e9 ? `${(total / 1e9).toFixed(1)} GB` : `${Math.max(0.1, total / 1e6).toFixed(1)} MB`;
  if (/seconds$/.test(unit)) return `${(total / 60).toFixed(total < 600 ? 1 : 0)} min`;
  return `${total.toFixed(1)} ${unit.replace(/_/g, ' ')}`;
}

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
  const [allStale, setAllStale] = useState(false);

  const stale = (m: MatchRow) => !!m.stateUpdatedAt && now.getTime() - new Date(m.stateUpdatedAt).getTime() > STALE_MS;
  const liveNow = (live.data?.items ?? []).filter((m) => !stale(m));
  const needsClosing = (live.data?.items ?? []).filter(stale);
  const next = liveNow[0] ?? upcoming.data?.items[0] ?? null;

  return (
    <>
      <PageHeader title={me.data?.user.name ? `Welcome back, ${me.data.user.name.split(' ')[0]}` : 'Welcome back'} subtitle={<>{me.data?.activeOrganisation?.name} · {new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</>}
        actions={full ? <>
          <Button asChild><Link href="/app/matches?import=1"><Upload className="size-4" /> Import fixtures</Link></Button>
          <Button asChild variant="primary"><Link href="/app/matches?new=1"><Plus className="size-4" /> New match</Link></Button>
        </> : null} />
      {me.data?.role === 'owner' ? <PlanReminder /> : null}
      {full ? <FirstRun hasMatches={!!(liveNow.length || upcoming.data?.total)} /> : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="min-w-0 xl:col-span-2">
          {next ? <NextMatch m={next} tz={tz} now={now} /> : null}
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Radio className="size-4 text-live" aria-hidden /> Live now</h2>
          <ErrorNotice error={live.error} onRetry={() => live.refetch()} />
          {live.isLoading ? <Spinner /> : liveNow.length ? <MatchTable rows={liveNow} tz={tz} view="cards" /> : <Card className="p-5 text-sm text-muted">No live matches right now. When the scorer starts a match it appears here.</Card>}
          {needsClosing.length ? (
            <Card className="mt-3 p-3">
              <h3 className="text-sm font-medium">Needs closing ({needsClosing.length})</h3>
              <p className="mb-2 text-xs text-muted">Still marked live, but nothing has been recorded for hours. Open the scorer and move the match to Full Time.</p>
              <ul className="grid gap-1 text-sm">{(allStale ? needsClosing : needsClosing.slice(0, 3)).map((m) => <li key={m.id} className="flex flex-wrap items-center gap-2"><span>{m.home?.name} v {m.away?.name}</span><span className="text-xs text-muted">{fmtDate(m.scheduledAt, tz)}</span><Button asChild size="sm" variant="ghost"><Link href={`/score/${m.id}`}>Open scorer</Link></Button></li>)}</ul>
              {needsClosing.length > 3 ? <button type="button" className="mt-2 text-sm font-medium text-primary hover:underline" onClick={() => setAllStale(!allStale)}>{allStale ? 'Show fewer' : `Show all ${needsClosing.length}`}</button> : null}
            </Card>
          ) : null}
          <h2 className="mb-3 mt-8 flex items-center gap-2 font-semibold"><CalendarDays className="size-4 text-primary" aria-hidden /> Upcoming</h2>
          {upcoming.isLoading ? <Spinner /> : <MatchTable rows={upcoming.data?.items ?? []} tz={tz} />}
        </section>
        <aside className="grid content-start gap-4">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Quick actions</h2>
            <div className="grid gap-2">
              <Button asChild className="justify-start"><Link href="/app/control-rooms"><Clapperboard className="size-4" aria-hidden /> Control rooms</Link></Button>
              <Button asChild className="justify-start"><Link href="/score"><Smartphone className="size-4" aria-hidden /> Scorer app</Link></Button>
              {streaming ? <Button asChild className="justify-start"><Link href="/app/streams"><Radio className="size-4" aria-hidden /> Streams</Link></Button> : null}
              <Button asChild className="justify-start"><Link href="/app/media"><Film className="size-4" aria-hidden /> Media library</Link></Button>
              {full ? <DemoButton /> : null}
            </div>
          </Card>
          {streaming ? <Card className="p-5">
            <h2 className="mb-2 font-semibold">Stream health</h2>
            {overview.error ? <p className="text-sm text-muted">Unavailable</p> : overview.isLoading ? <Spinner /> : unhealthy?.length ? (
              <ul className="grid gap-2">{unhealthy.map((s) => <li key={s.id} className="text-sm"><Link href={`/app/matches/${s.matchId}?tab=streams`} className="hover:text-primary">{s.matchLabel}</Link> <StatusPill tone={streamTone(s.state)}>{s.state.toLowerCase()}</StatusPill>{s.error?.message ? <span className="block text-xs text-muted">{s.error.message}</span> : null}</li>)}</ul>
            ) : <p className="text-sm text-healthy">All streams healthy or idle.</p>}
          </Card> : null}
          <Card className="p-5">
            <h2 className="mb-2 font-semibold">Usage this month</h2>
            {usage.data?.totals.length ? <ul className="text-sm">{usage.data.totals.map((u) => <li key={u.module + u.unit} className="flex justify-between py-0.5"><span className="text-muted">{usageName(u.module)}</span><span className="tabular">{usageAmount(u.total, u.unit)}</span></li>)}</ul> : <p className="text-sm text-muted">No measured usage yet.</p>}
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
    <Card className="relative mb-8 overflow-hidden p-5 sm:p-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_100%_at_100%_0%,color-mix(in_oklab,var(--color-primary)_12%,transparent),transparent_70%)]" />
      <div className="relative flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{m.status === 'live' ? 'Live now' : 'Next match'} <span className="font-medium normal-case tracking-normal text-muted">· {m.competition.shortName ?? m.competition.name}{m.round ? ` · ${m.round}` : ''}</span></div>
          <Link href={`/app/matches/${m.id}`} className="mt-1.5 block font-brand text-2xl font-bold hover:text-primary">{m.home?.name} v {m.away?.name}</Link>
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

/** The plan picked on the pricing page before signing up, offered once the organisation exists (owners only). */
function PlanReminder() {
  const [plan, setPlan] = useState<IntendedPlan | null>(null);
  useEffect(() => setPlan(intendedPlan()), []);
  if (!plan) return null;
  const name = PRICE_PLANS.find((p) => p.key === plan.plan)?.name ?? plan.plan;
  return (
    <Card className="mb-6 flex flex-wrap items-center gap-3 border-primary/40 p-4">
      <BadgeCheck className="size-5 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">You chose <strong>{name}</strong>, billed {plan.billing}, on the pricing page. Confirm it to finish subscribing.</p>
      <Button asChild size="sm" variant="primary"><Link href={`/app/settings?tab=plan&plan=${plan.plan}&interval=${plan.billing}`}>Review the plan</Link></Button>
      <button type="button" className="text-muted hover:text-text" aria-label="Dismiss" onClick={() => { forgetPlan(); setPlan(null); }}><X className="size-4" /></button>
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
    <Card className="mb-6 p-5">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Get set up</h2>
        <StatusPill tone="primary">{steps.length - left} of {steps.length} done</StatusPill>
        <button className="ml-auto text-muted hover:text-text" aria-label="Hide the set-up steps" onClick={dismiss}><X className="size-4" /></button>
      </div>
      <ul className="mt-1 divide-y divide-border">
        {steps.map((s) => <CheckRow key={s.label} done={s.done} label={s.label} detail={s.done ? undefined : s.detail} action={s.done ? null : <Button asChild size="sm"><Link href={s.href}>Go</Link></Button>} />)}
      </ul>
    </Card>
  );
}
