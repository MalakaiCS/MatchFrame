import { BookOpen, MessageSquareText } from 'lucide-react';
import { FaqBrowser } from '@/components/site/faq-browser';
import { ButtonLink, Container, Lead, PageIntro, plain } from '@/components/site/ui';
import { FAQS, FAQ_CATEGORIES } from '@/content/faq';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'FAQ',
  description: 'Answers about MatchFrame: sports, equipment, OBS, offline scoring, streaming, sponsors, highlights, pricing and support.',
  path: '/faq',
});

export default function FaqPage() {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.map(plain).join(' ') } })),
  };
  return (
    <>
      <PageIntro eyebrow="FAQ" title="Questions and answers">
        <Lead>Practical answers about equipment, sports, connectivity, sponsors and pricing. Where something has not been tested or decided yet, we say so.</Lead>
      </PageIntro>
      <Container className="py-10 sm:py-14">
        <FaqBrowser faqs={FAQS} categories={FAQ_CATEGORIES} />
        <div className="mt-16 grid grid-cols-1 gap-4 border-t border-border pt-10 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-panel p-6 shadow-card">
            <BookOpen className="size-6 text-primary" aria-hidden />
            <h2 className="mt-3 font-brand text-lg font-semibold text-text">Step-by-step guides</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">Set up a first match, connect the graphics to OBS and fix common matchday problems.</p>
            <ButtonLink href="/docs" variant="secondary" className="mt-4">Browse the documentation</ButtonLink>
          </div>
          <div className="rounded-2xl border border-border bg-panel p-6 shadow-card">
            <MessageSquareText className="size-6 text-primary" aria-hidden />
            <h2 className="mt-3 font-brand text-lg font-semibold text-text">Didn&apos;t find your answer?</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">Send the team a message. We reply by email.</p>
            <ButtonLink href="/contact" className="mt-4">Ask us</ButtonLink>
          </div>
        </div>
      </Container>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
    </>
  );
}
