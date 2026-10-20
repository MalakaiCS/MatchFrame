'use client';
// Plan and billing. With Stripe configured on the installation, upgrades go through Stripe Checkout and the
// customer portal; without it, the owner sets the plan by hand (self-hosted installations).
import { useSearchParams } from 'next/navigation';
import { Button, Card, ErrorNotice, Spinner, StatusPill, cx } from '@bs/ui';
import { post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';

interface Plan { key: 'free' | 'club' | 'league'; name: string; priceLabel: string; limits: Record<string, number>; features: string[] }
interface Billing { configured: boolean; plan: Plan; status: string; currentPeriodEnd: string | null; plans: Plan[]; canManage: boolean }
const LIMIT_LABELS: Record<string, string> = { liveMatches: 'live matches at once', outputsPerMatch: 'outputs per match', storageGb: 'GB of media storage', members: 'team members', webhooks: 'webhooks' };

export function BillingPanel({ owner, tz }: { owner: boolean; tz: string }) {
  const b = useGet<Billing>(['billing'], 'billing');
  const flag = useSearchParams().get('billing');
  const checkout = useAction((plan: 'club' | 'league') => post<{ url: string }>('billing/checkout', { plan }), []);
  const portal = useAction(() => post<{ url: string }>('billing/portal'), []);
  const manual = useAction((plan: string) => post('billing/plan', { plan }), [['billing'], ['org']], { success: 'Plan updated' });
  if (b.isLoading) return <Spinner />;
  if (b.error || !b.data) return <ErrorNotice error={b.error} onRetry={() => b.refetch()} />;
  const d = b.data;
  const go = (url: string) => {
    window.location.href = url;
  };
  return (
    <div className="grid gap-4">
      {flag === 'success' ? <Card className="border-healthy/60 p-3 text-sm text-healthy">Thanks. Your plan updates as soon as the payment is confirmed (usually within a minute).</Card> : flag === 'cancelled' ? <Card className="p-3 text-sm text-muted">Checkout was cancelled. Nothing has changed.</Card> : null}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Current plan: {d.plan.name}</h2>
          <StatusPill tone={d.status === 'active' ? 'healthy' : d.status === 'past_due' ? 'warning' : 'neutral'}>{d.status === 'none' ? 'no subscription' : d.status.replace(/_/g, ' ')}</StatusPill>
          {d.currentPeriodEnd ? <span className="text-xs text-muted">renews {fmtDate(d.currentPeriodEnd, tz, { dateStyle: 'medium' })}</span> : null}
          {d.configured && d.canManage && owner ? <Button size="sm" className="ml-auto" loading={portal.isPending} onClick={() => portal.mutate(undefined, { onSuccess: (r) => go(r.url) })}>Manage billing</Button> : null}
        </div>
        {!d.configured ? <p className="mt-2 text-xs text-muted">Online payment is not set up on this installation; the owner chooses the plan here. Add the Stripe keys to the environment to take card payments.</p> : null}
        <ErrorNotice error={checkout.error ?? portal.error ?? manual.error} />
      </Card>
      <div className="grid gap-3 md:grid-cols-3">
        {d.plans.map((p) => {
          const current = p.key === d.plan.key;
          return (
            <Card key={p.key} className={cx('flex flex-col p-4', current && 'border-primary')}>
              <div className="flex items-center justify-between"><h3 className="font-medium">{p.name}</h3>{current ? <StatusPill tone="primary">current</StatusPill> : null}</div>
              <p className="text-sm text-muted">{p.priceLabel}</p>
              <ul className="mt-2 flex-1 space-y-1 text-sm">{p.features.map((f) => <li key={f}>· {f}</li>)}</ul>
              <ul className="mt-2 space-y-0.5 text-xs text-muted">{Object.entries(p.limits).map(([k, v]) => <li key={k}>{v} {LIMIT_LABELS[k] ?? k}</li>)}</ul>
              {owner && !current ? (
                d.configured && p.key !== 'free' ? <Button className="mt-3" variant="primary" loading={checkout.isPending} onClick={() => checkout.mutate(p.key as 'club' | 'league', { onSuccess: (r) => go(r.url) })}>Upgrade to {p.name}</Button>
                : <Button className="mt-3" loading={manual.isPending} onClick={() => confirm(`Set the plan to ${p.name}?`) && manual.mutate(p.key)}>Set plan to {p.name}</Button>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
