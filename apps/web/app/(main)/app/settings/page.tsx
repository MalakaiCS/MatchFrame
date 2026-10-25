'use client';
// Settings: a grouped list of sections at the left on wide screens (a section picker on phones), the chosen section
// at the right. Sections keep their ?tab= names (org, members, plan, …) so links and bookmarks still land.
import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import * as TabsP from '@radix-ui/react-tabs';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Switch, Table, cx } from '@bs/ui';
import { del, patch, post, put } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isAdmin, useMe, type Role } from '@/lib/session';
import { BillingPanel } from '@/components/settings/billing';
import { BrandingPanel } from '@/components/settings/branding';
import { WebhooksPanel } from '@/components/settings/webhooks';
import { NotificationsPanel } from '@/components/settings/notifications';
import { SecurityPanel } from '@/components/settings/security';
import { BackupsPanel } from '@/components/settings/backups';

interface Member { id: string; userId: string; name: string; email: string | null; role: Role; status: string; grants: { action: string; scopeType: string; scopeId: string | null }[] }
interface Org { id: string; name: string; slug: string; timezone: string; locale: string; entitlements: { plan: string; features: Record<string, boolean>; limits: Record<string, number> } | null }

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}

interface Section { value: string; label: string }

function SettingsInner() {
  const me = useMe();
  const admin = isAdmin(me.data?.role);
  const owner = me.data?.role === 'owner';
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const qs = useSearchParams();
  const wanted = qs.get('billing') || qs.get('plan') ? 'plan' : (qs.get('tab') ?? 'org');
  const groups = useMemo(() => [
    { label: 'Organisation', items: [{ value: 'org', label: 'General' }, { value: 'members', label: 'Members' }, { value: 'plan', label: 'Plan & billing' }, { value: 'branding', label: 'Branding' }] },
    { label: 'Connections', items: [...(admin ? [{ value: 'integrations', label: 'Integrations' }] : []), { value: 'notifications', label: 'Notifications' }, ...(admin ? [{ value: 'keys', label: 'API keys' }] : [])] },
    { label: 'Security', items: [{ value: 'security', label: 'Security' }, ...(owner ? [{ value: 'backups', label: 'Backups' }] : []), { value: 'audit', label: 'Audit log' }] },
  ] satisfies { label: string; items: Section[] }[], [admin, owner]);
  const known = (v: string) => groups.some((g) => g.items.some((i) => i.value === v));
  const [tab, setTab] = useState(wanted);
  // the account menu links here with ?tab=security while the page may already be open
  useEffect(() => setTab(wanted), [wanted]);
  const current = known(tab) ? tab : 'org';
  const choose = (v: string) => {
    setTab(v);
    window.history.replaceState(null, '', `/app/settings?tab=${v}`);
  };
  return (
    <>
      <PageHeader title="Settings" subtitle="Your organisation, the people in it, your plan, connections and security." />
      <TabsP.Root value={current} onValueChange={choose} orientation="vertical" className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <Field label="Section" htmlFor="settings-section" className="lg:hidden">
          <NativeSelect id="settings-section" value={current} onChange={(e) => choose(e.target.value)}>
            {groups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}</optgroup>)}
          </NativeSelect>
        </Field>
        <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          {groups.map((g, gi) => (
            <Fragment key={g.label}>
              <p id={`settings-group-${gi}`} className={cx('mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted/80', gi && 'mt-5')}>{g.label}</p>
              <TabsP.List aria-labelledby={`settings-group-${gi}`} className="flex flex-col gap-0.5">
                {g.items.map((i) => (
                  <TabsP.Trigger key={i.value} value={i.value} className="flex min-h-9 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-muted hover:bg-elevated hover:text-text data-[state=active]:bg-primary/10 data-[state=active]:text-text data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-primary/30">
                    {i.label}
                  </TabsP.Trigger>
                ))}
              </TabsP.List>
            </Fragment>
          ))}
        </nav>
        <div className="min-w-0">
          <TabsP.Content value="org"><OrgSettings admin={admin} /></TabsP.Content>
          <TabsP.Content value="members"><Members admin={admin} owner={owner} selfId={me.data?.user.id} /></TabsP.Content>
          <TabsP.Content value="plan" className="grid gap-6"><BillingPanel owner={owner} tz={tz} /><Entitlements owner={owner} /></TabsP.Content>
          <TabsP.Content value="branding"><BrandingPanel owner={owner} admin={admin} /></TabsP.Content>
          {admin ? <TabsP.Content value="integrations"><WebhooksPanel tz={tz} canEdit={admin} /></TabsP.Content> : null}
          <TabsP.Content value="notifications"><NotificationsPanel tz={tz} /></TabsP.Content>
          <TabsP.Content value="security"><SecurityPanel owner={owner} tz={tz} /></TabsP.Content>
          {owner ? <TabsP.Content value="backups"><BackupsPanel tz={tz} /></TabsP.Content> : null}
          {admin ? <TabsP.Content value="keys"><ApiKeys /></TabsP.Content> : null}
          <TabsP.Content value="audit"><Audit tz={tz} /></TabsP.Content>
        </div>
      </TabsP.Root>
    </>
  );
}

/** Every IANA time zone the browser knows, for the searchable time zone field. */
const ZONES = (() => {
  try {
    const z = Intl.supportedValuesOf('timeZone');
    return z.includes('UTC') ? z : ['UTC', ...z];
  } catch {
    return ['UTC'];
  }
})();

function OrgSettings({ admin }: { admin: boolean }) {
  const org = useGet<Org>(['org'], 'organisations/current');
  const [f, setF] = useState<{ name?: string; timezone?: string }>({});
  const save = useAction(() => patch('organisations/current', f), [['org'], ['me']], { success: 'Saved' });
  if (org.isLoading) return <Spinner />;
  const zone = f.timezone ?? org.data?.timezone ?? '';
  const zoneOk = ZONES.includes(zone);
  const nowThere = zoneOk ? new Intl.DateTimeFormat('en-AU', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date()) : null;
  return (
    <Card className="max-w-3xl p-5">
      <h2 className="font-medium">Organisation</h2>
      <p className="mb-4 text-sm text-muted">The name shown to your team and on public pages, and the time zone kick-off times are entered and shown in.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="on"><Input id="on" disabled={!admin} defaultValue={org.data?.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Time zone" htmlFor="ot" hint={zoneOk ? `It is ${nowThere} there now.` : 'Pick one from the list: start typing a city, for example Brisbane or London.'} error={save.error?.fieldError('timezone')}>
          <Input id="ot" list="org-zones" autoComplete="off" disabled={!admin} defaultValue={org.data?.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
        </Field>
        <datalist id="org-zones">{ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</datalist>
      </div>
      {admin ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {save.done ? <p className="text-sm text-healthy">Saved.</p> : null}
          <Button variant="primary" loading={save.isPending} disabled={!Object.keys(f).length || !zoneOk} onClick={() => save.mutate(undefined)}>Save changes</Button>
        </div>
      ) : null}
      <ErrorNotice error={save.error && !save.error.fields ? save.error : null} />
      <details className="mt-4 text-xs text-muted">
        <summary className="cursor-pointer">Details</summary>
        <p className="mt-2">Web address name: <span className="font-mono">{org.data?.slug}</span> · Language and number format: {org.data?.locale}</p>
      </details>
    </Card>
  );
}

const ROLES: Role[] = ['admin', 'producer', 'operator', 'scorer', 'club_manager', 'viewer'];

function Members({ admin, owner, selfId }: { admin: boolean; owner: boolean; selfId?: string }) {
  const members = useGet<Member[]>(['members'], 'members');
  const invites = useGet<{ id: string; email: string; role: string; scopeType: string | null; expiresAt: string; revokedAt: string | null }[]>(['invitations'], admin ? 'invitations' : null);
  const matches = useGet<{ items: { id: string; home: { name: string } | null; away: { name: string } | null; scheduledAt: string }[] }>(['matches', 'invite-scope'], admin ? 'matches?pageSize=100' : null);
  const comps = useGet<{ id: string; name: string }[]>(['competitions'], admin ? 'competitions' : null);
  const teams = useGet<{ id: string; name: string }[]>(['teams'], admin ? 'teams' : null);
  const [open, setOpen] = useState(false);
  const [inv, setInv] = useState({ email: '', role: 'producer', scopeType: '', scopeId: '' });
  const [link, setLink] = useState<string | null>(null);
  const invite = useAction(() => post<{ acceptUrl?: string }>('invitations', { email: inv.email, role: inv.role, scopeType: inv.scopeType || null, scopeId: inv.scopeId || null }), [['invitations']], { success: 'Invitation sent' });
  const role = useAction((v: { id: string; role: string }) => patch(`members/${v.id}`, { role: v.role }), [['members']], { success: 'Role updated' });
  const revoke = useAction((mid: string) => del(`members/${mid}`), [['members']], { success: 'Member removed' });
  const revokeInv = useAction((iid: string) => del(`invitations/${iid}`), [['invitations']], { success: 'Invitation withdrawn' });
  const scopeOptions = inv.scopeType === 'match' ? matches.data?.items.map((m) => ({ id: m.id, label: `${m.home?.name} v ${m.away?.name}` })) : inv.scopeType === 'competition' ? comps.data?.map((c) => ({ id: c.id, label: c.name })) : inv.scopeType === 'team' ? teams.data?.map((t) => ({ id: t.id, label: t.name })) : [];
  return (
    <>
      {admin ? <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => { setOpen(true); setLink(null); invite.reset(); }}>Invite member</Button></div> : null}
      <ErrorNotice error={members.error ?? role.error ?? revoke.error} />
      <Table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Scope</th><th>Status</th><th /></tr></thead><tbody>
        {members.data?.map((m) => (
          <tr key={m.id}>
            <td>{m.name}{m.userId === selfId ? <span className="text-xs text-muted"> (you)</span> : null}</td>
            <td className="text-muted">{m.email ?? 'hidden'}</td>
            <td>{admin && m.status === 'active' && (m.role !== 'owner' || owner) ? (
              <NativeSelect aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => role.mutate({ id: m.id, role: e.target.value })} className="h-8 w-36">{(owner ? ['owner', ...ROLES] : ROLES).map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</NativeSelect>
            ) : m.role}</td>
            <td className="text-xs text-muted">{m.grants.length ? m.grants.map((g) => `${g.action}@${g.scopeType}`).join(', ') : 'organisation-wide'}</td>
            <td><StatusPill tone={m.status === 'active' ? 'healthy' : 'neutral'}>{m.status}</StatusPill></td>
            <td className="text-right">{admin && m.status === 'active' && m.userId !== selfId ? <Button size="sm" variant="danger" loading={revoke.isPending} onClick={() => confirm(`Remove ${m.name} (${m.role}) from this organisation? Their sessions lose access immediately.`) && revoke.mutate(m.id)}>Remove {m.name.split(' ')[0]}</Button> : null}</td>
          </tr>
        ))}
      </tbody></Table>
      {admin && invites.data?.length ? (
        <>
          <h3 className="mb-2 mt-6 text-sm font-medium">Pending invitations</h3>
          <Table><thead><tr><th>Email</th><th>Role</th><th>Scope</th><th>Expires</th><th /></tr></thead><tbody>
            {invites.data.map((i) => <tr key={i.id}><td>{i.email}</td><td>{i.role}</td><td>{i.scopeType ?? 'organisation'}</td><td className="text-muted">{new Date(i.expiresAt).toLocaleDateString('en-AU')}</td><td className="text-right">{i.revokedAt ? <StatusPill>revoked</StatusPill> : <Button size="sm" variant="ghost" onClick={() => revokeInv.mutate(i.id)}>Revoke</Button>}</td></tr>)}
          </tbody></Table>
        </>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen} title="Invite a member" description="Scorers, operators and club managers must be scoped to a match, competition or team."
        footer={link ? <Button variant="primary" onClick={() => setOpen(false)}>Done</Button> : <><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={invite.isPending} disabled={!inv.email} onClick={() => invite.mutate(undefined, { onSuccess: (r) => setLink(r.acceptUrl ?? 'sent') })}>Send invitation</Button></>}>
        {link ? <p className="text-sm text-healthy">Invitation sent to {inv.email}.{link !== 'sent' ? <span className="mt-2 block break-all text-xs text-muted">Development link: {link}</span> : null}</p> : (
          <div className="grid gap-3">
            <Field label="Email" htmlFor="ie" error={invite.error?.fieldError('email')}><Input id="ie" type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
            <Field label="Role" htmlFor="ir"><NativeSelect id="ir" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</NativeSelect></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scope" htmlFor="ist" error={invite.error?.fieldError('scopeType')}><NativeSelect id="ist" value={inv.scopeType} onChange={(e) => setInv({ ...inv, scopeType: e.target.value, scopeId: '' })}><option value="">Whole organisation</option><option value="match">One match</option><option value="competition">A competition</option><option value="team">A team</option></NativeSelect></Field>
              <Field label="Resource" htmlFor="isi"><NativeSelect id="isi" value={inv.scopeId} disabled={!inv.scopeType} onChange={(e) => setInv({ ...inv, scopeId: e.target.value })}><option value="">Choose…</option>{scopeOptions?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect></Field>
            </div>
            <ErrorNotice error={invite.error && !invite.error.fields ? invite.error : null} />
          </div>
        )}
      </Dialog>
    </>
  );
}

const USAGE_NAMES: Record<string, string> = { media_jobs: 'Media processing', storage: 'Storage', programme: 'Cloud production', recording: 'Recording', egress: 'Streaming out' };
const usageName = (m: string) => USAGE_NAMES[m] ?? m.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
/** Usage in words people read: minutes rather than job seconds, MB or GB rather than bytes. */
function usageAmount(total: number, unit: string) {
  if (unit === 'bytes') return total >= 1e9 ? `${(total / 1e9).toFixed(1)} GB` : `${Math.max(0.1, total / 1e6).toFixed(1)} MB`;
  if (/seconds$/.test(unit)) return `${(total / 60).toFixed(total < 600 ? 1 : 0)} min`;
  return `${total.toFixed(1)} ${unit.replace(/_/g, ' ')}`;
}
const limitName = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

function Entitlements({ owner }: { owner: boolean }) {
  const org = useGet<Org>(['org'], 'organisations/current');
  const [monthStart] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1).toISOString(); });
  const usage = useGet<{ totals: { module: string; unit: string; total: number }[] }>(['usage-month'], `usage/ledger?from=${encodeURIComponent(monthStart)}`);
  const save = useAction((features: Record<string, boolean>) => put('organisations/current/entitlements', { features }), [['org']], { success: 'Features saved' });
  if (org.isLoading) return <Spinner />;
  const e = org.data?.entitlements;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-4">
        <h2 className="mb-2 font-medium">Usage this month</h2>
        <ErrorNotice error={usage.error} />
        {usage.data?.totals.length ? <ul className="text-sm">{usage.data.totals.map((u) => <li key={u.module + u.unit} className="flex justify-between gap-3 py-0.5"><span className="text-muted">{usageName(u.module)}</span><span className="tabular">{usageAmount(u.total, u.unit)}</span></li>)}</ul> : usage.isLoading ? <Spinner /> : <p className="text-sm text-muted">No measured usage yet.</p>}
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-medium">Limits</h2>
        {Object.keys(e?.limits ?? {}).length ? <ul className="text-sm">{Object.entries(e?.limits ?? {}).map(([k, v]) => <li key={k} className="flex justify-between gap-3 py-0.5"><span className="text-muted">{limitName(k)}</span><span className="tabular">{v}</span></li>)}</ul> : <p className="text-sm text-muted">No limits on this plan.</p>}
      </Card>
      <Card className="p-4">
        <h2 className="mb-1 font-medium">Features on this plan</h2>
        <p className="mb-3 text-xs text-muted">Installation ceilings (capacity, destinations) cannot be raised here.</p>
        <div className="grid gap-2">{Object.entries(e?.features ?? {}).map(([k, v]) => <Switch key={k} label={limitName(k)} checked={v} disabled={!owner} onCheckedChange={(nv) => save.mutate({ ...(e?.features ?? {}), [k]: nv })} />)}</div>
        <ErrorNotice error={save.error} />
      </Card>
    </div>
  );
}

function ApiKeys() {
  const keys = useGet<{ id: string; name: string; prefix: string; scopes: { action: string }[]; expiresAt: string; revokedAt: string | null }[]>(['api-keys'], 'api-keys');
  const [name, setName] = useState('');
  const [action, setAction] = useState('competition.read');
  const [shown, setShown] = useState<string | null>(null);
  const create = useAction(() => post<{ key: string }>('api-keys', { name, scopes: [{ action, resourceType: 'organisation' }] }), [['api-keys']], { success: 'API key created' });
  const revoke = useAction((kid: string) => del(`api-keys/${kid}`), [['api-keys']], { success: 'API key revoked' });
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Key name" htmlFor="kn"><Input id="kn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Scope" htmlFor="ks"><NativeSelect id="ks" value={action} onChange={(e) => setAction(e.target.value)}>{['competition.read', 'reports.read', 'media.read', 'overlay.operate'].map((a) => <option key={a}>{a}</option>)}</NativeSelect></Field>
        <Button variant="primary" disabled={!name} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (r) => { setShown(r.key); setName(''); } })}>Create key</Button>
      </div>
      {shown ? <Card className="mb-3 p-3 text-sm"><p className="mb-1 text-warning">Copy this key now. It will not be shown again.</p><code className="break-all text-xs">{shown}</code></Card> : null}
      <ErrorNotice error={create.error ?? revoke.error} />
      <Table><thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Expires</th><th /></tr></thead><tbody>
        {keys.data?.map((k) => <tr key={k.id}><td>{k.name}</td><td className="font-mono text-xs">bsk_{k.prefix}_…</td><td className="text-xs">{k.scopes.map((s) => s.action).join(', ')}</td><td className="text-muted">{new Date(k.expiresAt).toLocaleDateString('en-AU')}</td><td className="text-right">{k.revokedAt ? <StatusPill>revoked</StatusPill> : <Button size="sm" variant="danger" onClick={() => revoke.mutate(k.id)}>Revoke {k.name}</Button>}</td></tr>)}
      </tbody></Table>
    </>
  );
}

function Audit({ tz }: { tz: string }) {
  const log = useGet<{ id: number; action: string; resourceType: string; resourceId: string | null; actorUserId: string | null; actorType: string; reason: string | null; requestId: string | null; createdAt: string }[]>(['audit'], 'audit?limit=200');
  return (
    <>
      <ErrorNotice error={log.error} />
      {log.isLoading ? <Spinner /> : <Table><thead><tr><th>When</th><th>Action</th><th>Resource</th><th>Actor</th><th>Reason</th></tr></thead><tbody>
        {log.data?.map((a) => <tr key={a.id}><td className="whitespace-nowrap text-xs tabular">{fmtDate(a.createdAt, tz, { dateStyle: 'short', timeStyle: 'medium' })}</td><td>{a.action}</td><td className="text-xs text-muted">{a.resourceType} {a.resourceId?.slice(0, 8)}</td><td className="text-xs">{a.actorType}</td><td className="text-xs text-muted">{a.reason ?? ''}</td></tr>)}
      </tbody></Table>}
    </>
  );
}
