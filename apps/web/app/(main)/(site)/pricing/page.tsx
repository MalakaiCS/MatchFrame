import { OPTIONAL_SERVICES } from '@bs/domain';
import { PricingPlans } from '@/components/site/pricing-plans';
import { Badge, ButtonLink, H2, Lead, PageIntro, Section } from '@/components/site/ui';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Pricing',
  description: 'MatchFrame plans: Starter $29/month, Club $79/month, Studio $199/month, League / Enterprise from $499/month, with two months free on yearly billing.',
  path: '/pricing',
});

/** Optional services the hosted service cannot deliver yet, with why (shown beside the proposed price). */
const NOT_YET: Record<string, string> = {
  'cloud-production': 'Coming to the hosted service. Cloud production runs today on self-hosted deployments with the media server; 1080p30 output is still being measured.',
};

export default function PricingPage() {
  return (
    <>
      <PageIntro eyebrow="Pricing" title="Plans for every kind of broadcast">
        <Lead>From one team streaming its home games to production companies covering several matches at once. Every plan includes all supported sports, unlimited fixture preparation and rehearsals, and watermark-free graphics.</Lead>
      </PageIntro>

      <Section>
        <PricingPlans />
        <p className="mt-6 text-center text-xs text-muted">Allowances are per organisation. Yearly billing is charged once a year.</p>
      </Section>

      <Section tone="panel">
        <H2>Optional services</H2>
        <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.12em] text-muted">
              <tr><th scope="col" className="px-4 py-3">Service</th><th scope="col" className="px-4 py-3">Price</th><th scope="col" className="px-4 py-3">What it covers</th></tr>
            </thead>
            <tbody>
              {OPTIONAL_SERVICES.map((s) => (
                <tr key={s.key} className="border-t border-white/5 align-top">
                  <th scope="row" className="px-4 py-3 font-medium text-white">
                    {s.name}
                    {NOT_YET[s.key] ? <span className="ml-2 align-middle"><Badge tone="beta">Coming soon</Badge></span> : null}
                  </th>
                  <td className="whitespace-nowrap px-4 py-3 text-white/90">{s.price}</td>
                  <td className="px-4 py-3 text-muted">
                    {s.covers}
                    {NOT_YET[s.key] ? <span className="mt-1 block text-xs text-warning/90">{NOT_YET[s.key]}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/register">Get started</ButtonLink>
          <ButtonLink href="/contact" variant="secondary">Talk to us about League / Enterprise</ButtonLink>
          <ButtonLink href="/faq#cost" variant="ghost">Pricing questions</ButtonLink>
        </div>
      </Section>
    </>
  );
}
