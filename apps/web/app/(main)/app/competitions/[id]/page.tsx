'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { Archive, Plus } from 'lucide-react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { patch, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import { MatchTable, type MatchRow } from '@/components/match-table';
import { CompetitionProduction } from '@/components/competition-production';

interface Competition {
  id: string; name: string; shortName: string | null; sport: string; status: string; defaultTimezone: string; rulesVersion: string;
  rulesConfig: Record<string, unknown>; rulesDescription: string[]; presets: { id: string; label: string }[];
  seasons: { id: string; name: string; startsOn: string | null; endsOn: string | null; status: string }[];
  themeProfileId: string | null; gamePlanVersionId: string | null; outputDefaults: Record<string, unknown>;
}

export default function CompetitionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const full = isFull(me.data?.role);
  const c = useGet<Competition>(['competition', id], `competitions/${id}`);
  const fixtures = useGet<{ items: MatchRow[]; total: number }>(['matches', 'competition', id], `matches?competitionId=${id}&pageSize=100`);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [season, setSeason] = useState({ name: '', startsOn: '', endsOn: '' });
  const addSeason = useAction((v: typeof season) => post(`competitions/${id}/seasons`, { name: v.name, startsOn: v.startsOn || null, endsOn: v.endsOn || null }), [['competition', id]]);
  const archive = useAction(() => patch(`competitions/${id}`, { status: c.data?.status === 'archived' ? 'active' : 'archived' }), [['competition', id], ['competitions']]);
  const setPreset = useAction((preset: string) => patch(`competitions/${id}`, { rulesPreset: preset }), [['competition', id]]);

  if (c.isLoading) return <Spinner />;
  if (c.error) return <ErrorNotice error={c.error} onRetry={() => c.refetch()} />;
  const comp = c.data!;
  const tz = comp.defaultTimezone;

  return (
    <>
      <PageHeader
        crumbs={<><Link href="/app/competitions" className="hover:text-text">Competitions</Link> / {comp.name}</>}
        title={comp.name}
        subtitle={<>{comp.sport} · {comp.shortName ?? 'no short name'} · {tz} <StatusPill className="ml-2" tone={comp.status === 'active' ? 'healthy' : 'neutral'}>{comp.status}</StatusPill></>}
        actions={full ? <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate(undefined)}><Archive className="size-4" /> {comp.status === 'archived' ? 'Restore' : 'Archive'}</Button> : null}
      />
      <Tabs defaultValue="overview">
        <TabList className="mb-4">
          <Tab value="overview">Overview</Tab>
          <Tab value="fixtures">Fixtures ({fixtures.data?.total ?? 0})</Tab>
          <Tab value="production">Graphics & production</Tab>
        </TabList>
        <TabPanel value="overview" className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Seasons</h2>{full ? <Button size="sm" onClick={() => setSeasonOpen(true)}><Plus className="size-4" /> Add season</Button> : null}</div>
            {comp.seasons.length ? (
              <Table><thead><tr><th>Name</th><th>Dates</th><th>Status</th></tr></thead><tbody>
                {comp.seasons.map((s) => <tr key={s.id}><td>{s.name}</td><td className="text-muted">{s.startsOn ?? '—'} → {s.endsOn ?? '—'}</td><td><StatusPill tone={s.status === 'active' ? 'healthy' : 'neutral'}>{s.status}</StatusPill></td></tr>)}
              </tbody></Table>
            ) : <p className="text-sm text-muted">No seasons yet. Fixtures need a season.</p>}
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Rules</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{comp.rulesDescription.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="mt-3 text-xs text-muted">Rules version {comp.rulesVersion}. Running and completed matches keep the rules they started with.</p>
            {full ? (
              <Field className="mt-3" label="Apply preset" htmlFor="preset">
                <NativeSelect id="preset" defaultValue="" onChange={(e) => e.target.value && setPreset.mutate(e.target.value)}><option value="">Choose…</option>{comp.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</NativeSelect>
              </Field>
            ) : null}
            <ErrorNotice error={setPreset.error} />
          </Card>
        </TabPanel>
        <TabPanel value="fixtures">
          <div className="mb-3 flex justify-end gap-2"><Button asChild size="sm"><Link href={`/app/matches?competitionId=${id}&import=1`}>Import CSV</Link></Button><Button asChild size="sm" variant="primary"><Link href={`/app/matches?competitionId=${id}&new=1`}>New fixture</Link></Button></div>
          {fixtures.isLoading ? <Spinner /> : <MatchTable rows={fixtures.data?.items ?? []} tz={tz} />}
        </TabPanel>
        <TabPanel value="production">
          <CompetitionProduction competition={comp} canEdit={full} />
        </TabPanel>
      </Tabs>
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
      <p className="mt-6 text-xs text-muted">Times shown in {tz}. Last refreshed {fmtDate(new Date(), tz, { timeStyle: 'short' })}.</p>
    </>
  );
}
