'use client';
import Link from 'next/link';
import { Suspense, use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorNotice, Field, InfoTip, NativeSelect, PageHeader, Spinner, StatusPill, Switch, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { patch } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, streamingOn, useMe } from '@/lib/session';
import { useRealtime } from '@/lib/realtime';
import { phaseTone } from '@/components/match-table';
import { ObsLinkPanel } from '@/components/match/overlays-panel';
import { HighlightsPanel } from '@/components/match/highlights-panel';
import { ThumbnailsPanel } from '@/components/match/thumbnails-panel';
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
  state: { phase: string; projection: { score: { home: number; away: number }; shootout: { home: number; away: number } | null; stats: Record<string, Record<string, number>> }; stateVersion: number; sequence?: number };
  lease: { holderName: string | null; expiresAt: string | null; leaseVersion: number; takenOverFrom: string | null } | null;
  scorers: { membershipId: string; name: string }[];
  rules: { description: string[]; phases: { id: string; label: string }[]; capabilities: { statRows: { key: string; label: string }[] }; knockout?: { label: string; on: boolean } | null };
  stage?: 'regular' | 'finals';
  homeTeamId: string; awayTeamId: string; seasonId: string; scoringSource: string; scorerSourceDelayMs: number;
  publicToken: string | null;
  officials?: { role: string; name: string }[] | null; attendance?: number | null; weather?: { summary?: string | null; tempC?: number | null; condition?: string | null } | null;
}
interface Fact { id: string; sequence: number; category: string; type: string; side: string | null; playerId: string | null; periodId: string; clockMs: number | null; occurredAt: string; acceptedAt: string; source: string; actorName: string | null; voided: boolean; revision: number; historical: boolean; payload: Record<string, unknown>; corrections: { kind: string; reason: string; createdAt: string }[] }

const TABS = ['overview', 'lineup', 'timeline', 'graphics', 'media', 'streams'];
/** links from before the tabs were merged: event log + activity → Timeline; OBS link + run sheet → Graphics; highlights + thumbnails → Media */
const OLD_TABS: Record<string, string> = { facts: 'timeline', activity: 'timeline', overlays: 'graphics', runsheet: 'graphics', highlights: 'media', thumbnails: 'media' };

/** The match's rules; before scoring starts, its stage (regular season or finals) and knockout can change here. */
function MatchRules({ d, canEdit }: { d: MatchDetail; canEdit: boolean }) {
  const untouched = d.status === 'scheduled' && !d.state.sequence;
  const save = useAction((v: { stage?: 'regular' | 'finals'; knockout?: boolean }) => patch(`matches/${d.id}`, v), [['match', d.id]], { success: (_r, v) => (v.stage ? (v.stage === 'finals' ? 'Now a finals match: knockout rules, left out of the ladder' : 'Now a regular-season match') : v.knockout ? 'A level score is decided in this match' : 'A draw stands in this match') });
  const ko = d.rules.knockout;
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-medium">Rules</h2>
      <ul className="list-disc pl-5 text-sm text-muted">{d.rules.description.map((x) => <li key={x}>{x}</li>)}</ul>
      {canEdit ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Stage" htmlFor="m-stage" hint={d.stage === 'finals' ? 'Never counts for the ladder.' : 'Counts for the ladder.'}>
            <NativeSelect id="m-stage" value={d.stage ?? 'regular'} disabled={save.isPending} onChange={(e) => save.mutate({ stage: e.target.value as 'regular' | 'finals' })}>
              <option value="regular">Regular season</option>
              <option value="finals">Finals</option>
            </NativeSelect>
          </Field>
          {ko ? (
            <div className="grid content-start gap-1">
              <Switch label={`Knockout: ${ko.label.toLowerCase()}`} checked={ko.on} disabled={!untouched || save.isPending} onCheckedChange={(v) => save.mutate({ knockout: v })} />
              <p className="text-xs text-muted">{untouched ? 'A level score goes to extra time, penalties or the sport\'s decider instead of a draw.' : 'Scoring has started: switch it in the scorer, under More options.'}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <ErrorNotice error={save.error} />
    </Card>
  );
}

function Inner({ id }: { id: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const asked = useSearchParams().get('tab') ?? 'overview';
  const wanted = OLD_TABS[asked] ?? asked;
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
        subtitle={<>{fmtDate(d.scheduledAt, tz, { dateStyle: 'full', timeStyle: 'short' })} ({tz}) · {d.season.name}{d.round ? ` · ${/^\d+$/.test(d.round) ? `Round ${d.round}` : d.round}` : ''}{d.venue ? ` · ${d.venue.name}` : ''}{d.stage === 'finals' ? <StatusPill className="ml-2" tone="primary">Finals</StatusPill> : null}</>}
        actions={<><Button asChild variant="ghost"><Link href={`/app/matches/${d.id}/commentary`}>Commentator view</Link></Button><Button asChild><Link href={`/score/${d.id}`}>Open scorer</Link></Button></>}
      />
      <Card className="mb-4 flex flex-wrap items-center gap-6 p-4">
        <div className="text-3xl font-semibold tabular">{d.state.projection.score.home} – {d.state.projection.score.away}{d.state.projection.shootout ? <span className="ml-2 text-base text-muted">({d.state.projection.shootout.home}–{d.state.projection.shootout.away} pens)</span> : null}</div>
        <StatusPill tone={phaseTone(d.status)}>{d.rules.phases.find((p) => p.id === d.state.phase)?.label ?? d.state.phase}</StatusPill>
        {d.isDemo ? <StatusPill tone="warning">Demo match</StatusPill> : null}
        <span className="text-sm text-muted">{scoringNow ? `Scoring now: ${scoringNow}${d.lease?.takenOverFrom ? ' (took over)' : ''}` : 'No scorer connected'}</span>
      </Card>
      {full ? <MatchDayChecklist d={d} canEdit={full} onGoTo={(t) => setTab(OLD_TABS[t] ?? t)} /> : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabList className="mb-4">
          <Tab value="overview">Overview</Tab>
          <Tab value="lineup">Line-ups</Tab>
          <Tab value="timeline">Timeline{events ? ` (${events})` : ''}</Tab>
          <Tab value="graphics">Graphics</Tab>
          <Tab value="media">Media</Tab>
          {streaming ? <Tab value="streams">Stream</Tab> : null}
        </TabList>
        <TabPanel value="overview" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Team stats</h2>
            <Table><thead><tr><th>{d.teams.home.abbreviation}</th><th className="text-center">Stat</th><th className="text-right">{d.teams.away.abbreviation}</th></tr></thead><tbody>
              {d.rules.capabilities.statRows.map((r) => <tr key={r.key}><td className="tabular">{d.state.projection.stats.home?.[r.key] ?? 0}</td><td className="text-center text-muted">{r.label}</td><td className="text-right tabular">{d.state.projection.stats.away?.[r.key] ?? 0}</td></tr>)}
            </tbody></Table>
          </Card>
          <div className="grid gap-4">
            <MatchRules d={d} canEdit={full} />
            {full ? <ScoringSetup d={d} /> : null}
            <SharePanel matchId={d.id} publicToken={d.publicToken} canEdit={full} />
            <MatchInfoEditor matchId={d.id} match={d} canEdit={full} />
          </div>
        </TabPanel>
        <TabPanel value="lineup"><LineupEditor matchId={d.id} canEdit={full} canSaveDefault={full} /></TabPanel>
        <TabPanel value="timeline" className="grid gap-6">
          <section aria-labelledby="t-events">
            <h2 id="t-events" className="mb-2 font-medium">Event log</h2>
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
          </section>
          <section aria-labelledby="t-activity">
            <h2 id="t-activity" className="mb-1 font-medium">Activity</h2>
            <p className="mb-2 text-xs text-muted">Everything that happened on this match: scoring, the desk, graphics on and off air, and changes to the set-up.</p>
            <ActivityFeed matchId={d.id} tz={tz} />
          </section>
        </TabPanel>
        <TabPanel value="graphics" className="grid gap-6">
          <ObsLinkPanel matchId={d.id} canEdit={full} />
          <section aria-labelledby="g-runsheet">
            <h2 id="g-runsheet" className="mb-1 font-medium">Run sheet and notes</h2>
            <p className="mb-2 text-xs text-muted">Timed lines the production team ticks off, and notes. Every desk on this match sees them too.</p>
            <RunSheet matchId={d.id} canEdit={full || me.data?.role === 'operator'} />
          </section>
        </TabPanel>
        <TabPanel value="media" className="grid gap-6">
          <section aria-labelledby="m-highlights">
            <h2 id="m-highlights" className="mb-2 font-medium">Highlights</h2>
            <HighlightsPanel matchId={d.id} canEdit={full || me.data?.role === 'operator'} />
          </section>
          <section aria-labelledby="m-thumbnails">
            <h2 id="m-thumbnails" className="mb-2 font-medium">Thumbnails</h2>
            <ThumbnailsPanel matchId={d.id} />
          </section>
          {streaming ? (
            <section aria-labelledby="m-recordings">
              <h2 id="m-recordings" className="mb-2 font-medium">Recordings and clips</h2>
              <MatchMediaPanel matchId={d.id} tz={tz} />
            </section>
          ) : null}
        </TabPanel>
        {streaming ? <TabPanel value="streams"><StreamsPanel matchId={d.id} canEdit={full} tz={tz} /></TabPanel> : null}
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
