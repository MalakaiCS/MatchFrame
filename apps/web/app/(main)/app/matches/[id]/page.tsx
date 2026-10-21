'use client';
import Link from 'next/link';
import { Suspense, use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorNotice, Field, InfoTip, NativeSelect, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { patch } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, streamingOn, useMe } from '@/lib/session';
import { useRealtime } from '@/lib/realtime';
import { phaseTone } from '@/components/match-table';
import { ObsLinkPanel } from '@/components/match/overlays-panel';
import { MatchDayChecklist } from '@/components/match/match-day';
import { StreamsPanel } from '@/components/match/streams-panel';
import { MatchMediaPanel } from '@/components/match/media-panel';
import { LineupEditor } from '@/components/lineup-editor';
import { RunSheet } from '@/components/match/run-sheet';
import { ActivityFeed } from '@/components/match/activity-feed';
import { SharePanel } from '@/components/match/share-panel';
import { MatchInfoEditor } from '@/components/match/match-info';

export interface LineupPlayer { playerId: string; displayName: string; number: number | null; position?: string | null; starter: boolean; captain?: boolean }
export interface MatchDetail {
  id: string; status: string; sport: string; scheduledAt: string; timezone: string; round: string | null; externalId: string | null; isDemo: boolean;
  competition: { id: string; name: string; themeProfileId?: string | null }; season: { id: string; name: string }; venue: { name: string } | null;
  teams: { home: { id: string; name: string; abbreviation: string; primaryColor: string }; away: { id: string; name: string; abbreviation: string; primaryColor: string } };
  lineup: { home: LineupPlayer[]; away: LineupPlayer[] }; lineupLocked: boolean;
  state: { phase: string; projection: { score: { home: number; away: number }; shootout: { home: number; away: number } | null; stats: Record<string, Record<string, number>> }; stateVersion: number };
  lease: { holderName: string | null; expiresAt: string | null; leaseVersion: number; takenOverFrom: string | null } | null;
  scorers: { membershipId: string; name: string }[];
  rules: { description: string[]; phases: { id: string; label: string }[]; capabilities: { statRows: { key: string; label: string }[] } };
  homeTeamId: string; awayTeamId: string; seasonId: string; scoringSource: string; scorerSourceDelayMs: number;
  publicToken: string | null;
  officials?: { role: string; name: string }[] | null; attendance?: number | null; weather?: { summary?: string | null; tempC?: number | null; condition?: string | null } | null;
}
interface Fact { id: string; sequence: number; category: string; type: string; side: string | null; playerId: string | null; periodId: string; clockMs: number | null; occurredAt: string; acceptedAt: string; source: string; actorName: string | null; voided: boolean; revision: number; historical: boolean; payload: Record<string, unknown>; corrections: { kind: string; reason: string; createdAt: string }[] }

const TABS = ['overview', 'lineup', 'facts', 'runsheet', 'activity', 'overlays', 'streams', 'media'];

function Inner({ id }: { id: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const wanted = useSearchParams().get('tab') ?? 'overview';
  const [tab, setTab] = useState(TABS.includes(wanted) ? wanted : 'overview');
  const m = useGet<MatchDetail>(['match', id], `matches/${id}`);
  const facts = useGet<Fact[]>(['facts', id], `matches/${id}/facts`);
  useRealtime('match', id, (e) => {
    if (e.topic.startsWith('match.')) {
      void qc.invalidateQueries({ queryKey: ['match', id] });
      void qc.invalidateQueries({ queryKey: ['facts', id] });
    }
  }, () => void qc.invalidateQueries({ queryKey: ['match', id] }));
  if (m.isLoading) return <Spinner />;
  if (m.error) return <ErrorNotice error={m.error} onRetry={() => m.refetch()} />;
  const d = m.data!;
  const full = isFull(me.data?.role);
  const streaming = streamingOn(me.data);
  const tz = d.timezone;
  const playerName = (pid: string | null) => [...d.lineup.home, ...d.lineup.away].find((p) => p.playerId === pid)?.displayName ?? null;
  const scoringNow = d.lease?.holderName && d.lease.expiresAt && new Date(d.lease.expiresAt) > new Date() ? d.lease.holderName : null;
  const events = facts.data?.filter((f) => f.category === 'event').length ?? 0;

  return (
    <>
      <PageHeader
        crumbs={<><Link href="/app/matches" className="hover:text-text">Matches</Link> / <Link href={`/app/competitions/${d.competition.id}`} className="hover:text-text">{d.competition.name}</Link></>}
        title={`${d.teams.home.name} v ${d.teams.away.name}`}
        subtitle={<>{fmtDate(d.scheduledAt, tz, { dateStyle: 'full', timeStyle: 'short' })} ({tz}) · {d.season.name}{d.round ? ` · ${d.round}` : ''}{d.venue ? ` · ${d.venue.name}` : ''}</>}
        actions={<><Button asChild variant="ghost"><Link href={`/app/matches/${d.id}/commentary`}>Commentator view</Link></Button><Button asChild><Link href={`/score/${d.id}`}>Open scorer</Link></Button></>}
      />
      <Card className="mb-4 flex flex-wrap items-center gap-6 p-4">
        <div className="text-3xl font-semibold tabular">{d.state.projection.score.home} – {d.state.projection.score.away}{d.state.projection.shootout ? <span className="ml-2 text-base text-muted">({d.state.projection.shootout.home}–{d.state.projection.shootout.away} pens)</span> : null}</div>
        <StatusPill tone={phaseTone(d.status)}>{d.rules.phases.find((p) => p.id === d.state.phase)?.label ?? d.state.phase}</StatusPill>
        {d.isDemo ? <StatusPill tone="warning">Demo match</StatusPill> : null}
        <span className="text-sm text-muted">{scoringNow ? `Scoring now: ${scoringNow}${d.lease?.takenOverFrom ? ' (took over)' : ''}` : 'No scorer connected'}</span>
      </Card>
      {full ? <MatchDayChecklist d={d} canEdit={full} onGoTo={setTab} /> : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabList className="mb-4">
          <Tab value="overview">Overview</Tab><Tab value="lineup">Lineup</Tab><Tab value="facts">Event log ({events})</Tab>
          <Tab value="runsheet">Run sheet</Tab><Tab value="activity">Activity</Tab>
          <Tab value="overlays">OBS link</Tab>
          {streaming ? <><Tab value="streams">Streams</Tab><Tab value="media">Recordings & highlights</Tab></> : null}
        </TabList>
        <TabPanel value="overview" className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Team stats</h2>
            <Table><thead><tr><th>{d.teams.home.abbreviation}</th><th className="text-center">Stat</th><th className="text-right">{d.teams.away.abbreviation}</th></tr></thead><tbody>
              {d.rules.capabilities.statRows.map((r) => <tr key={r.key}><td className="tabular">{d.state.projection.stats.home?.[r.key] ?? 0}</td><td className="text-center text-muted">{r.label}</td><td className="text-right tabular">{d.state.projection.stats.away?.[r.key] ?? 0}</td></tr>)}
            </tbody></Table>
          </Card>
          <div className="grid gap-4">
            <Card className="p-4"><h2 className="mb-2 font-medium">Rules</h2><ul className="list-disc pl-5 text-sm text-muted">{d.rules.description.map((x) => <li key={x}>{x}</li>)}</ul></Card>
            {full ? <ScoringSetup d={d} /> : null}
            <SharePanel matchId={d.id} publicToken={d.publicToken} canEdit={full} />
            <MatchInfoEditor matchId={d.id} match={d} canEdit={full} />
          </div>
        </TabPanel>
        <TabPanel value="lineup"><LineupEditor matchId={d.id} canEdit={full} canSaveDefault={full} /></TabPanel>
        <TabPanel value="facts">
          <ErrorNotice error={facts.error} />
          <Table><thead><tr><th>#</th><th>Time</th><th>Event</th><th>Team</th><th>Player</th><th>Recorded by</th><th>Status</th></tr></thead><tbody>
            {facts.data?.slice().reverse().map((f) => (
              <tr key={f.id} className={f.voided ? 'opacity-60' : ''}>
                <td className="tabular">{f.sequence}</td>
                <td className="tabular whitespace-nowrap">{f.clockMs != null ? `${Math.floor(f.clockMs / 60000)}'` : '—'} <span className="text-xs text-muted">{fmtDate(f.occurredAt, tz, { timeStyle: 'medium' })}</span></td>
                <td>{f.category === 'phase' ? `→ ${d.rules.phases.find((p) => p.id === f.payload.to)?.label ?? String(f.payload.to)}` : f.category === 'adjustment' ? `Score set ${JSON.stringify(f.payload.to)}` : f.type.replace(/_/g, ' ')}{f.historical ? <StatusPill className="ml-1" tone="neutral">late</StatusPill> : null}</td>
                <td>{f.side ? d.teams[f.side as 'home'].abbreviation : ''}</td>
                <td>{playerName(f.playerId) ?? (f.playerId ? 'Unknown' : '—')}</td>
                <td className="text-xs text-muted">{f.source}{f.actorName ? ` · ${f.actorName}` : ''}</td>
                <td>{f.voided ? <StatusPill tone="warning">undone</StatusPill> : f.revision > 1 ? <StatusPill tone="primary">corrected</StatusPill> : null}{f.corrections.map((c, i) => <span key={i} className="block text-xs text-muted">{c.kind}: {c.reason}</span>)}</td>
              </tr>
            ))}
            {facts.data && !facts.data.length ? <tr><td colSpan={7} className="text-center text-muted">Nothing recorded yet. Goals, cards and phase changes from the scorer appear here.</td></tr> : null}
          </tbody></Table>
        </TabPanel>
        <TabPanel value="runsheet"><RunSheet matchId={d.id} canEdit={full || me.data?.role === 'operator'} /></TabPanel>
        <TabPanel value="activity"><ActivityFeed matchId={d.id} tz={tz} /></TabPanel>
        <TabPanel value="overlays"><ObsLinkPanel matchId={d.id} canEdit={full} /></TabPanel>
        {streaming ? <>
          <TabPanel value="streams"><StreamsPanel matchId={d.id} canEdit={full} tz={tz} /></TabPanel>
          <TabPanel value="media"><MatchMediaPanel matchId={d.id} tz={tz} /></TabPanel>
        </> : null}
      </Tabs>
    </>
  );
}

function ScoringSetup({ d }: { d: MatchDetail }) {
  const source = useAction((v: { scoringSource: string; scorerSourceDelayMs: number }) => patch(`matches/${d.id}`, v), [['match', d.id]], { success: 'Scoring settings saved' });
  return (
    <Card className="p-4">
      <h2 className="mb-2 flex items-center gap-2 font-medium">Scoring settings <InfoTip text="Where the scorer watches from decides how clips and timed graphics line up with the video. Assign the scorer in the Match day checklist above." /></h2>
      <div className="grid grid-cols-2 gap-2">
        <Field label="The scorer is" htmlFor="ss"><NativeSelect id="ss" value={d.scoringSource} onChange={(e) => source.mutate({ scoringSource: e.target.value, scorerSourceDelayMs: d.scorerSourceDelayMs })}><option value="courtside">At the ground</option><option value="watching_stream">Watching the delayed stream</option></NativeSelect></Field>
        <Field label="Stream delay (ms)" htmlFor="sd" hint="Only matters when watching the stream"><input id="sd" type="number" className="h-9 rounded-md border border-border bg-bg px-2 text-sm" defaultValue={d.scorerSourceDelayMs} onBlur={(e) => source.mutate({ scoringSource: d.scoringSource, scorerSourceDelayMs: Number(e.target.value) || 0 })} /></Field>
      </div>
      <ErrorNotice error={source.error} />
    </Card>
  );
}

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <Inner id={id} />
    </Suspense>
  );
}
