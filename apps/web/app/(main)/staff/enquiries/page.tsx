'use client';
// Staff console: messages from the public contact form, newest first. Reply by email (the address is a mail link);
// mark a message Replied or Closed so the team knows it is handled. Admins and Owners can delete one. Every change
// is in the staff log. Messages are deleted automatically a year after they arrive.
import { useState } from 'react';
import { Mail, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorNotice, PageHeader, Spinner, StatusPill, cx, type Tone } from '@bs/ui';
import { api } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { useStaff } from '@/components/staff/staff-shell';

interface Enquiry { id: string; reference: string; name: string; email: string; topic: string; topicLabel: string; organisation: string | null; sport: string | null; plan: string | null; message: string; status: 'new' | 'replied' | 'closed'; delivery: 'pending' | 'sent' | 'failed' | 'not_configured'; deliveryError: string | null; createdAt: string }
interface List { items: Enquiry[]; counts: Record<string, number>; page: number; emailConfigured: boolean; retentionDays: number }

const FILTERS = [
  { key: 'new', label: 'New' },
  { key: 'replied', label: 'Replied' },
  { key: 'closed', label: 'Closed' },
  { key: '', label: 'All' },
];
const STATUS_TONE: Record<Enquiry['status'], Tone> = { new: 'primary', replied: 'healthy', closed: 'neutral' };
const DELIVERY: Record<Enquiry['delivery'], { tone: Tone; text: string }> = {
  sent: { tone: 'healthy', text: 'Emailed to the team' },
  pending: { tone: 'warning', text: 'Email retrying' },
  failed: { tone: 'live', text: 'Email failed' },
  not_configured: { tone: 'neutral', text: 'No team inbox set' },
};

export default function StaffEnquiriesPage() {
  const staff = useStaff();
  const [status, setStatus] = useState('new');
  const [open, setOpen] = useState<string | null>(null);
  const list = useGet<List>(['staff', 'enquiries', status], `staff/enquiries?${new URLSearchParams(status ? { status } : {})}`, { refetchInterval: 60_000 });
  const mark = useAction((v: { id: string; status: string }) => api(`/api/v1/staff/enquiries/${v.id}`, { method: 'PATCH', json: { status: v.status } }), [['staff', 'enquiries']], { success: (_r, v) => (v.status === 'new' ? 'Marked as new' : `Marked ${v.status}`) });
  const remove = useAction((id: string) => api(`/api/v1/staff/enquiries/${id}`, { method: 'DELETE' }), [['staff', 'enquiries']], { success: 'Message deleted' });

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Enquiries"
        subtitle={<>Messages from the contact form on the public site. Reply by email, then mark the message Replied. {list.data ? <>Deleted automatically after {Math.round(list.data.retentionDays / 30)} months.</> : null}</>}
      />
      {list.data && !list.data.emailConfigured ? (
        <p className="mb-4 rounded-lg border border-warning/45 bg-warning/10 px-4 py-3 text-sm text-text">
          No team inbox is set (<code className="text-xs">CONTACT_EMAIL</code>), so new messages arrive only here. Set it to have each one emailed as well, with the sender as reply-to.
        </p>
      ) : null}
      <div role="tablist" aria-label="Show" className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={status === f.key} onClick={() => setStatus(f.key)} className={cx('inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium', status === f.key ? 'border-primary bg-primary/10 text-text' : 'border-border text-muted hover:text-text')}>
            {f.label}
            {f.key && list.data ? <span className="rounded-full bg-elevated px-1.5 text-xs tabular-nums text-muted">{list.data.counts[f.key] ?? 0}</span> : null}
          </button>
        ))}
      </div>
      <ErrorNotice error={list.error ?? mark.error ?? remove.error} />
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? (
        <EmptyState icon={<Mail className="size-6 text-muted" aria-hidden />} title={status === 'new' ? 'No new messages' : 'Nothing here'} body="Messages sent from the contact page appear here." />
      ) : (
        <ul className="space-y-3">
          {list.data.items.map((e) => {
            const expanded = open === e.id;
            return (
              <li key={e.id} className="rounded-[var(--radius-card)] border border-border bg-panel shadow-card">
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : e.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left">
                  <StatusPill tone={STATUS_TONE[e.status]}>{e.status}</StatusPill>
                  <span className="font-medium">{e.name}</span>
                  <span className="text-sm text-muted">{e.topicLabel}{e.plan ? ` · ${e.plan}` : ''}</span>
                  <span className="ml-auto text-xs text-muted">{e.reference} · {fmtDate(e.createdAt, 'UTC')} UTC</span>
                </button>
                {expanded ? (
                  <div className="border-t border-border px-4 py-4">
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
                      <dt className="text-muted">Reply to</dt><dd><a className="font-medium text-primary hover:underline" href={`mailto:${e.email}?subject=${encodeURIComponent(`Re: your message to MatchFrame (${e.reference})`)}`}>{e.email}</a></dd>
                      {e.organisation ? <><dt className="text-muted">Organisation</dt><dd>{e.organisation}</dd></> : null}
                      {e.sport ? <><dt className="text-muted">Sport</dt><dd>{e.sport}</dd></> : null}
                      <dt className="text-muted">Team inbox</dt><dd><StatusPill tone={DELIVERY[e.delivery].tone}>{DELIVERY[e.delivery].text}</StatusPill>{e.deliveryError ? <span className="ml-2 text-xs text-muted">{e.deliveryError}</span> : null}</dd>
                    </dl>
                    <p className="mt-4 whitespace-pre-wrap rounded-lg bg-bg p-4 text-sm leading-relaxed">{e.message}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {e.status !== 'replied' ? <Button size="sm" variant="primary" loading={mark.isPending} onClick={() => mark.mutate({ id: e.id, status: 'replied' })}>Mark replied</Button> : null}
                      {e.status !== 'closed' ? <Button size="sm" loading={mark.isPending} onClick={() => mark.mutate({ id: e.id, status: 'closed' })}>Close</Button> : null}
                      {e.status !== 'new' ? <Button size="sm" variant="ghost" onClick={() => mark.mutate({ id: e.id, status: 'new' })}>Mark as new</Button> : null}
                      {staff.can['enquiries.delete'] ? (
                        <Button size="sm" variant="danger" className="ml-auto" loading={remove.isPending} onClick={() => { if (window.confirm(`Delete message ${e.reference}? This cannot be undone.`)) remove.mutate(e.id); }}>
                          <Trash2 className="size-4" aria-hidden /> Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
