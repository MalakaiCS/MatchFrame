'use client';
// The staff console's frame: its own navigation (staff do not need an organisation), the signed-in staff member's
// role, and a way back to the app. The server checks every staff action; the navigation only hides what a role
// cannot use.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, Building2, Inbox, Link2, LogOut, ShieldCheck, Users, UserCog } from 'lucide-react';
import { cx, ErrorNotice, Spinner, StatusPill, Toaster } from '@bs/ui';
import { api } from '@/lib/api';
import { useGet } from '@/lib/hooks';
import { useMe } from '@/lib/session';
import { MatchFrameMark } from '../site/brand';

export type StaffRole = 'owner' | 'admin' | 'moderator' | 'support';
export interface StaffMe {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
  label: string;
  source: 'granted' | 'config';
  can: Record<string, boolean>;
  roles: { role: StaffRole; label: string; description: string }[];
}

const StaffContext = createContext<StaffMe | null>(null);
export const useStaff = () => useContext(StaffContext)!;

const NAV = [
  { href: '/staff', label: 'Organisations', icon: Building2, can: 'directory.read' },
  { href: '/staff/users', label: 'Accounts', icon: Users, can: 'directory.read' },
  { href: '/staff/enquiries', label: 'Enquiries', icon: Inbox, can: 'enquiries.read' },
  { href: '/staff/links', label: 'Public links', icon: Link2, can: 'content.takedown' },
  { href: '/staff/team', label: 'Staff team', icon: UserCog, can: 'directory.read' },
  { href: '/staff/activity', label: 'Staff log', icon: Activity, can: 'activity.read' },
];

export function StaffShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const staff = useGet<StaffMe>(['staff', 'me'], me.data?.staff ? 'staff/me' : null);

  useEffect(() => {
    if (!me.isLoading && !me.data) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [me.isLoading, me.data, router, path]);

  if (me.isLoading || !me.data || (me.data.staff && staff.isLoading)) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;
  if (!me.data.staff || staff.error) {
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-panel p-6">
          <h1 className="text-lg font-semibold">Staff only</h1>
          <p className="mb-4 mt-1 text-sm text-muted">The staff console is for the people who run {process.env.NEXT_PUBLIC_PRODUCT_NAME}. Your account is not on the staff team.</p>
          {staff.error ? <ErrorNotice error={staff.error} /> : null}
          <Link href="/app" className="text-sm text-primary underline">Back to the app</Link>
        </div>
      </main>
    );
  }
  const s = staff.data!;
  const signOut = async () => {
    await api('/api/auth/sign-out', { method: 'POST', json: {} }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
  const nav = NAV.filter((n) => s.can[n.can]);

  return (
    <StaffContext.Provider value={s}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-panel lg:flex">
          <Link href="/staff" className="flex items-center gap-2 px-4 py-4 font-semibold">
            <MatchFrameMark size={28} />
            <span className="truncate">Staff console</span>
          </Link>
          <nav className="flex flex-1 flex-col gap-0.5 px-2 pb-4" aria-label="Staff">
            {nav.map((n) => {
              const active = n.href === '/staff' ? path === '/staff' || path.startsWith('/staff/organisations') : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={cx('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', active ? 'bg-elevated text-text' : 'text-muted hover:bg-elevated/60 hover:text-text')}>
                  <n.icon className="size-4" aria-hidden />
                  {n.label}
                </Link>
              );
            })}
            {me.data.organisations.length ? <Link href="/app" className="mt-auto rounded-md px-3 py-2 text-sm text-muted hover:bg-elevated/60 hover:text-text">← Back to the app</Link> : null}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/95 px-4">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            <span className="text-sm font-medium">{process.env.NEXT_PUBLIC_PRODUCT_NAME} staff</span>
            <StatusPill tone="primary" icon={false}>{s.label}</StatusPill>
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span className="hidden text-muted sm:inline">{s.email}</span>
              <button onClick={() => void signOut()} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted hover:text-text"><LogOut className="size-4" /> Sign out</button>
            </div>
          </header>
          <nav className="flex gap-1 relative overflow-x-auto border-b border-border px-2 py-1 lg:hidden" aria-label="Staff (compact)">
            {nav.map((n) => <Link key={n.href} href={n.href} className={cx('whitespace-nowrap rounded px-2.5 py-1.5 text-xs', path === n.href ? 'bg-elevated' : 'text-muted')}>{n.label}</Link>)}
          </nav>
          {me.data.user.twoFactorEnabled ? null : (
            <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">Staff accounts can change every organisation. Turn on two-step sign-in for this account (Settings → Account in the app).</div>
          )}
          <main id="main" className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </div>
        <Toaster />
      </div>
    </StaffContext.Provider>
  );
}
