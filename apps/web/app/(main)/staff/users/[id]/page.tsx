'use client';
// Staff console: one account. Its organisations and sign-in state; resend verification (Support), sign out
// everywhere and disable or enable (Admin).
import Link from 'next/link';
import { use } from 'react';
import { Button, Card, ErrorNotice, PageHeader, Spinner, StatusPill } from '@bs/ui';
import { post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { ReasonButton } from '@/components/staff/reason-dialog';
import { useStaff } from '@/components/staff/staff-shell';
import { orgStatusPill } from '@/components/staff/pills';

interface Account {
  id: string; name: string; email: string; emailVerified: boolean; twoFactorEnabled: boolean | null; disabledAt: string | null; disabledReason: string | null; createdAt: string;
  staffRole: string | null; staffSource: string | null; lastActiveAt: string | null; activeSessions: number;
  organisations: { organisationId: string; name: string; organisationStatus: string; role: string; status: string }[];
}

export default function StaffUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useStaff();
  const u = useGet<Account>(['staff', 'user', id], `staff/users/${encodeURIComponent(id)}`);
  const inv = [['staff', 'user', id], ['staff', 'users']];
  const act = useAction((x: { path: string; reason?: string }) => post(`staff/users/${encodeURIComponent(id)}/${x.path}`, { reason: x.reason }), inv);
  const resend = useAction(() => post(`staff/users/${encodeURIComponent(id)}/resend-verification`), inv, { success: 'Verification email sent' });

  if (u.isLoading) return <Spinner />;
  if (!u.data) return <ErrorNotice error={u.error} />;
  const a = u.data;
  const self = a.id === s.userId;

  return (
    <div>
      <PageHeader
        crumbs={<Link href="/staff/users" className="hover:underline">Accounts</Link>}
        title={<span className="flex items-center gap-3">{a.name} {a.disabledAt ? <StatusPill tone="live">disabled</StatusPill> : null}{a.staffRole ? <StatusPill tone="primary" icon={false}>staff · {a.staffRole}</StatusPill> : null}</span>}
        subtitle={a.email}
        actions={
          self ? null : (
            <>
              {!a.emailVerified && s.can['user.resend_verification'] ? <Button size="sm" loading={resend.isPending} onClick={() => resend.mutate(undefined)}>Resend verification email</Button> : null}
              {s.can['user.sign_out'] && a.activeSessions ? <ReasonButton label="Sign out everywhere" title={`Sign ${a.name} out everywhere`} description="Every device signed in to this account is signed out now. They can sign in again." confirm="Sign out everywhere" optional onConfirm={(reason) => act.mutateAsync({ path: 'sign-out', reason })} /> : null}
              {s.can['user.disable'] ? (
                a.disabledAt ? (
                  <ReasonButton label="Enable account" title={`Enable ${a.name}`} description="They can sign in again." confirm="Enable" optional onConfirm={(reason) => act.mutateAsync({ path: 'enable', reason })} />
                ) : (
                  <ReasonButton label="Disable account" danger title={`Disable ${a.name}`} description="They are signed out everywhere and cannot sign in until the account is enabled again. Their organisations are not changed." confirm="Disable account" onConfirm={(reason) => act.mutateAsync({ path: 'disable', reason })} />
                )
              ) : null}
            </>
          )
        }
      />
      <ErrorNotice error={act.error ?? resend.error} />
      {a.disabledAt ? <p className="mb-4 rounded-md border border-live/40 bg-live/10 px-3 py-2 text-sm">Disabled {fmtDate(a.disabledAt, 'UTC')}: {a.disabledReason}</p> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Sign-in</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Email verified</dt><dd>{a.emailVerified ? 'yes' : 'not yet'}</dd>
            <dt className="text-muted">Two-step sign-in</dt><dd>{a.twoFactorEnabled ? 'on' : 'off'}</dd>
            <dt className="text-muted">Signed in on</dt><dd>{a.activeSessions} device{a.activeSessions === 1 ? '' : 's'}</dd>
            <dt className="text-muted">Last active</dt><dd>{a.lastActiveAt ? fmtDate(a.lastActiveAt, 'UTC') : '—'}</dd>
            <dt className="text-muted">Signed up</dt><dd>{fmtDate(a.createdAt, 'UTC', { dateStyle: 'medium' })}</dd>
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Organisations</h2>
          {a.organisations.length ? (
            <ul className="space-y-1 text-sm">
              {a.organisations.map((o) => (
                <li key={o.organisationId} className="flex items-center justify-between gap-2">
                  <Link href={`/staff/organisations/${o.organisationId}`} className="truncate text-primary hover:underline">{o.name}</Link>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">{o.role}{o.status !== 'active' ? ` · ${o.status}` : ''} {o.organisationStatus !== 'active' ? orgStatusPill(o.organisationStatus) : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Not a member of any organisation.</p>}
        </Card>
      </div>
    </div>
  );
}
