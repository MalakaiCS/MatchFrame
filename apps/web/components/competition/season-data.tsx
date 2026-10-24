'use client';
// Season views on the competition page: the table, results and fixtures by round, and player totals.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, ErrorNotice, NativeSelect, Spinner, StatusPill, Table, cx } from '@bs/ui';
import { fmtDate, useGet } from '@/lib/hooks';
import { phaseTone } from '@/components/match-table';

interface Season { id: string; name: string; status: string }
interface TeamRef { id: string; name: string; shortName: string; abbreviation: string; primaryColor: string }
interface StandingRow { position: number; teamId: string; played: number; won: number; drawn: number; lost: number; byes: number; for: number; against: number; difference: number; percentage: number; points: number; winPct: number; team: TeamRef }
interface Standings { rules: { rankBy: string; unit: string; win: number; draw: number; loss: number }; rows: StandingRow[]; resultsCounted: number }
interface Fixture { id: string; round: string | null; scheduledAt: string; timezone: string; status: string; phase: string; isDemo: boolean; venue: string | null; home: TeamRef; away: TeamRef; score: { home: number; away: number } | null; scoreDetail: { home: string; away: string } | null; stage?: 'regular' | 'finals'; shootout?: { home: number; away: number } | null }
interface PlayerRow { playerId: string; displayName: string; team: TeamRef | null; appearances: number; starts: number; goals: number; assists: number; points: number; yellow: number; red: number; fouls: number; breakdown: Record<string, number> }

export function useSeasonPick(seasons: Season[]) {
  const [seasonId, setSeasonId] = useState(seasons.find((s) => s.status === 'active')?.id ?? seasons[0]?.id ?? '');
  useEffect(() => {
    if (!seasonId && seasons.length) setSeasonId(seasons.find((s) => s.status === 'active')?.id ?? seasons[0]!.id);
  }, [seasons, seasonId]);
  return [seasonId, setSeasonId] as const;
}

export function SeasonSelect({ seasons, value, onChange }: { seasons: Season[]; value: string; onChange: (v: string) => void }) {
  if (seasons.length <= 1) return null;
  return (
    <label className="mb-3 flex items-center gap-2 text-sm text-muted">Season
      <NativeSelect aria-label="Season" className="w-auto" value={value} onChange={(e) => onChange(e.target.value)}>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'archived' ? ' (archived)' : ''}</option>)}</NativeSelect>
    </label>
  );
}

export function SeasonStandings({ seasons }: { seasons: Season[] }) {
  const [seasonId, setSeasonId] = useSeasonPick(seasons);
  const q = useGet<Standings>(['standings', seasonId], seasonId ? `seasons/${seasonId}/standings` : null);
  if (!seasons.length) return <p className="text-sm text-muted">Add a season first.</p>;
  const pct = q.data?.rules.rankBy === 'win_pct';
  const unit = q.data?.rules.unit === 'points' ? 'Pts' : 'G';
  return (
    <div>
      <SeasonSelect seasons={seasons} value={seasonId} onChange={setSeasonId} />
      <ErrorNotice error={q.error} />
      {q.isLoading || !q.data ? <Spinner /> : (
        <Card className="relative overflow-x-auto p-0">
          <Table>
            <thead><tr><th>#</th><th>Team</th><th className="text-center">P</th><th className="text-center">W</th><th className="text-center">D</th><th className="text-center">L</th>{q.data.rows.some((r) => r.byes) ? <th className="text-center">B</th> : null}<th className="text-center">{unit}F</th><th className="text-center">{unit}A</th><th className="text-center">{pct || q.data.rules.unit === 'points' ? '%' : '+/−'}</th><th className="text-center">{pct ? 'Win %' : 'Pts'}</th></tr></thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.teamId}>
                  <td className="tabular">{r.position}</td>
                  <td><span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: r.team.primaryColor }} aria-hidden />{r.team.name}</span></td>
                  <td className="text-center tabular">{r.played}</td><td className="text-center tabular">{r.won}</td><td className="text-center tabular">{r.drawn}</td><td className="text-center tabular">{r.lost}</td>
                  {q.data!.rows.some((x) => x.byes) ? <td className="text-center tabular">{r.byes}</td> : null}
                  <td className="text-center tabular">{r.for}</td><td className="text-center tabular">{r.against}</td>
                  <td className="text-center tabular">{pct || q.data!.rules.unit === 'points' ? r.percentage.toFixed(1) : r.difference > 0 ? `+${r.difference}` : r.difference}</td>
                  <td className="text-center font-semibold tabular">{pct ? `${(r.winPct * 100).toFixed(0)}%` : r.points}</td>
                </tr>
              ))}
              {!q.data.rows.length ? <tr><td colSpan={11} className="text-center text-muted">No teams in this season yet.</td></tr> : null}
            </tbody>
          </Table>
          <p className="p-3 text-xs text-muted">{q.data.resultsCounted} result{q.data.resultsCounted === 1 ? '' : 's'} counted · {q.data.rules.win} for a win, {q.data.rules.draw} for a draw{q.data.rules.loss ? `, ${q.data.rules.loss} for a loss` : ''}. Completed regular-season matches count; finals and demo matches never do. The same table is available as a graphic on every desk.</p>
        </Card>
      )}
    </div>
  );
}

export function SeasonResults({ seasons, tz }: { seasons: Season[]; tz: string }) {
  const [seasonId, setSeasonId] = useSeasonPick(seasons);
  const q = useGet<{ rounds: { round: string | null; stage?: 'regular' | 'finals'; matches: Fixture[] }[] }>(['fixtures', seasonId], seasonId ? `seasons/${seasonId}/fixtures` : null);
  if (!seasons.length) return <p className="text-sm text-muted">Add a season first.</p>;
  return (
    <div>
      <SeasonSelect seasons={seasons} value={seasonId} onChange={setSeasonId} />
      <ErrorNotice error={q.error} />
      {q.isLoading || !q.data ? <Spinner /> : !q.data.rounds.length ? <p className="text-sm text-muted">No fixtures in this season yet.</p> : (
        <div className="grid gap-4">
          {q.data.rounds.map((r) => (
            <Card key={`${r.stage ?? 'regular'}:${r.round ?? 'none'}`} className="p-3">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">{r.round ? (/^\d+$/.test(r.round) ? `Round ${r.round}` : r.round) : 'Unrounded'}{r.stage === 'finals' ? <StatusPill tone="primary">Finals</StatusPill> : null}</h3>
              <ul className="divide-y divide-border/60">
                {r.matches.map((m) => (
                  <li key={m.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 py-1.5 text-sm">
                    <span className={cx('truncate text-right', m.score && m.score.home > m.score.away && 'font-semibold')}>{m.home.name}</span>
                    <Link href={`/app/matches/${m.id}`} className="min-w-16 rounded bg-elevated px-2 py-0.5 text-center tabular hover:bg-primary hover:text-bg">{m.score ? `${m.scoreDetail?.home ?? m.score.home} – ${m.scoreDetail?.away ?? m.score.away}${m.shootout ? ` (${m.shootout.home}–${m.shootout.away} pens)` : ''}` : fmtDate(m.scheduledAt, m.timezone || tz, { timeStyle: 'short' })}</Link>
                    <span className={cx('truncate', m.score && m.score.away > m.score.home && 'font-semibold')}>{m.away.name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted"><StatusPill tone={phaseTone(m.status)}>{m.status === 'live' ? m.phase.replace(/_/g, ' ') : m.status === 'completed' ? 'FT' : fmtDate(m.scheduledAt, m.timezone || tz, { dateStyle: 'short' })}</StatusPill>{m.isDemo ? <StatusPill tone="warning">demo</StatusPill> : null}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function SeasonPlayers({ seasons, sport }: { seasons: Season[]; sport: string }) {
  const [seasonId, setSeasonId] = useSeasonPick(seasons);
  const q = useGet<{ rows: PlayerRow[] }>(['player-stats', seasonId], seasonId ? `seasons/${seasonId}/player-stats` : null);
  const [sort, setSort] = useState<'goals' | 'points' | 'assists' | 'appearances'>(sport === 'basketball' || sport === 'rugby_league' ? 'points' : 'goals');
  if (!seasons.length) return <p className="text-sm text-muted">Add a season first.</p>;
  const rows = (q.data?.rows ?? []).slice().sort((a, b) => b[sort] - a[sort] || b.appearances - a.appearances || a.displayName.localeCompare(b.displayName));
  const breakdownKeys = [...new Set(rows.flatMap((r) => Object.keys(r.breakdown ?? {})))].slice(0, 4);
  const cards = rows.some((r) => r.yellow || r.red);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <SeasonSelect seasons={seasons} value={seasonId} onChange={setSeasonId} />
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">Sort by
          <NativeSelect aria-label="Sort players by" className="w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="goals">Goals</option><option value="points">Points</option><option value="assists">Assists</option><option value="appearances">Appearances</option>
          </NativeSelect>
        </label>
      </div>
      <ErrorNotice error={q.error} />
      {q.isLoading ? <Spinner /> : !rows.length ? <p className="text-sm text-muted">Player totals appear once line-ups and events have been recorded.</p> : (
        <Card className="relative overflow-x-auto p-0">
          <Table>
            <thead><tr><th>#</th><th>Player</th><th>Team</th><th className="text-center">Apps</th><th className="text-center">Starts</th><th className="text-center">Goals</th>{sport === 'football' || sport === 'basketball' || sport === 'futsal' ? <th className="text-center">Assists</th> : null}{sport !== 'football' && sport !== 'netball' && sport !== 'hockey' && sport !== 'futsal' ? <th className="text-center">Points</th> : null}{breakdownKeys.map((k) => <th key={k} className="text-center capitalize">{k.replace(/_/g, ' ')}</th>)}{cards ? <th className="text-center">Cards</th> : null}{sport === 'basketball' ? <th className="text-center">Fouls</th> : null}</tr></thead>
            <tbody>
              {rows.slice(0, 200).map((r, i) => (
                <tr key={r.playerId}>
                  <td className="tabular text-muted">{i + 1}</td>
                  <td>{r.displayName}</td>
                  <td className="text-xs text-muted">{r.team?.shortName ?? ''}</td>
                  <td className="text-center tabular">{r.appearances}</td><td className="text-center tabular">{r.starts}</td><td className="text-center tabular font-semibold">{r.goals}</td>
                  {sport === 'football' || sport === 'basketball' || sport === 'futsal' ? <td className="text-center tabular">{r.assists}</td> : null}
                  {sport !== 'football' && sport !== 'netball' && sport !== 'hockey' && sport !== 'futsal' ? <td className="text-center tabular">{r.points}</td> : null}
                  {breakdownKeys.map((k) => <td key={k} className="text-center tabular">{r.breakdown?.[k] ?? 0}</td>)}
                  {cards ? <td className="text-center text-xs">{r.yellow ? `${r.yellow} yellow` : ''}{r.yellow && r.red ? ', ' : ''}{r.red ? `${r.red} red` : ''}</td> : null}
                  {sport === 'basketball' ? <td className="text-center tabular">{r.fouls}</td> : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
