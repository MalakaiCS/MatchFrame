'use client';
// Create an account: with Google, Apple, Microsoft or Facebook (once configured), or with a name and email and a
// 6-digit code (no password needed), or with a password and a verification link. A plan picked on the pricing
// page (?plan=club&billing=yearly) is remembered and offered again once the organisation exists.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { PRICE_PLANS } from '@bs/domain';
import { Button, ErrorNotice, Field, Input } from '@bs/ui';
import { AuthCard } from '@/components/auth-card';
import { SocialButtons } from '@/components/auth/social';
import { api, ApiError, get } from '@/lib/api';
import { finishSignIn, intendedPlan, rememberMethod, rememberPlan, type AuthOptions, type IntendedPlan } from '@/lib/sign-in';

function Register() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const options = useQuery({ queryKey: ['auth-options'], queryFn: () => get<AuthOptions>('auth-options'), staleTime: 600_000, retry: 0 });
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [withPassword, setWithPassword] = useState(false);
  const [step, setStep] = useState<'form' | 'code' | 'check-email'>('form');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [plan, setPlan] = useState<IntendedPlan | null>(null);
  const pwShort = withPassword && form.password.length > 0 && form.password.length < 10;
  const emailOk = /^\S+@\S+\.\S+$/.test(form.email.trim());

  useEffect(() => {
    rememberPlan(params.get('plan'), params.get('billing'));
    setPlan(intendedPlan());
  }, [params]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  };
  const social = (provider: 'google' | 'apple' | 'microsoft' | 'facebook') =>
    run(provider, async () => {
      const r = await api<{ url?: string }>('/api/auth/sign-in/social', { method: 'POST', json: { provider, callbackURL: '/app', newUserCallbackURL: '/onboarding', errorCallbackURL: '/login', requestSignUp: true } });
      if (!r?.url) throw new ApiError(500, 'SOCIAL', 'Sign-up with that provider is not available right now.');
      rememberMethod(provider);
      window.location.href = r.url;
      await new Promise(() => undefined);
    });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (withPassword)
      return run('create', async () => {
        await api('/api/auth/sign-up/email', { method: 'POST', json: { ...form, email: form.email.trim(), callbackURL: '/verify-email?ok=1' } });
        rememberMethod('password');
        setStep('check-email');
      });
    return run('create', async () => {
      await api('/api/auth/email-otp/send-verification-otp', { method: 'POST', json: { email: form.email.trim(), type: 'sign-in' } });
      setStep('code');
    });
  };
  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    return run('verify', async () => {
      try {
        await api('/api/auth/sign-in/email-otp', { method: 'POST', json: { email: form.email.trim(), otp: code.replace(/\s/g, ''), name: form.name.trim() } });
      } catch (x) {
        const ae = x as ApiError;
        throw ae.status === 429 ? ae : new ApiError(ae.status, 'CODE', 'That code was not accepted. Check it, or send a new one.');
      }
      await finishSignIn(router, qc, null, 'email');
    });
  };

  const planName = plan ? PRICE_PLANS.find((p) => p.key === plan.plan)?.name : null;
  const planChip = planName ? (
    <p className="mb-6 flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm text-text">
      <BadgeCheck className="size-5 shrink-0 text-primary" aria-hidden />
      <span>You chose <strong className="font-semibold">{planName}</strong>, billed {plan!.billing}. You can confirm it once your organisation is set up.</span>
    </p>
  ) : null;

  if (step === 'check-email')
    return (
      <AuthCard title="Check your email" subtitle={<>We sent a verification link to <strong className="font-semibold text-text">{form.email}</strong>. It expires in 24 hours.</>}>
        <p className="text-sm text-muted">Open the link to finish creating your account. You can close this tab.</p>
      </AuthCard>
    );
  if (step === 'code')
    return (
      <AuthCard title="Enter your code" subtitle={<>We sent a 6-digit code to <strong className="font-semibold text-text">{form.email.trim()}</strong>. It works for 10 minutes.</>} footer={<button type="button" className="font-medium text-primary hover:underline" onClick={() => { setStep('form'); setCode(''); setErr(null); }}>Change the email</button>}>
        <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
          <Field label="6-digit code" htmlFor="otp">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} className="h-12 text-center text-xl tracking-[0.4em] tabular-nums" />
          </Field>
          <ErrorNotice error={err} />
          <Button variant="primary" size="lg" type="submit" loading={busy === 'verify'} disabled={code.replace(/\s/g, '').length !== 6}>Create my account</Button>
        </form>
      </AuthCard>
    );

  const providers = options.data?.providers ?? [];
  return (
    <AuthCard title="Create your account" subtitle="Set up your club or competition in a few minutes. Rehearse as much as you like before match day." footer={<>Already have an account? <Link className="font-semibold text-primary hover:underline" href="/login">Log in</Link></>}>
      {planChip}
      {providers.length ? (
        <>
          <SocialButtons providers={providers} onSelect={social} busy={(busy as never) ?? null} last={null} verb="Sign up" />
          <div className="my-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-muted"><span className="h-px flex-1 bg-border" />or with your email<span className="h-px flex-1 bg-border" /></div>
        </>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Your name" htmlFor="name">
          <Input id="name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        {withPassword ? (
          <Field label="Password" htmlFor="password" error={pwShort ? 'Use at least 10 characters' : null} hint="At least 10 characters">
            <Input id="password" type="password" autoComplete="new-password" required invalid={pwShort} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        ) : null}
        <ErrorNotice error={err} />
        <Button variant="primary" size="lg" type="submit" loading={busy === 'create'} disabled={!form.name.trim() || !emailOk || (withPassword && form.password.length < 10)}>
          {withPassword ? 'Create account' : 'Email me a code'}
        </Button>
        <button type="button" className="text-center text-sm text-muted hover:text-text" onClick={() => { setWithPassword(!withPassword); setErr(null); }}>
          {withPassword ? 'Use an email code instead (no password)' : 'Set a password instead'}
        </button>
      </form>
      <p className="mt-6 text-center text-xs leading-relaxed text-muted">
        By creating an account{providers.length ? ' (with your email or another account)' : ''} you agree to the <Link href="/terms" className="font-medium text-primary hover:underline">Terms and Conditions</Link> and the <Link href="/privacy" className="font-medium text-primary hover:underline">Privacy Policy</Link>.
      </p>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <Register />
    </Suspense>
  );
}
