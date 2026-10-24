import { OPTIONAL_SERVICES, PRICE_TERMS } from '@bs/domain';
import { PlanComparison, PricingPlans } from '@/components/site/pricing-plans';
import { ArrowLink, Badge, ButtonLink, Container, Eyebrow, H2, Rich, Section } from '@/components/site/ui';
import { FAQS } from '@/content/faq';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Pricing',
  description: 'MatchFrame plans: Starter $29 a month, Club $79, Studio $199, League / Enterprise from $499, with two months free when you pay yearly. Compare every plan.',
  path: '/pricing',
});

/** Optional services the hosted service cannot deliver yet, with why (shown beside the published price). */
const NOT_YET: Record<string, string> = {
  'cloud-production': 'Coming to the hosted service. Cloud production runs today on self-hosted deployments with the media server.',
};
const PRICING_FAQ = ['cost', 'free-trial', 'cancel-change', 'several-matches'];

export default function PricingPage() {
  const faqs = PRICING_FAQ.map((id) => FAQS.find((f) => f.id === id)).filter((f): f is (typeof FAQS)[number] => !!f);
  const terms = [PRICE_TERMS.currency ? `Prices are in ${PRICE_TERMS.currency}.` : 'Prices are shown in dollars as published.', PRICE_TERMS.tax ?? 'Checkout shows the currency, any tax and the exact total before you pay.'].join(' ');
  return (
    <>
      <div className="border-b border-border">
        <Container className="pb-8 pt-10 sm:pt-14">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="mt-3 max-w-3xl font-brand text-[34px] font-bold leading-[1.08] tracking-[-0.02em] text-text sm:text-5xl">Plans for every kind of broadcast</h1>
          <p className="mt-3 max-w-2xl text-muted sm:text-lg">Every plan includes all supported sports, unlimited fixture preparation and rehearsals, and watermark-free graphics.</p>
          <div className="mt-8">
            <PricingPlans />
          </div>
          <p className="mt-5 text-sm text-muted">{terms} Yearly plans are charged once a year, at ten times the monthly price.</p>
        </Container>
      </div>

      <Section labelledBy="compare-heading">
        <H2 id="compare-heading">Compare every plan</H2>
        <p className="mt-3 max-w-2xl text-muted">The same facts as the plan cards, row by row.</p>
        <div className="mt-8">
          <PlanComparison />
        </div>
      </Section>

      <Section tone="raised" labelledBy="services-heading">
        <H2 id="services-heading">Optional services</H2>
        <div className="mt-6 relative overflow-x-auto rounded-2xl border border-border bg-panel shadow-card" role="region" aria-label="Optional services" tabIndex={0}>
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-elevated/70 text-xs uppercase tracking-[0.12em] text-muted">
              <tr><th scope="col" className="px-5 py-3">Service</th><th scope="col" className="px-5 py-3">Price</th><th scope="col" className="px-5 py-3">What it covers</th></tr>
            </thead>
            <tbody>
              {OPTIONAL_SERVICES.map((s) => (
                <tr key={s.key} className="border-t border-border align-top">
                  <th scope="row" className="px-5 py-4 font-semibold text-text">
                    {s.name}
                    {NOT_YET[s.key] ? <span className="ml-2 inline-block align-middle"><Badge tone="planned">Coming soon</Badge></span> : null}
                  </th>
                  <td className="whitespace-nowrap px-5 py-4 text-text">{s.price}</td>
                  <td className="px-5 py-4 text-muted">
                    {s.covers}
                    {NOT_YET[s.key] ? <span className="mt-1.5 block text-xs text-muted">{NOT_YET[s.key]}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section labelledBy="pricing-faq-heading">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <H2 id="pricing-faq-heading">Pricing questions</H2>
            <p className="mt-3 text-muted">League, association or a production company with more than five matches at once? We quote for your season.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/contact?topic=sales&plan=league">Contact sales</ButtonLink>
              <ButtonLink href="/register" variant="secondary">Get started</ButtonLink>
            </div>
          </div>
          <div className="divide-y divide-border rounded-2xl border border-border bg-panel shadow-card">
            {faqs.map((f) => (
              <details key={f.id} className="group px-5 sm:px-6">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-text marker:hidden">
                  {f.q}
                  <span aria-hidden className="text-xl leading-none text-primary transition group-open:rotate-45">+</span>
                </summary>
                <div className="space-y-3 pb-5 text-[15px] leading-relaxed text-muted">
                  {f.a.map((p, i) => <p key={i}><Rich text={p} /></p>)}
                </div>
              </details>
            ))}
            <div className="px-5 py-4 sm:px-6"><ArrowLink href="/faq#cat-accounts-pricing">More account and pricing answers</ArrowLink></div>
          </div>
        </div>
      </Section>
    </>
  );
}
