'use client';
// Public match centre: the fan-facing page behind a share link. Live score, events, line-ups, statistics and
// the table, refreshed every few seconds while the match is live. No sign-in; nothing private is shown.
import { use, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spinner, cx } from '@bs/ui';
import { ApiError, get } from '@/lib/api';

type Side = 'home' | 'away';
interface Team { id: string; name: string; shortName: string; abbreviation: string; primaryColor: string; secondaryColor: string; logoUrl: string | null }
interface Player { id: string; name: string; number: number | null; position: string | null; starter: boolean; captain: boolean }
interface PublicMatch {
  id: string; sport: string; status: string; competition: { name: string; shortName: string | null }; round: string | null; venue: string | null; scheduledAt: string; timezone: string;
  teams: Record<Side, Team>; score: Record<Side, number>; scoreDetail: Record<Side, string> | null; phase: { id: string; label: string; short: string; kind: string };
  clock: { text: string; running: boolean; stoppage: string | null; serverNow: number }; shootout: Record<Side, number> | null;
  events: { id: string; type: string; side: Side | null; player: string | null; number: number | null; minute: string | null; periodId: string }[];
  lineups: { home: Player[]; away: Player[]; formations?: { home?: string | null; away?: string | null } };
  stats: { key: string; label: string; home: number; away: number }[];
  officials: { role: string; name: string }[]; attendance: number | null;
  standings: { position: number; team: string; played: number; points: number; teamId: string }[] | null;
}
interface Branding { productName: string; logoUrl: string | null; primaryColor: string | null; hideVendor: boolean }
const TABS = ['Summary', 'Line-ups', 'Stats', 'Table'] as const;

export default function MatchCentre({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Summary');
  const q = useQuery<PublicMatch, ApiError>({ queryKey: ['public-match', token], queryFn: () => get<PublicMatch>(`public/match/${token}`), refetchInterval: (query) => (query.state.data?.status === 'live' ? 3000 : 30_000), retry: 1 });
  const brand = useQuery<Branding>({ queryKey: ['public-branding'], queryFn: () => get<Branding>('public/branding'), staleTime: 600_000 });
  useEffect(() => {
    if (q.data) document.title = `${q.data.teams.home.shortName} ${q.data.score.home}–${q.data.score.away} ${q.data.teams.away.shortName}`;
  }, [q.data]);
  if (q.isLoading) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;
  if (q.error || !q.data) {
    return (
      <main className="mx-auto max-w-lg p-6 text-center">
        <h1 className="mb-2 text-xl font-semibold">This match link is not available</h1>
        <p className="text-sm text-muted">The link may have been switched off or replaced. Ask the organiser for the current one.</p>
      </main>
    );
  }
  const m = q.data;
  const live = m.status === 'live';
  const kickoff = new Intl.DateTimeFormat('en-AU', { timeZone: m.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(m.scheduledAt));
  const team = (side: Side) => (
    <div className="flex flex-col items-center gap-1">
      {m.teams[side].logoUrl ? <img src={m.teams[side].logoUrl} alt="" className="size-12 object-contain" /> : <span className="size-12 rounded-full" style={{ background: m.teams[side].primaryColor }} aria-hidden />}
      <span className="text-center text-sm font-semibold leading-tight">{m.teams[side].name}</span>
    </div>
  );
  const playerList = (side: Side) => {
    const starters = m.lineups[side].filter((p) => p.starter);
    const bench = m.lineups[side].filter((p) => !p.starter);
    return (
      <div>
        <h3 className="mb-1 flex items-center gap-2 font-semibold"><span className="size-2.5 rounded-sm" style={{ background: m.teams[side].primaryColor }} aria-hidden />{m.teams[side].name}{m.lineups.formations?.[side] ? <span className="text-xs text-muted">{m.lineups.formations[side]}</span> : null}</h3>
        {starters.length ? <ul className="divide-y divide-border/60 text-sm">{starters.map((p) => <li key={p.id} className="flex gap-2 py-1"><span className="w-7 text-right text-muted tabular">{p.number ?? ''}</span><span className="flex-1">{p.name}{p.captain ? <span className="ml-1 text-xs text-primary">C</span> : null}</span><span className="text-xs text-muted">{p.position ?? ''}</span></li>)}</ul> : <p className="text-sm text-muted">Line-up not announced yet.</p>}
        {bench.length ? <p className="mt-2 text-xs text-muted">Bench: {bench.map((p) => `${p.number ?? ''} ${p.name}`.trim()).join(', ')}</p> : null}
      </div>
    );
  };
  return (
    <main className="mx-auto max-w-3xl px-4 pb-10 pt-4">
      <p className="mb-2 text-center text-xs text-muted">{m.competition.name}{m.round ? ` · ${m.round}` : ''}{m.venue ? ` · ${m.venue}` : ''}</p>
      <section aria-label="Score" className="rounded-[var(--radius-card)] border border-border bg-panel p-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {team('home')}
          <div className="text-center">
            <div className="text-5xl font-bold tabular">{m.score.home}<span className="px-1 text-muted">–</span>{m.score.away}</div>
            {m.scoreDetail ? <div className="text-xs text-muted tabular">{m.scoreDetail.home} · {m.scoreDetail.away}</div> : null}
            {m.shootout ? <div className="text-xs text-muted">Pens {m.shootout.home}–{m.shootout.away}</div> : null}
            <div className={cx('mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', live ? 'bg-live/20 text-live' : 'bg-elevated text-muted')}>{live ? <span className="size-1.5 animate-pulse rounded-full bg-live" aria-hidden /> : null}{m.phase.label}{live && m.clock.text ? ` · ${m.clock.text}` : ''}{m.clock.stoppage ? ` ${m.clock.stoppage}` : ''}</div>
            {!live ? <div className="mt-1 text-xs text-muted">{m.status === 'completed' ? 'Full time' : kickoff}</div> : null}
          </div>
          {team('away')}
        </div>
      </section>
      <nav className="my-3 flex gap-1 relative overflow-x-auto rounded-md border border-border p-1 text-sm" aria-label="Sections">
        {TABS.map((t) => <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={cx('min-h-10 flex-1 rounded px-3', tab === t ? 'bg-elevated font-medium' : 'text-muted hover:text-text')}>{t}</button>)}
      </nav>
      {tab === 'Summary' ? (
        <section aria-label="Events">
          {m.events.length ? (
            <ol className="space-y-1 text-sm">
              {m.events.slice().reverse().map((e) => (
                <li key={e.id} className={cx('flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2', e.side === 'away' && 'flex-row-reverse text-right')}>
                  <span className="w-9 shrink-0 text-xs text-muted tabular">{e.minute ?? ''}</span>
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: e.side ? m.teams[e.side].primaryColor : 'transparent' }} aria-hidden />
                  <span className="flex-1"><span className="font-medium capitalize">{e.type.replace(/_/g, ' ')}</span>{e.player ? <span className="text-muted"> · {e.number ? `${e.number} ` : ''}{e.player}</span> : null}</span>
                </li>
              ))}
            </ol>
          ) : <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">{live ? 'No goals, cards or changes yet.' : m.status === 'completed' ? 'No events were recorded.' : `Kick-off ${kickoff}.`}</p>}
          {m.officials.length || m.attendance != null ? <p className="mt-3 text-xs text-muted">{m.officials.map((o) => `${o.role.replace(/_/g, ' ')}: ${o.name}`).join(' · ')}{m.attendance != null ? ` · Attendance ${m.attendance.toLocaleString('en-AU')}` : ''}</p> : null}
        </section>
      ) : null}
      {tab === 'Line-ups' ? <section aria-label="Line-ups" className="grid grid-cols-1 gap-4 sm:grid-cols-2">{playerList('home')}{playerList('away')}</section> : null}
      {tab === 'Stats' ? (
        <section aria-label="Statistics" className="rounded-[var(--radius-card)] border border-border bg-panel p-3">
          {m.stats.length ? m.stats.map((s) => {
            const total = s.home + s.away || 1;
            return (
              <div key={s.key} className="py-1.5">
                <div className="flex justify-between text-sm"><span className="font-semibold tabular">{s.home}</span><span className="text-xs text-muted">{s.label}</span><span className="font-semibold tabular">{s.away}</span></div>
                <div className="mt-1 flex h-1.5 overflow-hidden rounded bg-elevated"><span style={{ width: `${(s.home / total) * 100}%`, background: m.teams.home.primaryColor }} /><span className="flex-1" /><span style={{ width: `${(s.away / total) * 100}%`, background: m.teams.away.primaryColor }} /></div>
              </div>
            );
          }) : <p className="text-sm text-muted">No statistics yet.</p>}
        </section>
      ) : null}
      {tab === 'Table' ? (
        <section aria-label="Table">
          {m.standings?.length ? (
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">#</th><th>Team</th><th className="text-center">P</th><th className="text-center">Pts</th></tr></thead><tbody>
              {m.standings.map((r) => <tr key={r.teamId} className={cx('border-t border-border/60', (r.teamId === m.teams.home.id || r.teamId === m.teams.away.id) && 'font-semibold')}><td className="py-1.5 tabular">{r.position}</td><td>{r.team}</td><td className="text-center tabular">{r.played}</td><td className="text-center tabular">{r.points}</td></tr>)}
            </tbody></table>
          ) : <p className="text-sm text-muted">The table appears once results are in.</p>}
        </section>
      ) : null}
      <footer className="mt-8 text-center text-xs text-muted">
        {brand.data && !brand.data.hideVendor ? <span>Live scores by {brand.data.productName}</span> : null}
        {live ? <span> · updates every few seconds</span> : null}
      </footer>
    </main>
  );
}
