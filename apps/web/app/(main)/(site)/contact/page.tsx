import Link from 'next/link';
import { ContactForm } from '@/components/site/contact-form';
import { Card, Lead, PageIntro, Section } from '@/components/site/ui';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Contact',
  description: 'Contact the MatchFrame team about the product, setup help, pricing or partnerships.',
  path: '/contact',
});

export default function ContactPage() {
  return (
    <>
      <PageIntro eyebrow="Contact" title="Talk to the MatchFrame team">
        <Lead>Questions about the product, help with a setup, pricing for your season, or a partnership: send us a message and we will reply by email.</Lead>
      </PageIntro>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <ContactForm />
          <div className="space-y-4">
            <Card>
              <h2 className="font-semibold text-white">Help on matchday</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">We do not offer live phone support. For a problem during a match, start with <Link href="/docs/troubleshooting/graphics-not-visible" className="text-brand-cyan hover:underline">missing graphics</Link> or <Link href="/docs/troubleshooting/connection-loss" className="text-brand-cyan hover:underline">a dropped connection</Link>.</p>
            </Card>
            <Card>
              <h2 className="font-semibold text-white">What happens to your message</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">It is sent by email to the MatchFrame team so we can reply to you. This website does not store it, and we do not add you to a mailing list.</p>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
