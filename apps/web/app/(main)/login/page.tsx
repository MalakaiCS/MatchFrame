'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorNotice, Field, Input } from '@bs/ui';
import { AuthCard } from '@/components/auth-card';
import { api, ApiError, get } from '@/lib/api';
import type { Me } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const next = useSearchParams().get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/sign-in/email', { method: 'POST', json: { email, password } });
      const me = await get<Me>('me');
      qc.setQueryData(['me'], me);
      if (next && next.startsWith('/')) router.replace(next);
      else if (!me.organisations.length) router.replace('/onboarding');
      else if (me.role === 'scorer') router.replace('/score');
      else router.replace('/app');
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 403) setNeedsVerify(true);
      setErr(ae.status === 401 ? new ApiError(401, 'INVALID', 'Email or password is incorrect.') : ae);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    await api('/api/auth/send-verification-email', { method: 'POST', json: { email, callbackURL: '/verify-email?ok=1' } }).catch(() => undefined);
    setResent(true);
  }

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
