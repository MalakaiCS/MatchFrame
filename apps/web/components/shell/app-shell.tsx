'use client';
// The app's frame. Navigation in four plain groups (Home, On air, Graphics, Sponsors & media) with one primary
// action, New match; it folds to icons on desktop and slides in from the side on phones. Ctrl/⌘ K jumps to any
// page or searches matches. The top bar holds the organisation, connection state, notifications, the light/dark
// switch and the account menu. Guards: signed out → login; no organisation → onboarding; scorers → the scorer;
// a suspended organisation, a required two-step sign-in or an unverified email stop here with what to do.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DM from '@radix-ui/react-dropdown-menu';
import * as DialogP from '@radix-ui/react-dialog';
import {
  Bell, BarChart3, BookOpen, Building2, ChevronDown, ChevronsLeft, ChevronsRight, Clapperboard, CornerDownLeft, Film, Gauge, Image, LayoutDashboard, LayoutGrid, LogOut, Megaphone, Menu, Palette, Plus, Radio, Search, Settings, ShieldCheck, Trophy, UserRound, Workflow, X,
} from 'lucide-react';
import { Button, cx, Spinner, StatusPill, Toaster } from '@bs/ui';
import { api, get, post } from '@/lib/api';
import { canSee, isFull, useMe, type Me } from '@/lib/session';
import { useConnectionStatus } from '@/lib/realtime';
import { TwoFactorEnrol } from '@/components/settings/security';
import { ThemeChoices, ThemeToggle } from '@/components/theme-toggle';
import { MatchFrameMark } from '../site/brand';

interface NavItem { href: string; label: string; icon: typeof Gauge; area: string; hint: string }
const GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: '/app', label: 'Home', icon: Gauge, area: 'dashboard', hint: 'Live and upcoming matches' },
      { href: '/app/matches', label: 'Matches', icon: LayoutGrid, area: 'matches', hint: 'Fixtures, scorers and graphics for each match' },
      { href: '/app/competitions', label: 'Competitions', icon: Trophy, area: 'competitions', hint: 'Seasons, teams, tables and finals' },
    ],
  },
  {
    label: 'On air',
    items: [
      { href: '/app/control-rooms', label: 'Control rooms', icon: Clapperboard, area: 'control', hint: 'Send graphics to air for a match' },
      { href: '/app/board', label: 'Producer board', icon: LayoutDashboard, area: 'control', hint: 'Every live match on one screen' },
      { href: '/app/streams', label: 'Streams', icon: Radio, area: 'streams', hint: 'Cloud production inputs and outputs' },
    ],
  },
  {
    label: 'Graphics',
    items: [
      { href: '/app/themes', label: 'Themes', icon: Palette, area: 'themes', hint: 'Looks, colours and logos' },
      { href: '/app/automation', label: 'Automation', icon: Workflow, area: 'automation', hint: 'What goes on air by itself' },
      { href: '/app/assets', label: 'Assets', icon: Image, area: 'assets', hint: 'Teams, players, venues and images' },
    ],
  },
  {
    label: 'Sponsors & media',
    items: [
      { href: '/app/sponsors', label: 'Sponsors', icon: Megaphone, area: 'sponsors', hint: 'Campaigns and placements' },
      { href: '/app/reports', label: 'Reports', icon: BarChart3, area: 'reports', hint: 'Sponsor delivery and graphics on air' },
      { href: '/app/media', label: 'Media', icon: Film, area: 'media', hint: 'Clips, highlights and exports' },
    ],
  },
];
const SETTINGS: NavItem = { href: '/app/settings', label: 'Settings', icon: Settings, area: 'settings', hint: 'Organisation, members, plan, account and security' };
const COLLAPSE_KEY = 'mf-sidebar';

const isActive = (path: string, href: string) => (href === '/app' ? path === '/app' : path === href || path.startsWith(`${href}/`));

function visibleGroups(m: Me) {
  return GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canSee(m, i.area)) })).filter((g) => g.items.length);
}

function ConnectionBadge({ compact }: { compact?: boolean }) {
  const s = useConnectionStatus();
  if (compact)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={s === 'connected' ? 'Live updates on' : s === 'connecting' ? 'Connecting' : 'Offline'}>
        <span className={cx('size-2 rounded-full', s === 'connected' ? 'bg-healthy' : s === 'connecting' ? 'bg-warning' : 'bg-muted')} aria-hidden />
        <span className="sr-only">{s === 'connected' ? 'Live updates on' : s === 'connecting' ? 'Connecting' : 'Offline'}</span>
      </span>
    );
  return s === 'connected' ? <StatusPill tone="healthy">Live updates</StatusPill> : s === 'connecting' ? <StatusPill tone="warning">Connecting</StatusPill> : <StatusPill tone="offline">Offline</StatusPill>;
}

function Clock({ tz }: { tz: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <span className="hidden text-xs tabular-nums text-muted 2xl:inline" title={tz}>
      {new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(now)} · {tz.split('/').pop()?.replace('_', ' ')}
    </span>
  );
}

/** The grouped navigation, shared by the sidebar and the phone drawer. */
function NavList({ m, path, collapsed = false, onNavigate }: { m: Me; path: string; collapsed?: boolean; onNavigate?: () => void }) {
  const groups = visibleGroups(m);
  const link = (n: NavItem) => {
    const active = isActive(path, n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? n.label : undefined}
        className={cx(
          'group flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          active ? 'bg-primary/10 text-text ring-1 ring-inset ring-primary/30' : 'text-muted hover:bg-elevated hover:text-text',
        )}
      >
        <n.icon className={cx('size-[18px] shrink-0', active ? 'text-primary' : 'text-muted group-hover:text-text')} aria-hidden />
        {collapsed ? <span className="sr-only">{n.label}</span> : n.label}
      </Link>
    );
  };
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g, i) => (
        <div key={g.label ?? i} className="flex flex-col gap-0.5">
          {g.label ? (collapsed ? <div className="mx-auto mb-1 h-px w-6 bg-border" aria-hidden /> : <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted/80">{g.label}</p>) : null}
          {g.items.map(link)}
        </div>
      ))}
    </div>
  );
}

/** Ctrl/⌘ K: jump to a page, or search matches by team or competition. */
function QuickJump({ m, open, onOpenChange }: { m: Me; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = useMemo(() => [...GROUPS.flatMap((g) => g.items), SETTINGS].filter((i) => canSee(m, i.area)), [m]);
  const t = q.trim().toLowerCase();
  const shown = items.filter((i) => !t || `${i.label} ${i.hint}`.toLowerCase().includes(t));
  const actions = [...(t ? [{ key: 'search', label: `Search matches for “${q.trim()}”`, href: `/app/matches?search=${encodeURIComponent(q.trim())}`, icon: Search }] : []), ...shown.map((i) => ({ key: i.href, label: i.label, hint: i.hint, href: i.href, icon: i.icon }))];
  useEffect(() => setSel(0), [q, open]);
  const go = (href: string) => {
    onOpenChange(false);
    setQ('');
    router.push(href);
  };
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <DialogP.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-panel shadow-pop" aria-describedby={undefined}>
          <DialogP.Title className="sr-only">Jump to a page or search matches</DialogP.Title>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-5 text-muted" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(actions.length - 1, s + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                if (e.key === 'Enter' && actions[sel]) { e.preventDefault(); go(actions[sel]!.href); }
              }}
              placeholder="Jump to a page, or type a team to search matches"
              aria-label="Jump to a page or search matches"
              aria-controls="quick-jump-list"
              aria-activedescendant={actions[sel] ? `qj-${sel}` : undefined}
              className="h-14 flex-1 bg-transparent text-[15px] text-text placeholder:text-muted focus:outline-none"
            />
            <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[11px] text-muted sm:inline">Esc</kbd>
          </div>
          <ul id="quick-jump-list" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
            {actions.length ? actions.map((a, i) => (
              <li key={a.key} id={`qj-${i}`} role="option" aria-selected={i === sel}>
                <button type="button" onMouseEnter={() => setSel(i)} onClick={() => go(a.href)} className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left', i === sel ? 'bg-elevated' : '')}>
                  <a.icon className="size-[18px] shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text">{a.label}</span>{'hint' in a && a.hint ? <span className="block truncate text-xs text-muted">{a.hint}</span> : null}</span>
                  {i === sel ? <CornerDownLeft className="size-4 text-muted" aria-hidden /> : null}
                </button>
              </li>
            )) : <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches. Press Enter to search matches.</li>}
          </ul>
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

/** A full-screen stop with one thing to do (suspended organisation, two-step sign-in required, email to verify). */
function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-bg p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-panel p-6 shadow-card">
        <MatchFrameMark size={28} />
        <h1 className="mt-4 font-brand text-xl font-bold">{title}</h1>
        <div className="mt-2 text-sm text-muted">{children}</div>
      </div>
      <Toaster />
    </main>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [jump, setJump] = useState(false);
  const [resent, setResent] = useState(false);
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ id: string; title: string; severity: string; link?: string }[]>('notifications'), enabled: !!me.data?.activeOrganisation && !!me.data?.user.emailVerified, refetchInterval: 60_000 });
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* private mode: expanded */
    }
  }, []);
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setJump((j) => !j);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (me.isLoading) return;
    if (!me.data) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (!me.data.user.emailVerified) return;
    else if (!me.data.organisations.length) router.replace(me.data.staff ? '/staff' : '/onboarding');
    else if (me.data.role === 'scorer') router.replace('/score');
  }, [me.isLoading, me.data, router, path]);

  const signOut = async () => {
    await api('/api/auth/sign-out', { method: 'POST', json: {} }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
  const switchOrg = async (id: string) => {
    await post('organisations/switch', { organisationId: id });
    qc.clear();
    router.replace('/app');
  };

  if (me.data && !me.data.user.emailVerified) {
    return (
      <Gate title="Verify your email to continue">
        <p>We need to confirm <strong className="text-text">{me.data.user.email}</strong> before you can use MatchFrame.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={resent} onClick={() => void api('/api/auth/send-verification-email', { method: 'POST', json: { email: me.data!.user.email, callbackURL: '/verify-email?ok=1' } }).then(() => setResent(true))}>{resent ? 'Link sent: check your email' : 'Email me a verification link'}</Button>
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </Gate>
    );
  }
  if (me.isLoading || !me.data || !me.data.activeOrganisation || me.data.role === 'scorer') {
    return <div className="grid min-h-screen place-items-center bg-bg"><Spinner /></div>;
  }
  const m = me.data;
  const org = m.activeOrganisation!;
  const tz = org.timezone;
  // suspended by site staff: nothing in the organisation can be used until it is reactivated
  if (org.status === 'suspended') {
    const others = m.organisations.filter((o) => o.id !== org.id && o.status !== 'suspended');
    return (
      <Gate title={`${org.name} is suspended`}>
        <p>{process.env.NEXT_PUBLIC_PRODUCT_NAME} staff have suspended this organisation, so its matches, graphics, public pages and share links are unavailable for now. Nothing has been deleted. Contact support to find out why and how to have it reactivated.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {others.map((o) => <Button key={o.id} size="sm" onClick={() => void switchOrg(o.id)}>Switch to {o.name}</Button>)}
          {m.staff ? <Button asChild size="sm"><Link href="/staff">Staff console</Link></Button> : null}
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </Gate>
    );
  }
  // the organisation requires two-step sign-in and this account has not set it up yet
  if (org.requireTwoFactor && !m.user.twoFactorEnabled) {
    return (
      <Gate title="Two-step sign-in is required">
        <p className="mb-4">{org.name} asks every member to confirm sign-ins with an authenticator app. Set it up once; it takes about a minute.</p>
        <TwoFactorEnrol onDone={() => void qc.invalidateQueries({ queryKey: ['me'] })} />
        <button className="mt-4 text-sm text-muted underline" onClick={() => void signOut()}>Sign out</button>
      </Gate>
    );
  }

  const full = isFull(m.role);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  const newMatch = full ? (
    <Button asChild variant="primary" className={cx('w-full', collapsed && 'px-0')}>
      <Link href="/app/matches?new=1" title={collapsed ? 'New match' : undefined}><Plus className="size-4" aria-hidden />{collapsed ? <span className="sr-only">New match</span> : 'New match'}</Link>
    </Button>
  ) : null;
  const footerLinks = (onNavigate?: () => void, iconsOnly = false) => (
    <div className="flex flex-col gap-0.5">
      {canSee(m, 'settings') ? (
        <Link href={SETTINGS.href} onClick={onNavigate} aria-current={isActive(path, SETTINGS.href) ? 'page' : undefined} title={iconsOnly ? 'Settings' : undefined} className={cx('flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium', iconsOnly && 'justify-center px-0', isActive(path, SETTINGS.href) ? 'bg-primary/10 text-text' : 'text-muted hover:bg-elevated hover:text-text')}>
          <Settings className="size-[18px]" aria-hidden />{iconsOnly ? <span className="sr-only">Settings</span> : 'Settings'}
        </Link>
      ) : null}
      <a href="/docs" target="_blank" rel="noopener" onClick={onNavigate} title={iconsOnly ? 'Help and guides' : undefined} className={cx('flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted hover:bg-elevated hover:text-text', iconsOnly && 'justify-center px-0')}>
        <BookOpen className="size-[18px]" aria-hidden />{iconsOnly ? <span className="sr-only">Help and guides</span> : 'Help and guides'}
      </a>
      {m.staff ? (
        <Link href="/staff" onClick={onNavigate} title={iconsOnly ? 'Staff console' : undefined} className={cx('flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted hover:bg-elevated hover:text-text', iconsOnly && 'justify-center px-0')}>
          <ShieldCheck className="size-[18px]" aria-hidden />{iconsOnly ? <span className="sr-only">Staff console</span> : 'Staff console'}
        </Link>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-on-primary">Skip to main content</a>

      {/* desktop sidebar */}
      <aside className={cx('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-panel transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
        <div className={cx('flex h-16 items-center gap-2', collapsed ? 'justify-center px-2' : 'px-5')}>
          <Link href="/app" className="flex min-w-0 items-center gap-2.5 rounded-lg font-brand text-[17px] font-extrabold tracking-[-0.02em]">
            <MatchFrameMark size={26} />
            {collapsed ? <span className="sr-only">{process.env.NEXT_PUBLIC_PRODUCT_NAME} home</span> : <span className="truncate">{process.env.NEXT_PUBLIC_PRODUCT_NAME}</span>}
          </Link>
        </div>
        <div className={cx('pb-4', collapsed ? 'px-3' : 'px-4')}>{newMatch}</div>
        <nav className={cx('flex-1 overflow-y-auto pb-4', collapsed ? 'px-3' : 'px-3')} aria-label="Main">
          <NavList m={m} path={path} collapsed={collapsed} />
        </nav>
        <div className={cx('border-t border-border py-3', collapsed ? 'px-3' : 'px-3')}>
          {footerLinks(undefined, collapsed)}
          <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} className={cx('mt-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted hover:bg-elevated hover:text-text', collapsed && 'justify-center px-0')}>
            {collapsed ? <ChevronsRight className="size-[18px]" aria-hidden /> : <><ChevronsLeft className="size-[18px]" aria-hidden /> Collapse</>}
          </button>
        </div>
      </aside>

      {/* phone and tablet drawer */}
      <DialogP.Root open={drawer} onOpenChange={setDrawer}>
        <DialogP.Portal>
          <DialogP.Overlay className="fixed inset-0 z-50 bg-black/50 lg:hidden" />
          <DialogP.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(86vw,20rem)] flex-col border-r border-border bg-panel shadow-pop lg:hidden" aria-describedby={undefined}>
            <div className="flex h-16 items-center justify-between px-5">
              <DialogP.Title className="flex items-center gap-2.5 font-brand text-[17px] font-extrabold"><MatchFrameMark size={26} /> {process.env.NEXT_PUBLIC_PRODUCT_NAME}</DialogP.Title>
              <DialogP.Close className="grid size-10 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-text" aria-label="Close menu"><X className="size-5" /></DialogP.Close>
            </div>
            <div className="px-4 pb-4">{full ? <Button asChild variant="primary" className="w-full"><Link href="/app/matches?new=1" onClick={() => setDrawer(false)}><Plus className="size-4" aria-hidden /> New match</Link></Button> : null}</div>
            <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main (menu)">
              <NavList m={m} path={path} onNavigate={() => setDrawer(false)} />
            </nav>
            <div className="border-t border-border px-3 py-3">
              {footerLinks(() => setDrawer(false))}
              <div className="mt-3 flex items-center justify-between px-3"><span className="text-sm text-muted">Appearance</span><ThemeChoices /></div>
            </div>
          </DialogP.Content>
        </DialogP.Portal>
      </DialogP.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-md sm:px-5">
          <button type="button" onClick={() => setDrawer(true)} className="grid size-10 place-items-center rounded-lg text-text hover:bg-elevated lg:hidden" aria-label="Open menu"><Menu className="size-5" /></button>
          <Link href="/app" className="mr-1 lg:hidden" aria-label="Home"><MatchFrameMark size={24} /></Link>
          <DM.Root>
            <DM.Trigger className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-border bg-panel px-3 text-sm font-medium hover:border-border-strong">
              <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="max-w-32 truncate sm:max-w-48">{org.name}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
            </DM.Trigger>
            <DM.Portal>
              <DM.Content align="start" sideOffset={6} className="z-50 min-w-64 rounded-xl border border-border bg-panel p-1.5 text-sm shadow-pop">
                <DM.Label className="px-2.5 py-1.5 text-xs font-medium text-muted">Your organisations</DM.Label>
                {m.organisations.map((o) => (
                  <DM.Item key={o.id} onSelect={() => void switchOrg(o.id)} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated">
                    <span className="truncate">{o.name}</span> <span className="text-xs text-muted">{o.role}{o.id === org.id ? ' · current' : ''}</span>
                  </DM.Item>
                ))}
                <DM.Separator className="my-1 h-px bg-border" />
                <DM.Item onSelect={() => router.push('/onboarding?new=1')} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated"><Plus className="size-4" aria-hidden /> Create an organisation</DM.Item>
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <button type="button" onClick={() => setJump(true)} className="ml-1 hidden min-h-10 w-full max-w-sm items-center gap-2.5 rounded-lg border border-border bg-panel px-3 text-sm text-muted hover:border-border-strong md:flex" aria-label="Jump to a page or search matches (Control K)">
            <Search className="size-4" aria-hidden />
            <span className="flex-1 text-left">Jump to or search…</span>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[11px]">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Clock tz={tz} />
            <span className="hidden sm:inline-flex"><ConnectionBadge /></span>
            <span className="sm:hidden"><ConnectionBadge compact /></span>
            <button type="button" onClick={() => setJump(true)} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-text md:hidden" aria-label="Search"><Search className="size-[18px]" /></button>
            <DM.Root>
              <DM.Trigger className="relative grid size-10 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-text" aria-label={`Notifications${notes.data?.length ? ` (${notes.data.length})` : ''}`}>
                <Bell className="size-[18px]" />
                {notes.data?.length ? <span className="absolute right-2 top-2 size-2 rounded-full bg-live ring-2 ring-bg" /> : null}
              </DM.Trigger>
              <DM.Portal>
                <DM.Content align="end" sideOffset={6} className="z-50 w-80 rounded-xl border border-border bg-panel p-1.5 text-sm shadow-pop">
                  <DM.Label className="px-2.5 py-1.5 text-xs font-medium text-muted">Notifications</DM.Label>
                  {notes.data?.length ? notes.data.map((n) => (
                    <DM.Item key={n.id} onSelect={() => n.link && router.push(n.link)} className="flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated">
                      <StatusPill tone={n.severity === 'error' ? 'live' : n.severity === 'warning' ? 'warning' : 'neutral'}>{n.severity}</StatusPill> <span>{n.title}</span>
                    </DM.Item>
                  )) : <p className="px-2.5 py-4 text-muted">You’re all caught up.</p>}
                </DM.Content>
              </DM.Portal>
            </DM.Root>
            <ThemeToggle className="hidden sm:inline-grid" />
            <DM.Root>
              <DM.Trigger className="ml-1 grid size-9 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary ring-1 ring-primary/30 hover:ring-primary" aria-label="Account menu">{(m.user.name || m.user.email).slice(0, 1).toUpperCase()}</DM.Trigger>
              <DM.Portal>
                <DM.Content align="end" sideOffset={6} className="z-50 w-72 rounded-xl border border-border bg-panel p-1.5 text-sm shadow-pop">
                  <div className="px-2.5 py-2"><div className="truncate font-semibold">{m.user.name || m.user.email}</div><div className="truncate text-xs text-muted">{m.user.email} · {m.role}</div></div>
                  <DM.Separator className="my-1 h-px bg-border" />
                  <div className="flex items-center justify-between px-2.5 py-2"><span className="text-xs font-medium text-muted">Appearance</span><ThemeChoices /></div>
                  <DM.Separator className="my-1 h-px bg-border" />
                  <DM.Item onSelect={() => router.push('/app/settings?tab=security')} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated"><UserRound className="size-4" aria-hidden /> Account and sign-in</DM.Item>
                  {m.staff ? <DM.Item onSelect={() => router.push('/staff')} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated"><ShieldCheck className="size-4" aria-hidden /> Staff console <span className="ml-auto text-xs text-muted">{m.staff.label}</span></DM.Item> : null}
                  <DM.Item onSelect={() => window.open('/docs', '_blank', 'noopener')} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated"><BookOpen className="size-4" aria-hidden /> Help and guides</DM.Item>
                  <DM.Separator className="my-1 h-px bg-border" />
                  <DM.Item onSelect={() => void signOut()} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated"><LogOut className="size-4" aria-hidden /> Sign out</DM.Item>
                </DM.Content>
              </DM.Portal>
            </DM.Root>
          </div>
        </header>
        <main ref={mainRef} id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
      <QuickJump m={m} open={jump} onOpenChange={setJump} />
      <Toaster />
    </div>
  );
}
