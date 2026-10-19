'use client';
import Link from 'next/link';
import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorNotice, Field, NativeSelect, PageHeader, Spinner, StatusPill, Switch, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { patch, post, put } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import { useRealtime } from '@/lib/realtime';
import { phaseTone } from '@/components/match-table';
import { OverlaysPanel } from '@/components/match/overlays-panel';
import { StreamsPanel } from '@/components/match/streams-panel';
import { MatchMediaPanel } from '@/components/match/media-panel';

export interface LineupPlayer { playerId: string; displayName: string; number: number | null; position?: string | null; starter: boolean; captain?: boolean }
export interface MatchDetail {
  id: string; status: string; sport: string; scheduledAt: string; timezone: string; round: string | null; externalId: string | null; isDemo: boolean;
  competition: { id: string; name: string }; season: { id: string; name: string }; venue: { name: string } | null;
  teams: { home: { id: string; name: string; abbreviation: string; primaryColor: string }; away: { id: string; name: string; abbreviation: string; primaryColor: string } };
  lineup: { home: LineupPlayer[]; away: LineupPlayer[] }; lineupLocked: boolean;
  state: { phase: string; projection: { score: { home: number; away: number }; shootout: { home: number; away: number } | null; stats: Record<string, Record<string, number>> }; stateVersion: number };
  lease: { holderName: string | null; expiresAt: string | null; leaseVersion: number; takenOverFrom: string | null } | null;
  rules: { description: string[]; phases: { id: string; label: string }[]; capabilities: { statRows: { key: string; label: string }[] } };
  homeTeamId: string; awayTeamId: string; seasonId: string; scoringSource: string; scorerSourceDelayMs: number;
}
interface Fact { id: string; sequence: number; category: string; type: string; side: string | null; playerId: string | null; periodId: string; clockMs: number | null; occurredAt: string; acceptedAt: string; source: string; actorName: string | null; voided: boolean; revision: number; historical: boolean; payload: Record<string, unknown>; corrections: { kind: string; reason: string; createdAt: string }[] }

function Inner({ id }: { id: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const tab = useSearchParams().get('tab') ?? 'overview';
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
  const tz = d.timezone;
  const playerName = (pid: string | null) => [...d.lineup.home, ...d.lineup.away].find((p) => p.playerId === pid)?.displayName ?? null;

  return (
    <>
      <PageHeader
        crumbs={<><Link href="/app/matches" className="hover:text-text">Matches</Link> / <Link href={`/app/competitions/${d.competition.id}`} className="hover:text-text">{d.competition.name}</Link></>}
        title={`${d.teams.home.name} v ${d.teams.away.name}`}
        subtitle={<>{fmtDate(d.scheduledAt, tz, { dateStyle: 'full', timeStyle: 'short' })} ({tz}) · {d.season.name}{d.round ? ` · ${d.round}` : ''}{d.venue ? ` · ${d.venue.name}` : ''}</>}
        actions={<><Button asChild><Link href={`/score/${d.id}`}>Open scorer</Link></Button></>}
      />
      <Card className="mb-4 flex flex-wrap items-center gap-6 p-4">
        <div className="text-3xl font-semibold tabular">{d.state.projection.score.home} – {d.state.projection.score.away}{d.state.projection.shootout ? <span className="ml-2 text-base text-muted">({d.state.projection.shootout.home}–{d.state.projection.shootout.away} pens)</span> : null}</div>
        <StatusPill tone={phaseTone(d.status)}>{d.rules.phases.find((p) => p.id === d.state.phase)?.label ?? d.state.phase}</StatusPill>
        {d.isDemo ? <StatusPill tone="warning">Demo match</StatusPill> : null}
        <span className="text-sm text-muted">Scorer: {d.lease?.holderName && d.lease.expiresAt && new Date(d.lease.expiresAt) > new Date() ? d.lease.holderName : 'none active'}{d.lease?.takenOverFrom ? ' (taken over)' : ''}</span>
        <span className="text-xs text-muted">State v{d.state.stateVersion}</span>
      </Card>
      <Tabs defaultValue={tab}>
        <TabList className="mb-4">
          <Tab value="overview">Overview</Tab><Tab value="lineup">Lineup</Tab><Tab value="facts">Facts ({facts.data?.filter((f) => f.category === 'event').length ?? 0})</Tab>
          <Tab value="overlays">Overlays</Tab><Tab value="streams">Streams</Tab><Tab value="media">Recordings & highlights</Tab>
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
          </div>
        </TabPanel>
        <TabPanel value="lineup"><LineupEditor d={d} canEdit={full} /></TabPanel>
        <TabPanel value="facts">
          <ErrorNotice error={facts.error} />
          <Table><thead><tr><th>#</th><th>Time</th><th>Event</th><th>Team</th><th>Player</th><th>Source</th><th>Status</th></tr></thead><tbody>
            {facts.data?.slice().reverse().map((f) => (
              <tr key={f.id} className={f.voided ? 'opacity-60' : ''}>
                <td className="tabular">{f.sequence}</td>
                <td className="tabular whitespace-nowrap">{f.clockMs != null ? `${Math.floor(f.clockMs / 60000)}'` : '—'} <span className="text-xs text-muted">{fmtDate(f.occurredAt, tz, { timeStyle: 'medium' })}</span></td>
                <td>{f.category === 'phase' ? `→ ${d.rules.phases.find((p) => p.id === f.payload.to)?.label ?? String(f.payload.to)}` : f.category === 'adjustment' ? `Score set ${JSON.stringify(f.payload.to)}` : f.type.replace(/_/g, ' ')}{f.historical ? <StatusPill className="ml-1" tone="neutral">late</StatusPill> : null}</td>
                <td>{f.side ? d.teams[f.side as 'home'].abbreviation : ''}</td>
                <td>{playerName(f.playerId) ?? (f.playerId ? 'Unknown' : '—')}</td>
                <td className="text-xs text-muted">{f.source}{f.actorName ? ` · ${f.actorName}` : ''}</td>
                <td>{f.voided ? <StatusPill tone="warning">voided</StatusPill> : f.revision > 1 ? <StatusPill tone="primary">corrected</StatusPill> : null}{f.corrections.map((c, i) => <span key={i} className="block text-xs text-muted">{c.kind}: {c.reason}</span>)}</td>
              </tr>
            ))}
          </tbody></Table>
        </TabPanel>
        <TabPanel value="overlays"><OverlaysPanel matchId={d.id} sport={d.sport} canEdit={full} /></TabPanel>
        <TabPanel value="streams"><StreamsPanel matchId={d.id} canEdit={full} tz={tz} /></TabPanel>
        <TabPanel value="media"><MatchMediaPanel matchId={d.id} tz={tz} /></TabPanel>
      </Tabs>
    </>
  );
}

function ScoringSetup({ d }: { d: MatchDetail }) {
  const members = useGet<{ id: string; name: string; role: string; status: string }[]>(['members'], 'members');
  const [mid, setMid] = useState('');
  const assign = useAction((membershipId: string) => post(`matches/${d.id}/scorers`, { membershipId }), [['members']]);
  const source = useAction((v: { scoringSource: string; scorerSourceDelayMs: number }) => patch(`matches/${d.id}`, v), [['match', d.id]]);
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-medium">Scoring</h2>
      <div className="flex items-end gap-2">
        <Field label="Assign a scorer" htmlFor="as" className="flex-1"><NativeSelect id="as" value={mid} onChange={(e) => setMid(e.target.value)}><option value="">Choose member…</option>{members.data?.filter((x) => x.status === 'active').map((x) => <option key={x.id} value={x.id}>{x.name} ({x.role})</option>)}</NativeSelect></Field>
        <Button disabled={!mid} loading={assign.isPending} onClick={() => assign.mutate(mid)}>Assign</Button>
      </div>
      {assign.done ? <p className="mt-1 text-xs text-healthy">Assigned. They will see this match on their scoring list.</p> : null}
      <ErrorNotice error={assign.error} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field label="Scorer watches" htmlFor="ss"><NativeSelect id="ss" value={d.scoringSource} onChange={(e) => source.mutate({ scoringSource: e.target.value, scorerSourceDelayMs: d.scorerSourceDelayMs })}><option value="courtside">Live, courtside</option><option value="watching_stream">The delayed stream</option></NativeSelect></Field>
        <Field label="Scorer delay (ms)" htmlFor="sd" hint="Used to align clips and cues"><input id="sd" type="number" className="h-9 rounded-md border border-border bg-bg px-2 text-sm" defaultValue={d.scorerSourceDelayMs} onBlur={(e) => source.mutate({ scoringSource: d.scoringSource, scorerSourceDelayMs: Number(e.target.value) || 0 })} /></Field>
      </div>
    </Card>
  );
}

function LineupEditor({ d, canEdit }: { d: MatchDetail; canEdit: boolean }) {
  const [lu, setLu] = useState(d.lineup);
  useEffect(() => setLu(d.lineup), [d.lineup]);
  const save = useAction((lock: boolean) => put(`matches/${d.id}/lineup`, { home: lu.home.map(({ playerId, number, starter, captain, position }) => ({ playerId, number, starter, captain, position })), away: lu.away.map(({ playerId, number, starter, captain, position }) => ({ playerId, number, starter, captain, position })), lock }), [['match', d.id]]);
  const toggle = (side: 'home' | 'away', pid: string, key: 'starter' | 'captain') => setLu({ ...lu, [side]: lu[side].map((p) => (p.playerId === pid ? { ...p, [key]: !p[key] } : p)) });
  const remove = (side: 'home' | 'away', pid: string) => setLu({ ...lu, [side]: lu[side].filter((p) => p.playerId !== pid) });
  return (
    <div>
      <p className="mb-3 text-sm text-muted">The lineup is a snapshot: later roster edits and transfers never change this match’s graphics or history.{d.lineupLocked ? ' Locked.' : ''}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {(['home', 'away'] as const).map((side) => (
          <Card key={side} className="p-3">
            <h3 className="mb-2 font-medium">{d.teams[side].name}</h3>
            {lu[side].length ? (
              <Table><thead><tr><th>#</th><th>Player</th><th>Starter</th><th>Captain</th><th /></tr></thead><tbody>
                {lu[side].map((p) => <tr key={p.playerId}><td className="tabular">{p.number ?? '—'}</td><td>{p.displayName}</td>
                  <td><Switch label="" checked={p.starter} disabled={!canEdit} onCheckedChange={() => toggle(side, p.playerId, 'starter')} /></td>
                  <td><Switch label="" checked={!!p.captain} disabled={!canEdit} onCheckedChange={() => toggle(side, p.playerId, 'captain')} /></td>
                  <td>{canEdit ? <button className="text-xs text-muted hover:text-live" onClick={() => remove(side, p.playerId)}>Remove</button> : null}</td></tr>)}
              </tbody></Table>
            ) : <p className="text-sm text-muted">No players on this team’s season roster. Add players under Assets → Teams.</p>}
            <p className="mt-2 text-xs text-muted">{lu[side].filter((p) => p.starter).length} starters · {lu[side].filter((p) => !p.starter).length} bench</p>
          </Card>
        ))}
      </div>
      {canEdit ? <div className="mt-3 flex gap-2"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(false)}>Save lineup</Button><Button loading={save.isPending} onClick={() => save.mutate(true)}>Save and lock</Button></div> : null}
      {save.done ? <p className="mt-2 text-sm text-healthy">Lineup saved.</p> : null}
      <ErrorNotice error={save.error} />
    </div>
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
