'use client';
// The scorer's match list: a welcome, three tabs (today's and coming matches, matches that never started, finished
// ones), each match as a card (competition, date, crests, score or kick-off, status) or as a compact row, a filter
// sheet (competition, search) and, for producers, a button to add a match.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { CloudOff, LayoutGrid, List, MoreVertical, Plus, SlidersHorizontal, UserRound } from 'lucide-react';
import { Button, Dialog, ErrorNotice, Field, Input, NativeSelect, Spinner, cx } from '@bs/ui';
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
  { id: 'live', label: 'Live & upcoming' },
  { id: 'not_started', label: 'Not started' },
  { id: 'completed', label: 'Completed' },
];
const FINISHED = ['completed', 'abandoned', 'cancelled', 'archived'];
const VIEW_KEY = 'mf.scorer.listView';
const MENU_ITEM = 'flex min-h-10 cursor-pointer items-center rounded px-3 text-[15px] text-[var(--sc-ink)] outline-none data-[highlighted]:bg-[var(--sc-press)]';

const crestTeam = (t: NonNullable<MatchRow['home']>) => ({ ...t, shortName: t.shortName ?? t.name });

export default function ScoreList() {
  const me = useMe();
  const signOut = useSignOut();
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<TabId>('live');
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  // the card or list choice is a convenience kept on this phone
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'cards' || v === 'list') setView(v);
    } catch { /* storage unavailable */ }
  }, []);
  const chooseView = (v: 'cards' | 'list') => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ }
  };

  const tz = me.data?.activeOrganisation?.timezone ?? 'Australia/Brisbane';
  const day = (d: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(new Date(d));
  const today = day(new Date());
  const now = Date.now();
  const firstName = me.data?.user.name?.trim().split(/\s+/)[0] ?? '';
  const full = isFull(me.data?.role);

  const competitions = useMemo(() => [...new Map((rows ?? []).map((m) => [m.competition.id, m.competition.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const q = search.trim().toLowerCase();
  const filtered = (rows ?? []).filter((m) => (!competition || m.competition.id === competition) && (!q || [m.home?.name, m.away?.name, m.home?.abbreviation, m.away?.abbreviation, m.competition.name, m.round, m.venue?.name].some((s) => s?.toLowerCase().includes(q))));
  const byTab: Record<TabId, MatchRow[]> = {
    // live now, every match today whatever its state, and everything still to come
    live: filtered.filter((m) => m.status === 'live' || day(m.scheduledAt) === today || (!FINISHED.includes(m.status) && day(m.scheduledAt) > today)),
    // kick-off was on an earlier day and nobody started it, or it was put off
    not_started: filtered.filter((m) => m.status === 'postponed' || (m.status === 'scheduled' && day(m.scheduledAt) < today)),
    completed: filtered.filter((m) => FINISHED.includes(m.status)).sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt)),
  };
  const shown = byTab[tab];
  const filterCount = (competition ? 1 : 0) + (q ? 1 : 0);

  const status = (m: MatchRow): { text: string; urgent?: boolean } => {
    if (m.status === 'live') return { text: 'Live', urgent: true };
    if (m.status === 'completed') return { text: 'Finished' };
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
      <DM.Trigger aria-label={`Options for ${m.home?.name ?? ''} v ${m.away?.name ?? ''}`} className="grid size-10 place-items-center rounded-full text-[var(--sc-muted)] hover:bg-[var(--sc-press)]">
        <MoreVertical className="size-5" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="scorer z-50 min-w-48 rounded-lg border border-[var(--sc-line)] bg-white p-1 shadow-xl">
          <DM.Item asChild className={MENU_ITEM}><Link href={`/score/${m.id}`}>Open the scorer</Link></DM.Item>
          {access === 'score' ? <DM.Item asChild className={MENU_ITEM}><Link href={`/score/${m.id}/lineup`}>Line-ups</Link></DM.Item> : null}
          {full ? <DM.Item asChild className={MENU_ITEM}><Link href={`/app/matches/${m.id}`}>Match page</Link></DM.Item> : null}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );

  const card = (m: MatchRow) => {
    const access = scorerAccess(me.data, { id: m.id, competition: { id: m.competition.id } });
    const st = status(m);
    const label = `${m.home?.name ?? 'Home'} v ${m.away?.name ?? 'Away'}`;
    if (view === 'list')
      return (
        <li key={m.id} className="flex items-center border-b border-[var(--sc-line)] bg-white">
          <Link href={`/score/${m.id}`} aria-label={label} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2 active:bg-[var(--sc-press)]">
            <span className="w-14 shrink-0 text-xs text-[var(--sc-muted)]">{fmtDate(m.scheduledAt, tz, day(m.scheduledAt) === today ? { timeStyle: 'short' } : { day: 'numeric', month: 'short' })}</span>
            <span className="scorer-display min-w-0 flex-1 truncate text-[17px] font-semibold">
              {m.home?.abbreviation} {hasScore(m) ? <span className="tabular">{m.score.home} – {m.score.away}</span> : <span className="text-[var(--sc-muted)]">v</span>} {m.away?.abbreviation}
            </span>
            {access !== 'score' ? <span className="rounded bg-[var(--sc-press)] px-1.5 py-0.5 text-[11px]">{ACCESS_LABEL[access as keyof typeof ACCESS_LABEL]}</span> : null}
            <span className={cx('scorer-display shrink-0 text-[13px] font-semibold', st.urgent ? 'text-[#d93025]' : 'text-[var(--sc-muted)]')}>{st.text}</span>
          </Link>
          <span className="pr-1">{menu(m, access)}</span>
        </li>
      );
    return (
      <li key={m.id} className="relative rounded-xl bg-white shadow-[0_1px_3px_rgba(16,24,40,0.12)]">
        <Link href={`/score/${m.id}`} aria-label={label} className="block rounded-xl px-4 pb-3 pt-3 active:bg-[var(--sc-press)]">
          <span className="scorer-display block truncate pr-10 text-[14px] font-semibold text-[var(--sc-ink)]">{m.competition.name}{m.round ? ` · ${m.round}` : ''}</span>
          <span className="block text-[13px] text-[var(--sc-muted)]">{fmtDate(m.scheduledAt, tz, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{m.venue ? ` · ${m.venue.name}` : ''}</span>
          <span className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <span className="flex min-w-0 items-center justify-end gap-2">
              <span className="scorer-display truncate text-[20px] font-bold italic">{m.home?.abbreviation}</span>
              {m.home ? <TeamCrest team={crestTeam(m.home)} size={40} /> : null}
            </span>
            {hasScore(m) ? (
              <span className={cx('scorer-display text-[30px] font-bold leading-none tabular', m.status === 'live' && 'text-[#d93025]')}>{m.score.home} – {m.score.away}</span>
            ) : (
              <span className="text-center leading-tight">
                <span className="scorer-display block text-[14px] text-[var(--sc-muted)]">vs</span>
                <span className="scorer-display block text-[15px] font-semibold text-primary">{fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}</span>
              </span>
            )}
            <span className="flex min-w-0 items-center gap-2">
              {m.away ? <TeamCrest team={crestTeam(m.away)} size={40} /> : null}
              <span className="scorer-display truncate text-[20px] font-bold italic">{m.away?.abbreviation}</span>
            </span>
          </span>
          <span className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--sc-line)] pt-2">
            <span className={cx('scorer-display text-[13px] font-semibold uppercase tracking-wide', st.urgent ? 'text-[#d93025]' : 'text-[var(--sc-muted)]')}>
              {m.status === 'live' ? <span className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-[#d93025] align-middle" aria-hidden /> : null}{st.text}
            </span>
            {access !== 'score' ? <span className="rounded bg-[var(--sc-press)] px-2 py-0.5 text-[12px] text-[var(--sc-ink)]">{ACCESS_LABEL[access as keyof typeof ACCESS_LABEL]}</span> : null}
          </span>
        </Link>
        <span className="absolute right-1.5 top-1.5">{menu(m, access)}</span>
      </li>
    );
  };

  return (
    <div className="scorer min-h-screen bg-[var(--sc-page)] pb-28 text-[var(--sc-ink)]">
      <header className="bg-[var(--sc-head)] px-4 pb-0 pt-5 text-[var(--sc-head-text)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="scorer-display text-[13px] font-medium text-[var(--sc-head-muted)]">Welcome back</p>
            <h1 className="scorer-display truncate text-[32px] font-bold italic leading-tight">{firstName || 'Scorer'}</h1>
          </div>
          <DM.Root>
            <DM.Trigger aria-label="Account" className="grid size-11 place-items-center rounded-full bg-[var(--sc-head-raised)]"><UserRound className="size-5" /></DM.Trigger>
            <DM.Portal>
              <DM.Content align="end" sideOffset={6} className="scorer z-50 min-w-48 rounded-lg border border-[var(--sc-line)] bg-white p-1 shadow-xl">
                <DM.Label className="px-3 py-1.5 text-xs text-[var(--sc-muted)]">{me.data?.user.name}</DM.Label>
                {full ? <DM.Item asChild className={MENU_ITEM}><Link href="/app">Admin</Link></DM.Item> : null}
                <DM.Item className={MENU_ITEM} onSelect={() => void signOut()}>Sign out</DM.Item>
              </DM.Content>
            </DM.Portal>
          </DM.Root>
        </div>
        <div role="tablist" aria-label="Matches" className="mt-4 flex">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cx('scorer-display min-h-12 flex-1 border-b-[3px] px-1 text-[14px] font-semibold uppercase tracking-wide', tab === t.id ? 'border-primary text-[var(--sc-head-text)]' : 'border-transparent text-[var(--sc-head-muted)]')}>
              {t.label}{rows ? <span className="ml-1 text-[12px] font-normal opacity-70">{byTab[t.id].length}</span> : null}
            </button>
          ))}
        </div>
      </header>

      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setFiltersOpen(true)} className="scorer-display flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-semibold uppercase tracking-wide shadow-[0_1px_2px_rgba(16,24,40,0.12)]">
          <SlidersHorizontal className="size-4" aria-hidden /> Filters{filterCount ? <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-white">{filterCount}</span> : null}
        </button>
        <span className="flex-1" />
        <div className="flex rounded-full bg-white p-1 shadow-[0_1px_2px_rgba(16,24,40,0.12)]" role="group" aria-label="Show matches as">
          <button type="button" aria-label="Cards" aria-pressed={view === 'cards'} onClick={() => chooseView('cards')} className={cx('grid size-9 place-items-center rounded-full', view === 'cards' ? 'bg-[var(--sc-head)] text-white' : 'text-[var(--sc-muted)]')}><LayoutGrid className="size-4" /></button>
          <button type="button" aria-label="List" aria-pressed={view === 'list'} onClick={() => chooseView('list')} className={cx('grid size-9 place-items-center rounded-full', view === 'list' ? 'bg-[var(--sc-head)] text-white' : 'text-[var(--sc-muted)]')}><List className="size-4" /></button>
        </div>
      </div>

      <main className="px-4" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
        {cachedAt ? <p className="mb-3 flex items-center gap-2 text-sm text-[var(--sc-muted)]"><CloudOff className="size-4" /> Offline copy from {new Date(cachedAt).toLocaleTimeString('en-AU')}.</p> : null}
        <ErrorNotice error={err} />
        {!rows && !err ? <div className="grid place-items-center py-10"><Spinner /></div> : null}
        {rows?.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--sc-faint)] bg-white p-6 text-center text-sm text-[var(--sc-muted)]">No matches assigned to you yet. Ask your producer to assign you from the match page, or to send you the match link.</p> : null}
        {rows?.length && !shown.length ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-[var(--sc-muted)]">
            {filterCount ? 'No matches fit the filters.' : tab === 'live' ? 'Nothing today or coming up.' : tab === 'not_started' ? 'Every earlier match was started.' : 'No finished matches in the last month.'}
          </p>
        ) : null}
        {shown.length ? <ul className={view === 'cards' ? 'grid gap-3' : 'overflow-hidden rounded-xl shadow-[0_1px_3px_rgba(16,24,40,0.12)] [&>li:last-child]:border-b-0'}>{shown.map(card)}</ul> : null}
      </main>

      {full ? (
        <Link href="/app/matches?new=1" aria-label="New match" className="fixed bottom-5 right-5 z-20 grid size-14 place-items-center rounded-full bg-primary text-white shadow-lg active:opacity-90">
          <Plus className="size-7" />
        </Link>
      ) : null}

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen} title="Filters" description="Show only some of your matches.">
        <div className="grid gap-4">
          <Field label="Competition" htmlFor="flt-comp">
            <NativeSelect id="flt-comp" value={competition} onChange={(e) => setCompetition(e.target.value)}>
              <option value="">All competitions</option>
              {competitions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Team, round or venue" htmlFor="flt-q"><Input id="flt-q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Northgate" /></Field>
          <div className="flex gap-2">
            <Button className="flex-1" variant="ghost" onClick={() => { setCompetition(''); setSearch(''); }}>Clear</Button>
            <Button className="flex-1" variant="primary" onClick={() => setFiltersOpen(false)}>Show {filtered.length} {filtered.length === 1 ? 'match' : 'matches'}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
