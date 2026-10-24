'use client';
// The scorer's match list, in MatchFrame's console style: a search box and a competition picker, three tabs (now and
// next, matches that were never played, results), and the matches by day, each as a ticker: the kick-off time or
// the state on the left, the two teams in their colours with their scores, the competition, round and ground, and a
// menu (the scorer, the line-ups, the match page). Producers get a button to add a match.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { CloudOff, MoreVertical, Plus, Search, UserRound } from 'lucide-react';
import { ErrorNotice, NativeSelect, Spinner, cx } from '@bs/ui';
import { ApiError, get } from '@/lib/api';
import { fmtDate } from '@/lib/hooks';
import { cacheList, getCachedList } from '@/lib/scorer-outbox';
import { ACCESS_LABEL, scorerAccess } from '@/lib/scorer-access';
import { isFull, useMe } from '@/lib/session';
import type { MatchRow } from '@/components/match-table';
import { TeamCrest } from '@/components/scorer/sheet';
import { useSignOut } from '@/components/scorer/scorer-shell';

type TabId = 'live' | 'not_started' | 'completed';
const TABS: { id: TabId; label: string }[] = [
  { id: 'live', label: 'Now & next' },
  { id: 'not_started', label: 'Not played' },
  { id: 'completed', label: 'Results' },
];
const FINISHED = ['completed', 'abandoned', 'cancelled', 'archived'];
const MENU = 'z-50 min-w-48 rounded-xl border border-border bg-panel p-1 text-text shadow-xl';
const MENU_ITEM = 'flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-[15px] outline-none data-[highlighted]:bg-elevated';

const crestTeam = (t: NonNullable<MatchRow['home']>) => ({ ...t, shortName: t.shortName ?? t.name });

export default function ScoreList() {
  const me = useMe();
  const signOut = useSignOut();
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<TabId>('live');
  const [competition, setCompetition] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    get<MatchRow[]>('score/matches')
      .then(async (r) => { setRows(r); setCachedAt(null); await cacheList(r); })
      .catch(async (e: ApiError) => {
        const c = await getCachedList();
        if (c) { setRows(c.list as MatchRow[]); setCachedAt(c.at); } else setErr(e);
      });
  }, []);

  const tz = me.data?.activeOrganisation?.timezone ?? 'Australia/Brisbane';
  const day = (d: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(new Date(d));
  const today = day(new Date());
  const tomorrow = day(new Date(Date.now() + 86_400_000));
  const yesterday = day(new Date(Date.now() - 86_400_000));
  const now = Date.now();
  const full = isFull(me.data?.role);

  const competitions = useMemo(() => [...new Map((rows ?? []).map((m) => [m.competition.id, m.competition.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const q = search.trim().toLowerCase();
  const filtered = (rows ?? []).filter((m) => (!competition || m.competition.id === competition) && (!q || [m.home?.name, m.away?.name, m.home?.abbreviation, m.away?.abbreviation, m.competition.name, m.round, m.venue?.name].some((s) => s?.toLowerCase().includes(q))));
  const byTab: Record<TabId, MatchRow[]> = {
    // live now, every match today whatever its state, and everything still to come
    live: filtered.filter((m) => m.status === 'live' || day(m.scheduledAt) === today || (!FINISHED.includes(m.status) && day(m.scheduledAt) > today)),
    // kick-off was on an earlier day and nobody started it, or it was put off
    not_started: filtered.filter((m) => m.status === 'postponed' || (m.status === 'scheduled' && day(m.scheduledAt) < today)).sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt)),
    completed: filtered.filter((m) => FINISHED.includes(m.status)).sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt)),
  };
  const shown = byTab[tab];
  const filtering = !!competition || !!q;
  // the tab's matches by day, in the order they are listed
  const days = shown.reduce<{ day: string; at: string; list: MatchRow[] }[]>((acc, m) => {
    const d = day(m.scheduledAt);
    const last = acc[acc.length - 1];
    if (last?.day === d) last.list.push(m);
    else acc.push({ day: d, at: m.scheduledAt, list: [m] });
    return acc;
  }, []);
  const dayName = (d: string, at: string) => (d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : d === yesterday ? 'Yesterday' : fmtDate(at, tz, { weekday: 'long', day: 'numeric', month: 'long' }));

  const status = (m: MatchRow): { text: string; urgent?: boolean } => {
    if (m.status === 'live') return { text: 'Live', urgent: true };
    if (m.status === 'completed') return { text: 'FT' };
    if (m.status === 'cancelled') return { text: 'Cancelled' };
    if (m.status === 'postponed') return { text: 'Postponed' };
    if (m.status === 'abandoned') return { text: 'Abandoned' };
    if (m.status === 'archived') return { text: 'Archived' };
    if (new Date(m.scheduledAt).getTime() < now) return day(m.scheduledAt) === today ? { text: 'Running late', urgent: true } : { text: 'Not started', urgent: true };
    return { text: 'Not started' };
  };
  const hasScore = (m: MatchRow) => m.status === 'live' || m.status === 'completed' || m.status === 'abandoned';

  const menu = (m: MatchRow, access: string) => (
    <DM.Root>
      <DM.Trigger aria-label={`Options for ${m.home?.name ?? ''} v ${m.away?.name ?? ''}`} className="grid size-11 place-items-center rounded-lg text-muted hover:bg-elevated">
        <MoreVertical className="size-5" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className={MENU}>
          <DM.Item asChild className={MENU_ITEM}><Link href={`/score/${m.id}`}>Open the scorer</Link></DM.Item>
          {access === 'score' ? <DM.Item asChild className={MENU_ITEM}><Link href={`/score/${m.id}/lineup`}>Line-ups</Link></DM.Item> : null}
          {full ? <DM.Item asChild className={MENU_ITEM}><Link href={`/app/matches/${m.id}`}>Match page</Link></DM.Item> : null}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );

  /** one team's line of a ticker: its colour, its crest, its name and, once there is one, its score */
  const teamLine = (m: MatchRow, side: 'home' | 'away') => {
    const t = m[side];
    const other = side === 'home' ? 'away' : 'home';
    const lead = hasScore(m) && m.score[side] > m.score[other];
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="h-5 w-1 shrink-0 rounded-full" style={{ background: t?.primaryColor ?? 'var(--color-border)' }} />
        {t ? <TeamCrest team={crestTeam(t)} size={22} className="rounded" /> : null}
        <span className={cx('min-w-0 flex-1 truncate text-[15px]', lead || !hasScore(m) ? 'font-semibold' : 'text-muted')}>{t?.name ?? (side === 'home' ? 'Home' : 'Away')}</span>
        {hasScore(m) ? <span className={cx('shrink-0 text-[18px] font-bold leading-none tabular', m.status === 'live' && 'text-live')}>{m.score[side]}</span> : null}
      </span>
    );
  };

  const ticker = (m: MatchRow) => {
    const access = scorerAccess(me.data, { id: m.id, competition: { id: m.competition.id } });
    const st = status(m);
    const label = `${m.home?.name ?? 'Home'} v ${m.away?.name ?? 'Away'}`;
    const upcoming = m.status === 'scheduled' && !st.urgent;
    return (
      <li key={m.id} className={cx('flex items-stretch overflow-hidden rounded-xl border bg-panel', m.status === 'live' ? 'border-live/60' : 'border-border')}>
        <Link href={`/score/${m.id}`} aria-label={label} className="flex min-w-0 flex-1 items-stretch active:bg-elevated">
          <span className="flex w-[68px] shrink-0 flex-col items-center justify-center gap-0.5 border-r border-border bg-bg/40 px-1 text-center">
            {m.status === 'live' ? (
              <span className="flex items-center gap-1 rounded bg-live px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white"><span aria-hidden className="size-1.5 animate-pulse rounded-full bg-white" />Live</span>
            ) : upcoming ? (
              <span className="text-[15px] font-bold tabular">{fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}</span>
            ) : (
              <>
                {m.status === 'scheduled' ? <span className="text-[13px] font-semibold tabular text-muted">{fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}</span> : null}
                <span className={cx('text-[11px] font-semibold uppercase leading-tight tracking-wide', st.urgent ? 'text-live' : 'text-muted')}>{st.text}</span>
              </>
            )}
          </span>
          <span className="grid min-w-0 flex-1 gap-1.5 px-3 py-2.5">
            {teamLine(m, 'home')}
            {teamLine(m, 'away')}
            <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
              <span className="truncate">{m.competition.name}{m.round ? ` · ${m.round}` : ''}{m.venue ? ` · ${m.venue.name}` : ''}</span>
              {access !== 'score' ? <span className="ml-auto shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[11px] text-text">{ACCESS_LABEL[access as keyof typeof ACCESS_LABEL]}</span> : null}
            </span>
          </span>
        </Link>
        <span className="flex items-start border-l border-border p-0.5">{menu(m, access)}</span>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-bg pb-28 text-text">
      <header className="border-b border-border bg-panel px-4 pt-4">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">MatchFrame</p>
            <h1 className="truncate text-[22px] font-bold leading-tight">Scoring</h1>
          </div>
          <DM.Root>
            <DM.Trigger aria-label="Account" className="grid size-11 place-items-center rounded-lg border border-border bg-elevated"><UserRound className="size-5" /></DM.Trigger>
            <DM.Portal>
              <DM.Content align="end" sideOffset={6} className={MENU}>
                <DM.Label className="px-3 py-1.5 text-xs text-muted">{me.data?.user.name}</DM.Label>
                {full ? <DM.Item asChild className={MENU_ITEM}><Link href="/app">Admin</Link></DM.Item> : null}
                <DM.Item className={MENU_ITEM} onSelect={() => void signOut()}>Sign out</DM.Item>
              </DM.Content>
            </DM.Portal>
          </DM.Root>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <label className="flex h-11 min-w-0 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-primary">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            <input type="search" aria-label="Search matches" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Team, round or ground" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          </label>
          <NativeSelect aria-label="Competition" value={competition} onChange={(e) => setCompetition(e.target.value)} className="h-11 max-w-40">
            <option value="">All competitions</option>
            {competitions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </NativeSelect>
        </div>
        <div role="tablist" aria-label="Matches" className="mt-3 flex gap-1">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cx('flex min-h-12 flex-1 items-center justify-center gap-1.5 border-b-2 px-1 text-[14px] font-semibold', tab === t.id ? 'border-primary text-text' : 'border-transparent text-muted')}>
              {t.label}{rows ? <span className={cx('rounded-full px-1.5 text-[11px] tabular', tab === t.id ? 'bg-primary text-bg' : 'bg-elevated text-muted')}>{byTab[t.id].length}</span> : null}
            </button>
          ))}
        </div>
      </header>

      <main className="px-3 pt-3" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
        {cachedAt ? <p className="mb-3 flex items-center gap-2 text-sm text-warning"><CloudOff className="size-4" /> Offline copy from {new Date(cachedAt).toLocaleTimeString('en-AU')}.</p> : null}
        <ErrorNotice error={err} />
        {!rows && !err ? <div className="grid place-items-center py-10"><Spinner /></div> : null}
        {rows?.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">No matches assigned to you yet. Ask your producer to assign you from the match page, or to send you the match link.</p> : null}
        {rows?.length && !shown.length ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            {filtering ? 'No matches fit the search.' : tab === 'live' ? 'Nothing today or coming up.' : tab === 'not_started' ? 'Every earlier match was started.' : 'No finished matches in the last month.'}
          </p>
        ) : null}
        {days.map((d) => (
          <section key={d.day} aria-label={dayName(d.day, d.at)} className="mb-4">
            <h2 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {dayName(d.day, d.at)}<span aria-hidden className="h-px flex-1 bg-border" />
            </h2>
            <ul className="grid gap-2">{d.list.map(ticker)}</ul>
          </section>
        ))}
      </main>

      {full ? (
        <Link href="/app/matches?new=1" aria-label="New match" className="fixed bottom-5 right-5 z-20 flex h-14 items-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-bold text-bg shadow-lg active:opacity-90">
          <Plus className="size-5" aria-hidden />Match
        </Link>
      ) : null}
    </div>
  );
}
