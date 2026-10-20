'use client';
// Producer board: every live and upcoming match of the day on one screen, with scorer, OBS, on-air and approval
// state per output, and one-click routes into the control room, the match page and the scorer.
import Link from 'next/link';
import { Clapperboard, Smartphone } from 'lucide-react';
import { Button, Card, EmptyState, ErrorNotice, PageHeader, Spinner, StatusPill, cx, type Tone } from '@bs/ui';
import { fmtDate, useGet } from '@/lib/hooks';
import { layerLabel } from '@/lib/labels';
import { useMe } from '@/lib/session';
import { phaseTone, type MatchRow } from '@/components/match-table';
import { useAwaiting } from '@/components/control/approvals';

type Output = MatchRow['overlays'][number] & { displayedRevision?: number; revision?: number; onAir?: string[] };

function obsState(o: Output): { tone: Tone; text: string } {
  if (o.inhibited) return { tone: 'live', text: 'Output cleared' };
  if (!o.displayedRevision) return { tone: 'offline', text: 'OBS not connected' };
  return (o.displayedRevision ?? 0) >= (o.revision ?? 0) ? { tone: 'healthy', text: 'OBS showing the latest' } : { tone: 'warning', text: 'OBS catching up' };
}

function OutputLine({ matchId, o }: { matchId: string; o: Output }) {
  const awaiting = useAwaiting(o.id);
  const st = obsState(o);
  const n = awaiting.data?.length ?? 0;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md bg-elevated/60 px-2 py-1.5 text-sm">
      <span className="font-medium">{o.name}</span>
      <StatusPill tone={st.tone}>{st.text}</StatusPill>
      <StatusPill tone={o.mode === 'manual' ? 'warning' : 'neutral'}>{o.mode === 'manual' ? 'manual' : 'automatic'}</StatusPill>
      {o.onAir?.length ? <span className="text-xs text-muted">On air: {o.onAir.map(layerLabel).join(', ')}</span> : null}
      {n ? <StatusPill tone="warning">{n} waiting for approval</StatusPill> : null}
      <Button asChild size="sm" variant={n ? 'live' : 'primary'} className="ml-auto"><Link href={`/app/matches/${matchId}/control/${o.id}`}><Clapperboard className="size-4" /> Control room</Link></Button>
    </li>
  );
}

export default function ProducerBoard() {
  const me = useMe();
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const now = Date.now();
  const live = useGet<{ items: MatchRow[] }>(['matches', 'board-live'], 'matches?status=live&pageSize=50', { refetchInterval: 5000 });
  const today = useGet<{ items: MatchRow[] }>(['matches', 'board-today'], `matches?status=scheduled&from=${encodeURIComponent(new Date(now - 6 * 3600_000).toISOString())}&to=${encodeURIComponent(new Date(now + 18 * 3600_000).toISOString())}&pageSize=50`, { refetchInterval: 15_000 });
  const rows = [...(live.data?.items ?? []), ...(today.data?.items ?? []).filter((m) => m.status !== 'live')];
  const outputs = rows.flatMap((m) => m.overlays as Output[]);
  const disconnected = outputs.filter((o) => !o.displayedRevision).length;

  return (
    <>
      <PageHeader title="Producer board" subtitle="Everything on today, on one screen. Refreshes itself." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <StatusPill tone="live">{live.data?.items.length ?? 0} live</StatusPill>
        <StatusPill tone="primary">{rows.length - (live.data?.items.length ?? 0)} more today</StatusPill>
        <StatusPill tone={disconnected ? 'warning' : 'healthy'}>{disconnected ? `${disconnected} output${disconnected > 1 ? 's' : ''} without OBS` : 'All outputs connected'}</StatusPill>
        <StatusPill tone={rows.some((m) => m.status === 'live' && !m.scorer?.name) ? 'warning' : 'neutral'}>{rows.filter((m) => m.status === 'live' && !m.scorer?.name).length} live without a scorer</StatusPill>
      </div>
      <ErrorNotice error={live.error ?? today.error} />
      {live.isLoading || today.isLoading ? <Spinner /> : !rows.length ? (
        <EmptyState title="Nothing on today" body="Live matches and today's fixtures appear here with their outputs." action={<Button asChild><Link href="/app/matches">Go to matches</Link></Button>} />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {rows.map((m) => (
            <Card key={m.id} className={cx('p-3', m.status === 'live' && 'border-live/60')}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="size-2.5 rounded-sm" style={{ background: m.home?.primaryColor }} aria-hidden />
                    <Link href={`/app/matches/${m.id}`} className="truncate hover:underline">{m.home?.name} v {m.away?.name}</Link>
                    <span className="size-2.5 rounded-sm" style={{ background: m.away?.primaryColor }} aria-hidden />
                  </div>
                  <div className="text-xs text-muted">{m.competition.name}{m.round ? ` · ${m.round}` : ''} · {fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}{m.venue ? ` · ${m.venue.name}` : ''}</div>
                </div>
                <span className="text-2xl font-semibold tabular">{m.score.home}–{m.score.away}</span>
                <StatusPill tone={phaseTone(m.status)}>{m.status === 'live' ? m.phase.replace(/_/g, ' ') : m.status}</StatusPill>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <StatusPill tone={m.scorer?.name ? 'healthy' : m.status === 'live' ? 'warning' : 'neutral'}><Smartphone className="size-3" /> {m.scorer?.name ? `Scorer: ${m.scorer.name}` : 'No scorer connected'}</StatusPill>
                {m.isDemo ? <StatusPill tone="warning">Demo</StatusPill> : null}
                <Button asChild size="sm" variant="ghost" className="ml-auto"><Link href={`/score/${m.id}`}>Open scorer</Link></Button>
                <Button asChild size="sm" variant="ghost"><Link href={`/app/matches/${m.id}/commentary`}>Commentator view</Link></Button>
              </div>
              <ul className="mt-2 grid gap-1">
                {(m.overlays as Output[]).map((o) => <OutputLine key={o.id} matchId={m.id} o={o} />)}
                {!m.overlays.length ? <li className="text-xs text-muted">No graphics output yet. <Link href={`/app/matches/${m.id}?tab=overlays`} className="underline">Create the OBS link</Link>.</li> : null}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
