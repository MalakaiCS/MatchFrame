'use client';
// Staff console: one organisation. Members, usage and recent activity for everyone on the staff team; taking down
// public pages and share links for Moderators; suspending, reactivating and setting the plan for Admins.
import Link from 'next/link';
import { use, useState } from 'react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Table } from '@bs/ui';
import { PRICE_PLANS } from '@bs/domain';
import { post, put } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { ReasonButton } from '@/components/staff/reason-dialog';
import { useStaff } from '@/components/staff/staff-shell';
import { orgStatusPill } from '@/components/staff/pills';

interface Detail {
  organisation: { id: string; name: string; slug: string; status: string; timezone: string; locale: string; customDomain: string | null; requireTwoFactor: boolean; suspendedAt: string | null; suspendedReason: string | null; createdAt: string };
  members: { membershipId: string; userId: string; name: string; email: string; role: string; status: string; disabledAt: string | null }[];
  entitlements: { plan: string } | null;
  counts: { competitions: number; matches: number; liveMatches: number; outputs: number; storageBytes: number };
  publicPages: { matchId: string; home: string; away: string; scheduledAt: string; status: string }[];
  shareLinks: { id: string; resourceType: string; publicId: string; expiresAt: string | null; accessCount: number; createdAt: string }[];
  activity: { id: number; action: string; actorType: string; actor: string | null; resourceType: string; reason: string | null; createdAt: string }[];
}

const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);

function PlanButton({ id, current }: { id: string; current: string }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(current);
  const [reason, setReason] = useState('');
  const save = useAction(() => put(`staff/organisations/${id}/plan`, { plan, reason }), [['staff', 'organisation', id], ['staff', 'organisations']], { success: 'Plan set' });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Set plan</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Set the plan by hand"
        description="For invoiced or sponsored organisations. A Stripe subscription changing later sets the plan again."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate(undefined, { onSuccess: () => setOpen(false) })}>Set plan</Button></>}
      >
        <div className="grid gap-3">
          <Field label="Plan" htmlFor="staff-plan">
            <NativeSelect id="staff-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="free">No plan</option>
              {PRICE_PLANS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Reason" htmlFor="staff-plan-reason"><Input id="staff-plan-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorNotice error={save.error} />
        </div>
      </Dialog>
    </>
  );
}

export default function StaffOrganisationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useStaff();
  const d = useGet<Detail>(['staff', 'organisation', id], `staff/organisations/${id}`);
  const inv = [['staff', 'organisation', id], ['staff', 'organisations']];
  const act = useAction((x: { path: string; reason: string }) => post(`staff/organisations/${id}/${x.path}`, { reason: x.reason }), inv);

  if (d.isLoading) return <Spinner />;
  if (!d.data) return <ErrorNotice error={d.error} />;
  const { organisation: o, counts } = d.data;
  const tz = o.timezone;

  return (
    <div>
      <PageHeader
        crumbs={<Link href="/staff" className="hover:underline">Organisations</Link>}
        title={<span className="flex items-center gap-3">{o.name} {orgStatusPill(o.status)}</span>}
        subtitle={`${o.slug} · ${o.timezone} · plan ${d.data.entitlements?.plan ?? 'free'}`}
        actions={
          <>
            {s.can['organisation.plan'] ? <PlanButton id={id} current={d.data.entitlements?.plan ?? 'free'} /> : null}
            {s.can['organisation.suspend'] ? (
              o.status === 'suspended' ? (
                <ReasonButton label="Reactivate" title={`Reactivate ${o.name}`} description="Its members can use it again, and its outputs, public pages and share links work again." confirm="Reactivate" optional onConfirm={(reason) => act.mutateAsync({ path: 'reactivate', reason })} />
              ) : o.status === 'active' ? (
                <ReasonButton label="Suspend" danger title={`Suspend ${o.name}`} description="Members cannot use it (they are told it is suspended); its graphics outputs, public match pages, share links, API keys and invitations stop working. Nothing is deleted, and reactivating restores everything." confirm="Suspend organisation" onConfirm={(reason) => act.mutateAsync({ path: 'suspend', reason })} />
              ) : null
            ) : null}
          </>
        }
      />
      {o.status === 'suspended' ? <p className="mb-4 rounded-md border border-live/40 bg-live/10 px-3 py-2 text-sm">Suspended {fmtDate(o.suspendedAt, tz)}: {o.suspendedReason}</p> : null}
      <ErrorNotice error={act.error} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Usage</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Competitions</dt><dd>{counts.competitions}</dd>
            <dt className="text-muted">Matches</dt><dd>{counts.matches}{counts.liveMatches ? ` (${counts.liveMatches} live)` : ''}</dd>
            <dt className="text-muted">Graphics outputs</dt><dd>{counts.outputs}</dd>
            <dt className="text-muted">Media stored</dt><dd>{gb(counts.storageBytes)}</dd>
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Details</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Created</dt><dd>{fmtDate(o.createdAt, tz, { dateStyle: 'medium' })}</dd>
            <dt className="text-muted">Own address</dt><dd>{o.customDomain ?? '—'}</dd>
            <dt className="text-muted">Two-step sign-in</dt><dd>{o.requireTwoFactor ? 'required' : 'optional'}</dd>
            <dt className="text-muted">Locale</dt><dd>{o.locale}</dd>
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Members ({d.data.members.length})</h2>
          <ul className="space-y-1 text-sm">
            {d.data.members.map((m) => (
              <li key={m.membershipId} className="flex items-center justify-between gap-2">
                <Link href={`/staff/users/${m.userId}`} className="truncate text-primary hover:underline">{m.name} <span className="text-muted">{m.email}</span></Link>
                <span className="shrink-0 text-xs text-muted">{m.role}{m.status !== 'active' ? ` · ${m.status}` : ''}{m.disabledAt ? ' · disabled' : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <h2 className="mb-2 mt-6 font-medium">Public match pages</h2>
      {d.data.publicPages.length ? (
        <Table>
          <thead><tr><th>Match</th><th>When</th><th>Status</th><th /></tr></thead>
          <tbody>
            {d.data.publicPages.map((p) => (
              <tr key={p.matchId}>
                <td>{p.home} v {p.away}</td>
                <td className="text-muted">{fmtDate(p.scheduledAt, tz)}</td>
                <td>{p.status}</td>
                <td className="text-right">{s.can['content.takedown'] ? <ReasonButton label="Take down" danger title={`Take down ${p.home} v ${p.away}`} description="The match's public page and its data feed stop working. The organisation can share the match again with a new link." confirm="Take down" onConfirm={(reason) => act.mutateAsync({ path: `match-pages/${p.matchId}/take-down`, reason })} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <p className="text-sm text-muted">No match has a public page.</p>}

      <h2 className="mb-2 mt-6 font-medium">Media share links</h2>
      {d.data.shareLinks.length ? (
        <Table>
          <thead><tr><th>Shares</th><th>Link id</th><th>Created</th><th>Expires</th><th>Views</th><th /></tr></thead>
          <tbody>
            {d.data.shareLinks.map((l) => (
              <tr key={l.id}>
                <td>{l.resourceType}</td>
                <td className="font-mono text-xs">{l.publicId}</td>
                <td className="text-muted">{fmtDate(l.createdAt, tz)}</td>
                <td className="text-muted">{l.expiresAt ? fmtDate(l.expiresAt, tz) : 'never'}</td>
                <td>{l.accessCount}</td>
                <td className="text-right">{s.can['content.takedown'] ? <ReasonButton label="Revoke" danger title="Revoke this share link" description="Anyone with the link can no longer watch or embed it." confirm="Revoke" onConfirm={(reason) => act.mutateAsync({ path: `share-links/${l.id}/revoke`, reason })} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <p className="text-sm text-muted">No live share links.</p>}

      <h2 className="mb-2 mt-6 font-medium">Recent activity</h2>
      <Table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Reason</th></tr></thead>
        <tbody>
          {d.data.activity.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap text-muted">{fmtDate(a.createdAt, tz)}</td>
              <td>{a.actor ?? a.actorType}{a.actorType === 'staff' ? <StatusPill tone="primary" icon={false} className="ml-2">staff</StatusPill> : null}</td>
              <td className="font-mono text-xs">{a.action}</td>
              <td className="text-muted">{a.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
