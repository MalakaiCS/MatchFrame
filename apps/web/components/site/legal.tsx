// A legal document (terms, privacy): the date it was last updated, a list of sections that stays beside the text on
// wide screens, and the sections themselves, from apps/web/content/legal.ts.
import { Container, Lead, PageIntro, Rich } from '@/components/site/ui';
import { LEGAL_UPDATED, type LegalSection } from '@/content/legal';

export function LegalDocument({ title, lead, sections }: { title: string; lead: string; sections: LegalSection[] }) {
  return (
    <>
      <PageIntro eyebrow="Legal" title={title}>
        <Lead>{lead}</Lead>
        <p className="mt-4 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      </PageIntro>
      <Container className="py-10 sm:py-14">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">On this page</p>
            <ol className="mt-3 space-y-1 border-l border-border">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-sm text-muted hover:border-primary hover:text-text">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="max-w-3xl">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className={`scroll-mt-24 ${i ? 'mt-10 border-t border-border pt-10' : ''}`}>
                <h2 id={`${s.id}-h`} className="font-brand text-xl font-bold tracking-tight text-text sm:text-2xl">
                  {s.title}
                </h2>
                <div className="mt-4 space-y-4 text-[15px] leading-[1.7] text-muted">
                  {s.body.map((b, j) =>
                    typeof b === 'string' ? (
                      <p key={j}>
                        <Rich text={b} />
                      </p>
                    ) : (
                      <ul key={j} className="list-disc space-y-2 pl-5 marker:text-primary">
                        {b.list.map((item) => (
                          <li key={item}>
                            <Rich text={item} />
                          </li>
                        ))}
                      </ul>
                    ),
                  )}
                </div>
              </section>
            ))}
          </article>
        </div>
      </Container>
    </>
  );
}
