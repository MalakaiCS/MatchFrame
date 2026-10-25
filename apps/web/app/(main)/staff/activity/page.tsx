'use client';
// Staff console (Admin and above): everything staff have done, newest first, with who did it and why.
import Link from 'next/link';
import { ErrorNotice, PageHeader, Spinner, StatusPill, Table } from '@bs/ui';
import { fmtDate, useGet } from '@/lib/hooks';

interface Entry { id: number; action: string; actorRole: string; actor: string | null; targetType: string; targetId: string | null; organisationId: string | null; reason: string | null; detail: Record<string, unknown>; createdAt: string }

const LABELS: Record<string, string> = {
  'organisation.view': 'Looked at an organisation',
  'organisation.suspend': 'Suspended an organisation',
  'organisation.reactivate': 'Reactivated an organisation',
  'organisation.plan': 'Set a plan',
  'content.match_page_down': 'Took down a public match page',
  'content.share_link_revoked': 'Revoked a share link',
  'user.disable': 'Disabled an account',
  'user.enable': 'Enabled an account',
  'user.sign_out': 'Signed an account out everywhere',
  'user.resend_verification': 'Resent a verification email',
  'staff.add': 'Added to staff',
  'staff.change': 'Changed a staff role',
  'staff.remove': 'Removed from staff',
  'staff.owner_from_config': 'Became Owner (configuration)',
  'staff.owner_removed_from_config': 'No longer Owner (configuration)',
};

export default function StaffActivityPage() {
  const log = useGet<Entry[]>(['staff', 'activity'], 'staff/activity?limit=200');
  return (
    <div>
      <PageHeader title="Staff log" subtitle="Everything done in the staff console. It cannot be edited or deleted." />
      <ErrorNotice error={log.error} />
      {log.isLoading ? <Spinner /> : (
        <Table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>Reason</th></tr></thead>
          <tbody>
            {log.data?.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-muted">{fmtDate(e.createdAt, 'UTC')}</td>
                <td>{e.actor ?? '—'} <StatusPill tone="neutral" icon={false} className="ml-1">{e.actorRole}</StatusPill></td>
                <td>{LABELS[e.action] ?? e.action}{e.detail && typeof e.detail.email === 'string' ? <span className="text-muted"> · {e.detail.email}{e.detail.after ? ` → ${String(e.detail.after)}` : ''}</span> : null}</td>
                <td>
                  {e.organisationId ? <Link className="text-primary hover:underline" href={`/staff/organisations/${e.organisationId}`}>organisation</Link> : e.targetType === 'user' && e.targetId ? <Link className="text-primary hover:underline" href={`/staff/users/${e.targetId}`}>account</Link> : e.targetType}
                </td>
                <td className="text-muted">{e.reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
