'use client';
// Season tools on the competition page: roll a season over, create a whole round at once, and set the table
// rules (points for a win, how ties are broken).
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, Switch } from '@bs/ui';
import { patch, post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';

interface Season { id: string; name: string; status: string }

export function RolloverDialog({ competitionId, season, onClose }: { competitionId: string; season: Season; onClose: () => void }) {
  const guess = /\d{4}/.test(season.name) ? season.name.replace(/\d{4}/, (y) => String(Number(y) + 1)) : `${season.name} (next)`;
  const [f, setF] = useState({ name: guess, startsOn: '', endsOn: '', carryRosters: true, archivePrevious: true });
  const run = useAction(() => post<{ season: { id: string }; carriedRosterRows: number }>(`seasons/${season.id}/rollover`, { name: f.name.trim(), startsOn: f.startsOn || null, endsOn: f.endsOn || null, carryRosters: f.carryRosters, archivePrevious: f.archivePrevious }), [['competition', competitionId], ['competitions']], { success: (r) => `New season created${r.carriedRosterRows ? ` with ${r.carriedRosterRows} roster entries carried over` : ''}` });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Roll ${season.name} over`} description="Creates the next season in this competition. Nothing about the finished season changes: its results, tables and graphics stay as they were."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={run.isPending} disabled={!f.name.trim()} onClick={() => run.mutate(undefined, { onSuccess: onClose })}>Create next season</Button></>}>
      <div className="grid gap-3">
        <Field label="New season name" htmlFor="ro-n" error={run.error?.fieldError('name')}><Input id="ro-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" htmlFor="ro-s"><Input id="ro-s" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field>
          <Field label="Ends" htmlFor="ro-e"><Input id="ro-e" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
        </div>
        <Switch label="Carry every team's roster into the new season" checked={f.carryRosters} onCheckedChange={(v) => setF({ ...f, carryRosters: v })} />
        <Switch label={`Archive ${season.name} (it stays viewable; no new fixtures)`} checked={f.archivePrevious} onCheckedChange={(v) => setF({ ...f, archivePrevious: v })} />
        <ErrorNotice error={run.error && !run.error.fields ? run.error : null} />
      </div>
    </Dialog>
  );
}

interface Row { homeTeamId: string; awayTeamId: string; kickoffLocal: string; venueId: string }
export function BulkRoundDialog({ competitionId, sport, seasons, timezone, onClose }: { competitionId: string; sport: string; seasons: Season[]; timezone: string; onClose: () => void }) {
  const teams = useGet<{ id: string; name: string }[]>(['teams', sport], `teams?sport=${sport}`);
  const venues = useGet<{ id: string; name: string }[]>(['venues'], 'venues');
  const recent = useGet<{ items: { id: string; home: { name: string } | null; away: { name: string } | null; round: string | null }[] }>(['matches', 'copy-from', competitionId], `matches?competitionId=${competitionId}&pageSize=20&sort=-scheduledAt`);
  const [seasonId, setSeasonId] = useState(seasons.find((s) => s.status === 'active')?.id ?? seasons[0]?.id ?? '');
  const [round, setRound] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<Row[]>([{ homeTeamId: '', awayTeamId: '', kickoffLocal: '', venueId: '' }]);
  useEffect(() => {
    // a default date fills every empty kick-off, so a round of five games needs one date and five times
    if (date) setRows((rs) => rs.map((r) => (r.kickoffLocal ? r : { ...r, kickoffLocal: `${date}T15:00` })));
  }, [date]);
  const valid = rows.filter((r) => r.homeTeamId && r.awayTeamId && r.homeTeamId !== r.awayTeamId && r.kickoffLocal);
  const create = useAction(() => post<{ created: unknown[] }>('matches/bulk', { competitionId, seasonId, round: round.trim() || null, timezone, copySetupFromMatchId: copyFrom || null, fixtures: valid.map((r) => ({ homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId, kickoffLocal: r.kickoffLocal.replace('T', ' '), venueId: r.venueId || null })) }), [['matches'], ['competition', competitionId], ['fixtures']], { success: (r) => `${r.created.length} fixtures created, each with its OBS link ready` });
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="Create a round" description="Several fixtures at once. Each gets its graphics output straight away, and can copy the look and automation from an earlier match."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!seasonId || !valid.length} onClick={() => create.mutate(undefined, { onSuccess: onClose })}>Create {valid.length || ''} fixture{valid.length === 1 ? '' : 's'}</Button></>}>
      <div className="grid gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Season" htmlFor="br-s"><NativeSelect id="br-s" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
          <Field label="Round" htmlFor="br-r"><Input id="br-r" value={round} onChange={(e) => setRound(e.target.value)} placeholder="Round 7" /></Field>
          <Field label="Date for every game" htmlFor="br-d" hint="Adjust times per game below"><Input id="br-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Copy setup from" htmlFor="br-c" hint="Look, automation and output format"><NativeSelect id="br-c" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}><option value="">Competition defaults</option>{recent.data?.items.map((m) => <option key={m.id} value={m.id}>{m.home?.name} v {m.away?.name}{m.round ? ` (${m.round})` : ''}</option>)}</NativeSelect></Field>
        </div>
        <div className="grid gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_11rem_1fr_auto]">
              <NativeSelect aria-label={`Home team ${i + 1}`} value={r.homeTeamId} onChange={(e) => set(i, { homeTeamId: e.target.value })}><option value="">Home team…</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
              <NativeSelect aria-label={`Away team ${i + 1}`} value={r.awayTeamId} onChange={(e) => set(i, { awayTeamId: e.target.value })}><option value="">Away team…</option>{teams.data?.filter((t) => t.id !== r.homeTeamId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
              <Input aria-label={`Kick-off ${i + 1}`} type="datetime-local" value={r.kickoffLocal} onChange={(e) => set(i, { kickoffLocal: e.target.value })} />
              <NativeSelect aria-label={`Venue ${i + 1}`} value={r.venueId} onChange={(e) => set(i, { venueId: e.target.value })}><option value="">No venue</option>{venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</NativeSelect>
              <Button variant="ghost" size="md" aria-label={`Remove fixture ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setRows([...rows, { homeTeamId: '', awayTeamId: '', kickoffLocal: date ? `${date}T15:00` : '', venueId: '' }])}><Plus className="size-4" /> Add a fixture</Button>
        </div>
        <p className="text-xs text-muted">Times are in {timezone}. A team cannot play itself; rows missing a team or a time are ignored.</p>
        <ErrorNotice error={create.error} />
      </div>
    </Dialog>
  );
}

interface Rules { win?: number; draw?: number; loss?: number; bye?: number; rankBy?: 'points' | 'win_pct'; order?: string[]; unit?: 'goals' | 'points' }
const ORDER_LABELS: Record<string, string> = { points: 'Points', win_pct: 'Win percentage', difference: 'Goal / point difference', for: 'Scored', percentage: 'Percentage (for ÷ against)', wins: 'Wins', head_to_head: 'Head to head', name: 'Team name' };
const DEFAULTS: Record<string, Required<Rules>> = {
  football: { win: 3, draw: 1, loss: 0, bye: 0, rankBy: 'points', order: ['points', 'difference', 'for', 'name'], unit: 'goals' },
  hockey: { win: 3, draw: 1, loss: 0, bye: 0, rankBy: 'points', order: ['points', 'difference', 'for', 'name'], unit: 'goals' },
  basketball: { win: 2, draw: 1, loss: 0, bye: 0, rankBy: 'win_pct', order: ['win_pct', 'head_to_head', 'difference', 'name'], unit: 'points' },
  netball: { win: 4, draw: 2, loss: 0, bye: 4, rankBy: 'points', order: ['points', 'percentage', 'for', 'name'], unit: 'goals' },
  rugby_league: { win: 2, draw: 1, loss: 0, bye: 2, rankBy: 'points', order: ['points', 'difference', 'for', 'name'], unit: 'points' },
  afl: { win: 4, draw: 2, loss: 0, bye: 4, rankBy: 'points', order: ['points', 'percentage', 'for', 'name'], unit: 'points' },
};

export function StandingsRulesCard({ competitionId, sport, rules, canEdit }: { competitionId: string; sport: string; rules: Rules | null | undefined; canEdit: boolean }) {
  const base = DEFAULTS[sport] ?? DEFAULTS.football!;
  const [r, setR] = useState<Required<Rules>>({ ...base, ...(rules ?? {}) } as Required<Rules>);
  useEffect(() => setR({ ...base, ...(rules ?? {}) } as Required<Rules>), [rules, base]);
  const save = useAction(() => patch(`competitions/${competitionId}`, { standingsRules: r }), [['competition', competitionId], ['standings']], { success: 'Table rules saved. Tables and the table graphic use them straight away.' });
  const num = (k: 'win' | 'draw' | 'loss' | 'bye') => <Field key={k} label={k === 'bye' ? 'Bye' : `${k[0]!.toUpperCase()}${k.slice(1)}`} htmlFor={`sr-${k}`}><Input id={`sr-${k}`} type="number" min={0} max={10} disabled={!canEdit} value={r[k]} onChange={(e) => setR({ ...r, [k]: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} /></Field>;
  const tiebreakers = Object.keys(ORDER_LABELS);
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-medium">Table rules</h2>
      <p className="mb-3 text-xs text-muted">Points per result and how ties are broken. Defaults follow the sport; change them for a competition that does things its own way.</p>
      <div className="grid grid-cols-4 gap-2">{(['win', 'draw', 'loss', 'bye'] as const).map(num)}</div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Rank teams by" htmlFor="sr-rank"><NativeSelect id="sr-rank" disabled={!canEdit} value={r.rankBy} onChange={(e) => setR({ ...r, rankBy: e.target.value as 'points' | 'win_pct', order: [e.target.value, ...r.order.filter((o) => o !== 'points' && o !== 'win_pct')] })}><option value="points">Points</option><option value="win_pct">Win percentage</option></NativeSelect></Field>
        <Field label="Scoring unit" htmlFor="sr-unit"><NativeSelect id="sr-unit" disabled={!canEdit} value={r.unit} onChange={(e) => setR({ ...r, unit: e.target.value as 'goals' | 'points' })}><option value="goals">Goals</option><option value="points">Points</option></NativeSelect></Field>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1 text-xs font-medium text-muted">Then separate teams by</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <NativeSelect key={n} aria-label={`Tiebreaker ${n}`} disabled={!canEdit} value={r.order[n] ?? ''} onChange={(e) => { const next = [...r.order]; next[n] = e.target.value; setR({ ...r, order: next.filter(Boolean) }); }}>
              <option value="">—</option>
              {tiebreakers.filter((t) => t !== r.rankBy).map((t) => <option key={t} value={t}>{ORDER_LABELS[t]}</option>)}
            </NativeSelect>
          ))}
        </div>
      </fieldset>
      {canEdit ? <Button className="mt-3" size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save table rules</Button> : null}
      <ErrorNotice error={save.error} />
    </Card>
  );
}
