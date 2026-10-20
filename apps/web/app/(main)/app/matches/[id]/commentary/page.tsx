'use client';
// Commentator view: a read-only, large-type companion for the commentary position or a spotter. Line-ups with
// what each player has done, the key events, the statistics, head-to-head, form and the table, all live.
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { getAdapter, type ClockState, type DisplayModel, type MatchProjection } from '@bs/domain';
import { Button, Card, ErrorNotice, Spinner, StatusPill, cx } from '@bs/ui';
import { fmtDate, useGet } from '@/lib/hooks';
import { serverNow, useRealtime } from '@/lib/realtime';
import type { MatchDetail } from '../page';
import { RunSheet } from '@/components/match/run-sheet';

type Side = 'home' | 'away';
interface Fact { id: string; category: string; type: string; side: Side | null; playerId: string | null; clockMs: number | null; voided: boolean; periodId: string; payload: Record<string, unknown> }
interface TeamRef { id: string; name: string; shortName: string; abbreviation: string; primaryColor: string }
interface FormEntry { matchId: string; result: string; opponent: TeamRef | null; home: boolean; scored: number; conceded: number; playedAt: string }
interface StandingRow { position: number; teamId: string; played: number; won: number; drawn: number; lost: number; for: number; against: number; difference: number; points: number }
interface Preview { headToHead: { played: number; homeWins: number; awayWins: number; draws: number; meetings: { matchId: string; homeScore: number; awayScore: number; playedAt: string; homeTeam: TeamRef; awayTeam: TeamRef }[] }; form: { home: FormEntry[]; away: FormEntry[] }; standings: { home: StandingRow | null; away: StandingRow | null } | null }
interface Standings { rows: (StandingRow & { team: TeamRef })[] }
type Detail = MatchDetail & { rulesConfig: Record<string, unknown>; state: MatchDetail['state'] & { clocks: Record<string, ClockState>; projection: MatchProjection }; officials?: { role: string; name: string }[]; weather?: { summary?: string | null; tempC?: number | null } | null; attendance?: number | null; lineup: MatchDetail['lineup'] & { formations?: { home?: string | null; away?: string | null } } };

const SCALE_KEY = 'bs.commentary.scale';
const EVENT_GROUPS = ['goal', 'own_goal', 'penalty_scored', 'try', 'penalty_try', 'conversion', 'penalty_goal', 'field_goal', 'behind', 'score', 'yellow_card', 'second_yellow', 'red_card', 'green_card', 'sin_bin', 'send_off', 'substitution', 'interchange', 'timeout', 'shootout_kick', 'shootout_stroke'];

export default function CommentaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const m = useGet<Detail>(['match', id], `matches/${id}`);
  const facts = useGet<Fact[]>(['facts', id], `matches/${id}/facts`);
  const preview = useGet<Preview>(['preview', id], `matches/${id}/preview`);
  const seasonId = m.data?.season.id;
  const table = useGet<Standings>(['standings', seasonId], seasonId ? `seasons/${seasonId}/standings` : null);
  const [scale, setScale] = useState(1);
  const [, tick] = useState(0);
  useEffect(() => {
    try {
      const s = Number(localStorage.getItem(SCALE_KEY));
      if (s >= 0.8 && s <= 1.6) setScale(s);
    } catch {
      // optional
    }
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  useRealtime('match', id, (e) => {
    if (e.topic.startsWith('match.')) {
      void qc.invalidateQueries({ queryKey: ['match', id] });
      void qc.invalidateQueries({ queryKey: ['facts', id] });
    }
  });
  const changeScale = (d: number) => {
    const s = Math.min(1.6, Math.max(0.8, Math.round((scale + d) * 10) / 10));
    setScale(s);
    try {
      localStorage.setItem(SCALE_KEY, String(s));
    } catch {
      // optional
    }
  };
  if (m.isLoading) return <Spinner />;
  if (m.error || !m.data) return <ErrorNotice error={m.error} onRetry={() => m.refetch()} />;
  const d = m.data;
  const tz = d.timezone;
  const adapter = getAdapter(d.sport);
  const cfg = d.rulesConfig as never;
  const proj = d.state.projection;
  const display: DisplayModel = adapter.display(cfg, proj, d.state.clocks ?? {}, serverNow());
  const players = [...d.lineup.home, ...d.lineup.away];
  const nameOf = (pid: string | null | undefined) => players.find((p) => p.playerId === pid)?.displayName ?? null;
  const events = (facts.data ?? []).filter((f) => f.category === 'event' && !f.voided && EVENT_GROUPS.includes(f.type)).slice().reverse();
  const tally = (pid: string) => proj.players[pid];
  const marks = (pid: string) => {
    const t = tally(pid);
    if (!t) return null;
    const out: string[] = [];
    if (t.goals) out.push(`${t.goals} ${d.sport === 'basketball' ? 'pts' : t.goals === 1 ? 'goal' : 'goals'}`);
    if (t.points && d.sport === 'basketball') out.push(`${t.points} pts`);
    if (t.assists) out.push(`${t.assists} ast`);
    if (t.yellow) out.push(t.yellow > 1 ? '2 yellow' : 'yellow');
    if (t.red) out.push('sent off');
    if (t.fouls) out.push(`${t.fouls} F`);
    if (t.onCourt === false) out.push('off');
    if (t.onCourt === true) out.push('on');
    return out.join(' · ') || null;
  };
  const lineup = (side: Side) => {
    const list = d.lineup[side];
    const starters = list.filter((p) => p.starter);
    const bench = list.filter((p) => !p.starter);
    return (
      <Card className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ background: d.teams[side].primaryColor }} aria-hidden />
          <h2 className="font-semibold">{d.teams[side].name}</h2>
          {d.lineup.formations?.[side] ? <span className="text-xs text-muted">{d.lineup.formations[side]}</span> : null}
        </div>
        {starters.length ? (
          <ul className="divide-y divide-border/60">
            {starters.map((p) => (
              <li key={p.playerId} className={cx('flex items-center gap-2 py-1', tally(p.playerId)?.red && 'opacity-50')}>
                <span className="w-8 text-right font-semibold tabular text-muted">{p.number ?? ''}</span>
                <span className="flex-1">{p.displayName}{p.captain ? <span className="ml-1 text-xs text-primary">C</span> : null}{p.position ? <span className="ml-1 text-xs text-muted">{p.position}</span> : null}</span>
                <span className="text-xs text-muted">{marks(p.playerId)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No line-up entered yet.</p>}
        {bench.length ? <p className="mt-2 text-xs text-muted"><span className="font-medium">Bench:</span> {bench.map((p) => `${p.number ?? ''} ${p.displayName}${marks(p.playerId) ? ` (${marks(p.playerId)})` : ''}`.trim()).join(', ')}</p> : null}
      </Card>
    );
  };
  const formLine = (list: FormEntry[]) => list.length ? list.slice(0, 5).map((f) => (
    <span key={f.matchId} title={`${f.scored}–${f.conceded} ${f.home ? 'v' : 'at'} ${f.opponent?.shortName ?? '?'}`} className={cx('grid size-7 place-items-center rounded text-xs font-bold', f.result === 'W' ? 'bg-healthy text-bg' : f.result === 'L' ? 'bg-live text-bg' : 'bg-elevated')}>{f.result}</span>
  )) : <span className="text-xs text-muted">no results yet</span>;
  const rows = table.data?.rows ?? [];
  const around = rows.filter((r) => Math.abs(r.position - (preview.data?.standings?.home?.position ?? 1)) <= 2 || Math.abs(r.position - (preview.data?.standings?.away?.position ?? 1)) <= 2 || r.teamId === d.homeTeamId || r.teamId === d.awayTeamId);

  return (
    <div style={{ fontSize: `${scale}rem` }} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/app/matches/${d.id}`} className="text-muted hover:text-text">← Match page</Link>
        <span className="text-muted">Commentator view · read only · {d.competition.name}{d.round ? ` · ${d.round}` : ''}{d.venue ? ` · ${d.venue.name}` : ''}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Smaller text" onClick={() => changeScale(-0.1)}><Minus className="size-4" /></Button>
          <Button size="sm" variant="ghost" aria-label="Larger text" onClick={() => changeScale(0.1)}><Plus className="size-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => document.documentElement.requestFullscreen?.()}><Maximize2 className="size-4" /> Full screen</Button>
        </div>
      </div>
      <Card className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4 text-center">
        {(['home', 'away'] as const).map((side, i) => (
          <div key={side} className={cx(i === 1 && 'order-3')}>
            <div className="mx-auto mb-1 h-1.5 w-20 rounded" style={{ background: d.teams[side].primaryColor }} />
            <div className="text-xl font-semibold">{d.teams[side].name}</div>
            <div className="text-6xl font-bold tabular">{display.score[side]}</div>
            {display.scoreDetail ? <div className="text-sm text-muted tabular">{display.scoreDetail[side]}</div> : null}
            {display.fouls ? <div className="text-xs text-muted">Fouls {display.fouls[side]}{display.bonus?.[side] ? ' · bonus' : ''} · Timeouts {display.timeouts?.[side]}</div> : null}
          </div>
        ))}
        <div className="order-2">
          <StatusPill tone={d.status === 'live' ? 'live' : 'neutral'}>{display.periodLabel}</StatusPill>
          <div className="mt-1 text-4xl font-semibold tabular">{display.clockText}</div>
          {display.stoppageText ? <div className="text-warning tabular">{display.stoppageText}</div> : null}
          {display.shootout ? <div className="text-sm">Pens {display.shootout.home}–{display.shootout.away}</div> : null}
          <div className="mt-1 text-xs text-muted">{fmtDate(d.scheduledAt, tz, { dateStyle: 'medium', timeStyle: 'short' })}</div>
        </div>
      </Card>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3">{lineup('home')}{lineup('away')}</div>
        <div className="space-y-3">
          <Card className="p-3">
            <h2 className="mb-2 font-semibold">Key events</h2>
            <ul className="space-y-1">
              {events.map((f) => (
                <li key={f.id} className="flex items-start gap-2">
                  <span className="w-10 shrink-0 text-right text-muted tabular">{f.clockMs != null ? `${Math.floor(f.clockMs / 60000) + 1}'` : ''}</span>
                  <span className="w-12 shrink-0 font-semibold">{f.side ? d.teams[f.side].abbreviation : ''}</span>
                  <span className="flex-1">
                    {f.type.replace(/_/g, ' ')}{nameOf(f.playerId) ? ` · ${nameOf(f.playerId)}` : ''}
                    {f.payload?.assistId ? <span className="text-muted"> (assist {nameOf(String(f.payload.assistId)) ?? '?'})</span> : null}
                    {f.type === 'substitution' || f.type === 'interchange' ? <span className="text-muted"> {nameOf(f.payload?.playerInId as string)} on{nameOf(f.payload?.playerOutId as string) ? `, ${nameOf(f.payload?.playerOutId as string)} off` : ''}</span> : null}
                    {f.payload?.points ? <span className="text-muted"> +{String(f.payload.points)}</span> : null}
                  </span>
                </li>
              ))}
              {!events.length ? <li className="text-sm text-muted">No scoring, cards or changes yet.</li> : null}
            </ul>
          </Card>
          <Card className="p-3">
            <h2 className="mb-2 font-semibold">Statistics</h2>
            <table className="w-full text-sm"><tbody>
              {d.rules.capabilities.statRows.map((r) => {
                const h = proj.stats.home?.[r.key] ?? 0;
                const a = proj.stats.away?.[r.key] ?? 0;
                const total = h + a || 1;
                return (
                  <tr key={r.key}>
                    <td className="w-10 text-right font-semibold tabular">{h}</td>
                    <td className="px-2">
                      <div className="mb-0.5 text-center text-xs text-muted">{r.label}</div>
                      <div className="flex h-1.5 overflow-hidden rounded bg-elevated"><span style={{ width: `${(h / total) * 100}%`, background: d.teams.home.primaryColor }} /><span style={{ width: `${(a / total) * 100}%`, background: d.teams.away.primaryColor }} /></div>
                    </td>
                    <td className="w-10 font-semibold tabular">{a}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </Card>
        </div>
        <div className="space-y-3">
          <Card className="p-3">
            <h2 className="mb-2 font-semibold">Head to head</h2>
            {preview.data ? (
              <>
                <p className="text-sm">{preview.data.headToHead.played ? <>{preview.data.headToHead.played} meetings · {d.teams.home.abbreviation} {preview.data.headToHead.homeWins} · draws {preview.data.headToHead.draws} · {d.teams.away.abbreviation} {preview.data.headToHead.awayWins}</> : 'First meeting in this competition.'}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted">{preview.data.headToHead.meetings.slice(0, 5).map((x) => <li key={x.matchId}>{fmtDate(x.playedAt, tz, { dateStyle: 'medium' })}: {x.homeTeam.abbreviation} {x.homeScore}–{x.awayScore} {x.awayTeam.abbreviation}</li>)}</ul>
                <div className="mt-3 grid gap-2 text-sm">
                  <div className="flex items-center gap-2"><span className="w-12 font-semibold">{d.teams.home.abbreviation}</span><span className="flex gap-1">{formLine(preview.data.form.home)}</span></div>
                  <div className="flex items-center gap-2"><span className="w-12 font-semibold">{d.teams.away.abbreviation}</span><span className="flex gap-1">{formLine(preview.data.form.away)}</span></div>
                </div>
              </>
            ) : <Spinner />}
          </Card>
          <Card className="p-3">
            <h2 className="mb-2 font-semibold">Table</h2>
            {around.length ? (
              <table className="w-full text-sm"><thead><tr className="text-xs text-muted"><th className="text-left">#</th><th className="text-left">Team</th><th>P</th><th>+/−</th><th>Pts</th></tr></thead><tbody>
                {around.map((r) => <tr key={r.teamId} className={cx(r.teamId === d.homeTeamId || r.teamId === d.awayTeamId ? 'font-semibold' : 'text-muted')}><td>{r.position}</td><td>{r.team.shortName}</td><td className="text-center tabular">{r.played}</td><td className="text-center tabular">{r.difference > 0 ? `+${r.difference}` : r.difference}</td><td className="text-center tabular">{r.points}</td></tr>)}
              </tbody></table>
            ) : <p className="text-sm text-muted">No results in this season yet.</p>}
          </Card>
          <Card className="p-3 text-sm">
            <h2 className="mb-2 font-semibold">Match information</h2>
            <ul className="space-y-0.5 text-muted">
              {d.officials?.length ? <li>Officials: {d.officials.map((o) => `${o.name} (${o.role.replace(/_/g, ' ')})`).join(', ')}</li> : null}
              {d.attendance != null ? <li>Attendance: {d.attendance.toLocaleString('en-AU')}</li> : null}
              {d.weather?.summary || d.weather?.tempC != null ? <li>Weather: {[d.weather?.summary, d.weather?.tempC != null ? `${d.weather.tempC}°C` : null].filter(Boolean).join(', ')}</li> : null}
              <li>Scorer: {d.lease?.holderName && d.lease.expiresAt && new Date(d.lease.expiresAt) > new Date() ? d.lease.holderName : 'not connected'}</li>
            </ul>
            <h3 className="mb-1 mt-3 text-xs font-medium text-muted">Run sheet</h3>
            <RunSheet matchId={d.id} canEdit={false} compact />
          </Card>
        </div>
      </div>
    </div>
  );
}
