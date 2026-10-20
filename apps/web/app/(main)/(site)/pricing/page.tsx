import { Check } from 'lucide-react';
import { Badge, ButtonLink, Card, H2, Lead, PageIntro, Section } from '@/components/site/ui';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Pricing',
  description: 'MatchFrame hosted pricing is being finalised. How the hosted service and self-hosting differ, and what we will publish with prices.',
  path: '/pricing',
});

const WILL_PUBLISH = [
  'The currency, and whether prices include GST',
  'The billing period and how renewal works',
  'How many people, matches at once and outputs each plan includes',
  'Storage and export allowances, and what happens at a limit',
  'Any free plan or trial, and whether it needs a payment card',
  'How to change plans or cancel, and what happens to your data afterwards',
];

export default function PricingPage() {
  return (
    <>
      <PageIntro eyebrow="Pricing" title="Hosted pricing is being finalised">
        <Lead>We would rather publish nothing than a price that changes next month. If you are planning a season, tell us about your setup and we will come back to you.</Lead>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/contact">Tell us about your setup</ButtonLink>
          <ButtonLink href="/features" variant="secondary">See what is included</ButtonLink>
        </div>
      </PageIntro>

      <Section>
        <H2>Two ways to run MatchFrame</H2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Card>
            <div className="flex items-center gap-3"><h3 className="font-brand text-xl font-semibold text-white">Hosted</h3><Badge tone="beta">Pricing to come</Badge></div>
            <p className="mt-3 text-sm leading-relaxed text-muted">We run MatchFrame for you. Open it in a browser; there is nothing to install. The hosted service is the graphics edition: scoring, graphics, automation, sponsors and reports, with your stream going out from OBS on your own computer.</p>
            <ul className="mt-4 space-y-2 text-sm text-white/90">
              {['We look after the servers, backups and updates', 'Sign in from any browser; scorers use their phones', 'Cloud production is not part of the hosted service'].map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-cyan" aria-hidden />{x}</li>)}
            </ul>
          </Card>
          <Card>
            <div id="self-hosting" className="flex scroll-mt-24 items-center gap-3"><h3 className="font-brand text-xl font-semibold text-white">Self-hosted</h3><Badge>Terms to come</Badge></div>
            <p className="mt-3 text-sm leading-relaxed text-muted">You run your own MatchFrame deployment on servers you control: the app, a PostgreSQL database, Redis, file storage and an email service. Add the media server for cloud production, recordings and automatic highlights.</p>
            <ul className="mt-4 space-y-2 text-sm text-white/90">
              {['You pay your hosting provider for servers, storage and email', 'You are responsible for backups, updates and security', 'Cloud production needs a media server sized for your programmes'].map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-cyan" aria-hidden />{x}</li>)}
            </ul>
            <p className="mt-4 text-xs text-muted">Self-hosting terms are not published yet. Contact us before you plan a deployment.</p>
          </Card>
        </div>
      </Section>

      <Section tone="panel">
        <H2>What we will publish with prices</H2>
        <p className="mt-3 max-w-3xl text-muted">So you can decide without an email exchange, the pricing page will answer all of these when it goes live:</p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {WILL_PUBLISH.map((x) => (
            <li key={x} className="flex gap-3 rounded-lg border border-white/10 bg-panel/60 p-4 text-sm text-white/90"><Check className="mt-0.5 size-4 shrink-0 text-brand-cyan" aria-hidden />{x}</li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/contact">Contact us</ButtonLink>
          <ButtonLink href="/faq#cost" variant="secondary">Pricing questions</ButtonLink>
        </div>
      </Section>
    </>
  );
}
