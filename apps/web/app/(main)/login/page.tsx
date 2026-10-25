'use client';
// Log in, every way the installation offers: Google, Apple, Microsoft or Facebook (once configured), a passkey,
// a six-digit code by email (which also creates the account for a new address) or by text message (to a number on
// the account), or an email and password. Accounts with two-step sign-in finish with their authenticator code,
// whichever way they started. The way used last on this device is offered first.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, KeyRound, Mail, MessageSquareText } from 'lucide-react';
import { Button, ErrorNotice, Field, Input, cx } from '@bs/ui';
import { AuthCard } from '@/components/auth-card';
import { SocialButtons } from '@/components/auth/social';
import { api, ApiError, get } from '@/lib/api';
import { finishSignIn, lastMethod, passkeyCancelled, passkeysSupported, rememberMethod, signInWithPasskey, toE164, type AuthOptions, type Method } from '@/lib/sign-in';

type Tab = 'email' | 'password' | 'phone';
type Step = 'start' | 'code' | 'two-factor';

const SOCIAL_ERROR: Record<string, string> = {
  account_not_linked: 'There is already an account with that email. Sign in another way first, then connect this provider under Settings → Account.',
  access_denied: 'Sign-in was cancelled.',
};

function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const next = params.get('next');
  const options = useQuery({ queryKey: ['auth-options'], queryFn: () => get<AuthOptions>('auth-options'), staleTime: 600_000, retry: 0 });
  const o = options.data;
  const [tab, setTab] = useState<Tab>('email');
  const [step, setStep] = useState<Step>('start');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resent, setResent] = useState(false);
  const [backup, setBackup] = useState(false);
  const [trust, setTrust] = useState(true);
  const [last, setLast] = useState<Method | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // the starting tab: a link's ?method=, else the way used last here; a code link from the email fills the code
  useEffect(() => {
    const l = lastMethod();
    setLast(l);
    setCanPasskey(passkeysSupported());
    const m = params.get('method');
    const t = (m === 'password' || m === 'email' || m === 'phone' ? m : l === 'password' || l === 'phone' ? l : 'email') as Tab;
    setTab(t);
    const e = params.get('email');
    if (e) setEmail(e);
    const c = params.get('code');
    if (e && c && /^\d{6}$/.test(c)) {
      setTab('email');
      setCode(c);
      setStep('code');
    }
    if (params.get('step') === 'two-factor') setStep('two-factor');
    const se = params.get('error');
    if (se) setErr(new ApiError(400, 'SOCIAL', SOCIAL_ERROR[se] ?? 'Signing in with that account did not work. Try again, or use your email.'));
  }, [params]);
  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(0, 'ERROR', e instanceof Error ? e.message : 'Something went wrong. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  const after = async (r: unknown, method: Method) => {
    if (r && typeof r === 'object' && 'twoFactorRedirect' in r && (r as { twoFactorRedirect?: boolean }).twoFactorRedirect) {
      setStep('two-factor');
      setCode('');
      return;
    }
    await finishSignIn(router, qc, next, method);
  };

  const social = (provider: 'google' | 'apple' | 'microsoft' | 'facebook') =>
    run(provider, async () => {
      const r = await api<{ url?: string }>('/api/auth/sign-in/social', { method: 'POST', json: { provider, callbackURL: next && next.startsWith('/') ? next : '/app', newUserCallbackURL: '/onboarding', errorCallbackURL: '/login' } });
      if (!r?.url) throw new ApiError(500, 'SOCIAL', 'Sign-in with that provider is not available right now.');
      rememberMethod(provider);
      window.location.href = r.url;
      await new Promise(() => undefined); // keep the button busy while the browser leaves
    });

  const passkey = () =>
    run('passkey', async () => {
      try {
        await signInWithPasskey();
      } catch (e) {
        if (passkeyCancelled(e)) return;
        throw e instanceof ApiError ? new ApiError(e.status, e.code, 'That passkey was not recognised. Add one under Settings → Account after signing in another way.') : e;
      }
      await finishSignIn(router, qc, next, 'passkey');
    });

  const sendEmailCode = (e?: React.FormEvent) => {
    e?.preventDefault();
    return run('send', async () => {
      await api('/api/auth/email-otp/send-verification-otp', { method: 'POST', json: { email: email.trim(), type: 'sign-in' } });
      setStep('code');
      setCode('');
      setCooldown(30);
      setNote(`We sent a 6-digit code to ${email.trim()}. It works for 10 minutes.`);
    });
  };
  const sendTextCode = (e?: React.FormEvent) => {
    e?.preventDefault();
    const n = toE164(phone);
    if (!n) {
      setErr(new ApiError(400, 'PHONE', 'Enter the number in international form, starting with + and the country code, e.g. +61 412 345 678.'));
      return;
    }
    return run('send', async () => {
      await api('/api/auth/phone-number/send-otp', { method: 'POST', json: { phoneNumber: n } });
      setPhone(n);
      setStep('code');
      setCode('');
      setCooldown(30);
      setNote(`If ${n} is on a MatchFrame account, a 6-digit code is on its way by text. Add a number under Settings → Account first.`);
    });
  };
  const verifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.replace(/\s/g, '');
    return run('verify', async () => {
      try {
        const r = tab === 'phone' ? await api('/api/auth/phone-number/verify', { method: 'POST', json: { phoneNumber: phone, code: c } }) : await api('/api/auth/sign-in/email-otp', { method: 'POST', json: { email: email.trim(), otp: c } });
        await after(r, tab === 'phone' ? 'phone' : 'email');
      } catch (x) {
        const ae = x as ApiError;
        throw ae.status === 429 ? ae : new ApiError(ae.status, 'CODE', 'That code was not accepted. Check it, or send a new one.');
      }
    });
  };
  const passwordSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    return run('password', async () => {
      try {
        const r = await api('/api/auth/sign-in/email', { method: 'POST', json: { email: email.trim(), password } });
        await after(r, 'password');
      } catch (x) {
        const ae = x as ApiError;
        // 403: email not verified yet (offer to resend), or an account disabled by staff (say so)
        if (ae.status === 403 && ae.code !== 'ACCOUNT_DISABLED') setNeedsVerify(true);
        throw ae.status === 401 ? new ApiError(401, 'INVALID', 'Email or password is incorrect.') : ae;
      }
    });
  };
  const verifySecondStep = (e: React.FormEvent) => {
    e.preventDefault();
    return run('verify', async () => {
      const c = code.replace(/\s/g, '');
      try {
        await api(backup ? '/api/auth/two-factor/verify-backup-code' : '/api/auth/two-factor/verify-totp', { method: 'POST', json: backup ? { code: c } : { code: c, trustDevice: trust } });
      } catch {
        throw new ApiError(401, 'CODE', backup ? 'That backup code was not accepted.' : 'That code was not accepted. Codes change every 30 seconds; enter the one showing now.');
      }
      await finishSignIn(router, qc, next, last ?? 'password');
    });
  };
  const resend = async () => {
    await api('/api/auth/send-verification-email', { method: 'POST', json: { email, callbackURL: '/verify-email?ok=1' } }).catch(() => undefined);
    setResent(true);
  };
  const back = () => {
    setStep('start');
    setCode('');
    setErr(null);
    setNote(null);
  };

  if (step === 'two-factor') {
    return (
      <AuthCard title="Two-step sign-in" subtitle={backup ? 'Enter one of your backup codes. Each works once.' : 'Enter the 6-digit code from your authenticator app.'} footer={<button type="button" className="font-medium text-primary hover:underline" onClick={() => { router.replace('/login'); back(); }}>Start again</button>}>
        <form onSubmit={verifySecondStep} className="flex flex-col gap-4" noValidate>
          <Field label={backup ? 'Backup code' : 'Authenticator code'} htmlFor="tf-code">
            <Input id="tf-code" inputMode={backup ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} className={cx(!backup && 'h-12 text-center text-xl tracking-[0.4em] tabular-nums')} />
          </Field>
          {!backup ? (
            <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> Trust this browser for 30 days</label>
          ) : null}
          <ErrorNotice error={err} />
          <Button variant="primary" size="lg" type="submit" loading={busy === 'verify'} disabled={code.replace(/\s/g, '').length < 6}>Continue</Button>
          <button type="button" className="text-center text-sm text-muted hover:text-text" onClick={() => { setBackup(!backup); setCode(''); setErr(null); }}>{backup ? 'Use the authenticator app instead' : 'Lost the phone? Use a backup code'}</button>
        </form>
      </AuthCard>
    );
  }

  if (step === 'code') {
    const to = tab === 'phone' ? phone : email.trim();
    return (
      <AuthCard title="Enter your code" subtitle={note ?? <>Enter the 6-digit code sent to <strong className="font-semibold text-text">{to}</strong>.</>} footer={<button type="button" className="font-medium text-primary hover:underline" onClick={back}>Use a different {tab === 'phone' ? 'number' : 'email'} or another way</button>}>
        <form onSubmit={verifyCode} className="flex flex-col gap-4" noValidate>
          <Field label="6-digit code" htmlFor="otp">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={7} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} className="h-12 text-center text-xl tracking-[0.4em] tabular-nums" />
          </Field>
          <ErrorNotice error={err} />
          <Button variant="primary" size="lg" type="submit" loading={busy === 'verify'} disabled={code.replace(/\s/g, '').length !== 6}>Sign in</Button>
          <button type="button" disabled={cooldown > 0 || busy === 'send'} onClick={() => void (tab === 'phone' ? sendTextCode() : sendEmailCode())} className="text-center text-sm text-muted hover:text-text disabled:opacity-60">
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
          </button>
        </form>
      </AuthCard>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof Mail }[] = [
    { key: 'email', label: 'Email code', icon: Mail },
    { key: 'password', label: 'Password', icon: KeyRound },
    ...(o?.sms ? [{ key: 'phone' as const, label: 'Text message', icon: MessageSquareText }] : []),
  ];
  const providers = o?.providers ?? [];
  return (
    <AuthCard title="Log in" subtitle="Welcome back. Choose how you'd like to sign in." footer={<>New to MatchFrame? <Link className="font-semibold text-primary hover:underline" href="/register">Create an account</Link></>}>
      <div className="flex flex-col gap-2.5">
        <SocialButtons providers={providers} onSelect={social} busy={(busy as never) ?? null} last={last} />
        {canPasskey && o?.passkey !== false ? (
          <button type="button" onClick={passkey} disabled={!!busy} className="relative inline-flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-border-strong/60 bg-panel px-4 text-[15px] font-semibold text-text transition hover:border-border-strong hover:bg-elevated disabled:opacity-60">
            <Fingerprint className="size-5 text-primary" aria-hidden /> Sign in with a passkey
            {last === 'passkey' ? <span className="absolute -top-2 right-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-primary">Last used</span> : null}
          </button>
        ) : null}
      </div>
      <div className="my-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-muted"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>

      <div role="tablist" aria-label="Sign in with" className="mb-5 grid rounded-xl border border-border bg-elevated/60 p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} onClick={() => { setTab(t.key); setErr(null); setNeedsVerify(false); }} className={cx('inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition', tab === t.key ? 'bg-panel text-text shadow-card ring-1 ring-primary/50' : 'text-muted hover:text-text')}>
            <t.icon className="size-4" aria-hidden /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'email' ? (
        <form id="panel-email" role="tabpanel" aria-labelledby="tab-email" onSubmit={sendEmailCode} className="flex flex-col gap-4" noValidate>
          <Field label="Email" htmlFor="email-code" hint="We'll email you a 6-digit code. No password needed; a new address gets a new account.">
            <Input id="email-code" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorNotice error={err} />
          <Button variant="primary" size="lg" type="submit" loading={busy === 'send'} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}>Email me a code</Button>
        </form>
      ) : tab === 'phone' ? (
        <form id="panel-phone" role="tabpanel" aria-labelledby="tab-phone" onSubmit={sendTextCode} className="flex flex-col gap-4" noValidate>
          <Field label="Mobile number" htmlFor="phone" hint="In international form, e.g. +61 412 345 678. The number must already be on your account (Settings → Account).">
            <Input id="phone" type="tel" autoComplete="tel" inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <ErrorNotice error={err} />
          <Button variant="primary" size="lg" type="submit" loading={busy === 'send'} disabled={!phone.trim()}>Text me a code</Button>
        </form>
      ) : (
        <form id="panel-password" role="tabpanel" aria-labelledby="tab-password" onSubmit={passwordSignIn} className="flex flex-col gap-4" noValidate>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {needsVerify ? (
            <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
              Verify your email before logging in. {resent ? 'A new link has been sent.' : <button type="button" className="font-semibold underline" onClick={resend}>Resend the link</button>}
            </div>
          ) : (
            <ErrorNotice error={err} />
          )}
          <Button variant="primary" size="lg" type="submit" loading={busy === 'password'} disabled={!email || !password}>Log in</Button>
          <Link href="/reset-password" className="text-center text-sm text-muted hover:text-text">Forgot password?</Link>
        </form>
      )}
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
