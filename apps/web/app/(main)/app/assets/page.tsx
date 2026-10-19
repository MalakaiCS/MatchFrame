'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { del, patch, post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import { AssetLibrary } from '@/components/asset-library';

interface Team { id: string; name: string; shortName: string; abbreviation: string; sport: string; primaryColor: string; secondaryColor: string; status: string; logoAssetId: string | null; clubId: string | null }
interface TeamDetail extends Team { roster: { id: string; seasonId: string; seasonName: string; number: number | null; position: string | null; status: string; player: { id: string; displayName: string } }[] }
interface Player { id: string; displayName: string; defaultNumber: number | null; position: string | null }
interface Comp { id: string; name: string; sport: string }

export default function AssetsPage() {
  const me = useMe();
  const full = isFull(me.data?.role);
  return (
    <>
      <PageHeader title="Assets" subtitle="Clubs, teams, players, venues and media files used by graphics and broadcasts." />
      <Tabs defaultValue="teams">
        <TabList className="mb-4"><Tab value="teams">Teams</Tab><Tab value="players">Players</Tab><Tab value="venues">Venues</Tab><Tab value="clubs">Clubs</Tab><Tab value="files">Images, video & audio</Tab></TabList>
        <TabPanel value="teams"><Teams full={full} /></TabPanel>
        <TabPanel value="players"><Players full={full} /></TabPanel>
        <TabPanel value="venues"><Venues full={full} /></TabPanel>
        <TabPanel value="clubs"><Clubs full={full} /></TabPanel>
        <TabPanel value="files"><AssetLibrary /></TabPanel>
      </Tabs>
    </>
  );
}

function Teams({ full }: { full: boolean }) {
  const [archived, setArchived] = useState(false);
  const teams = useGet<Team[]>(['teams', 'all', archived], `teams${archived ? '?includeArchived=true' : ''}`);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const blank = { name: '', shortName: '', abbreviation: '', sport: 'football', primaryColor: '#1F6FEB', secondaryColor: '#0B1220' };
  const [form, setForm] = useState(blank);
  const create = useAction((v: typeof form) => post('teams', v), [['teams']]);
  return (
    <>
      <div className="mb-3 flex justify-between">
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>
        {full ? <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> New team</Button> : null}
      </div>
      <ErrorNotice error={teams.error} onRetry={() => teams.refetch()} />
      {teams.isLoading ? <Spinner /> : !teams.data?.length ? <EmptyState title="No teams yet" body="Teams take part in fixtures; players join them through season rosters." /> : (
        <Table><thead><tr><th>Team</th><th>Abbr.</th><th>Sport</th><th>Colours</th><th>Status</th><th /></tr></thead><tbody>
          {teams.data.map((t) => <tr key={t.id}><td>{t.name}<span className="block text-xs text-muted">{t.shortName}</span></td><td className="font-mono">{t.abbreviation}</td><td>{t.sport}</td>
            <td><span className="inline-flex gap-1"><span className="size-4 rounded" style={{ background: t.primaryColor }} title={t.primaryColor} /><span className="size-4 rounded border border-border" style={{ background: t.secondaryColor }} title={t.secondaryColor} /></span></td>
            <td><StatusPill tone={t.status === 'active' ? 'healthy' : 'neutral'}>{t.status}</StatusPill></td>
            <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setSel(t.id)}>Roster</Button></td></tr>)}
        </tbody></Table>
      )}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); create.reset(); }} title="New team" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!form.name || form.abbreviation.length < 2} onClick={() => create.mutate({ ...form, shortName: form.shortName || form.name.slice(0, 24) }, { onSuccess: () => { setOpen(false); setForm(blank); } })}>Create</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" htmlFor="tn" className="sm:col-span-2" error={create.error?.fieldError('name')}><Input id="tn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Short name" htmlFor="ts" hint="Approved label for tight graphics"><Input id="ts" maxLength={24} value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} /></Field>
          <Field label="Abbreviation" htmlFor="ta" error={create.error?.fieldError('abbreviation')}><Input id="ta" maxLength={5} value={form.abbreviation} onChange={(e) => setForm({ ...form, abbreviation: e.target.value.toUpperCase() })} /></Field>
          <Field label="Sport" htmlFor="tsp"><NativeSelect id="tsp" value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}><option value="football">Football</option><option value="basketball">Basketball</option></NativeSelect></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Primary" htmlFor="tc1"><input id="tc1" type="color" className="h-9 w-full rounded border border-border bg-bg" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value.toUpperCase() })} /></Field>
            <Field label="Secondary" htmlFor="tc2"><input id="tc2" type="color" className="h-9 w-full rounded border border-border bg-bg" value={form.secondaryColor} onChange={(e) => setForm({ ...form, secondaryColor: e.target.value.toUpperCase() })} /></Field>
          </div>
          <div className="sm:col-span-2"><ErrorNotice error={create.error && !create.error.fields ? create.error : null} /></div>
        </div>
      </Dialog>
      {sel ? <TeamRoster id={sel} full={full} onClose={() => setSel(null)} /> : null}
    </>
  );
}

function TeamRoster({ id, full, onClose }: { id: string; full: boolean; onClose: () => void }) {
  const team = useGet<TeamDetail>(['team', id], `teams/${id}`);
  const hist = useGet<{ matches: number }>(['team-history', id], `teams/${id}/history`);
  const players = useGet<Player[]>(['players'], 'players');
  const comps = useGet<(Comp & { currentSeason: { id: string; name: string } | null })[]>(['competitions'], 'competitions');
  const [add, setAdd] = useState({ playerId: '', seasonId: '', number: '' });
  const addRoster = useAction(() => post('rosters', { playerId: add.playerId, teamId: id, seasonId: add.seasonId, number: add.number ? Number(add.number) : null }), [['team', id]]);
  const removeRoster = useAction((rid: string) => del(`rosters/${rid}`), [['team', id]]);
  const archive = useAction(() => patch(`teams/${id}`, { status: team.data?.status === 'archived' ? 'active' : 'archived' }), [['team', id], ['teams']]);
  const remove = useAction(() => del(`teams/${id}`), [['teams']]);
  const seasons = (comps.data ?? []).filter((c) => c.sport === team.data?.sport && c.currentSeason).map((c) => ({ id: c.currentSeason!.id, label: `${c.name} · ${c.currentSeason!.name}` }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={team.data?.name ?? 'Team'} description={hist.data ? `${hist.data.matches} fixture(s) reference this team.` : undefined}
      footer={full ? <>
        <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate(undefined)}>{team.data?.status === 'archived' ? 'Restore team' : 'Archive team'}</Button>
        <Button variant="danger" disabled={(hist.data?.matches ?? 0) > 0} title={(hist.data?.matches ?? 0) > 0 ? 'Teams with match history can only be archived' : undefined} loading={remove.isPending} onClick={() => { if (confirm(`Delete team "${team.data?.name}" permanently?`)) remove.mutate(undefined, { onSuccess: onClose }); }}>Delete {team.data?.name}</Button>
      </> : null}>
      {team.isLoading ? <Spinner /> : (
        <>
          <Table><thead><tr><th>#</th><th>Player</th><th>Season</th><th>Status</th><th /></tr></thead><tbody>
            {team.data!.roster.map((r) => <tr key={r.id}><td className="tabular">{r.number ?? '—'}</td><td>{r.player.displayName}</td><td className="text-muted">{r.seasonName}</td><td><StatusPill tone={r.status === 'active' ? 'healthy' : 'neutral'}>{r.status}</StatusPill></td><td>{full && r.status === 'active' ? <button className="text-xs text-muted hover:text-live" onClick={() => removeRoster.mutate(r.id)}>End membership</button> : null}</td></tr>)}
            {!team.data!.roster.length ? <tr><td colSpan={5} className="text-center text-muted">No roster entries</td></tr> : null}
          </tbody></Table>
          {full ? (
            <Card className="mt-3 grid gap-2 p-3 sm:grid-cols-[1fr_1fr_5rem_auto] sm:items-end">
              <Field label="Player" htmlFor="rp"><NativeSelect id="rp" value={add.playerId} onChange={(e) => setAdd({ ...add, playerId: e.target.value })}><option value="">Choose…</option>{players.data?.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</NativeSelect></Field>
              <Field label="Season" htmlFor="rs"><NativeSelect id="rs" value={add.seasonId} onChange={(e) => setAdd({ ...add, seasonId: e.target.value })}><option value="">Choose…</option>{seasons.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</NativeSelect></Field>
              <Field label="Number" htmlFor="rn"><Input id="rn" inputMode="numeric" value={add.number} onChange={(e) => setAdd({ ...add, number: e.target.value.replace(/\D/g, '') })} /></Field>
              <Button variant="primary" disabled={!add.playerId || !add.seasonId} loading={addRoster.isPending} onClick={() => addRoster.mutate(undefined)}>Add</Button>
            </Card>
          ) : null}
          <ErrorNotice error={addRoster.error ?? remove.error ?? archive.error} />
        </>
      )}
    </Dialog>
  );
}

function Players({ full }: { full: boolean }) {
  const [search, setSearch] = useState('');
  const players = useGet<Player[]>(['players', search], `players${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  const [form, setForm] = useState({ displayName: '', shortName: '', defaultNumber: '', position: '' });
  const create = useAction(() => post('players', { displayName: form.displayName, shortName: form.shortName || null, defaultNumber: form.defaultNumber ? Number(form.defaultNumber) : null, position: form.position || null }), [['players']]);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Input className="max-w-xs" placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search players" />
        {full ? (
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <Field label="Display name" htmlFor="pd"><Input id="pd" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
            <Field label="Short" htmlFor="ps"><Input id="ps" className="w-28" value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} /></Field>
            <Field label="No." htmlFor="pn"><Input id="pn" className="w-16" value={form.defaultNumber} onChange={(e) => setForm({ ...form, defaultNumber: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Position" htmlFor="pp"><Input id="pp" className="w-28" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></Field>
            <Button variant="primary" disabled={!form.displayName.trim()} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => setForm({ displayName: '', shortName: '', defaultNumber: '', position: '' }) })}>Add player</Button>
          </div>
        ) : null}
      </div>
      <ErrorNotice error={create.error ?? players.error} />
      {players.isLoading ? <Spinner /> : <Table><thead><tr><th>Name</th><th>No.</th><th>Position</th></tr></thead><tbody>{players.data?.map((p) => <tr key={p.id}><td>{p.displayName}</td><td className="tabular">{p.defaultNumber ?? '—'}</td><td>{p.position ?? '—'}</td></tr>)}</tbody></Table>}
      <p className="mt-2 text-xs text-muted">Dates of birth are private and never shown in graphics.</p>
    </>
  );
}

function Venues({ full }: { full: boolean }) {
  const venues = useGet<{ id: string; name: string; address: string | null; timezone: string }[]>(['venues'], 'venues');
  const [form, setForm] = useState({ name: '', address: '', timezone: 'Australia/Brisbane' });
  const create = useAction(() => post('venues', { ...form, address: form.address || null }), [['venues']]);
  return (
    <>
      {full ? (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="Venue name" htmlFor="vn"><Input id="vn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Address" htmlFor="va"><Input id="va" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="Timezone" htmlFor="vt" error={create.error?.fieldError('timezone')}><Input id="vt" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
          <Button variant="primary" disabled={!form.name.trim()} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => setForm({ ...form, name: '', address: '' }) })}>Add venue</Button>
        </div>
      ) : null}
      <ErrorNotice error={create.error && !create.error.fields ? create.error : venues.error} />
      <Table><thead><tr><th>Venue</th><th>Address</th><th>Timezone</th></tr></thead><tbody>{venues.data?.map((v) => <tr key={v.id}><td>{v.name}</td><td className="text-muted">{v.address ?? '—'}</td><td>{v.timezone}</td></tr>)}</tbody></Table>
    </>
  );
}

function Clubs({ full }: { full: boolean }) {
  const clubs = useGet<{ id: string; name: string; shortName: string | null }[]>(['clubs'], 'clubs');
  const [name, setName] = useState('');
  const create = useAction(() => post('clubs', { name }), [['clubs']]);
  return (
    <>
      {full ? <div className="mb-3 flex items-end gap-2"><Field label="Club name" htmlFor="cl"><Input id="cl" value={name} onChange={(e) => setName(e.target.value)} /></Field><Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => setName('') })}>Add club</Button></div> : null}
      <ErrorNotice error={create.error} />
      <Table><thead><tr><th>Club</th></tr></thead><tbody>{clubs.data?.map((c) => <tr key={c.id}><td>{c.name}</td></tr>)}{!clubs.data?.length ? <tr><td className="text-muted">No clubs. Clubs group several teams (e.g. seniors and juniors).</td></tr> : null}</tbody></Table>
    </>
  );
}
