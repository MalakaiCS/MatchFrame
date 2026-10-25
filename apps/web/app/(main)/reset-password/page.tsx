'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button, ErrorNotice, Field, Input } from '@bs/ui';
import { AuthCard } from '@/components/auth-card';
import { api, ApiError } from '@/lib/api';

function Reset() {
  const q = useSearchParams();
  const token = q.get('token');
  const linkError = q.get('error');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [state, setState] = useState<'idle' | 'sent' | 'done'>('idle');

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/request-password-reset', { method: 'POST', json: { email, redirectTo: `${location.origin}/reset-password` } });
      setState('sent');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function reset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/reset-password', { method: 'POST', json: { token, newPassword: pw } });
      setState('done');
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.status === 400 ? new ApiError(400, 'INVALID_TOKEN', 'This reset link is invalid, expired or already used. Request a new one.') : ae);
    } finally {
      setBusy(false);
    }
  }

  if (linkError) return <AuthCard title="Link not valid" subtitle="This reset link is invalid or has expired."><Link href="/reset-password" className="text-primary">Request a new link</Link></AuthCard>;
  if (state === 'done') return <AuthCard title="Password changed" subtitle="All other sessions were signed out."><Link href="/login" className="inline-block rounded-md bg-primary px-4 py-2 font-semibold text-bg">Log in</Link></AuthCard>;
  if (state === 'sent') return <AuthCard title="Check your email" subtitle="If an account exists for that address, a reset link is on its way. It expires in 1 hour." >{null}</AuthCard>;
  if (token)
    return (
      <AuthCard title="Choose a new password">
        <form onSubmit={reset} className="flex flex-col gap-4">
          <Field label="New password" htmlFor="pw" hint="At least 10 characters">
            <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <ErrorNotice error={err} />
          <Button variant="primary" type="submit" loading={busy} disabled={pw.length < 10}>Save password</Button>
        </form>
      </AuthCard>
    );
  return (
    <AuthCard title="Reset your password" footer={<Link href="/login" className="text-primary">Back to log in</Link>}>
      <form onSubmit={request} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <ErrorNotice error={err} />
        <Button variant="primary" type="submit" loading={busy} disabled={!email}>Send reset link</Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
