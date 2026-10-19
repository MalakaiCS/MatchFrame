'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, ErrorNotice, Field, Input } from '@bs/ui';
import { AuthCard } from '@/components/auth-card';
import { api, ApiError } from '@/lib/api';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const pwShort = form.password.length > 0 && form.password.length < 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/sign-up/email', { method: 'POST', json: { ...form, callbackURL: '/verify-email?ok=1' } });
      setDone(true);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <AuthCard title="Check your email" subtitle={<>We sent a verification link to <strong className="text-text">{form.email}</strong>. It expires in 24 hours.</>}>
        <p className="text-sm text-muted">Open the link to finish creating your account. You can close this tab.</p>
      </AuthCard>
    );

  return (
    <AuthCard title="Create your account" footer={<>Already registered? <Link className="text-primary" href="/login">Log in</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Your name" htmlFor="name">
          <Input id="name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password" error={pwShort ? 'Use at least 10 characters' : null} hint="At least 10 characters">
          <Input id="password" type="password" autoComplete="new-password" required invalid={pwShort} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <ErrorNotice error={err} />
        <Button variant="primary" type="submit" loading={busy} disabled={!form.name || !form.email || form.password.length < 10}>Create account</Button>
      </form>
    </AuthCard>
  );
}
