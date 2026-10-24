'use client';
// Plan cards with a monthly / yearly switch, and the full comparison, from the shared pricing catalogue. Yearly
// shows the actual yearly charge first; the monthly equivalent is secondary and says it is billed annually. The
// chosen plan and period travel to sign-up (/register?plan=club&billing=yearly) and on to checkout.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { PLAN_COMPARISON, PRICE_PLANS, PRICE_TERMS, monthsFreeYearly, type BillingInterval, type PricePlan } from '@bs/domain';
import { get } from '@/lib/api';

const money = (n: number, cents = false) => `$${n.toLocaleString('en-AU', cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : undefined)}`;
const signupHref = (p: PricePlan, interval: BillingInterval) => (p.selfServe ? `/register?plan=${p.key}&billing=${interval}` : '/contact?topic=sales&plan=league');

function Price({ p, interval }: { p: PricePlan; interval: BillingInterval }) {
  if (p.monthly == null)
    return (
      <div className="mt-5 min-h-[5.5rem]">
        <p><span className="text-sm text-muted">From </span><span className="font-brand text-4xl font-bold tracking-tight text-text">{money(p.fromMonthly ?? 0)}</span><span className="text-sm text-muted"> /month</span></p>
        <p className="mt-1.5 text-xs text-muted">Quoted for your season. Billing period agreed in the quote.</p>
      </div>
    );
  if (interval === 'yearly')
    return (
      <div className="mt-5 min-h-[5.5rem]">
        <p><span className="font-brand text-4xl font-bold tracking-tight text-text">{money(p.yearly!)}</span><span className="text-sm text-muted"> /year</span></p>
        <p className="mt-1.5 text-xs text-muted">Charged once a year. Works out at {money(p.yearly! / 12, true)} a month, billed annually.</p>
      </div>
    );
  return (
    <div className="mt-5 min-h-[5.5rem]">
      <p><span className="font-brand text-4xl font-bold tracking-tight text-text">{money(p.monthly)}</span><span className="text-sm text-muted"> /month</span></p>
      <p className="mt-1.5 text-xs text-muted">Charged monthly. Or {money(p.yearly!)} a year.</p>
    </div>
  );
}

export function PricingPlans() {
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  // a shared link can open on yearly: /pricing?billing=yearly
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('billing') === 'yearly') setInterval('yearly');
  }, []);
  const free = monthsFreeYearly(PRICE_PLANS[0]!);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="radiogroup" aria-label="Billing period" className="flex w-fit rounded-xl border border-border bg-panel p-1 shadow-card">
          {(['monthly', 'yearly'] as const).map((i) => (
            <button key={i} type="button" role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={`min-h-10 rounded-lg px-5 text-sm font-semibold transition ${interval === i ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:text-text'}`}>
              {i === 'monthly' ? 'Monthly' : `Yearly · ${free} months free`}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">Allowances are per organisation.</p>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PRICE_PLANS.map((p) => (
          <article key={p.key} aria-labelledby={`plan-${p.key}`} className={`relative flex flex-col rounded-2xl border bg-panel p-6 shadow-card ${p.popular ? 'border-primary ring-1 ring-primary' : 'border-border'}`}>
            {p.popular ? <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-on-primary">Recommended for clubs</span> : null}
            <h2 id={`plan-${p.key}`} className="font-brand text-2xl font-bold text-text">{p.name}</h2>
            <p className="mt-1.5 min-h-10 text-sm leading-snug text-muted">{p.audience}</p>
            <Price p={p} interval={interval} />
            <p className="mt-2 rounded-lg bg-elevated px-3 py-2 text-sm font-medium text-text">
              {p.limits.liveMatches != null ? `${p.limits.liveMatches} live ${p.limits.liveMatches === 1 ? 'match' : 'matches'} at once · ${p.limits.staffAccounts} staff` : 'Allowances agreed in your quote'}
            </p>
            <Link href={signupHref(p, interval)} className={`mt-5 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition ${p.popular ? 'bg-primary text-on-primary hover:bg-primary-strong' : 'border border-border-strong/70 text-text hover:border-primary hover:text-primary'}`}>
              {p.selfServe ? `Get started with ${p.name}` : 'Contact sales for a quote'}
            </Link>
            <ul className="mt-6 space-y-2.5 border-t border-border pt-5">
              {p.features.slice(0, 6).map((f) => (
                <li key={f} className="flex gap-2.5 text-sm leading-snug text-text/90">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

/**
 * The currency and tax line under the plans: the currency Stripe actually charges in once online payment is on
 * (read from the payment account, never guessed), otherwise the published wording.
 */
export function PriceTermsNote() {
  const [currency, setCurrency] = useState<string | null>(PRICE_TERMS.currency);
  useEffect(() => {
    if (PRICE_TERMS.currency) return;
    void get<{ online: boolean; currency: string | null }>('public/billing').then((r) => r.currency && setCurrency(r.currency)).catch(() => undefined);
  }, []);
  return (
    <p className="mt-5 text-sm text-muted">
      {currency ? `Prices are in ${currency}.` : 'Prices are shown in dollars as published.'} {PRICE_TERMS.tax ?? 'Checkout shows the currency, any tax and the exact total before you pay.'} Yearly plans are charged once a year, at ten times the monthly price. Subscriptions renew until cancelled; see the{' '}
      <Link href="/terms#plans" className="font-medium text-primary hover:underline">Terms and Conditions</Link>.
    </p>
  );
}

/** Every plan difference in one table: a scrolling region with a visible hint on narrow screens. */
export function PlanComparison() {
  const cell = (v: boolean | string) =>
    v === true ? <><Check className="mx-auto size-5 text-healthy" aria-hidden /><span className="sr-only">Included</span></> : v === false ? <><Minus className="mx-auto size-5 text-muted/60" aria-hidden /><span className="sr-only">Not included</span></> : <span className="text-text">{v}</span>;
  return (
    <div>
      <p className="mb-2 text-xs text-muted md:hidden" aria-hidden>Scroll sideways to see every plan →</p>
      <div className="relative overflow-x-auto rounded-2xl border border-border bg-panel shadow-card" role="region" aria-label="Plan comparison" tabIndex={0}>
        <table className="w-full min-w-[46rem] text-sm">
          <caption className="sr-only">What each plan includes</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="bg-panel px-5 py-4 text-left font-medium text-muted">Plan</th>
              {PRICE_PLANS.map((p) => <th key={p.key} scope="col" className="px-4 py-4 text-center font-brand text-base font-bold text-text">{p.name}</th>)}
            </tr>
          </thead>
          {PLAN_COMPARISON.map((g) => (
            <tbody key={g.group}>
              <tr><th colSpan={PRICE_PLANS.length + 1} scope="colgroup" className="bg-elevated/70 px-5 py-2 text-left text-xs font-semibold uppercase tracking-[0.14em] text-muted">{g.group}</th></tr>
              {g.rows.map((r) => (
                <tr key={r.label} className="border-t border-border">
                  <th scope="row" className="bg-panel px-5 py-3 text-left font-medium text-text">{r.label}</th>
                  {PRICE_PLANS.map((p) => <td key={p.key} className="px-4 py-3 text-center">{cell(r.values[p.key])}</td>)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
