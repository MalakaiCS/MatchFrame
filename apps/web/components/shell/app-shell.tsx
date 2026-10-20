'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DM from '@radix-ui/react-dropdown-menu';
import {
  Bell, BarChart3, Building2, ChevronDown, Clapperboard, Film, Gauge, Image, LayoutDashboard, LayoutGrid, LogOut, Megaphone, Palette, Radio, Search, Settings, Trophy, Workflow,
} from 'lucide-react';
import { cx, Spinner, StatusPill, Toaster } from '@bs/ui';
import { api, get, post } from '@/lib/api';
import { canSee, useMe } from '@/lib/session';
import { useConnectionStatus } from '@/lib/realtime';
import { TwoFactorEnrol } from '@/components/settings/security';

const NAV = [
  { href: '/app', label: 'Dashboard', icon: Gauge, area: 'dashboard' },
  { href: '/app/competitions', label: 'Competitions', icon: Trophy, area: 'competitions' },
  { href: '/app/matches', label: 'Matches', icon: LayoutGrid, area: 'matches' },
  { href: '/app/board', label: 'Producer board', icon: LayoutDashboard, area: 'control' },
  { href: '/app/control-rooms', label: 'Control Rooms', icon: Clapperboard, area: 'control' },
  { href: '/app/streams', label: 'Streams', icon: Radio, area: 'streams' },
  { href: '/app/assets', label: 'Assets', icon: Image, area: 'assets' },
  { href: '/app/themes', label: 'Themes', icon: Palette, area: 'themes' },
  { href: '/app/automation', label: 'Automation', icon: Workflow, area: 'automation' },
  { href: '/app/sponsors', label: 'Sponsors', icon: Megaphone, area: 'sponsors' },
  { href: '/app/media', label: 'Media', icon: Film, area: 'media' },
  { href: '/app/reports', label: 'Reports', icon: BarChart3, area: 'reports' },
  { href: '/app/settings', label: 'Settings', icon: Settings, area: 'settings' },
];

function Clock({ tz }: { tz: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <span className="hidden text-xs text-muted md:inline" title={tz}>
      {new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(now)} · {tz.split('/').pop()?.replace('_', ' ')}
    </span>
  );
}

function ConnectionBadge() {
  const s = useConnectionStatus();
  return s === 'connected' ? <StatusPill tone="healthy">Live updates</StatusPill> : s === 'connecting' ? <StatusPill tone="warning">Connecting</StatusPill> : <StatusPill tone="offline">Offline</StatusPill>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ id: string; title: string; severity: string; link?: string }[]>('notifications'), enabled: !!me.data?.activeOrganisation, refetchInterval: 60_000 });

  useEffect(() => {
    if (me.isLoading) return;
    if (!me.data) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (!me.data.organisations.length) router.replace('/onboarding');
    else if (me.data.role === 'scorer') router.replace('/score');
  }, [me.isLoading, me.data, router, path]);

  if (me.isLoading || !me.data || !me.data.activeOrganisation || me.data.role === 'scorer') {
    return <div className="grid min-h-screen place-items-center"><Spinner /></div>;
  }
  const m = me.data;
  const tz = m.activeOrganisation!.timezone;
  // the organisation requires two-step sign-in and this account has not set it up yet
  if (m.activeOrganisation?.requireTwoFactor && !m.user.twoFactorEnabled) {
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-panel p-6">
          <h1 className="text-lg font-semibold">Two-step sign-in is required</h1>
          <p className="mb-4 mt-1 text-sm text-muted">{m.activeOrganisation.name} asks every member to confirm sign-ins with an authenticator app. Set it up once; it takes about a minute.</p>
          <TwoFactorEnrol onDone={() => void qc.invalidateQueries({ queryKey: ['me'] })} />
          <button className="mt-4 text-sm text-muted underline" onClick={() => void (async () => { await api('/api/auth/sign-out', { method: 'POST', json: {} }).catch(() => undefined); qc.clear(); router.replace('/login'); })()}>Sign out</button>
        </div>
        <Toaster />
      </main>
    );
  }

  async function switchOrg(id: string) {
    await post('organisations/switch', { organisationId: id });
    qc.clear();
    router.replace('/app');
  }
  async function signOut() {
    await api('/api/auth/sign-out', { method: 'POST', json: {} }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-bg">Skip to main content</a>
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-panel lg:flex">
        <Link href="/app" className="flex items-center gap-2 px-4 py-4 font-semibold">
          <span className="grid size-7 place-items-center rounded bg-primary text-bg">▶</span>
          <span className="truncate">{process.env.NEXT_PUBLIC_PRODUCT_NAME}</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4" aria-label="Main">
          {NAV.filter((n) => canSee(m, n.area)).map((n) => {
            const active = n.href === '/app' ? path === '/app' : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={cx('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', active ? 'bg-elevated text-text' : 'text-muted hover:bg-elevated/60 hover:text-text')}>
                <n.icon className="size-4" aria-hidden />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur">
          <DM.Root>
            <DM.Trigger className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm hover:border-primary">
              <Building2 className="size-4 text-muted" aria-hidden />
              <span className="max-w-40 truncate">{m.activeOrganisation!.name}</span>
              <ChevronDown className="size-3 text-muted" aria-hidden />
            </DM.Trigger>
            <DM.Portal>
              <DM.Content align="start" sideOffset={6} className="z-50 min-w-56 rounded-md border border-border bg-panel p-1 text-sm shadow-xl">
                <DM.Label className="px-2 py-1 text-xs text-muted">Switch organisation</DM.Label>
                {m.organisations.map((o) => (
                  <DM.Item key={o.id} onSelect={() => switchOrg(o.id)} className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 outline-none data-[highlighted]:bg-elevated">
                    {o.name} <span className="text-xs text-muted">{o.role}{o.id === m.activeOrganisation!.id ? ' · current' : ''}</span>
                  </DM.Item>
                ))}
                <DM.Separator className="my-1 h-px bg-border" />
                <DM.Item onSelect={() => router.push('/onboarding?new=1')} className="cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-elevated">Create organisation…</DM.Item>
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <form className="relative hidden flex-1 sm:block" role="search" onSubmit={(e) => { e.preventDefault(); router.push(`/app/matches?search=${encodeURIComponent(q)}`); }}>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
            <input id="global-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search matches, teams, competitions…" aria-label="Global search" className="h-9 w-full max-w-md rounded-md border border-border bg-panel pl-8 pr-3 text-sm placeholder:text-muted focus:border-primary focus:outline-none" />
          </form>
          <div className="ml-auto flex items-center gap-3">
            <Clock tz={tz} />
            <ConnectionBadge />
            <DM.Root>
              <DM.Trigger className="relative rounded-md p-2 text-muted hover:text-text" aria-label={`Notifications${notes.data?.length ? ` (${notes.data.length})` : ''}`}>
                <Bell className="size-4" />
                {notes.data?.length ? <span className="absolute right-1 top-1 size-2 rounded-full bg-live" /> : null}
              </DM.Trigger>
              <DM.Portal>
                <DM.Content align="end" sideOffset={6} className="z-50 w-80 rounded-md border border-border bg-panel p-1 text-sm shadow-xl">
                  {notes.data?.length ? notes.data.map((n) => (
                    <DM.Item key={n.id} onSelect={() => n.link && router.push(n.link)} className="cursor-pointer rounded px-2 py-2 outline-none data-[highlighted]:bg-elevated">
                      <StatusPill tone={n.severity === 'error' ? 'live' : n.severity === 'warning' ? 'warning' : 'neutral'}>{n.severity}</StatusPill> <span className="ml-1">{n.title}</span>
                    </DM.Item>
                  )) : <p className="px-2 py-3 text-muted">No notifications</p>}
                </DM.Content>
              </DM.Portal>
            </DM.Root>
            <DM.Root>
              <DM.Trigger className="grid size-8 place-items-center rounded-full bg-elevated text-sm font-semibold" aria-label="Account menu">{m.user.name.slice(0, 1).toUpperCase()}</DM.Trigger>
              <DM.Portal>
                <DM.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-md border border-border bg-panel p-1 text-sm shadow-xl">
                  <div className="px-2 py-1.5"><div className="font-medium">{m.user.name}</div><div className="text-xs text-muted">{m.user.email} · {m.role}</div></div>
                  <DM.Separator className="my-1 h-px bg-border" />
                  <DM.Item onSelect={signOut} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-elevated"><LogOut className="size-4" /> Sign out</DM.Item>
                </DM.Content>
              </DM.Portal>
            </DM.Root>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1 lg:hidden" aria-label="Main (compact)">
          {NAV.filter((n) => canSee(m, n.area)).map((n) => (
            <Link key={n.href} href={n.href} className={cx('whitespace-nowrap rounded px-2.5 py-1.5 text-xs', path.startsWith(n.href) && (n.href !== '/app' || path === '/app') ? 'bg-elevated' : 'text-muted')}>{n.label}</Link>
          ))}
        </nav>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6 outline-none">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
