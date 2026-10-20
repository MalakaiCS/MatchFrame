import { FaqBrowser } from '@/components/site/faq-browser';
import { ButtonLink, Lead, PageIntro, Section, plain } from '@/components/site/ui';
import { FAQS } from '@/content/faq';
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
      <Section>
        <FaqBrowser faqs={FAQS} />
        <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-white/5 pt-8">
          <p className="mr-2 text-muted">Didn't find your answer?</p>
          <ButtonLink href="/docs" variant="secondary">Browse the documentation</ButtonLink>
          <ButtonLink href="/contact">Ask us</ButtonLink>
        </div>
      </Section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
    </>
  );
}
