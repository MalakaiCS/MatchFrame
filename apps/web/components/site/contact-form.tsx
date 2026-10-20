'use client';
// Public contact form: asks the API whether the form is connected (CONTACT_EMAIL set) and, if so, sends the
// message there by email. Shows field errors in place, and a real success or failure, never a pretend one.
import { useEffect, useState } from 'react';
import { CheckCircle2, TriangleAlert } from 'lucide-react';

type Status = { enabled: boolean; topics: Record<string, string> } | null;
type Fields = { name: string; email: string; topic: string; organisation: string; sport: string; message: string; website: string };
const EMPTY: Fields = { name: '', email: '', topic: '', organisation: '', sport: '', message: '', website: '' };

export function ContactForm() {
  const [status, setStatus] = useState<Status | 'error'>(null);
  const [f, setF] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/v1/public/contact')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Status) => setStatus(s))
      .catch(() => setStatus('error'));
  }, []);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await fetch('/api/v1/public/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, organisation: f.organisation || undefined, sport: f.sport || undefined }) });
      const body = (await r.json().catch(() => ({}))) as { error?: { message?: string; fields?: { field: string; message: string }[] } };
      if (!r.ok) {
        const fe = Object.fromEntries((body.error?.fields ?? []).map((x) => [x.field, x.message]));
        setFieldErrors(fe);
        setError(body.error?.message ?? 'We could not send your message. Please try again.');
        return;
      }
      setSent(true);
      setF(EMPTY);
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (status === null) return <p className="text-muted">Loading the form…</p>;
  if (status === 'error' || !status.enabled)
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-5 text-sm leading-relaxed text-white">
        <p className="flex items-center gap-2 font-semibold"><TriangleAlert className="size-4 text-warning" aria-hidden /> The contact form is not connected yet</p>
        <p className="mt-2 text-white/85">Messages cannot be sent from this site at the moment, so we are not offering a form that would go nowhere. In the meantime, the <a href="/docs" className="text-brand-cyan hover:underline">documentation</a> and <a href="/faq" className="text-brand-cyan hover:underline">FAQ</a> cover setup, OBS and common problems.</p>
      </div>
    );
  if (sent)
    return (
      <div role="status" className="rounded-xl border border-healthy/40 bg-healthy/10 p-5 text-white">
        <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-5 text-healthy" aria-hidden /> Message sent</p>
        <p className="mt-2 text-sm text-white/85">Thanks. It has gone to the MatchFrame team by email, and we will reply to the address you gave.</p>
        <button type="button" onClick={() => setSent(false)} className="mt-4 text-sm text-brand-cyan hover:underline">Send another message</button>
      </div>
    );

  const input = 'mt-1.5 min-h-11 w-full rounded-lg border bg-panel px-3 text-white placeholder:text-muted focus:border-brand-cyan focus:outline-none';
  const border = (k: string) => (fieldErrors[k] ? 'border-live' : 'border-white/10');
  const described = (k: string, hint?: boolean) => (fieldErrors[k] ? `cf-${k}-error` : hint ? `cf-${k}-hint` : undefined);
  const below = (k: string, hint?: string) =>
    fieldErrors[k] ? <p id={`cf-${k}-error`} className="mt-1 text-xs text-live">{fieldErrors[k]}</p> : hint ? <p id={`cf-${k}-hint`} className="mt-1 text-xs text-muted">{hint}</p> : null;
  const label = (k: string, text: string, optional = false) => (
    <label htmlFor={`cf-${k}`} className="block text-sm text-white">
      {text}
      {optional ? <span className="text-muted"> (optional)</span> : null}
    </label>
  );
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
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
      <div>
        {label('topic', 'What is it about?')}
        <select id="cf-topic" value={f.topic} onChange={set('topic')} required aria-invalid={!!fieldErrors.topic} aria-describedby={described('topic')} className={`${input} ${border('topic')}`}>
          <option value="">Choose…</option>
          {Object.entries(status.topics).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {below('topic')}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          {label('organisation', 'Club or organisation', true)}
          <input id="cf-organisation" value={f.organisation} onChange={set('organisation')} autoComplete="organization" maxLength={120} className={`${input} border-white/10`} />
        </div>
        <div>
          {label('sport', 'Sport', true)}
          <input id="cf-sport" value={f.sport} onChange={set('sport')} maxLength={40} className={`${input} border-white/10`} />
        </div>
      </div>
      <div>
        {label('message', 'Message')}
        <textarea id="cf-message" value={f.message} onChange={set('message')} required rows={6} maxLength={4000} aria-invalid={!!fieldErrors.message} aria-describedby={described('message', true)} className={`${input} ${border('message')} py-2.5`} />
        {below('message', 'For setup help, say which match and what you saw. Never include passwords or stream keys.')}
      </div>
      {/* spam trap: hidden from people and screen readers */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-live/40 bg-live/10 px-4 py-3 text-sm text-white">{error}</p> : null}
      <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center rounded-lg bg-brand-cyan px-6 text-sm font-semibold text-brand-navy transition hover:bg-white disabled:opacity-60">
        {busy ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}
