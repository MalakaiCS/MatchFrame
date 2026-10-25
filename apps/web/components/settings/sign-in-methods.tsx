'use client';
// Ways to sign in to this account: a password (set one by email link if there is none), passkeys on this and other
// devices, a mobile number for text-message codes, and connected Google / Apple / Microsoft / Facebook accounts.
// The last way in cannot be removed (Better Auth refuses to unlink the only account).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, KeyRound, Link2, MessageSquareText, Trash2 } from 'lucide-react';
import { Button, Card, ErrorNotice, Field, Input, StatusPill, toast } from '@bs/ui';
import { PROVIDER_NAME } from '@/components/auth/social';
import { ApiError, api, del, get } from '@/lib/api';
import { fmtDate } from '@/lib/hooks';
import { useMe } from '@/lib/session';
import { addPasskey, passkeyCancelled, passkeysSupported, toE164, type AuthOptions } from '@/lib/sign-in';

interface Account { id: string; providerId: string; accountId: string; createdAt: string }
interface Passkey { id: string; name: string | null; createdAt: string; deviceType: string }

/** Whether the signed-in account has a password (shared with the two-step sign-in controls). */
export function useHasPassword() {
  const accounts = useQuery({ queryKey: ['auth-accounts'], queryFn: () => api<Account[]>('/api/auth/list-accounts'), staleTime: 30_000 });
  return { hasPassword: !!accounts.data?.some((a) => a.providerId === 'credential'), accounts };
}

export function SignInMethods({ tz }: { tz: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const { hasPassword, accounts } = useHasPassword();
  const options = useQuery({ queryKey: ['auth-options'], queryFn: () => get<AuthOptions>('auth-options'), staleTime: 600_000 });
  const keys = useQuery({ queryKey: ['passkeys'], queryFn: () => api<Passkey[]>('/api/auth/passkey/list-user-passkeys') });
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneStep, setPhoneStep] = useState<'idle' | 'enter' | 'code'>('idle');
  const [code, setCode] = useState('');
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => setCanPasskey(passkeysSupported()), []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      if (!passkeyCancelled(e)) setErr(e instanceof ApiError ? e : new ApiError(0, 'ERROR', e instanceof Error ? e.message : 'That did not work. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  const linked = new Set((accounts.data ?? []).map((a) => a.providerId));
  const ways = (accounts.data?.length ?? 0) + (keys.data?.length ?? 0) + (me.data?.user.phoneNumber ? 1 : 0);
  const number = me.data?.user.phoneNumber ?? null;

  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className="font-semibold">Ways to sign in</h2>
      <p className="mt-1 text-sm text-muted">Use any of these to get into this account. A code by email to {me.data?.user.email} always works.</p>
      <ErrorNotice error={err} />
      <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
        <li className="flex flex-wrap items-center gap-3 px-4 py-3">
          <KeyRound className="size-5 text-muted" aria-hidden />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">Password</p><p className="text-xs text-muted">{hasPassword ? 'Set. Change it below.' : 'None yet. We can email you a link to set one.'}</p></div>
          {!hasPassword ? (
            <Button size="sm" loading={busy === 'pw'} onClick={() => run('pw', async () => {
              await api('/api/auth/request-password-reset', { method: 'POST', json: { email: me.data!.user.email, redirectTo: `${location.origin}/reset-password` } });
              toast(`A link to set a password is on its way to ${me.data!.user.email}`);
            })}>Email me a link</Button>
          ) : <StatusPill tone="healthy">set</StatusPill>}
        </li>
        <li className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Fingerprint className="size-5 text-muted" aria-hidden />
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">Passkeys</p><p className="text-xs text-muted">Sign in with this device's fingerprint, face or screen lock. No code to type.</p></div>
            {canPasskey ? (
              <Button size="sm" loading={busy === 'pk'} onClick={() => run('pk', async () => {
                await addPasskey(navigator.userAgent.includes('iPhone') ? 'iPhone' : navigator.userAgent.includes('Android') ? 'Android phone' : navigator.userAgent.includes('Mac') ? 'Mac' : 'This device');
                await qc.invalidateQueries({ queryKey: ['passkeys'] });
                toast('Passkey added');
              })}>Add a passkey</Button>
            ) : <span className="text-xs text-muted">Not supported in this browser</span>}
          </div>
          {keys.data?.length ? (
            <ul className="mt-3 space-y-1.5 pl-8">
              {keys.data.map((k) => (
                <li key={k.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{k.name ?? 'Passkey'} <span className="text-xs text-muted">· added {fmtDate(k.createdAt, tz, { dateStyle: 'medium' })}</span></span>
                  <Button size="sm" variant="ghost" aria-label={`Remove passkey ${k.name ?? ''}`} disabled={ways <= 1} onClick={() => run(`del-${k.id}`, async () => {
                    await api('/api/auth/passkey/delete-passkey', { method: 'POST', json: { id: k.id } });
                    await qc.invalidateQueries({ queryKey: ['passkeys'] });
                  })}><Trash2 className="size-4" aria-hidden /></Button>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
        {options.data?.sms || number ? (
          <li className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <MessageSquareText className="size-5 text-muted" aria-hidden />
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">Mobile number</p><p className="text-xs text-muted">{number ? `${number}: sign in with a code by text message.` : 'Add a number to sign in with a code by text message.'}</p></div>
              {phoneStep === 'idle' ? (
                <div className="flex gap-2">
                  {options.data?.sms ? <Button size="sm" onClick={() => setPhoneStep('enter')}>{number ? 'Change' : 'Add a number'}</Button> : null}
                  {number ? <Button size="sm" variant="ghost" loading={busy === 'rm'} onClick={() => run('rm', async () => { await del('me/phone-number'); await qc.invalidateQueries({ queryKey: ['me'] }); toast('Mobile number removed'); })}>Remove</Button> : null}
                </div>
              ) : null}
            </div>
            {phoneStep === 'enter' ? (
              <form className="mt-3 flex flex-wrap items-end gap-2 pl-8" onSubmit={(e) => { e.preventDefault(); const n = toE164(phone); if (!n) { setErr(new ApiError(400, 'PHONE', 'Enter the number with + and the country code, e.g. +61 412 345 678.')); return; } void run('send', async () => { await api('/api/auth/phone-number/send-otp', { method: 'POST', json: { phoneNumber: n } }); setPhone(n); setPhoneStep('code'); }); }}>
                <Field label="Mobile number" htmlFor="mp" className="min-w-56 flex-1"><Input id="mp" type="tel" autoComplete="tel" placeholder="+61 412 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
                <Button type="submit" size="sm" variant="primary" loading={busy === 'send'}>Text me a code</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPhoneStep('idle')}>Cancel</Button>
              </form>
            ) : phoneStep === 'code' ? (
              <form className="mt-3 flex flex-wrap items-end gap-2 pl-8" onSubmit={(e) => { e.preventDefault(); void run('verify', async () => { await api('/api/auth/phone-number/verify', { method: 'POST', json: { phoneNumber: phone, code: code.replace(/\s/g, ''), updatePhoneNumber: true } }); await qc.invalidateQueries({ queryKey: ['me'] }); setPhoneStep('idle'); setCode(''); toast('Mobile number added'); }); }}>
                <Field label={`Code sent to ${phone}`} htmlFor="mc" className="w-44"><Input id="mc" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
                <Button type="submit" size="sm" variant="primary" loading={busy === 'verify'} disabled={code.replace(/\s/g, '').length !== 6}>Confirm</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPhoneStep('enter')}>Back</Button>
              </form>
            ) : null}
          </li>
        ) : null}
        {(options.data?.providers ?? []).map((p) => (
          <li key={p} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Link2 className="size-5 text-muted" aria-hidden />
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{PROVIDER_NAME[p]}</p><p className="text-xs text-muted">{linked.has(p) ? 'Connected: you can sign in with it.' : 'Not connected.'}</p></div>
            {linked.has(p) ? (
              <Button size="sm" variant="ghost" disabled={ways <= 1} loading={busy === p} onClick={() => run(p, async () => { await api('/api/auth/unlink-account', { method: 'POST', json: { providerId: p } }); await qc.invalidateQueries({ queryKey: ['auth-accounts'] }); })}>Disconnect</Button>
            ) : (
              <Button size="sm" loading={busy === p} onClick={() => run(p, async () => {
                const r = await api<{ url?: string }>('/api/auth/link-social', { method: 'POST', json: { provider: p, callbackURL: '/app/settings?tab=security' } });
                if (r?.url) window.location.href = r.url;
              })}>Connect</Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
