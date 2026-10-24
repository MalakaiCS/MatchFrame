'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { Archive, Plus, RefreshCw } from 'lucide-react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { patch, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import { MatchTable, type MatchRow } from '@/components/match-table';
import { CompetitionProduction } from '@/components/competition-production';
import { SeasonPlayers, SeasonResults, SeasonStandings } from '@/components/competition/season-data';
import { BulkRoundDialog, RolloverDialog, StandingsRulesCard } from '@/components/competition/season-tools';
import { DemoButton } from '@/components/demo-button';
import { RulesEditor, usePresetOptions } from '@/components/competition/rules-editor';
import { MatchTimeline } from '@/components/competition/rules-timing';
import { LogoField } from '@/components/logo-field';
import { FinalsPanel } from '@/components/competition/finals';
import type { Sport } from '@bs/domain';

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
  const addSeason = useAction((v: typeof season) => post(`competitions/${id}/seasons`, { name: v.name, startsOn: v.startsOn || null, endsOn: v.endsOn || null }), [['competition', id]], { success: 'Season added' });
  const archive = useAction(() => patch(`competitions/${id}`, { status: c.data?.status === 'archived' ? 'active' : 'archived' }), [['competition', id], ['competitions']]);
  const setPreset = useAction((preset: string) => patch<{ matchesUpdated: number }>(`competitions/${id}`, { rulesPreset: preset, applyToUpcoming: true }), [['competition', id], ['matches', 'competition', id]], { success: (r) => `Rules updated${r.matchesUpdated ? `; ${r.matchesUpdated} upcoming match${r.matchesUpdated === 1 ? '' : 'es'} updated` : ''}` });
  const presetOptions = usePresetOptions(c.data?.sport ?? 'football');
  const setLogo = useAction((logoAssetId: string | null) => patch(`competitions/${id}`, { logoAssetId }), [['competition', id], ['competitions']], { success: (_r, v) => (v ? 'Logo saved. Graphics for this competition show it in their title bars.' : 'Logo removed') });
  if (c.isLoading) return <Spinner />;
  if (c.error) return <ErrorNotice error={c.error} onRetry={() => c.refetch()} />;
  const comp = c.data!;
  const tz = comp.defaultTimezone;

  return (
    <>
      <PageHeader
        crumbs={<><Link href="/app/competitions" className="hover:text-text">Competitions</Link> / {comp.name}</>}
        title={<span className="flex items-center gap-3">{comp.logoAssetId ? <img src={`/api/v1/assets/${comp.logoAssetId}/preview`} alt="" className="h-9 w-auto max-w-24 object-contain" /> : null}{comp.name}</span>}
        subtitle={<>{comp.sport} · {comp.shortName ?? 'no short name'} · {tz} <StatusPill className="ml-2" tone={comp.status === 'active' ? 'healthy' : 'neutral'}>{comp.status}</StatusPill></>}
        actions={full ? <><DemoButton competitionId={id} /><Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate(undefined)}><Archive className="size-4" /> {comp.status === 'archived' ? 'Restore' : 'Archive'}</Button></> : null}
      />
      <Tabs defaultValue="overview">
        <TabList className="mb-4">
          <Tab value="overview">Overview</Tab>
          <Tab value="fixtures">Fixtures ({fixtures.data?.total ?? 0})</Tab>
          <Tab value="table">Table</Tab>
          <Tab value="finals">Finals</Tab>
          <Tab value="results">Results & fixtures</Tab>
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
            <p className="mt-2 text-xs text-muted">Shown beside the competition&apos;s name in the app, and in the title bars of full-screen graphics and on the holding slate in every look (in place of the look&apos;s own logo). PNG with a transparent background works best.</p>
            <ErrorNotice error={setLogo.error} />
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Rules</h2>
            <MatchTimeline sport={comp.sport as Sport} config={comp.rulesConfig} className="mb-3" />
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{comp.rulesDescription.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="mt-3 text-xs text-muted">Rules version {comp.rulesVersion}. Running and completed matches keep the rules they started with; upcoming matches nobody has started scoring take changed rules.{comp.finals ? ` Finals: ${comp.finals.own ? 'their own rules' : comp.finals.knockoutLabel ? `these rules with ${comp.finals.knockoutLabel.toLowerCase()}` : 'these rules'} (Finals tab).` : ''}</p>
            {full ? (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="Apply preset" htmlFor="preset">
                  <NativeSelect id="preset" value="" onChange={(e) => e.target.value && setPreset.mutate(e.target.value)}>
                    <option value="">Choose…</option>
                    {presetOptions.mine.length ? <optgroup label="Your presets">{presetOptions.mine.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</optgroup> : null}
                    <optgroup label="Built-in">{comp.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
                  </NativeSelect>
                </Field>
                <Button onClick={() => setRulesOpen(true)}>Edit rules and timing</Button>
              </div>
            ) : null}
            <ErrorNotice error={setPreset.error} />
          </Card>
          <div className="lg:col-span-2"><StandingsRulesCard competitionId={id} sport={comp.sport} rules={comp.standingsRules as never} canEdit={full} /></div>
        </TabPanel>
        <TabPanel value="fixtures">
          <div className="mb-3 flex flex-wrap justify-end gap-2">{full ? <Button size="sm" onClick={() => setRoundOpen(true)}><Plus className="size-4" /> Create a round</Button> : null}<Button asChild size="sm"><Link href={`/app/matches?competitionId=${id}&import=1`}>Import fixtures</Link></Button><Button asChild size="sm" variant="primary"><Link href={`/app/matches?competitionId=${id}&new=1`}>New match</Link></Button></div>
          {fixtures.isLoading ? <Spinner /> : <MatchTable rows={fixtures.data?.items ?? []} tz={tz} />}
        </TabPanel>
        <TabPanel value="table"><SeasonStandings seasons={comp.seasons} /></TabPanel>
        <TabPanel value="finals"><FinalsPanel competition={comp} canEdit={full} /></TabPanel>
        <TabPanel value="results"><SeasonResults seasons={comp.seasons} tz={tz} /></TabPanel>
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
