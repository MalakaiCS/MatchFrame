'use client';
// Plan and billing. The plans and prices are the published ones (shared catalogue). With online payment on (a Stripe
// secret key), a plan is bought through Stripe Checkout, monthly or yearly, confirmed as soon as the owner comes back,
// and changed or cancelled in the customer portal; without it, the owner sets the plan by hand (self-hosted
// installations, invoices). A plan given by MatchFrame staff shows with the date it ends and what follows it.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorNotice, Spinner, StatusPill, cx } from '@bs/ui';
import { get, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { forgetPlan } from '@/lib/sign-in';

type Interval = 'monthly' | 'yearly';
interface Plan { key: string; name: string; priceLabel: string; audience: string; popular: boolean; selfServe: boolean; limits: { liveMatches: number | null; members: number | null }; features: string[] }
interface Billing {
  configured: boolean;
  plan: Plan;
  basePlan: Plan;
  grant: { plan: Plan; endsAt: string | null; since: string | null } | null;
  status: string;
  interval: Interval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  plans: Plan[];
  checkout: Record<string, Record<Interval, boolean>>;
  canManage: boolean;
}

export function BillingPanel({ owner, tz }: { owner: boolean; tz: string }) {
  const b = useGet<Billing>(['billing'], 'billing');
  const qc = useQueryClient();
  const qs = useSearchParams();
  const flag = qs.get('billing');
  const session = qs.get('session');
  // a plan chosen on the pricing page arrives as ?plan=club&interval=yearly
  const chosen = qs.get('plan');
  const [interval, setInterval] = useState<Interval>('monthly');
  const [currency, setCurrency] = useState<string | null>(null);
  useEffect(() => {
    const i = qs.get('interval');
    if (i === 'yearly' || i === 'monthly') setInterval(i);
  }, [qs]);
  useEffect(() => {
    void get<{ online: boolean; currency: string | null }>('public/billing').then((r) => setCurrency(r.currency)).catch(() => undefined);
  }, []);
  // back from Stripe Checkout: confirm the payment now rather than waiting for the webhook or the worker
  const confirm = useAction((s: string) => post<{ status: string; plan?: string }>('billing/confirm', { session: s }), [['billing'], ['org']]);
  const confirmed = useRef(false);
  useEffect(() => {
    if (flag === 'success' && session && owner && !confirmed.current) {
      confirmed.current = true;
      confirm.mutate(session, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['billing'] }) });
    }
  }, [flag, session, owner, confirm, qc]);
  const checkout = useAction((x: { plan: string; interval: Interval }) => post<{ url: string }>('billing/checkout', x), []);
  const portal = useAction(() => post<{ url: string }>('billing/portal'), []);
  const manual = useAction((plan: string) => post('billing/plan', { plan }), [['billing'], ['org']], { success: 'Plan updated' });
  if (b.isLoading) return <Spinner />;
  if (b.error || !b.data) return <ErrorNotice error={b.error} onRetry={() => b.refetch()} />;
  const d = b.data;
  const go = (url: string) => {
    window.location.href = url;
  };
  const day = (iso: string) => fmtDate(iso, tz, { dateStyle: 'medium' });
  return (
    <div className="grid gap-4">
      {flag === 'success' ? (
        <Card className="border-healthy/60 p-3 text-sm text-healthy" role="status">
          {confirm.isPending ? 'Confirming your payment with Stripe…' : confirm.data?.status === 'complete' ? `Payment confirmed. You are on ${d.plan.name}.` : 'Thanks. Your plan updates as soon as Stripe confirms the payment (usually within a minute).'}
        </Card>
      ) : flag === 'cancelled' ? (
        <Card className="p-3 text-sm text-muted" role="status">Checkout was cancelled. Nothing has changed.</Card>
      ) : null}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Current plan: {d.plan.name}</h2>
          {d.grant ? <StatusPill tone="primary">from MatchFrame</StatusPill> : <StatusPill tone={d.status === 'active' ? 'healthy' : d.status === 'past_due' ? 'warning' : 'neutral'}>{d.status === 'none' ? 'no subscription' : d.status === 'past_due' ? 'payment due' : d.status.replace(/_/g, ' ')}</StatusPill>}
          {d.configured && d.canManage && owner ? <Button size="sm" className="ml-auto" loading={portal.isPending} onClick={() => portal.mutate(undefined, { onSuccess: (r) => go(r.url) })}>Manage billing</Button> : null}
        </div>
        {d.grant ? (
          <p className="mt-2 text-sm text-muted">
            Given to your organisation by MatchFrame {d.grant.endsAt ? <>until <strong className="font-semibold text-text">{fmtDate(d.grant.endsAt, tz, { dateStyle: 'medium', timeStyle: 'short' })}</strong></> : 'with no end date'}. {d.grant.endsAt ? <>After that: {d.basePlan.key === 'free' ? 'no plan, unless you choose one below' : `${d.basePlan.name}${d.status === 'active' ? ' (your subscription)' : ''}`}.</> : null}
          </p>
        ) : null}
        {!d.grant && d.status !== 'none' && d.currentPeriodEnd ? (
          <p className="mt-2 text-sm text-muted">
            {d.interval === 'yearly' ? 'Billed yearly' : d.interval === 'monthly' ? 'Billed monthly' : 'Subscription'} · {d.cancelAtPeriodEnd ? <>cancelled, ends {day(d.currentPeriodEnd)}</> : d.status === 'past_due' ? <>the last payment failed; Stripe is trying again. Update the card in Manage billing.</> : <>renews {day(d.currentPeriodEnd)}</>}
          </p>
        ) : null}
        {!d.configured ? <p className="mt-2 text-xs text-muted">Online payment is not set up on this installation, so the owner chooses the plan here. Setting STRIPE_SECRET_KEY turns on card payments.</p> : null}
        <div className="mt-3 flex items-center gap-2 text-sm" role="group" aria-label="Billing period">
          {(['monthly', 'yearly'] as const).map((i) => (
            <button key={i} type="button" aria-pressed={interval === i} onClick={() => setInterval(i)} className={cx('rounded-md border px-3 py-1.5', interval === i ? 'border-primary text-text' : 'border-border text-muted')}>
              {i === 'monthly' ? 'Monthly' : 'Yearly (two months free)'}
            </button>
          ))}
        </div>
        <ErrorNotice error={checkout.error ?? portal.error ?? manual.error ?? confirm.error} />
      </Card>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {d.plans.map((p) => {
          const current = p.key === d.plan.key;
          const paidFor = p.key === d.basePlan.key && d.status === 'active';
          const canBuy = d.configured && p.selfServe && d.checkout[p.key]?.[interval];
          return (
            <Card key={p.key} className={cx('flex flex-col p-4', (current || (chosen === p.key && !current)) && 'border-primary ring-1 ring-primary')}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{p.name}</h3>
                {current ? <StatusPill tone="primary">current</StatusPill> : chosen === p.key ? <StatusPill tone="primary">your choice</StatusPill> : p.popular ? <StatusPill tone="healthy">recommended for clubs</StatusPill> : null}
              </div>
              <p className="text-sm text-muted">{p.priceLabel}</p>
              <p className="mt-1 text-xs text-muted">{p.audience}</p>
              <ul className="mt-2 flex-1 space-y-1 text-sm">{p.features.map((f) => <li key={f}>· {f}</li>)}</ul>
              {owner && !paidFor && !(current && !d.grant) ? (
                !p.selfServe ? (
                  <Button asChild className="mt-3"><Link href="/contact?topic=sales&plan=league">Contact us</Link></Button>
                ) : canBuy ? (
                  <Button className="mt-3" variant="primary" loading={checkout.isPending && checkout.variables?.plan === p.key} onClick={() => checkout.mutate({ plan: p.key, interval }, { onSuccess: (r) => { forgetPlan(); go(r.url); } })}>Choose {p.name} ({interval})</Button>
                ) : d.configured ? (
                  <p className="mt-3 text-xs text-muted">{p.name} is not available {interval} online yet.</p>
                ) : (
                  <Button className="mt-3" loading={manual.isPending} onClick={() => window.confirm(`Set the plan to ${p.name}?`) && manual.mutate(p.key, { onSuccess: () => forgetPlan() })}>Set plan to {p.name}</Button>
                )
              ) : null}
            </Card>
          );
        })}
      </div>
      {d.configured ? (
        <p className="text-xs leading-relaxed text-muted">
          Paid securely through Stripe{currency ? ` in ${currency}` : ''}; any tax is shown before you pay. Subscriptions renew automatically until cancelled in Manage billing, and a cancelled plan stays until the end of the period you paid for. See the <Link href="/terms#plans" className="font-medium text-primary hover:underline">Terms and Conditions</Link>.
        </p>
      ) : null}
    </div>
  );
}
