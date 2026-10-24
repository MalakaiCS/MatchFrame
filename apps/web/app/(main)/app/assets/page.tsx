'use client';
import { SportOptions } from '@/components/sport-options';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { del, patch, post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import { AssetLibrary } from '@/components/asset-library';
import { ImageField, LogoField } from '@/components/logo-field';
import { CrestColours, useCrestPalette } from '@/components/crest-colours';

/** a small logo or photo in a table row */
function Thumb({ id, alt, tall }: { id: string | null; alt: string; tall?: boolean }) {
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded border border-border bg-[repeating-conic-gradient(#1c2c43_0_25%,#131f32_0_50%)] bg-[length:8px_8px] ${tall ? 'h-10 w-8' : 'size-9'}`}>
      {id ? <img src={`/api/v1/assets/${id}/preview`} alt={alt} className="max-h-full max-w-full object-contain" loading="lazy" /> : <span className="text-[9px] text-muted">—</span>}
    </span>
  );
}

interface Team { id: string; name: string; shortName: string; abbreviation: string; sport: string; primaryColor: string; secondaryColor: string; status: string; logoAssetId: string | null; clubId: string | null }
interface TeamDetail extends Team { roster: { id: string; seasonId: string; seasonName: string; number: number | null; position: string | null; status: string; player: { id: string; displayName: string } }[] }
interface Player { id: string; displayName: string; shortName?: string | null; defaultNumber: number | null; position: string | null; photoAssetId?: string | null }
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
  const blank = { name: '', shortName: '', abbreviation: '', sport: 'football', primaryColor: '#1F6FEB', secondaryColor: '#0B1220', logoAssetId: null as string | null };
  const [form, setForm] = useState(blank);
  const create = useAction((v: typeof form) => post('teams', v), [['teams']], { success: 'Team added' });
  // a new team's colours follow its crest until someone picks colours by hand
  const [coloursSet, setColoursSet] = useState(false);
  const crest = useCrestPalette(form.logoAssetId);
  useEffect(() => {
    if (crest && !coloursSet) setForm((f) => ({ ...f, primaryColor: crest.primary, secondaryColor: crest.secondary }));
  }, [crest, coloursSet]);
  return (
    <>
      <div className="mb-3 flex justify-between">
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>
        {full ? <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> New team</Button> : null}
      </div>
      <ErrorNotice error={teams.error} onRetry={() => teams.refetch()} />
      {teams.isLoading ? <Spinner /> : !teams.data?.length ? <EmptyState title="No teams yet" body="Teams take part in fixtures; players join them through season rosters." /> : (
        <Table><thead><tr><th>Team</th><th>Abbr.</th><th>Sport</th><th>Colours</th><th>Status</th><th /></tr></thead><tbody>
          {teams.data.map((t) => <tr key={t.id}><td><span className="flex items-center gap-2"><Thumb id={t.logoAssetId} alt={`${t.name} logo`} /><span>{t.name}<span className="block text-xs text-muted">{t.shortName}</span></span></span></td><td className="font-mono">{t.abbreviation}</td><td>{t.sport}</td>
            <td><span className="inline-flex gap-1"><span className="size-4 rounded" style={{ background: t.primaryColor }} title={t.primaryColor} /><span className="size-4 rounded border border-border" style={{ background: t.secondaryColor }} title={t.secondaryColor} /></span></td>
            <td><StatusPill tone={t.status === 'active' ? 'healthy' : 'neutral'}>{t.status}</StatusPill></td>
            <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setSel(t.id)}>{full ? 'Logo, colours & roster' : 'Roster'}</Button></td></tr>)}
        </tbody></Table>
      )}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); create.reset(); }} title="New team" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!form.name || form.abbreviation.length < 2} onClick={() => create.mutate({ ...form, shortName: form.shortName || form.name.slice(0, 24) }, { onSuccess: () => { setOpen(false); setForm(blank); setColoursSet(false); } })}>Create</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Full name" htmlFor="tn" className="sm:col-span-2" error={create.error?.fieldError('name')}><Input id="tn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Short name" htmlFor="ts" hint="Approved label for tight graphics"><Input id="ts" maxLength={24} value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} /></Field>
          <Field label="Abbreviation" htmlFor="ta" error={create.error?.fieldError('abbreviation')}><Input id="ta" maxLength={5} value={form.abbreviation} onChange={(e) => setForm({ ...form, abbreviation: e.target.value.toUpperCase() })} /></Field>
          <Field label="Sport" htmlFor="tsp"><NativeSelect id="tsp" value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}><SportOptions /></NativeSelect></Field>
          <div className="sm:col-span-2"><LogoField label="Team logo" value={form.logoAssetId} onChange={(v) => setForm((f) => ({ ...f, logoAssetId: v }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Primary" htmlFor="tc1"><input id="tc1" type="color" className="h-9 w-full rounded border border-border bg-bg" value={form.primaryColor.toLowerCase()} onChange={(e) => { setColoursSet(true); setForm({ ...form, primaryColor: e.target.value.toUpperCase() }); }} /></Field>
            <Field label="Secondary" htmlFor="tc2"><input id="tc2" type="color" className="h-9 w-full rounded border border-border bg-bg" value={form.secondaryColor.toLowerCase()} onChange={(e) => { setColoursSet(true); setForm({ ...form, secondaryColor: e.target.value.toUpperCase() }); }} /></Field>
          </div>
          <div className="sm:col-span-2"><CrestColours palette={crest} primary={form.primaryColor} secondary={form.secondaryColor} onPick={(c) => { setColoursSet(true); setForm((f) => ({ ...f, ...c })); }} /></div>
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
  const addRoster = useAction(() => post('rosters', { playerId: add.playerId, teamId: id, seasonId: add.seasonId, number: add.number ? Number(add.number) : null }), [['team', id]], { success: 'Added to the roster' });
  const removeRoster = useAction((rid: string) => del(`rosters/${rid}`), [['team', id]], { success: 'Removed from the roster' });
  const archive = useAction(() => patch(`teams/${id}`, { status: team.data?.status === 'archived' ? 'active' : 'archived' }), [['team', id], ['teams']]);
  const remove = useAction(() => del(`teams/${id}`), [['teams']]);
  const seasons = (comps.data ?? []).filter((c) => c.sport === team.data?.sport && c.currentSeason).map((c) => ({ id: c.currentSeason!.id, label: `${c.name} · ${c.currentSeason!.name}` }));
  const brand = useAction((v: Partial<Pick<Team, 'logoAssetId' | 'primaryColor' | 'secondaryColor'>>) => patch(`teams/${id}`, v), [['team', id], ['teams']], { success: (_r, v) => ('logoAssetId' in v ? (v.logoAssetId ? 'Logo saved. Upcoming matches show it on their graphics.' : 'Logo removed') : 'Colours saved') });
  const crest = useCrestPalette(team.data?.logoAssetId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={team.data?.name ?? 'Team'} description={hist.data ? `${hist.data.matches} fixture(s) reference this team.` : undefined}
      footer={full ? <>
        <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate(undefined)}>{team.data?.status === 'archived' ? 'Restore team' : 'Archive team'}</Button>
        <Button variant="danger" disabled={(hist.data?.matches ?? 0) > 0} title={(hist.data?.matches ?? 0) > 0 ? 'Teams with match history can only be archived' : undefined} loading={remove.isPending} onClick={() => { if (confirm(`Delete team "${team.data?.name}" permanently?`)) remove.mutate(undefined, { onSuccess: onClose }); }}>Delete {team.data?.name}</Button>
      </> : null}>
      {team.isLoading ? <Spinner /> : (
        <>
          <section aria-label="Logo and colours" className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <LogoField label="Team logo" value={team.data!.logoAssetId} disabled={!full} onChange={(v) => brand.mutateAsync({ logoAssetId: v })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Primary" htmlFor="tb1"><input key={team.data!.primaryColor} id="tb1" type="color" disabled={!full} className="h-9 w-20 rounded border border-border bg-bg" defaultValue={team.data!.primaryColor.toLowerCase()} onBlur={(e) => e.target.value.toUpperCase() !== team.data!.primaryColor && brand.mutate({ primaryColor: e.target.value.toUpperCase() })} /></Field>
              <Field label="Secondary" htmlFor="tb2"><input key={team.data!.secondaryColor} id="tb2" type="color" disabled={!full} className="h-9 w-20 rounded border border-border bg-bg" defaultValue={team.data!.secondaryColor.toLowerCase()} onBlur={(e) => e.target.value.toUpperCase() !== team.data!.secondaryColor && brand.mutate({ secondaryColor: e.target.value.toUpperCase() })} /></Field>
            </div>
            {full ? <div className="sm:col-span-2"><CrestColours palette={crest} primary={team.data!.primaryColor} secondary={team.data!.secondaryColor} disabled={brand.isPending} onPick={(c) => brand.mutate(c)} /></div> : null}
            <div className="sm:col-span-2"><ErrorNotice error={brand.error} /></div>
          </section>
          <h3 className="mb-1 text-sm font-medium">Roster</h3>
          <Table><thead><tr><th>#</th><th>Player</th><th>Season</th><th>Status</th><th /></tr></thead><tbody>
            {team.data!.roster.map((r) => <tr key={r.id}><td className="tabular">{r.number ?? '—'}</td><td>{r.player.displayName}</td><td className="text-muted">{r.seasonName}</td><td><StatusPill tone={r.status === 'active' ? 'healthy' : 'neutral'}>{r.status}</StatusPill></td><td>{full && r.status === 'active' ? <button className="text-xs text-muted hover:text-live" onClick={() => removeRoster.mutate(r.id)}>End membership</button> : null}</td></tr>)}
            {!team.data!.roster.length ? <tr><td colSpan={5} className="text-center text-muted">No roster entries</td></tr> : null}
          </tbody></Table>
          {full ? (
            <Card className="mt-3 grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_1fr_5rem_auto] sm:items-end">
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
  const [edit, setEdit] = useState<Player | null>(null);
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
      {players.isLoading ? <Spinner /> : <Table><thead><tr><th>Name</th><th>No.</th><th>Position</th>{full ? <th /> : null}</tr></thead><tbody>{players.data?.map((p) => <tr key={p.id}><td><span className="flex items-center gap-2"><Thumb tall id={p.photoAssetId ?? null} alt={`${p.displayName} photo`} />{p.displayName}</span></td><td className="tabular">{p.defaultNumber ?? '—'}</td><td>{p.position ?? '—'}</td>{full ? <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Photo & details</Button></td> : null}</tr>)}</tbody></Table>}
      {edit ? <PlayerEdit player={edit} onClose={() => setEdit(null)} /> : null}
      <p className="mt-2 text-xs text-muted">Dates of birth are private and never shown in graphics.</p>
    </>
  );
}

function PlayerEdit({ player, onClose }: { player: Player; onClose: () => void }) {
  const [f, setF] = useState({ displayName: player.displayName, shortName: player.shortName ?? '', defaultNumber: player.defaultNumber == null ? '' : String(player.defaultNumber), position: player.position ?? '' });
  const photo = useAction((photoAssetId: string | null) => patch(`players/${player.id}`, { photoAssetId }), [['players']], { success: (_r, v) => (v ? 'Photo saved. Player graphics of upcoming matches show it.' : 'Photo removed') });
  const save = useAction(() => patch(`players/${player.id}`, { displayName: f.displayName, shortName: f.shortName || null, defaultNumber: f.defaultNumber ? Number(f.defaultNumber) : null, position: f.position || null }), [['players']], { success: 'Player saved' });
  const [photoId, setPhotoId] = useState(player.photoAssetId ?? null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={player.displayName} description="The photo is used by player cards, line-ups and the player of the match."
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={save.isPending} disabled={!f.displayName.trim()} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Save details</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><ImageField kind="image" label="Photo" value={photoId} onChange={async (v) => { await photo.mutateAsync(v); setPhotoId(v); }} /></div>
        <Field label="Display name" htmlFor="pe-n"><Input id="pe-n" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <Field label="Short name" htmlFor="pe-s"><Input id="pe-s" value={f.shortName} onChange={(e) => setF({ ...f, shortName: e.target.value })} /></Field>
        <Field label="Number" htmlFor="pe-no"><Input id="pe-no" inputMode="numeric" value={f.defaultNumber} onChange={(e) => setF({ ...f, defaultNumber: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Position" htmlFor="pe-p"><Input id="pe-p" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></Field>
        <div className="sm:col-span-2"><ErrorNotice error={save.error ?? photo.error} /></div>
      </div>
    </Dialog>
  );
}

function Venues({ full }: { full: boolean }) {
  const venues = useGet<{ id: string; name: string; address: string | null; timezone: string }[]>(['venues'], 'venues');
  const [form, setForm] = useState({ name: '', address: '', timezone: 'Australia/Brisbane' });
  const create = useAction(() => post('venues', { ...form, address: form.address || null }), [['venues']], { success: 'Venue added' });
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
  const clubs = useGet<{ id: string; name: string; shortName: string | null; logoAssetId: string | null }[]>(['clubs'], 'clubs');
  const [name, setName] = useState('');
  const create = useAction(() => post('clubs', { name }), [['clubs']], { success: 'Club added' });
  const setLogo = useAction((v: { id: string; logoAssetId: string | null }) => patch(`clubs/${v.id}`, { logoAssetId: v.logoAssetId }), [['clubs']], { success: (_r, v) => (v.logoAssetId ? 'Club logo saved' : 'Club logo removed') });
  return (
    <>
      {full ? <div className="mb-3 flex items-end gap-2"><Field label="Club name" htmlFor="cl"><Input id="cl" value={name} onChange={(e) => setName(e.target.value)} /></Field><Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => setName('') })}>Add club</Button></div> : null}
      <ErrorNotice error={create.error ?? setLogo.error} />
      <Table><thead><tr><th>Club</th><th>Logo</th></tr></thead><tbody>{clubs.data?.map((c) => <tr key={c.id}><td>{c.name}</td><td><LogoField label={`${c.name} logo`} value={c.logoAssetId} disabled={!full} onChange={(v) => setLogo.mutateAsync({ id: c.id, logoAssetId: v })} /></td></tr>)}{!clubs.data?.length ? <tr><td colSpan={2} className="text-muted">No clubs. Clubs group several teams (e.g. seniors and juniors).</td></tr> : null}</tbody></Table>
    </>
  );
}
