'use client';
// Staff console: the staff team. Owners manage everyone; Admins add and change Moderators and Support.
import Link from 'next/link';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Card, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Table } from '@bs/ui';
import { del, patch, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { useStaff, type StaffRole } from '@/components/staff/staff-shell';

interface Member { userId: string; role: StaffRole; source: 'granted' | 'config'; name: string; email: string; twoFactorEnabled: boolean | null; disabledAt: string | null; since: string }

export default function StaffTeamPage() {
  const s = useStaff();
  const team = useGet<Member[]>(['staff', 'team'], 'staff/team');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('support');
  const inv = [['staff', 'team']];
  const add = useAction(() => post('staff/team', { email, role }), inv, { success: (_r) => `${email} is now ${s.roles.find((r) => r.role === role)?.label} staff` });
  const change = useAction((x: { userId: string; role: StaffRole }) => patch(`staff/team/${encodeURIComponent(x.userId)}`, { role: x.role }), inv, { success: 'Role changed' });
  const remove = useAction((userId: string) => del(`staff/team/${encodeURIComponent(userId)}`), inv, { success: 'Removed from staff' });
  const manage = s.can['staff.manage'];
  // the roles this staff member may hand out
  const grantable = s.roles.filter((r) => s.role === 'owner' || r.role === 'moderator' || r.role === 'support');
  const canEdit = (m: Member) => manage && m.userId !== s.userId && m.source !== 'config' && (s.role === 'owner' || m.role === 'moderator' || m.role === 'support');

  return (
    <div>
      <PageHeader title="Staff team" subtitle="The people who run this installation, across every organisation. Not the same as an organisation's own members and roles." />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div>
          <ErrorNotice error={team.error ?? change.error ?? remove.error} />
          {team.isLoading ? <Spinner /> : (
            <Table>
              <thead><tr><th>Name</th><th>Role</th><th>Two-step</th><th>Since</th><th /></tr></thead>
              <tbody>
                {team.data?.map((m) => (
                  <tr key={m.userId}>
                    <td><Link className="text-primary hover:underline" href={`/staff/users/${m.userId}`}>{m.name}</Link><div className="text-xs text-muted">{m.email}{m.userId === s.userId ? ' · you' : ''}</div></td>
                    <td>
                      {canEdit(m) ? (
                        <NativeSelect aria-label={`Role of ${m.name}`} className="w-auto" value={m.role} onChange={(e) => change.mutate({ userId: m.userId, role: e.target.value as StaffRole })}>
                          {grantable.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
                        </NativeSelect>
                      ) : (
                        <span className="flex items-center gap-2">{s.roles.find((r) => r.role === m.role)?.label}{m.source === 'config' ? <StatusPill tone="neutral" icon={false}>from configuration</StatusPill> : null}</span>
                      )}
                    </td>
                    <td>{m.twoFactorEnabled ? 'on' : <StatusPill tone="warning">off</StatusPill>}</td>
                    <td className="text-muted">{fmtDate(m.since, 'UTC', { dateStyle: 'medium' })}</td>
                    <td className="text-right">{canEdit(m) ? <Button size="sm" variant="ghost" aria-label={`Remove ${m.name} from staff`} loading={remove.isPending} onClick={() => confirm(`Remove ${m.name} from the staff team?`) && remove.mutate(m.userId)}><Trash2 className="size-4" /></Button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        <div className="grid content-start gap-4">
          {manage ? (
            <Card className="p-4">
              <h2 className="mb-2 font-medium">Add to staff</h2>
              <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setEmail('') }); }}>
                <Field label="Email of their account" htmlFor="staff-add-email" hint="They need to have signed up and verified their email."><Input id="staff-add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Field label="Role" htmlFor="staff-add-role">
                  <NativeSelect id="staff-add-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>{grantable.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</NativeSelect>
                </Field>
                <Button type="submit" variant="primary" loading={add.isPending} disabled={!email.includes('@')}>Add</Button>
                <ErrorNotice error={add.error} />
              </form>
            </Card>
          ) : null}
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Roles</h2>
            <dl className="space-y-2 text-sm">
              {s.roles.map((r) => <div key={r.role}><dt className="font-medium">{r.label}</dt><dd className="text-muted">{r.description}</dd></div>)}
            </dl>
            <p className="mt-3 text-xs text-muted">Owners can also be set with PLATFORM_OWNER_EMAILS in the server configuration; those are changed there.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
