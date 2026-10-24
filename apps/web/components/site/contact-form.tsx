'use client';
// Public contact form. Asks the API whether the form is open (someone can read what arrives: an inbox, or the site's
// staff console), then stores the message there and shows its reference. Field errors appear in place; a failed
// send keeps everything typed so the visitor can try again; success is only shown once the server has the message.
// Choosing "Help with an account or a match" points first at the matchday troubleshooting guides.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, LifeBuoy, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';

type Status = { enabled: boolean; email: boolean; topics: Record<string, string>; retentionDays: number } | null;
type Fields = { name: string; email: string; topic: string; organisation: string; sport: string; message: string; plan: string; website: string };
const EMPTY: Fields = { name: '', email: '', topic: '', organisation: '', sport: '', message: '', plan: '', website: '' };
const PLANS: Record<string, string> = { starter: 'Starter', club: 'Club', studio: 'Studio', league: 'League / Enterprise' };

export function ContactForm() {
  const [status, setStatus] = useState<Status | 'error'>(null);
  const [f, setF] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ reference: string | null; email: string } | null>(null);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const errorRef = useRef<HTMLParagraphElement>(null);

  const load = () => {
    setStatus(null);
    fetch('/api/v1/public/contact')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Status) => setStatus(s))
      .catch(() => setStatus('error'));
  };
  useEffect(() => {
    load();
    // links such as /contact?topic=sales&plan=league choose the topic and plan
    const p = new URLSearchParams(window.location.search);
    const topic = p.get('topic');
    const plan = p.get('plan');
    setF((x) => ({ ...x, topic: topic && /^(setup|sales|support|partnership|other)$/.test(topic) ? topic : x.topic, plan: plan && PLANS[plan] ? plan : x.plan }));
  }, []);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: e.target.value });
    if (fieldErrors[k]) setFieldErrors({ ...fieldErrors, [k]: '' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // the same checks as the server, so a missing field is pointed out without a round trip
    const local: Record<string, string> = {};
    if (!f.name.trim()) local.name = 'Please tell us your name';
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) local.email = 'Enter an email address we can reply to';
    if (!f.topic) local.topic = 'Choose what your message is about';
    if (f.message.trim().length < 10) local.message = 'A little more detail helps us answer (at least 10 characters)';
    if (Object.keys(local).length) {
      setFieldErrors(local);
      setError({ message: 'Check the highlighted fields.', retry: false });
      document.getElementById(`cf-${Object.keys(local)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await fetch('/api/v1/public/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, organisation: f.organisation || undefined, sport: f.sport || undefined, plan: f.plan || undefined }) });
      const body = (await r.json().catch(() => ({}))) as { reference?: string | null; error?: { message?: string; fields?: { field: string; message: string }[] } };
      if (!r.ok) {
        const fe = Object.fromEntries((body.error?.fields ?? []).map((x) => [x.field, x.message]));
        setFieldErrors(fe);
        setError({ message: body.error?.message ?? 'We could not send your message. Please try again.', retry: r.status >= 500 || r.status === 429 });
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      setSent({ reference: body.reference ?? null, email: f.email.trim() });
      setF(EMPTY);
    } catch {
      setError({ message: 'We could not reach the server. Check your connection and try again; your message is still here.', retry: true });
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  if (status === null)
    return (
      <div className="flex min-h-64 items-center justify-center rounded-2xl border border-border bg-panel text-sm text-muted" role="status">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Loading the form…
      </div>
    );
  if (status === 'error' || !status.enabled)
    return (
      <div className="rounded-2xl border border-warning/45 bg-warning/10 p-6 text-[15px] leading-relaxed text-text">
        <p className="flex items-center gap-2 font-semibold"><TriangleAlert className="size-5 text-warning" aria-hidden /> {status === 'error' ? 'The contact form could not load' : 'The contact form is not connected yet'}</p>
        <p className="mt-2 text-muted">
          {status === 'error' ? 'We could not reach the server to open the form. ' : 'Messages cannot be received from this site at the moment, so we are not offering a form that would go nowhere. '}
          In the meantime, the <Link href="/docs" className="font-medium text-primary hover:underline">documentation</Link> and <Link href="/faq" className="font-medium text-primary hover:underline">FAQ</Link> cover setup, OBS and common problems.
        </p>
        {status === 'error' ? (
          <button type="button" onClick={load} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-strong/70 px-4 text-sm font-semibold text-text hover:border-primary">
            <RotateCcw className="size-4" aria-hidden /> Try again
          </button>
        ) : null}
      </div>
    );
  if (sent)
    return (
      <div role="status" className="rounded-2xl border border-healthy/45 bg-healthy/10 p-6 text-text">
        <p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="size-5 text-healthy" aria-hidden /> Message received</p>
        <p className="mt-2 text-[15px] text-muted">
          Thanks. The MatchFrame team has your message{sent.reference ? <> (reference <strong className="font-semibold text-text">{sent.reference}</strong>)</> : null} and will reply to <strong className="font-semibold text-text">{sent.email}</strong>.
        </p>
        <button type="button" onClick={() => setSent(null)} className="mt-4 text-sm font-semibold text-primary hover:underline">Send another message</button>
      </div>
    );

  const input = 'mt-1.5 min-h-11 w-full rounded-xl border bg-bg px-3.5 text-[15px] text-text placeholder:text-muted/70 transition hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25';
  const border = (k: string) => (fieldErrors[k] ? 'border-live' : 'border-border');
  const described = (k: string, hint?: boolean) => (fieldErrors[k] ? `cf-${k}-error` : hint ? `cf-${k}-hint` : undefined);
  const below = (k: string, hint?: string) =>
    fieldErrors[k] ? <p id={`cf-${k}-error`} className="mt-1.5 text-sm text-live">{fieldErrors[k]}</p> : hint ? <p id={`cf-${k}-hint`} className="mt-1.5 text-sm text-muted">{hint}</p> : null;
  const label = (k: string, text: string, optional = false) => (
    <label htmlFor={`cf-${k}`} className="block text-sm font-medium text-text">
      {text}
      {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
    </label>
  );
  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-2xl border border-border bg-panel p-5 shadow-card sm:p-7" aria-busy={busy}>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          {label('name', 'Your name')}
          <input id="cf-name" value={f.name} onChange={set('name')} autoComplete="name" required maxLength={80} aria-invalid={!!fieldErrors.name} aria-describedby={described('name')} className={`${input} ${border('name')}`} />
          {below('name')}
        </div>
        <div>
          {label('email', 'Email to reply to')}
          <input id="cf-email" type="email" value={f.email} onChange={set('email')} autoComplete="email" required maxLength={254} aria-invalid={!!fieldErrors.email} aria-describedby={described('email')} className={`${input} ${border('email')}`} />
          {below('email')}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          {label('topic', 'What is it about?')}
          <select id="cf-topic" value={f.topic} onChange={set('topic')} required aria-invalid={!!fieldErrors.topic} aria-describedby={described('topic')} className={`${input} ${border('topic')}`}>
            <option value="">Choose…</option>
            {Object.entries(status.topics).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {below('topic')}
        </div>
        {f.topic === 'sales' || f.plan ? (
          <div>
            {label('plan', 'Plan you are interested in', true)}
            <select id="cf-plan" value={f.plan} onChange={set('plan')} className={`${input} border-border`}>
              <option value="">Not sure yet</option>
              {Object.entries(PLANS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        ) : (
          <div>
            {label('sport', 'Sport', true)}
            <input id="cf-sport" value={f.sport} onChange={set('sport')} maxLength={40} className={`${input} border-border`} />
          </div>
        )}
      </div>
      {f.topic === 'support' ? (
        <div className="flex gap-3 rounded-xl border border-primary/35 bg-primary/5 p-4 text-sm leading-relaxed text-text">
          <LifeBuoy className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <p>
            <span className="font-semibold">Problem during a match right now?</span> We do not offer live matchday support, so start with the guides for{' '}
            <Link href="/docs/troubleshooting/graphics-not-visible" className="font-medium text-primary hover:underline">missing graphics</Link> and{' '}
            <Link href="/docs/troubleshooting/connection-loss" className="font-medium text-primary hover:underline">a dropped connection</Link>. For anything else, send us the details below.
          </p>
        </div>
      ) : null}
      <div>
        {label('organisation', 'Club or organisation', true)}
        <input id="cf-organisation" value={f.organisation} onChange={set('organisation')} autoComplete="organization" maxLength={120} className={`${input} border-border`} />
      </div>
      <div>
        {label('message', 'Message')}
        <textarea id="cf-message" value={f.message} onChange={set('message')} required rows={6} maxLength={4000} aria-invalid={!!fieldErrors.message} aria-describedby={described('message', true)} className={`${input} ${border('message')} py-3`} />
        {below('message', 'For setup help, say which match and what you saw. Never include passwords or stream keys.')}
      </div>
      {/* spam trap: hidden from people and screen readers */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
      </div>
      {error ? (
        <p ref={errorRef} tabIndex={-1} role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-live/45 bg-live/10 px-4 py-3 text-sm text-text outline-none">
          <TriangleAlert className="size-4 shrink-0 text-live" aria-hidden />
          <span className="flex-1">{error.message}</span>
          {error.retry ? (
            <button type="submit" className="font-semibold text-primary hover:underline">Try again</button>
          ) : null}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-6 text-[15px] font-semibold text-on-primary shadow-sm transition hover:bg-primary-strong disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Sending…' : 'Send message'}
        </button>
        <p className="text-xs text-muted">We reply by email. No mailing lists.</p>
      </div>
    </form>
  );
}
