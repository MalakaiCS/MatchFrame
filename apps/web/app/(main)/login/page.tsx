'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorNotice, Field, Input } from '@bs/ui';
import { AuthCard } from '@/components/auth-card';
import { api, ApiError, get } from '@/lib/api';
import type { Me } from '@/lib/session';

const PROVIDERS: Record<string, string> = { google: 'Continue with Google', microsoft: 'Continue with Microsoft' };

function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const next = params.get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(params.get('error') ? new ApiError(400, 'SOCIAL', 'Signing in with that account did not work. Try again or use your email and password.') : null);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resent, setResent] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const options = useQuery({ queryKey: ['auth-options'], queryFn: () => get<{ password: boolean; providers: string[] }>('auth-options'), staleTime: 600_000, retry: 0 });

  async function finish() {
    const me = await get<Me>('me');
    qc.setQueryData(['me'], me);
    if (next && next.startsWith('/')) router.replace(next);
    else if (!me.organisations.length) router.replace('/onboarding');
    else if (me.role === 'scorer') router.replace('/score');
    else router.replace('/app');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ twoFactorRedirect?: boolean } | null>('/api/auth/sign-in/email', { method: 'POST', json: { email, password } });
      if (r && typeof r === 'object' && 'twoFactorRedirect' in r && r.twoFactorRedirect) {
        setTwoFactor(true);
        return;
      }
      await finish();
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 403) setNeedsVerify(true);
      setErr(ae.status === 401 ? new ApiError(401, 'INVALID', 'Email or password is incorrect.') : ae);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const c = code.replace(/\s/g, '');
      await api(backup ? '/api/auth/two-factor/verify-backup-code' : '/api/auth/two-factor/verify-totp', { method: 'POST', json: backup ? { code: c } : { code: c, trustDevice: true } });
      await finish();
    } catch {
      setErr(new ApiError(401, 'CODE', backup ? 'That backup code was not accepted.' : 'That code was not accepted. Codes change every 30 seconds; enter the one showing now.'));
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ url?: string }>('/api/auth/sign-in/social', { method: 'POST', json: { provider, callbackURL: next && next.startsWith('/') ? next : '/app', errorCallbackURL: '/login?error=social' } });
      if (r?.url) window.location.href = r.url;
      else throw new ApiError(500, 'SOCIAL', 'Sign-in with that provider is not available right now.');
    } catch (e) {
      setErr(e as ApiError);
      setBusy(false);
    }
  }

  async function resend() {
    await api('/api/auth/send-verification-email', { method: 'POST', json: { email, callbackURL: '/verify-email?ok=1' } }).catch(() => undefined);
    setResent(true);
  }

  if (twoFactor) {
    return (
      <AuthCard title="Two-step sign-in" footer={<button type="button" className="text-primary" onClick={() => { setTwoFactor(false); setCode(''); setErr(null); }}>Back to password</button>}>
        <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-muted">{backup ? 'Enter one of your backup codes. Each works once.' : 'Enter the 6-digit code from your authenticator app.'}</p>
          <Field label={backup ? 'Backup code' : 'Code'} htmlFor="tf-code">
            <Input id="tf-code" inputMode={backup ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <ErrorNotice error={err} />
          <Button variant="primary" type="submit" loading={busy} disabled={code.replace(/\s/g, '').length < 6}>Continue</Button>
          <button type="button" className="text-center text-sm text-muted hover:text-text" onClick={() => { setBackup(!backup); setCode(''); setErr(null); }}>{backup ? 'Use the authenticator app instead' : 'Lost the phone? Use a backup code'}</button>
        </form>
      </AuthCard>
    );
  }

  const providers = options.data?.providers ?? [];
  return (
    <AuthCard title="Log in" footer={<>New here? <Link className="text-primary" href="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {needsVerify ? (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
            Verify your email before logging in. {resent ? 'A new link has been sent.' : <button type="button" className="underline" onClick={resend}>Resend the link</button>}
          </div>
        ) : (
          <ErrorNotice error={err} />
        )}
        <Button variant="primary" type="submit" loading={busy} disabled={!email || !password}>Log in</Button>
        <Link href="/reset-password" className="text-center text-sm text-muted hover:text-text">Forgot password?</Link>
      </form>
      {providers.length ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
          {providers.map((p) => <Button key={p} type="button" variant="secondary" disabled={busy} onClick={() => void social(p)}>{PROVIDERS[p] ?? `Continue with ${p}`}</Button>)}
        </div>
      ) : null}
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
