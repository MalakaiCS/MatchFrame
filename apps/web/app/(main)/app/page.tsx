'use client';
import Link from 'next/link';
import { Clapperboard, Plus, Radio, Upload } from 'lucide-react';
import { Button, Card, ErrorNotice, PageHeader, Spinner, StatusPill } from '@bs/ui';
import { useGet } from '@/lib/hooks';
import { isFull, streamingOn, useMe } from '@/lib/session';
import { MatchTable, streamTone, type MatchRow } from '@/components/match-table';

interface StreamRow { id: string; matchId: string; matchLabel: string; state: string; error: { message?: string } | null }
const UNHEALTHY = ['DEGRADED', 'WAITING_FOR_INPUT', 'FAILED'];

export default function Dashboard() {
  const me = useMe();
  const tz = me.data?.activeOrganisation?.timezone ?? 'Australia/Brisbane';
  const now = new Date();
  const live = useGet<{ items: MatchRow[] }>(['matches', 'live'], 'matches?status=live&pageSize=20', { refetchInterval: 10_000 });
  const upcoming = useGet<{ items: MatchRow[] }>(['matches', 'upcoming'], `matches?status=scheduled&from=${encodeURIComponent(new Date(now.getTime() - 3600_000).toISOString())}&pageSize=8`);
  const streaming = streamingOn(me.data);
  const overview = useGet<{ sessions: StreamRow[] }>(['streams-overview'], 'streams', { refetchInterval: 10_000, enabled: !!me.data && streaming });
  const unhealthy = overview.data?.sessions.filter((s) => UNHEALTHY.includes(s.state));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const usage = useGet<{ totals: { module: string; unit: string; total: number }[] }>(['usage-month'], `usage/ledger?from=${encodeURIComponent(monthStart)}`);
  const full = isFull(me.data?.role);

  return (
    <>
      <PageHeader title={`Welcome, ${me.data?.user.name.split(' ')[0] ?? ''}`} subtitle={me.data?.activeOrganisation?.name}
        actions={full ? <>
          <Button asChild><Link href="/app/matches?import=1"><Upload className="size-4" /> Import fixtures</Link></Button>
          <Button asChild variant="primary"><Link href="/app/matches?new=1"><Plus className="size-4" /> New fixture</Link></Button>
        </> : null} />
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <h2 className="mb-2 flex items-center gap-2 font-medium"><Radio className="size-4 text-live" /> Live now</h2>
          <ErrorNotice error={live.error} onRetry={() => live.refetch()} />
          {live.isLoading ? <Spinner /> : live.data?.items.length ? <MatchTable rows={live.data.items} tz={tz} view="cards" /> : <Card className="p-4 text-sm text-muted">No live matches.</Card>}
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
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
