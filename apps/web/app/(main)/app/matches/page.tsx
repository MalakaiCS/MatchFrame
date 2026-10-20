'use client';
import { SportOptions } from '@/components/sport-options';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, List, Plus, Upload } from 'lucide-react';
import { Button, Dialog, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, Switch, Table } from '@bs/ui';
import { ApiError, get, post, put } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import { MatchTable, type MatchRow } from '@/components/match-table';

interface Filters { from: string; to: string; sport: string; competitionId: string; status: string; view: 'table' | 'cards'; sort: 'scheduledAt' | '-scheduledAt' }
const DEFAULTS: Filters = { from: '', to: '', sport: '', competitionId: '', status: '', view: 'table', sort: 'scheduledAt' };
interface Comp { id: string; name: string; sport: string; seasons?: { id: string; name: string }[] }

function MatchesInner() {
  const me = useMe();
  const tz = me.data?.activeOrganisation?.timezone ?? 'Australia/Brisbane';
  const qs = useSearchParams();
  const router = useRouter();
  const [f, setF] = useState<Filters>({ ...DEFAULTS, competitionId: qs.get('competitionId') ?? '' });
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const search = qs.get('search') ?? '';
  const comps = useGet<Comp[]>(['competitions'], 'competitions');

  // per-user persisted filters
  useEffect(() => {
    get<{ prefs: { matchFilters?: Partial<Filters> } }>('me/preferences')
      .then((r) => setF((cur) => ({ ...cur, ...(r.prefs.matchFilters ?? {}), competitionId: qs.get('competitionId') ?? r.prefs.matchFilters?.competitionId ?? '' })))
      .finally(() => setLoaded(true));
  }, [qs]);
  useEffect(() => {
    if (loaded) void put('me/preferences', { matchFilters: f }).catch(() => undefined);
  }, [f, loaded]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '25', sort: f.sort });
    if (f.from) p.set('from', new Date(f.from).toISOString());
    if (f.to) p.set('to', new Date(`${f.to}T23:59:59`).toISOString());
    for (const k of ['sport', 'competitionId', 'status'] as const) if (f[k]) p.set(k, f[k]);
    if (search) p.set('search', search);
    return p.toString();
  }, [f, page, search]);
  const list = useGet<{ items: MatchRow[]; total: number; page: number; pageSize: number }>(['matches', query], loaded ? `matches?${query}` : null, { refetchInterval: 15_000 });
  const full = isFull(me.data?.role);
  const set = (patch: Partial<Filters>) => { setF({ ...f, ...patch }); setPage(1); };
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Matches" subtitle={`Kick-off times in ${tz}`} actions={full ? <>
        <Button onClick={() => router.push(`/app/matches?${new URLSearchParams({ ...(f.competitionId ? { competitionId: f.competitionId } : {}), import: '1' })}`)}><Upload className="size-4" /> Import CSV</Button>
        <Button variant="primary" onClick={() => router.push(`/app/matches?${new URLSearchParams({ ...(f.competitionId ? { competitionId: f.competitionId } : {}), new: '1' })}`)}><Plus className="size-4" /> New fixture</Button>
      </> : null} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From" htmlFor="ff"><Input id="ff" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
        <Field label="To" htmlFor="ft"><Input id="ft" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
        <Field label="Sport" htmlFor="fs"><NativeSelect id="fs" value={f.sport} onChange={(e) => set({ sport: e.target.value })}><option value="">All</option><SportOptions /></NativeSelect></Field>
        <Field label="Competition" htmlFor="fc"><NativeSelect id="fc" value={f.competitionId} onChange={(e) => set({ competitionId: e.target.value })}><option value="">All</option>{comps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
        <Field label="Status" htmlFor="fst"><NativeSelect id="fst" value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="">Active</option>{['scheduled', 'live', 'completed', 'postponed', 'cancelled', 'abandoned', 'archived'].map((s) => <option key={s}>{s}</option>)}</NativeSelect></Field>
        <Field label="Order" htmlFor="fo"><NativeSelect id="fo" value={f.sort} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })}><option value="scheduledAt">Earliest first</option><option value="-scheduledAt">Latest first</option></NativeSelect></Field>
        <div className="ml-auto flex gap-1" role="group" aria-label="View">
          <Button size="sm" variant={f.view === 'table' ? 'primary' : 'secondary'} onClick={() => set({ view: 'table' })} aria-pressed={f.view === 'table'}><List className="size-4" /> Table</Button>
          <Button size="sm" variant={f.view === 'cards' ? 'primary' : 'secondary'} onClick={() => set({ view: 'cards' })} aria-pressed={f.view === 'cards'}><LayoutGrid className="size-4" /> Cards</Button>
        </div>
      </div>
      {search ? <p className="mb-2 text-sm text-muted">Search: “{search}” <button className="underline" onClick={() => router.push('/app/matches')}>clear</button></p> : null}
      <ErrorNotice error={list.error} onRetry={() => list.refetch()} />
      {!list.data && list.isLoading ? <Spinner /> : list.data ? <MatchTable rows={list.data.items} tz={tz} view={f.view} /> : null}
      {list.data && list.data.total > list.data.pageSize ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span className="text-muted">{list.data.total} matches · page {page} of {pages}</span>
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      ) : null}
      {qs.get('new') ? <NewFixture comps={comps.data ?? []} tz={tz} initialCompetition={f.competitionId} onClose={() => router.push('/app/matches')} /> : null}
      {qs.get('import') ? <ImportFixtures comps={comps.data ?? []} onClose={() => router.push('/app/matches')} /> : null}
    </>
  );
}

function NewFixture({ comps, tz, initialCompetition, onClose }: { comps: Comp[]; tz: string; initialCompetition: string; onClose: () => void }) {
  const [form, setForm] = useState({ competitionId: initialCompetition || comps[0]?.id || '', seasonId: '', homeTeamId: '', awayTeamId: '', venueId: '', round: '', kickoffLocal: '', timezone: tz, externalId: '' });
  const comp = useGet<Comp & { seasons: { id: string; name: string }[] }>(['competition', form.competitionId], form.competitionId ? `competitions/${form.competitionId}` : null);
  const teams = useGet<{ id: string; name: string }[]>(['teams', comp.data?.sport], comp.data ? `teams?sport=${comp.data.sport}` : null);
  const venues = useGet<{ id: string; name: string; timezone: string }[]>(['venues'], 'venues');
  const create = useAction((v: typeof form) => post<{ id: string }>('matches', { ...v, venueId: v.venueId || null, round: v.round || null, externalId: v.externalId || null, kickoffLocal: v.kickoffLocal.replace('T', ' ') }), [['matches']], { success: 'Fixture created. Its OBS link is ready on the match page.' });
  const router = useRouter();
  useEffect(() => {
    if (comp.data?.seasons?.length && !form.seasonId) setForm((x) => ({ ...x, seasonId: comp.data!.seasons.at(-1)!.id }));
  }, [comp.data, form.seasonId]);
  const fe = (k: string) => create.error?.fieldError(k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New fixture" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!form.seasonId || !form.homeTeamId || !form.awayTeamId || !form.kickoffLocal} onClick={() => create.mutate(form, { onSuccess: (m) => router.push(`/app/matches/${m.id}`) })}>Create fixture</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Competition" htmlFor="nc"><NativeSelect id="nc" value={form.competitionId} onChange={(e) => setForm({ ...form, competitionId: e.target.value, seasonId: '', homeTeamId: '', awayTeamId: '' })}><option value="">Choose…</option>{comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
        <Field label="Season" htmlFor="ns" error={fe('seasonId')}><NativeSelect id="ns" value={form.seasonId} onChange={(e) => setForm({ ...form, seasonId: e.target.value })}><option value="">Choose…</option>{comp.data?.seasons?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
        <Field label="Home team" htmlFor="nh" error={fe('homeTeamId')}><NativeSelect id="nh" value={form.homeTeamId} onChange={(e) => setForm({ ...form, homeTeamId: e.target.value })}><option value="">Choose…</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
        <Field label="Away team" htmlFor="na" error={fe('awayTeamId')}><NativeSelect id="na" value={form.awayTeamId} onChange={(e) => setForm({ ...form, awayTeamId: e.target.value })}><option value="">Choose…</option>{teams.data?.filter((t) => t.id !== form.homeTeamId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
        <Field label="Venue" htmlFor="nv"><NativeSelect id="nv" value={form.venueId} onChange={(e) => { const v = venues.data?.find((x) => x.id === e.target.value); setForm({ ...form, venueId: e.target.value, timezone: v?.timezone ?? form.timezone }); }}><option value="">None</option>{venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</NativeSelect></Field>
        <Field label="Round" htmlFor="nr"><Input id="nr" value={form.round} onChange={(e) => setForm({ ...form, round: e.target.value })} /></Field>
        <Field label="Kick-off (local)" htmlFor="nk" error={fe('kickoffLocal')}><Input id="nk" type="datetime-local" value={form.kickoffLocal} onChange={(e) => setForm({ ...form, kickoffLocal: e.target.value })} /></Field>
        <Field label="Timezone (IANA)" htmlFor="nt" error={fe('timezone')}><Input id="nt" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
        <Field label="External ID" htmlFor="ne" hint="Optional reference from your fixture system"><Input id="ne" value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><ErrorNotice error={create.error && !create.error.fields ? create.error : null} /></div>
    </Dialog>
  );
}

interface Plan {
  valid: boolean;
  rows: { row: number; externalId: string; kickoffLocal: string; timezone: string; scheduledAt: string; action: string; skipReason?: string; homeTeam: unknown; awayTeam: unknown; round: string }[];
  errors: { row: number; field: string; code: string; message: string }[];
  summary: { create: number; update: number; skip: number; error: number; teamsToCreate: string[] };
  checksum: string;
  errorsCsv: string | null;
}

function ImportFixtures({ comps, onClose }: { comps: Comp[]; onClose: () => void }) {
  const sports = [...new Set(comps.map((c) => c.sport))];
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [opts, setOpts] = useState({ sport: (sports[0] ?? 'football') as string, mode: 'skip_duplicates', createMissingTeams: false, teamMappings: {} as Record<string, string> });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<{ created: string[]; updated: string[]; skipped: { externalId: string; reason: string }[]; teamsCreated: string[] } | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const teams = useGet<{ id: string; name: string }[]>(['teams', opts.sport], `teams?sport=${opts.sport}`);
  const unknownTeams = plan ? [...new Set(plan.errors.filter((e) => e.code === 'UNKNOWN_TEAM').map((e) => /"(.*)"/.exec(e.message)?.[1] ?? ''))].filter(Boolean) : [];

  const dryRun = async (o = opts) => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setPlan(await post<Plan>('imports/fixtures/dry-run', { csv, options: o }));
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await post('imports/fixtures/commit', { csv, options: opts, checksum: plan!.checksum }));
      setPlan(null);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const download = (name: string, text: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    a.click();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="Import fixtures" description={<>Columns: external_id, competition, season, round, home_team, away_team, venue, kickoff_local, timezone. <a className="text-primary underline" href="/api/v1/imports/fixtures/template.csv">Download template</a></>}
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => dryRun()} loading={busy && !plan} disabled={!csv}>Preview</Button><Button variant="primary" onClick={commit} loading={busy && !!plan} disabled={!plan?.valid}>Import {plan ? `${plan.summary.create + plan.summary.update} fixture(s)` : ''}</Button></>}>
      {result ? (
        <div className="text-sm">
          <p className="text-healthy">Imported: {result.created.length} created, {result.updated.length} updated, {result.skipped.length} skipped.</p>
          {result.teamsCreated.length ? <p className="mt-1 text-muted">Teams created: {result.teamsCreated.join(', ')}</p> : null}
          {result.skipped.length ? <ul className="mt-2 list-disc pl-5 text-muted">{result.skipped.map((s) => <li key={s.externalId}>{s.externalId}: {s.reason}</li>)}</ul> : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="CSV file" htmlFor="csvf"><Input id="csvf" type="file" accept=".csv,text/csv" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) { setFileName(fl.name); setCsv(await fl.text()); setPlan(null); } }} /></Field>
            <Field label="Sport" htmlFor="isp"><NativeSelect id="isp" value={opts.sport} onChange={(e) => { setOpts({ ...opts, sport: e.target.value }); setPlan(null); }}>{(sports.length ? sports : ['football', 'basketball']).map((s) => <option key={s}>{s}</option>)}</NativeSelect></Field>
            <Field label="Repeat import" htmlFor="imd"><NativeSelect id="imd" value={opts.mode} onChange={(e) => { setOpts({ ...opts, mode: e.target.value }); setPlan(null); }}><option value="skip_duplicates">Skip existing fixtures</option><option value="update_matched_future">Update matched future fixtures</option></NativeSelect></Field>
          </div>
          <Switch label="Create teams that do not exist yet" checked={opts.createMissingTeams} onCheckedChange={(v) => { setOpts({ ...opts, createMissingTeams: v }); setPlan(null); }} />
          {fileName ? <p className="text-xs text-muted">{fileName} · {csv.split(/\r?\n/).filter(Boolean).length - 1} data rows. Nothing is saved until you import.</p> : null}
          <ErrorNotice error={err} />
          {unknownTeams.length && !opts.createMissingTeams ? (
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm">Map unknown team names to existing teams:</p>
              {unknownTeams.map((n) => (
                <div key={n} className="mb-1 grid grid-cols-2 items-center gap-2 text-sm"><span>{n}</span>
                  <NativeSelect aria-label={`Map ${n}`} value={opts.teamMappings[n.toLowerCase()] ?? ''} onChange={(e) => setOpts({ ...opts, teamMappings: { ...opts.teamMappings, [n.toLowerCase()]: e.target.value } })}><option value="">Not mapped</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></div>
              ))}
              <Button size="sm" className="mt-2" onClick={() => dryRun()}>Re-check with mappings</Button>
            </div>
          ) : null}
          {plan ? (
            <>
              <p className="text-sm">{plan.summary.create} to create · {plan.summary.update} to update · {plan.summary.skip} skipped · <span className={plan.errors.length ? 'text-live' : ''}>{plan.summary.error} row(s) with errors</span>{plan.summary.teamsToCreate.length ? ` · new teams: ${plan.summary.teamsToCreate.join(', ')}` : ''}</p>
              {plan.errors.length ? (
                <>
                  <Table><thead><tr><th>Row</th><th>Field</th><th>Problem</th></tr></thead><tbody>{plan.errors.map((e, i) => <tr key={i}><td className="tabular">{e.row}</td><td>{e.field}</td><td className="text-live">{e.message}</td></tr>)}</tbody></Table>
                  {plan.errorsCsv ? <Button size="sm" onClick={() => download('fixture-import-errors.csv', plan.errorsCsv!)}>Download error CSV</Button> : null}
                </>
              ) : null}
              {plan.rows.length ? <Table><thead><tr><th>Row</th><th>External ID</th><th>Round</th><th>Kick-off</th><th>Action</th></tr></thead><tbody>{plan.rows.map((r) => <tr key={r.row}><td className="tabular">{r.row}</td><td>{r.externalId}</td><td>{r.round}</td><td className="tabular">{r.kickoffLocal} {r.timezone}</td><td>{r.action}{r.skipReason ? <span className="block text-xs text-muted">{r.skipReason}</span> : null}</td></tr>)}</tbody></Table> : null}
            </>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

export default function MatchesPage() {
  return (
    <Suspense>
      <MatchesInner />
    </Suspense>
  );
}
