'use client';
// Plan cards with a monthly / yearly switch, from the shared pricing catalogue.
import Link from 'next/link';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { PRICE_PLANS, monthsFreeYearly, type BillingInterval, type PricePlan } from '@bs/domain';

const money = (n: number) => `$${n.toLocaleString('en-AU')}`;

function Price({ p, interval }: { p: PricePlan; interval: BillingInterval }) {
  if (p.monthly == null)
    return (
      <p className="mt-4 min-h-[4.25rem]">
        <span className="text-sm text-muted">From </span>
        <span className="font-brand text-4xl font-bold text-white">{money(p.fromMonthly ?? 0)}</span>
        <span className="text-sm text-muted">/month</span>
      </p>
    );
  const yearly = interval === 'yearly';
  return (
    <p className="mt-4 min-h-[4.25rem]">
      <span className="font-brand text-4xl font-bold text-white">{money(yearly ? p.yearly! : p.monthly)}</span>
      <span className="text-sm text-muted">/{yearly ? 'year' : 'month'}</span>
      <span className="mt-1 block text-xs text-muted">{yearly ? `${money(p.monthly)}/month if paid monthly` : `or ${money(p.yearly!)}/year`}</span>
    </p>
  );
}

export function PricingPlans() {
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const free = monthsFreeYearly(PRICE_PLANS[0]!);
  return (
    <div>
      <div role="group" aria-label="Billing period" className="mx-auto flex w-fit rounded-xl border border-white/10 bg-panel p-1">
        {(['monthly', 'yearly'] as const).map((i) => (
          <button key={i} type="button" aria-pressed={interval === i} onClick={() => setInterval(i)} className={`min-h-10 rounded-lg px-5 text-sm font-medium transition ${interval === i ? 'bg-brand-cyan text-brand-navy' : 'text-muted hover:text-white'}`}>
            {i === 'monthly' ? 'Monthly' : `Yearly · ${free} months free`}
          </button>
        ))}
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PRICE_PLANS.map((p) => (
          <article key={p.key} aria-labelledby={`plan-${p.key}`} className={`relative flex flex-col rounded-2xl border p-6 ${p.popular ? 'border-brand-cyan bg-[linear-gradient(180deg,rgba(0,210,255,0.10),rgba(19,31,50,0.7))] shadow-[0_20px_80px_-30px_rgba(0,210,255,0.5)]' : 'border-white/10 bg-panel/70'}`}>
            {p.popular ? <span className="absolute -top-3 left-6 rounded-full bg-brand-cyan px-3 py-1 text-xs font-semibold text-brand-navy">Most popular</span> : null}
            <div className="xl:min-h-[7.5rem]">
              <h2 id={`plan-${p.key}`} className="font-brand text-2xl font-bold text-white">{p.name}</h2>
              <p className="mt-2 text-sm text-muted">{p.audience}</p>
            </div>
            <Price p={p} interval={interval} />
            <Link href={p.selfServe ? '/register' : '/contact'} className={`mt-6 inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition ${p.popular ? 'bg-brand-cyan text-brand-navy hover:bg-white' : 'border border-white/20 text-white hover:border-brand-cyan hover:text-brand-cyan'}`}>
              {p.selfServe ? `Get started with ${p.name}` : 'Contact us for a quote'}
            </Link>
            <ul className="mt-6 space-y-2.5 border-t border-white/10 pt-6">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2.5 text-sm leading-snug text-white/90">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand-cyan" aria-hidden />
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
