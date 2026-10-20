'use client';
// Plan and billing. The plans and prices are the published ones (shared catalogue). With Stripe configured,
// a plan is bought through Stripe Checkout (monthly or yearly, where a price is set up) and changed in the
// customer portal; without it, the owner sets the plan by hand (self-hosted installations, invoices).
import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, ErrorNotice, Spinner, StatusPill, cx } from '@bs/ui';
import { post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';

type Interval = 'monthly' | 'yearly';
interface Plan { key: string; name: string; priceLabel: string; audience: string; popular: boolean; selfServe: boolean; limits: { liveMatches: number | null; members: number | null }; features: string[] }
interface Billing { configured: boolean; plan: Plan; status: string; currentPeriodEnd: string | null; plans: Plan[]; checkout: Record<string, Record<Interval, boolean>>; canManage: boolean }

export function BillingPanel({ owner, tz }: { owner: boolean; tz: string }) {
  const b = useGet<Billing>(['billing'], 'billing');
  const flag = useSearchParams().get('billing');
  const [interval, setInterval] = useState<Interval>('monthly');
  const checkout = useAction((x: { plan: string; interval: Interval }) => post<{ url: string }>('billing/checkout', x), []);
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
        {!d.configured ? <p className="mt-2 text-xs text-muted">Online payment is not set up on this installation; the owner chooses the plan here. Add the Stripe keys and a price for each plan to take card payments.</p> : null}
        <div className="mt-3 flex items-center gap-2 text-sm" role="group" aria-label="Billing period">
          {(['monthly', 'yearly'] as const).map((i) => (
            <button key={i} type="button" aria-pressed={interval === i} onClick={() => setInterval(i)} className={cx('rounded-md border px-3 py-1.5', interval === i ? 'border-primary text-text' : 'border-border text-muted')}>
              {i === 'monthly' ? 'Monthly' : 'Yearly (two months free)'}
            </button>
          ))}
        </div>
        <ErrorNotice error={checkout.error ?? portal.error ?? manual.error} />
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {d.plans.map((p) => {
          const current = p.key === d.plan.key;
          const canBuy = d.configured && p.selfServe && d.checkout[p.key]?.[interval];
          return (
            <Card key={p.key} className={cx('flex flex-col p-4', current && 'border-primary')}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{p.name}</h3>
                {current ? <StatusPill tone="primary">current</StatusPill> : p.popular ? <StatusPill tone="healthy">most popular</StatusPill> : null}
              </div>
              <p className="text-sm text-muted">{p.priceLabel}</p>
              <p className="mt-1 text-xs text-muted">{p.audience}</p>
              <ul className="mt-2 flex-1 space-y-1 text-sm">{p.features.map((f) => <li key={f}>· {f}</li>)}</ul>
              {owner && !current ? (
                !p.selfServe ? (
                  <Button asChild className="mt-3"><Link href="/contact">Contact us</Link></Button>
                ) : canBuy ? (
                  <Button className="mt-3" variant="primary" loading={checkout.isPending} onClick={() => checkout.mutate({ plan: p.key, interval }, { onSuccess: (r) => go(r.url) })}>Choose {p.name} ({interval})</Button>
                ) : d.configured ? (
                  <p className="mt-3 text-xs text-muted">{p.name} is not available {interval} online yet.</p>
                ) : (
                  <Button className="mt-3" loading={manual.isPending} onClick={() => confirm(`Set the plan to ${p.name}?`) && manual.mutate(p.key)}>Set plan to {p.name}</Button>
                )
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
