'use client';
// Reminders and web push for this account: turn on notifications in this browser, see the devices already
// subscribed, and read what gets sent.
import { useEffect, useState } from 'react';
import { Button, Card, ErrorNotice, Spinner, StatusPill, Table } from '@bs/ui';
import { ApiError, post } from '@/lib/api';
import { fmtDate, useGet } from '@/lib/hooks';

interface Sub { id: string; endpoint: string; userAgent: string | null; createdAt: string }

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function NotificationsPanel({ tz }: { tz: string }) {
  const key = useGet<{ configured: boolean; publicKey: string | null }>(['push-key'], 'push/public-key');
  const subs = useGet<Sub[]>(['push-subs'], 'me/push-subscriptions');
  const [here, setHere] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setSupported(false);
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => setHere(s?.endpoint ?? null)).catch(() => undefined);
  }, []);
  const enable = async () => {
    setBusy(true);
    setErr(null);
    try {
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new ApiError(0, 'DENIED', 'Notifications are blocked for this site in the browser settings.');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key.data!.publicKey!) });
      const json = sub.toJSON();
      await post('me/push-subscriptions', { endpoint: sub.endpoint, keys: json.keys, userAgent: navigator.userAgent.slice(0, 200) });
      setHere(sub.endpoint);
      await subs.refetch();
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'PUSH', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const disableHere = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removeSub(sub.endpoint);
        await sub.unsubscribe();
      }
      setHere(null);
      await subs.refetch();
    } finally {
      setBusy(false);
    }
  };
  // DELETE carries a body (the endpoint), which the shared helper does not send
  const removeSub = async (endpoint: string) => {
    await fetch('/api/v1/me/push-subscriptions', { method: 'DELETE', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }) });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-1 font-medium">What gets sent</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li><span className="text-text">Kick-off reminder</span>, an hour before the start, to the match's scorers and the person who set the fixture up.</li>
          <li><span className="text-text">Still live?</span> nudge when a match has been live for three hours with nothing recorded, so it gets closed.</li>
          <li>Email always; a phone or desktop notification too when this account has a subscribed device.</li>
        </ul>
      </Card>
      <Card className="p-4">
        <h2 className="mb-1 font-medium">Notifications on this device</h2>
        {key.isLoading ? <Spinner /> : !key.data?.configured ? <p className="text-sm text-muted">Push notifications are not set up on this installation (no VAPID keys). Email reminders still go out.</p> : !supported ? <p className="text-sm text-muted">This browser does not support web push. On iPhone, add the app to the Home Screen first.</p> : here ? (
          <div className="flex flex-wrap items-center gap-2 text-sm"><StatusPill tone="healthy">On for this device</StatusPill><Button size="sm" variant="ghost" loading={busy} onClick={disableHere}>Turn off here</Button></div>
        ) : (
          <div className="grid gap-2 text-sm"><p className="text-muted">Get the reminders as a notification on this phone or computer.</p><Button variant="primary" loading={busy} onClick={enable}>Turn on notifications</Button></div>
        )}
        <ErrorNotice error={err} />
        {subs.data?.length ? (
          <>
            <h3 className="mb-1 mt-4 text-xs font-medium text-muted">Subscribed devices</h3>
            <Table><thead><tr><th>Device</th><th>Since</th><th /></tr></thead><tbody>
              {subs.data.map((s) => <tr key={s.id}><td className="max-w-xs truncate text-xs">{s.userAgent ?? 'Unknown browser'}{s.endpoint === here ? <StatusPill className="ml-1" tone="primary">this device</StatusPill> : null}</td><td className="text-xs text-muted">{fmtDate(s.createdAt, tz, { dateStyle: 'medium' })}</td><td className="text-right"><Button size="sm" variant="ghost" onClick={async () => { await removeSub(s.endpoint); await subs.refetch(); if (s.endpoint === here) setHere(null); }}>Remove</Button></td></tr>)}
            </tbody></Table>
          </>
        ) : null}
      </Card>
    </div>
  );
}
