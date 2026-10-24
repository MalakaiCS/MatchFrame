import Link from 'next/link';
import { ArrowRight, LifeBuoy, PlayCircle } from 'lucide-react';
import { DocsSearch, type DocIndexEntry } from '@/components/site/docs-search';
import { Container, Eyebrow, H1, Section, plain } from '@/components/site/ui';
import { DOCS, DOC_SECTIONS, docsIn, type Block } from '@/content/docs';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Documentation',
  description: 'Set up your first match, connect your graphics to OBS, rehearse, and fix common problems with MatchFrame.',
  path: '/docs',
});

const blockText = (b: Block) => ('h' in b ? b.h : 'p' in b ? b.p : 'note' in b ? b.note : 'list' in b ? b.list.join(' ') : 'steps' in b ? b.steps.map((s) => `${s.do} ${s.expect ?? ''}`).join(' ') : b.table.rows.flat().join(' '));

export default function DocsHome() {
  const index: DocIndexEntry[] = DOCS.map((d) => ({ slug: d.slug, title: d.title, outcome: d.outcome, section: DOC_SECTIONS.find((s) => s.key === d.section)!.label, text: plain(d.body.map(blockText).join(' ')) }));
  return (
    <>
      <div className="relative border-b border-border">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_10%_0%,color-mix(in_oklab,var(--color-primary)_14%,transparent),transparent_70%)]" />
        <Container className="relative py-10 sm:py-14">
          <Eyebrow>Documentation</Eyebrow>
          <H1 className="mt-3 max-w-3xl !text-[34px] sm:!text-5xl">How can we help?</H1>
          <p className="mt-3 max-w-2xl text-muted sm:text-lg">{DOCS.length} guides, checked against the product. Search them, or start with one of the two below.</p>
          <div className="relative z-10 mt-7 max-w-2xl">
            <DocsSearch index={index} />
          </div>
        </Container>
      </div>

      <Section className="!pt-10 sm:!pt-12">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Link href="/docs/getting-started/first-match" className="group rounded-2xl border border-primary/40 bg-primary/[0.07] p-6 shadow-card transition hover:border-primary sm:p-7">
            <PlayCircle className="size-7 text-primary" aria-hidden />
            <h2 className="mt-4 font-brand text-2xl font-bold text-text">Set up your first match</h2>
            <p className="mt-2 max-w-md text-muted">From a new account to graphics in OBS that follow the scorer, step by step.</p>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">Start here <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
          </Link>
          <div id="troubleshooting" className="scroll-mt-24 rounded-2xl border border-border bg-panel p-6 shadow-card sm:p-7">
            <LifeBuoy className="size-7 text-warning" aria-hidden />
            <h2 className="mt-4 font-brand text-xl font-bold text-text">Something wrong on matchday?</h2>
            <p className="mt-1.5 text-sm text-muted">What to check, in order.</p>
            <ul className="mt-3 space-y-1">
              {docsIn('troubleshooting').map((d) => (
                <li key={d.slug}><Link href={`/docs/${d.slug}`} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-text hover:text-primary"><ArrowRight className="size-3.5 text-primary" aria-hidden />{d.title}</Link></li>
              ))}
              <li><Link href="/docs/scoring/corrections" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-text hover:text-primary"><ArrowRight className="size-3.5 text-primary" aria-hidden />The score looks wrong</Link></li>
              <li><Link href="/docs/support/contact" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-text hover:text-primary"><ArrowRight className="size-3.5 text-primary" aria-hidden />Get help from us</Link></li>
            </ul>
          </div>
        </div>

        <h2 className="mt-14 font-brand text-2xl font-bold text-text">All guides</h2>
        <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_SECTIONS.filter((s) => s.key !== 'troubleshooting').map((s) => {
            const list = docsIn(s.key);
            if (!list.length) return null;
            return (
              <section key={s.key} aria-labelledby={s.key} className="border-t border-border pt-5">
                <h3 id={s.key} className="scroll-mt-24 font-brand text-lg font-semibold text-text">{s.label}</h3>
                <p className="mt-1 text-sm text-muted">{s.blurb}</p>
                <ul className="mt-3 space-y-0.5">
                  {list.map((d) => (
                    <li key={d.slug}>
                      <Link href={`/docs/${d.slug}`} className="inline-flex min-h-9 items-center text-[15px] text-text/90 hover:text-primary hover:underline hover:underline-offset-4">{d.title}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <p className="mt-14 max-w-2xl text-muted">Can&apos;t find what you need? The <Link href="/faq" className="font-medium text-primary hover:underline">FAQ</Link> answers the common questions, and you can always <Link href="/contact" className="font-medium text-primary hover:underline">contact us</Link>.</p>
      </Section>
    </>
  );
}
