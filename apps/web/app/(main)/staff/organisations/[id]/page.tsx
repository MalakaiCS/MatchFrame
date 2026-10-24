'use client';
// Staff console: one organisation. Members, usage and recent activity for everyone on the staff team; taking down
// public pages and share links for Moderators; suspending, reactivating and setting the plan for Admins. A plan set
// here always has an end (days, months, a date, or Permanent on purpose); the worker ends it on time and the
// organisation goes back to the plan it pays for.
import Link from 'next/link';
import { use, useState } from 'react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Table } from '@bs/ui';
import { PLAN_GRANT_DURATIONS, PRICE_PLANS, planGrantEnd, type PlanGrantDuration } from '@bs/domain';
import { post, put } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { ReasonButton } from '@/components/staff/reason-dialog';
import { useStaff } from '@/components/staff/staff-shell';
import { orgStatusPill } from '@/components/staff/pills';

interface Detail {
  organisation: { id: string; name: string; slug: string; status: string; timezone: string; locale: string; customDomain: string | null; requireTwoFactor: boolean; suspendedAt: string | null; suspendedReason: string | null; createdAt: string };
  members: { membershipId: string; userId: string; name: string; email: string; role: string; status: string; disabledAt: string | null }[];
  entitlements: { plan: string } | null;
  billing: {
    basePlan: string;
    provider: string | null;
    status: string;
    interval: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    staffPlan: { plan: string; endsAt: string | null; since: string | null; reason: string | null; by: { name: string; email: string } | null } | null;
  };
  counts: { competitions: number; matches: number; liveMatches: number; outputs: number; storageBytes: number };
  publicPages: { matchId: string; home: string; away: string; scheduledAt: string; status: string }[];
  shareLinks: { id: string; resourceType: string; publicId: string; expiresAt: string | null; accessCount: number; createdAt: string }[];
  activity: { id: number; action: string; actorType: string; actor: string | null; resourceType: string; reason: string | null; createdAt: string }[];
}

const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);

const tzName = (tz: string) => tz.replace(/_/g, ' ');
// anything that is not a published plan (an organisation that never had one stores 'self-hosted') reads as No plan
const planName = (k: string | null | undefined) => PRICE_PLANS.find((p) => p.key === k)?.name ?? 'No plan';

function PlanButton({ id, current, base, tz }: { id: string; current: string; base: string; tz: string }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(current);
  const [duration, setDuration] = useState<PlanGrantDuration | ''>('');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const untilIso = until ? new Date(until).toISOString() : undefined;
  // the end as it will be saved, shown before saving
  let ends: { at: Date | null } | { error: string } | null = null;
  if (duration) {
    try {
      ends = { at: planGrantEnd(duration, new Date(), untilIso) };
    } catch (e) {
      ends = { error: (e as Error).message };
    }
  }
  const save = useAction(() => put(`staff/organisations/${id}/plan`, { plan, reason, duration, ...(duration === 'date' ? { until: untilIso } : {}) }), [['staff', 'organisation', id], ['staff', 'organisations']], { success: 'Plan set' });
  const ready = reason.trim().length >= 3 && !!ends && !('error' in ends);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Set plan</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Set the plan"
        description={`For trials, invoiced or sponsored organisations. It applies instead of the plan the organisation pays for (${planName(base)}) until it ends, then that plan applies again.`}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => save.mutate(undefined, { onSuccess: () => setOpen(false) })}>Set plan</Button></>}
      >
        <div className="grid gap-3">
          <Field label="Plan" htmlFor="staff-plan">
            <NativeSelect id="staff-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="free">No plan</option>
              {PRICE_PLANS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="For how long" htmlFor="staff-plan-duration" hint="Every change ends at some point. Choose Permanent only on purpose.">
            <NativeSelect id="staff-plan-duration" value={duration} onChange={(e) => setDuration(e.target.value as PlanGrantDuration)}>
              <option value="" disabled>Choose…</option>
              {PLAN_GRANT_DURATIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </NativeSelect>
          </Field>
          {duration === 'date' ? (
            <Field label="Ends on" htmlFor="staff-plan-until">
              <Input id="staff-plan-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
            </Field>
          ) : null}
          {ends ? (
            <p className={`rounded-md px-3 py-2 text-sm ${'error' in ends ? 'bg-live/10 text-live' : 'bg-elevated text-text'}`} role="status">
              {'error' in ends ? ends.error : ends.at ? <>Ends {fmtDate(ends.at.toISOString(), tz, { dateStyle: 'full', timeStyle: 'short' })} ({tzName(tz)}). Then: {planName(base)}.</> : <>Permanent: stays until someone changes or ends it.</>}
            </p>
          ) : null}
          <Field label="Reason" htmlFor="staff-plan-reason"><Input id="staff-plan-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorNotice error={save.error} />
        </div>
      </Dialog>
    </>
  );
}

/** What the organisation pays for, and a plan given by staff on top with when it ends. */
function PlanCard({ d, tz, canChange, onEnd }: { d: Detail; tz: string; canChange: boolean; onEnd: (reason: string) => Promise<unknown> }) {
  const b = d.billing;
  const g = b.staffPlan;
  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Plan: {planName(d.entitlements?.plan)}</h2>
          {g ? (
            <p className="mt-1 text-sm text-muted">
              Given by staff{g.by ? ` (${g.by.name || g.by.email})` : ''}{g.since ? ` on ${fmtDate(g.since, tz, { dateStyle: 'medium' })}` : ''}{g.reason ? `: “${g.reason}”` : ''}.{' '}
              <strong className="font-semibold text-text">{g.endsAt ? `Ends ${fmtDate(g.endsAt, tz, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Permanent'}</strong>, then {planName(b.basePlan)}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">No plan given by staff.</p>
          )}
          <p className="mt-1 text-sm text-muted">
            Paid or chosen plan: {planName(b.basePlan)}
            {b.provider === 'stripe' ? ` · Stripe ${b.status.replace(/_/g, ' ')}${b.interval ? `, ${b.interval}` : ''}${b.currentPeriodEnd ? `, ${b.cancelAtPeriodEnd ? 'ends' : 'renews'} ${fmtDate(b.currentPeriodEnd, tz, { dateStyle: 'medium' })}` : ''}` : ''}
          </p>
        </div>
        {canChange && g ? (
          <ReasonButton label="End now" title="End the plan given by staff" description={`The organisation goes back to ${planName(b.basePlan)} straight away.`} confirm="End plan" onConfirm={onEnd} />
        ) : null}
      </div>
    </Card>
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
        subtitle={`${o.slug} · ${o.timezone} · ${planName(d.data.entitlements?.plan)}`}
        actions={
          <>
            {s.can['organisation.plan'] ? <PlanButton id={id} current={PRICE_PLANS.some((p) => p.key === d.data.entitlements?.plan) ? d.data.entitlements!.plan : 'free'} base={d.data.billing.basePlan} tz={tz} /> : null}
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
      <PlanCard d={d.data} tz={tz} canChange={!!s.can['organisation.plan']} onEnd={(reason) => act.mutateAsync({ path: 'plan/end', reason })} />
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
