'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { Archive, Plus, RefreshCw } from 'lucide-react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs, cx } from '@bs/ui';
import { patch, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import { MatchTable, type MatchRow } from '@/components/match-table';
import { CompetitionProduction } from '@/components/competition-production';
import { SeasonPlayers, SeasonResults, SeasonStandings } from '@/components/competition/season-data';
import { BulkRoundDialog, RolloverDialog, StandingsRulesCard } from '@/components/competition/season-tools';
import { DemoButton } from '@/components/demo-button';
import { RulesEditor } from '@/components/competition/rules-editor';
import { MatchTimeline } from '@/components/competition/rules-timing';
import { LogoField } from '@/components/logo-field';
import { FinalsPanel } from '@/components/competition/finals';
import { regulationTimeline, SPORT_LABELS, type Sport } from '@bs/domain';

interface Competition {
  id: string; name: string; shortName: string | null; sport: string; status: string; defaultTimezone: string; rulesVersion: string;
  rulesConfig: Record<string, unknown>; rulesDescription: string[]; presets: { id: string; label: string }[];
  seasons: { id: string; name: string; startsOn: string | null; endsOn: string | null; status: string }[];
  themeProfileId: string | null; gamePlanVersionId: string | null; outputDefaults: Record<string, unknown>; logoAssetId: string | null;
  standingsRules?: Record<string, unknown> | null;
  finals?: { rulesConfig: Record<string, unknown>; rulesDescription: string[]; own: boolean; knockoutLabel: string | null };
}

export default function CompetitionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const full = isFull(me.data?.role);
  const c = useGet<Competition>(['competition', id], `competitions/${id}`);
  const fixtures = useGet<{ items: MatchRow[]; total: number }>(['matches', 'competition', id], `matches?competitionId=${id}&pageSize=100&sort=-scheduledAt`);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [season, setSeason] = useState({ name: '', startsOn: '', endsOn: '' });
  const [rollover, setRollover] = useState<Competition['seasons'][number] | null>(null);
  const [roundOpen, setRoundOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [fixtureView, setFixtureView] = useState<'rounds' | 'list'>('rounds');
  const addSeason = useAction((v: typeof season) => post(`competitions/${id}/seasons`, { name: v.name, startsOn: v.startsOn || null, endsOn: v.endsOn || null }), [['competition', id]], { success: 'Season added' });
  const archive = useAction(() => patch(`competitions/${id}`, { status: c.data?.status === 'archived' ? 'active' : 'archived' }), [['competition', id], ['competitions']]);
  const setLogo = useAction((logoAssetId: string | null) => patch(`competitions/${id}`, { logoAssetId }), [['competition', id], ['competitions']], { success: (_r, v) => (v ? 'Logo saved. Graphics for this competition show it in their title bars.' : 'Logo removed') });
  if (c.isLoading) return <Spinner />;
  if (c.error) return <ErrorNotice error={c.error} onRetry={() => c.refetch()} />;
  const comp = c.data!;
  const tz = comp.defaultTimezone;
  const hasTimeline = !!regulationTimeline(comp.sport as Sport, comp.rulesConfig)?.totalMinutes;

  return (
    <>
      <PageHeader
        crumbs={<><Link href="/app/competitions" className="hover:text-text">Competitions</Link> / {comp.name}</>}
        title={<span className="flex items-center gap-3">{comp.logoAssetId ? <img src={`/api/v1/assets/${comp.logoAssetId}/preview`} alt="" className="h-9 w-auto max-w-24 object-contain" /> : null}{comp.name}</span>}
        subtitle={<>{[SPORT_LABELS[comp.sport as Sport] ?? comp.sport, comp.shortName, tz].filter(Boolean).join(' · ')}{comp.status !== 'active' ? <StatusPill className="ml-2" tone="neutral">{comp.status}</StatusPill> : null}</>}
        actions={full ? <><DemoButton competitionId={id} /><Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate(undefined)}><Archive className="size-4" /> {comp.status === 'archived' ? 'Restore' : 'Archive'}</Button></> : null}
      />
      <Tabs defaultValue="overview">
        <TabList className="mb-4">
          <Tab value="overview">Overview</Tab>
          <Tab value="fixtures">Fixtures and results ({fixtures.data?.total ?? 0})</Tab>
          <Tab value="table">Table</Tab>
          <Tab value="finals">Finals</Tab>
          <Tab value="players">Players</Tab>
          <Tab value="production">Graphics & production</Tab>
        </TabList>
        <TabPanel value="overview" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Seasons</h2>{full ? <Button size="sm" onClick={() => setSeasonOpen(true)}><Plus className="size-4" /> Add season</Button> : null}</div>
            {comp.seasons.length ? (
              <Table><thead><tr><th>Name</th><th>Dates</th><th>Status</th>{full ? <th /> : null}</tr></thead><tbody>
                {comp.seasons.map((s) => <tr key={s.id}><td>{s.name}</td><td className="text-muted">{s.startsOn ?? '—'} → {s.endsOn ?? '—'}</td><td><StatusPill tone={s.status === 'active' ? 'healthy' : 'neutral'}>{s.status}</StatusPill></td>{full ? <td className="text-right">{s.status === 'active' ? <Button size="sm" variant="ghost" onClick={() => setRollover(s)}><RefreshCw className="size-3.5" /> Roll over</Button> : null}</td> : null}</tr>)}
              </tbody></Table>
            ) : <p className="text-sm text-muted">No seasons yet. Fixtures need a season.</p>}
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Logo</h2>
            <LogoField label="Competition logo" value={comp.logoAssetId} disabled={!full} onChange={(v) => setLogo.mutateAsync(v)} />
            <p className="mt-2 text-xs text-muted">Shown in the app and on the competition&apos;s full-screen graphics, in place of the look&apos;s own logo. A PNG with a transparent background works best.</p>
            <ErrorNotice error={setLogo.error} />
          </Card>
          <Card className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Rules</h2>
              {full ? <Button size="sm" onClick={() => setRulesOpen(true)}>Edit rules and timing</Button> : null}
            </div>
            {/* the timeline draws the periods and breaks; the rules themselves read as one line under it */}
            {hasTimeline ? <MatchTimeline sport={comp.sport as Sport} config={comp.rulesConfig} className="mb-2" /> : null}
            <p className="text-sm text-muted">{comp.rulesDescription.join(' · ')}</p>
            <p className="mt-2 text-xs text-muted">Changes apply to upcoming matches; a match under way keeps its rules.{comp.finals ? ` Finals: ${comp.finals.own ? 'their own rules' : comp.finals.knockoutLabel ? `these rules with ${comp.finals.knockoutLabel.toLowerCase()}` : 'these rules'} (Finals tab).` : ''}</p>
          </Card>
          <div className="lg:col-span-2"><StandingsRulesCard competitionId={id} sport={comp.sport} rules={comp.standingsRules as never} canEdit={full} /></div>
        </TabPanel>
        <TabPanel value="fixtures">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-border bg-panel p-1" role="group" aria-label="Show fixtures">
              {(['rounds', 'list'] as const).map((v) => <button key={v} type="button" aria-pressed={fixtureView === v} onClick={() => setFixtureView(v)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', fixtureView === v ? 'bg-primary/15 text-text ring-1 ring-inset ring-primary/40' : 'text-muted hover:text-text')}>{v === 'rounds' ? 'By round' : 'All matches'}</button>)}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">{full ? <Button size="sm" onClick={() => setRoundOpen(true)}><Plus className="size-4" /> Create a round</Button> : null}<Button asChild size="sm"><Link href={`/app/matches?competitionId=${id}&import=1`}>Import fixtures</Link></Button><Button asChild size="sm" variant="primary"><Link href={`/app/matches?competitionId=${id}&new=1`}>New match</Link></Button></div>
          </div>
          {fixtureView === 'rounds' ? <SeasonResults seasons={comp.seasons} tz={tz} /> : fixtures.isLoading ? <Spinner /> : <MatchTable rows={fixtures.data?.items ?? []} tz={tz} />}
        </TabPanel>
        <TabPanel value="table"><SeasonStandings seasons={comp.seasons} /></TabPanel>
        <TabPanel value="finals"><FinalsPanel competition={comp} canEdit={full} /></TabPanel>
        <TabPanel value="players"><SeasonPlayers seasons={comp.seasons} sport={comp.sport} /></TabPanel>
        <TabPanel value="production">
          <CompetitionProduction competition={comp} canEdit={full} />
        </TabPanel>
      </Tabs>
      {full ? <RulesEditor competitionId={id} sport={comp.sport as Sport} current={comp.rulesConfig} open={rulesOpen} onOpenChange={setRulesOpen} /> : null}
      <Dialog open={seasonOpen} onOpenChange={setSeasonOpen} title="Add season" footer={<><Button variant="ghost" onClick={() => setSeasonOpen(false)}>Cancel</Button><Button variant="primary" loading={addSeason.isPending} disabled={!season.name.trim()} onClick={() => addSeason.mutate(season, { onSuccess: () => { setSeasonOpen(false); setSeason({ name: '', startsOn: '', endsOn: '' }); } })}>Add</Button></>}>
        <div className="grid gap-3">
          <Field label="Name" htmlFor="sn" error={addSeason.error?.fieldError('name')}><Input id="sn" value={season.name} onChange={(e) => setSeason({ ...season, name: e.target.value })} placeholder="2027" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="ss"><Input id="ss" type="date" value={season.startsOn} onChange={(e) => setSeason({ ...season, startsOn: e.target.value })} /></Field>
            <Field label="Ends" htmlFor="se" error={addSeason.error?.fieldError('endsOn')}><Input id="se" type="date" value={season.endsOn} onChange={(e) => setSeason({ ...season, endsOn: e.target.value })} /></Field>
          </div>
          <ErrorNotice error={addSeason.error && !addSeason.error.fields ? addSeason.error : null} />
        </div>
      </Dialog>
      {rollover ? <RolloverDialog competitionId={id} season={rollover} onClose={() => setRollover(null)} /> : null}
      {roundOpen ? <BulkRoundDialog competitionId={id} sport={comp.sport} seasons={comp.seasons.filter((s) => s.status === 'active')} timezone={tz} onClose={() => setRoundOpen(false)} /> : null}
      <p className="mt-6 text-xs text-muted">Times shown in {tz}. Last refreshed {fmtDate(new Date(), tz, { timeStyle: 'short' })}.</p>
    </>
  );
}
