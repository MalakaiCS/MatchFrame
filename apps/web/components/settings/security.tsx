'use client';
// Security: two-step sign-in for this account (authenticator app with backup codes), the organisation's
// requirement that everyone uses it, the account's active sessions, and a password change.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toDataURL } from 'qrcode';
import { Button, Card, Dialog, ErrorNotice, Field, Input, Spinner, StatusPill, Switch, Table } from '@bs/ui';
import { ApiError, api, patch } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { useMe } from '@/lib/session';
import { SignInMethods, useHasPassword } from './sign-in-methods';

interface Session { id: string; token: string; userAgent: string | null; ipAddress: string | null; createdAt: string; updatedAt: string; expiresAt: string }
const auth = <T,>(path: string, json: unknown) => api<T>(`/api/auth/${path}`, { method: 'POST', json });

/** Enrol an authenticator app: password → QR code and backup codes → first code confirms it. */
export function TwoFactorEnrol({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const qc = useQueryClient();
  const { hasPassword, accounts } = useHasPassword();
  const [step, setStep] = useState<'password' | 'scan' | 'done'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    if (uri) toDataURL(uri, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [uri]);
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await auth<{ totpURI: string; backupCodes: string[] }>('two-factor/enable', hasPassword ? { password } : {});
      setUri(r.totpURI);
      setCodes(r.backupCodes ?? []);
      setStep('scan');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await auth('two-factor/verify-totp', { code: code.replace(/\s/g, '') });
      await qc.invalidateQueries({ queryKey: ['me'] });
      setStep('done');
      onDone?.();
    } catch {
      setErr(new ApiError(400, 'CODE', 'That code was not accepted. Codes change every 30 seconds; try the current one.'));
    } finally {
      setBusy(false);
    }
  };
  const secret = uri ? new URL(uri).searchParams.get('secret') : null;
  if (step === 'done') return <p className="text-sm text-healthy">Two-step sign-in is on. Keep the backup codes somewhere safe.</p>;
  if (step === 'password')
    return (
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        {!compact ? <p className="text-sm text-muted">You will need an authenticator app (Google Authenticator, Authy, 1Password…).{hasPassword ? ' Confirm your password to begin.' : ''}</p> : null}
        {hasPassword ? <Field label="Your password" htmlFor="tf-pw"><Input id="tf-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field> : null}
        <ErrorNotice error={err} />
        <Button type="submit" variant="primary" loading={busy} disabled={accounts.isLoading || (hasPassword && !password)}>Set up two-step sign-in</Button>
      </form>
    );
  return (
    <div className="grid gap-3 text-sm">
      <p>1. Scan this code with your authenticator app{secret ? <>, or enter the key <code className="break-all text-xs">{secret}</code></> : null}.</p>
      {qr ? <img src={qr} alt="QR code for the authenticator app" className="size-[220px] rounded bg-white p-1" /> : <Spinner />}
      {codes.length ? (
        <div>
          <p className="mb-1">2. Save these backup codes. Each works once if you lose the phone.</p>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-2 font-mono text-xs sm:grid-cols-5">{codes.map((c) => <span key={c}>{c}</span>)}</div>
        </div>
      ) : null}
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <Field label="3. Enter the 6-digit code the app shows now" htmlFor="tf-code"><Input id="tf-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <ErrorNotice error={err} />
        <Button type="submit" variant="primary" loading={busy} disabled={code.replace(/\s/g, '').length < 6}>Turn on</Button>
      </form>
    </div>
  );
}

export function SecurityPanel({ owner, tz }: { owner: boolean; tz: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const { hasPassword } = useHasPassword();
  const org = useGet<{ requireTwoFactor: boolean }>(['org'], 'organisations/current');
  const [list, setList] = useState<Session[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const requireTf = useAction((v: boolean) => patch('organisations/current', { requireTwoFactor: v }), [['org'], ['me']], { success: (r: unknown) => ((r as { requireTwoFactor?: boolean }).requireTwoFactor ? 'Two-step sign-in is now required for everyone in this organisation' : 'Two-step sign-in is optional again') });
  const loadSessions = async () => {
    try {
      const [s, cur] = await Promise.all([api<Session[]>('/api/auth/list-sessions'), api<{ session?: { id: string } }>('/api/auth/get-session')]);
      setList(s);
      setCurrent(cur?.session?.id ?? null);
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  useEffect(() => {
    void loadSessions();
  }, []);
  const revoke = async (token: string) => {
    await auth('revoke-session', { token }).catch((e) => setErr(e as ApiError));
    await loadSessions();
  };
  const revokeOthers = async () => {
    await auth('revoke-other-sessions', {}).catch((e) => setErr(e as ApiError));
    setMsg('Every other session has been signed out.');
    await loadSessions();
  };
  const disable = async () => {
    setErr(null);
    try {
      await auth('two-factor/disable', hasPassword ? { password } : {});
      await qc.invalidateQueries({ queryKey: ['me'] });
      setDisableOpen(false);
      setPassword('');
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  const changePassword = async () => {
    setErr(null);
    setMsg(null);
    try {
      await auth('change-password', { currentPassword: pw.current, newPassword: pw.next, revokeOtherSessions: true });
      setPw({ current: '', next: '' });
      setMsg('Password changed. Other sessions were signed out.');
      await loadSessions();
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  const tfOn = !!me.data?.user.twoFactorEnabled;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SignInMethods tz={tz} />
      <Card className="p-4">
        <h2 className="mb-1 flex items-center gap-2 font-medium">Two-step sign-in <StatusPill tone={tfOn ? 'healthy' : 'neutral'}>{tfOn ? 'on' : 'off'}</StatusPill></h2>
        <p className="mb-3 text-xs text-muted">A code from an authenticator app is asked for when you sign in, so a stolen password alone is not enough.</p>
        {tfOn ? <Button size="sm" variant="ghost" onClick={() => setDisableOpen(true)}>Turn off</Button> : <Button size="sm" variant="primary" onClick={() => setEnrolOpen(true)}>Turn on</Button>}
        <h3 className="mb-1 mt-5 text-sm font-medium">For the whole organisation</h3>
        <Switch label="Require two-step sign-in for every member" checked={!!org.data?.requireTwoFactor} disabled={!owner || requireTf.isPending} onCheckedChange={(v) => requireTf.mutate(v)} />
        <p className="mt-1 text-xs text-muted">Members who have not turned it on are asked to set it up before they can do anything else. Owners only.{!tfOn && owner ? ' Turn it on for your own account first.' : ''}</p>
        <ErrorNotice error={requireTf.error} />
      </Card>
      {hasPassword ? <Card className="p-4">
        <h2 className="mb-1 font-medium">Change password</h2>
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void changePassword(); }}>
          <Field label="Current password" htmlFor="pw-c"><Input id="pw-c" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password" htmlFor="pw-n" hint="At least 12 characters"><Input id="pw-n" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Button type="submit" size="sm" disabled={!pw.current || pw.next.length < 12}>Change password</Button>
        </form>
      </Card> : null}
      <Card className="p-4 lg:col-span-2">
        <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="font-medium">Where you are signed in</h2><Button size="sm" variant="ghost" className="ml-auto" onClick={revokeOthers}>Sign out everywhere else</Button></div>
        {msg ? <p className="mb-2 text-sm text-healthy">{msg}</p> : null}
        <ErrorNotice error={err} />
        {!list ? <Spinner /> : (
          <Table><thead><tr><th>Device</th><th>Address</th><th>Signed in</th><th>Last seen</th><th /></tr></thead><tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td className="max-w-xs truncate text-xs">{s.userAgent ?? 'Unknown'}{s.id === current ? <StatusPill className="ml-1" tone="primary">this session</StatusPill> : null}</td>
                <td className="text-xs text-muted">{s.ipAddress ?? ''}</td>
                <td className="text-xs text-muted">{fmtDate(s.createdAt, tz)}</td>
                <td className="text-xs text-muted">{fmtDate(s.updatedAt, tz)}</td>
                <td className="text-right">{s.id !== current ? <Button size="sm" variant="ghost" onClick={() => revoke(s.token)}>Sign out</Button> : null}</td>
              </tr>
            ))}
          </tbody></Table>
        )}
      </Card>
      <Dialog open={enrolOpen} onOpenChange={setEnrolOpen} title="Two-step sign-in" description="Takes about a minute.">
        <TwoFactorEnrol onDone={() => setTimeout(() => setEnrolOpen(false), 1500)} />
      </Dialog>
      <Dialog open={disableOpen} onOpenChange={setDisableOpen} title="Turn off two-step sign-in" description="Your password alone will sign you in again."
        footer={<><Button variant="ghost" onClick={() => setDisableOpen(false)}>Keep it on</Button><Button variant="danger" disabled={hasPassword && !password} onClick={disable}>Turn off</Button></>}>
        {hasPassword ? <Field label="Your password" htmlFor="tf-off"><Input id="tf-off" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field> : null}
        <ErrorNotice error={err} />
      </Dialog>
    </div>
  );
}
