'use client';
// The line-up editor shared by the match page (desktop) and the scorer's phone. Starters and bench come from the
// season roster; "use last line-up" and "use team default" fill a side in one tap and are always reviewable
// before saving. Saving snapshots player identity for the match (later roster changes never alter its history).
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorNotice, Input, Spinner, StatusPill, Tab, TabList, TabPanel, Tabs, cx, toast } from '@bs/ui';
import { ApiError, get, patch, put } from '@/lib/api';
import { useGet } from '@/lib/hooks';

type Side = 'home' | 'away';
interface RosterPlayer { playerId: string; displayName: string; shortName?: string | null; number: number | null; position: string | null; photoAssetId?: string | null }
export interface LineupEntry { playerId: string; displayName: string; number: number | null; position?: string | null; starter: boolean; captain?: boolean }
interface MatchForLineup {
  id: string;
  sport: string;
  status: string;
  lineupLocked: boolean;
  homeTeamId: string;
  awayTeamId: string;
  teams: Record<Side, { name: string; abbreviation: string; primaryColor: string }>;
  lineup: { home: LineupEntry[]; away: LineupEntry[]; formations?: { home?: string | null; away?: string | null } };
}
interface Suggestion { players: { playerId: string; number: number | null; position: string | null; starter: boolean; captain?: boolean }[]; formation: string | null; reason: string | null; from: { matchId: string; scheduledAt: string } | null }

/** Usual number of players on the field per code; used only to flag an unusual line-up, never to block one. */
export const STARTERS: Record<string, number> = { football: 11, basketball: 5, netball: 7, rugby_league: 13, afl: 18, hockey: 11, futsal: 5 };
type Status = 'starter' | 'bench' | 'out';

const strip = (ps: LineupEntry[]) => ps.map(({ playerId, number, starter, captain, position }) => ({ playerId, number, starter, captain: !!captain, position: position ?? null }));

export function LineupEditor({ matchId, canEdit, canSaveDefault = false, compact = false, onSaved }: { matchId: string; canEdit: boolean; canSaveDefault?: boolean; compact?: boolean; onSaved?: () => void }) {
  const qc = useQueryClient();
  const m = useGet<MatchForLineup>(['match', matchId], `matches/${matchId}`);
  const roster = useGet<Record<Side, RosterPlayer[]>>(['roster', matchId], `matches/${matchId}/roster`);
  const [lu, setLu] = useState<{ home: LineupEntry[]; away: LineupEntry[] } | null>(null);
  const [formations, setFormations] = useState<Record<Side, string>>({ home: '', away: '' });
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Side>('home');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!m.data || dirty) return;
    setLu({ home: m.data.lineup.home, away: m.data.lineup.away });
    setFormations({ home: m.data.lineup.formations?.home ?? '', away: m.data.lineup.formations?.away ?? '' });
  }, [m.data, dirty]);

  if (m.isLoading || roster.isLoading || !lu) return <Spinner />;
  if (m.error) return <ErrorNotice error={m.error} onRetry={() => m.refetch()} />;
  const d = m.data!;
  // the service refuses changes once a locked match has started; before then a locked line-up can still be fixed
  const locked = d.lineupLocked && d.status !== 'scheduled';
  const editable = canEdit && !locked && !busy;
  const expected = STARTERS[d.sport];

  const statusOf = (side: Side, id: string): Status => {
    const e = lu[side].find((p) => p.playerId === id);
    return !e ? 'out' : e.starter ? 'starter' : 'bench';
  };
  const setStatus = (side: Side, p: RosterPlayer | LineupEntry, st: Status) => {
    setDirty(true);
    setLu((cur) => {
      const list = (cur ?? lu)[side].filter((x) => x.playerId !== p.playerId);
      if (st === 'out') return { ...(cur ?? lu), [side]: list };
      const prev = (cur ?? lu)[side].find((x) => x.playerId === p.playerId);
      return { ...(cur ?? lu), [side]: [...list, { playerId: p.playerId, displayName: p.displayName, number: prev?.number ?? p.number ?? null, position: prev?.position ?? p.position ?? null, starter: st === 'starter', captain: st === 'starter' ? prev?.captain ?? false : false }] };
    });
  };
  const toggleCaptain = (side: Side, id: string) => {
    setDirty(true);
    setLu((cur) => ({ ...(cur ?? lu), [side]: (cur ?? lu)[side].map((p) => (p.playerId === id ? { ...p, captain: !p.captain } : { ...p, captain: false })) }));
  };
  const setNumber = (side: Side, id: string, n: string) => {
    setDirty(true);
    setLu((cur) => ({ ...(cur ?? lu), [side]: (cur ?? lu)[side].map((p) => (p.playerId === id ? { ...p, number: n === '' ? null : Number(n) } : p)) }));
  };

  const suggest = async (side: Side, source: 'last' | 'default') => {
    setBusy(`${side}:${source}`);
    setErr(null);
    try {
      const r = await get<Suggestion>(`matches/${matchId}/lineup/suggest?side=${side}&source=${source}`);
      if (!r.players.length) {
        toast(r.reason ?? 'Nothing to copy for this team', 'info');
        return;
      }
      const ros = roster.data?.[side] ?? [];
      const next: LineupEntry[] = r.players.flatMap((p) => {
        const rp = ros.find((x) => x.playerId === p.playerId);
        return rp ? [{ playerId: rp.playerId, displayName: rp.displayName, number: p.number ?? rp.number, position: p.position ?? rp.position, starter: p.starter, captain: p.captain ?? false }] : [];
      });
      const skipped = r.players.length - next.length;
      setLu((cur) => ({ ...(cur ?? lu), [side]: next }));
      if (r.formation) setFormations((f) => ({ ...f, [side]: r.formation ?? '' }));
      setDirty(true);
      toast(`${next.length} players filled in${skipped ? `; ${skipped} no longer on the roster were left out` : ''}. Review, then save.`);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const save = async (lock: boolean) => {
    setBusy(lock ? 'lock' : 'save');
    setErr(null);
    try {
      const r = await put<{ lockedAt: string | null }>(`matches/${matchId}/lineup`, { home: strip(lu.home), away: strip(lu.away), formations: { home: formations.home || null, away: formations.away || null }, lock });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['match', matchId] });
      toast(r.lockedAt ? 'Line-up saved and locked' : 'Line-up saved');
      onSaved?.();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const saveDefault = async (side: Side) => {
    const teamId = side === 'home' ? d.homeTeamId : d.awayTeamId;
    setBusy(`${side}:default-save`);
    setErr(null);
    try {
      await patch(`teams/${teamId}`, { defaultLineup: { players: strip(lu[side]), formation: formations[side] || null } });
      toast(`Saved as the default line-up for ${d.teams[side].name}`);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const panel = (side: Side) => {
    const ros = roster.data?.[side] ?? [];
    const extras = lu[side].filter((e) => !ros.some((r) => r.playerId === e.playerId));
    const rows: (RosterPlayer | LineupEntry)[] = [...ros, ...extras];
    const starters = lu[side].filter((p) => p.starter).length;
    const bench = lu[side].length - starters;
    return (
      <div>
        {canEdit ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!editable} loading={busy === `${side}:last`} onClick={() => suggest(side, 'last')}>Use last line-up</Button>
            <Button size="sm" disabled={!editable} loading={busy === `${side}:default`} onClick={() => suggest(side, 'default')}>Use team default</Button>
            {canSaveDefault ? <Button size="sm" variant="ghost" disabled={!!busy || !lu[side].length} loading={busy === `${side}:default-save`} onClick={() => saveDefault(side)}>Save as team default</Button> : null}
            <label className="ml-auto flex items-center gap-2 text-xs text-muted">
              Formation
              <Input aria-label={`${d.teams[side].name} formation`} className="h-8 w-24" placeholder="e.g. 4-3-3" value={formations[side]} disabled={!editable} onChange={(e) => { setDirty(true); setFormations((f) => ({ ...f, [side]: e.target.value })); }} />
            </label>
          </div>
        ) : null}
        {rows.length ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((p) => {
              const st = statusOf(side, p.playerId);
              const entry = lu[side].find((x) => x.playerId === p.playerId);
              const onRoster = ros.some((r) => r.playerId === p.playerId);
              return (
                <li key={p.playerId} className={cx('flex items-center gap-2 px-2 py-1.5', st === 'out' && 'text-muted')}>
                  {canEdit && !compact && st !== 'out' ? (
                    <Input aria-label={`${p.displayName} number`} inputMode="numeric" className="h-8 w-14 text-right tabular" value={entry?.number ?? ''} disabled={!editable} onChange={(e) => setNumber(side, p.playerId, e.target.value.replace(/\D/g, ''))} />
                  ) : (
                    <span className="w-8 shrink-0 text-right tabular">{entry?.number ?? p.number ?? ''}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {p.displayName}
                    {p.position ? <span className="ml-1 text-xs text-muted">{p.position}</span> : null}
                    {!onRoster ? <span className="ml-1 text-xs text-warning">not on the roster</span> : null}
                  </span>
                  {st === 'starter' && canEdit ? (
                    <button type="button" aria-label={`${p.displayName} captain`} aria-pressed={!!entry?.captain} disabled={!editable} onClick={() => toggleCaptain(side, p.playerId)} className={cx('size-8 shrink-0 rounded-full border text-xs font-semibold', entry?.captain ? 'border-primary bg-primary text-bg' : 'border-border text-muted')}>C</button>
                  ) : entry?.captain ? <span className="text-xs font-semibold text-primary">C</span> : null}
                  {canEdit ? (
                    <div role="group" aria-label={`${p.displayName} role`} className="flex shrink-0 overflow-hidden rounded-md border border-border text-xs">
                      {(['starter', 'bench', 'out'] as const).map((k) => (
                        <button key={k} type="button" aria-pressed={st === k} disabled={!editable} onClick={() => setStatus(side, p, k)} className={cx('min-h-9 px-2.5', st === k ? (k === 'starter' ? 'bg-primary text-bg' : 'bg-elevated text-text') : 'text-muted hover:text-text')}>
                          {k === 'starter' ? 'Start' : k === 'bench' ? 'Bench' : 'Out'}
                        </button>
                      ))}
                    </div>
                  ) : <StatusPill tone={st === 'starter' ? 'primary' : 'neutral'}>{st === 'starter' ? 'starter' : st === 'bench' ? 'bench' : 'out'}</StatusPill>}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-muted">No players on this team’s season roster. Add players under Library → Teams first.</p>}
        <p className="mt-2 text-xs text-muted">
          {starters} starters · {bench} bench{expected && starters !== expected && starters > 0 ? ` · usually ${expected} start in ${d.sport === 'afl' ? 'AFL' : d.sport.replace('_', ' ')}` : ''}
        </p>
      </div>
    );
  };

  const saveBar = canEdit ? (
    <div className={cx('flex flex-wrap items-center gap-2', compact && 'fixed inset-x-0 bottom-0 z-20 border-t border-border bg-panel p-3')}>
      <Button variant="primary" size={compact ? 'touch' : 'md'} className={compact ? 'flex-1' : ''} disabled={!editable} loading={busy === 'save'} onClick={() => save(false)}>Save line-ups</Button>
      <Button size={compact ? 'touch' : 'md'} disabled={!editable} loading={busy === 'lock'} onClick={() => save(true)}>Save and lock</Button>
      {dirty ? <span className="text-xs text-warning">Unsaved changes</span> : null}
    </div>
  ) : null;

  return (
    <div className={compact ? 'pb-24' : ''}>
      <p className="mb-3 text-sm text-muted">
        The line-up is a snapshot for this match: later roster changes and transfers never alter its graphics or history.
        {locked ? ' It is locked now that the match has started.' : d.lineupLocked ? ' Locked for match day; it can still be corrected until the start.' : ''}
      </p>
      {compact ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Side)}>
          <TabList className="mb-3">
            {(['home', 'away'] as const).map((side) => (
              <Tab key={side} value={side}>
                <span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: d.teams[side].primaryColor }} />
                {d.teams[side].name}
              </Tab>
            ))}
          </TabList>
          <TabPanel value="home">{panel('home')}</TabPanel>
          <TabPanel value="away">{panel('away')}</TabPanel>
        </Tabs>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(['home', 'away'] as const).map((side) => (
            <div key={side} className="rounded-[var(--radius-card)] border border-border bg-panel p-3">
              <h3 className="mb-2 font-medium">{d.teams[side].name}</h3>
              {panel(side)}
            </div>
          ))}
        </div>
      )}
      <ErrorNotice error={err} />
      {saveBar ? <div className="mt-3">{saveBar}</div> : null}
    </div>
  );
}
