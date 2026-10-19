'use client';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@bs/ui';
import { api } from '@/lib/api';
import { useMe, isFull } from '@/lib/session';

/** Simplified scorer surface: no admin shell; works offline once cached (service worker + IndexedDB). */
export function ScorerShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    // hand the worker everything this page already loaded so an offline refresh can boot the shell
    void navigator.serviceWorker.ready.then((reg) => {
      const urls = [location.href, ...performance.getEntriesByType('resource').map((r) => r.name)];
      reg.active?.postMessage({ type: 'precache', urls });
    });
  }, [path]);
  useEffect(() => {
    if (!me.isLoading && me.data === null && navigator.onLine) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [me.isLoading, me.data, router, path]);
  // offline: never block the scorer on the account request; local data and the outbox are enough
  if (me.isLoading && (typeof navigator === 'undefined' || navigator.onLine)) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;
  return (
    <div className="min-h-screen">
      <header className="flex h-12 items-center justify-between border-b border-border px-3 text-sm">
        <Link href="/score" className="font-semibold">Scoring</Link>
        <div className="flex items-center gap-3 text-muted">
          {isFull(me.data?.role) ? <Link href="/app" className="hover:text-text">Admin</Link> : null}
          <span className="max-w-32 truncate">{me.data?.user.name}</span>
          <button className="hover:text-text" onClick={async () => { await api('/api/auth/sign-out', { method: 'POST', json: {} }).catch(() => undefined); router.replace('/login'); }}>Sign out</button>
        </div>
      </header>
      {children}
    </div>
  );
}
