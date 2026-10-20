import Link from 'next/link';
import { ArrowRight, LifeBuoy, PlayCircle } from 'lucide-react';
import { DocsSearch, type DocIndexEntry } from '@/components/site/docs-search';
import { Card, Container, Eyebrow, H1, Lead, Section, plain } from '@/components/site/ui';
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
      <div className="border-b border-white/5 bg-[radial-gradient(ellipse_at_top,rgba(43,92,255,0.18),transparent_60%)]">
        <Container className="py-14 sm:py-20">
          <Eyebrow>Documentation</Eyebrow>
          <H1 className="mt-3 max-w-3xl">How can we help?</H1>
          <div className="mt-8 max-w-2xl">
            <DocsSearch index={index} />
          </div>
        </Container>
      </div>

      <Section>
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <Link href="/docs/getting-started/first-match" className="group rounded-2xl border border-brand-cyan/40 bg-[linear-gradient(135deg,rgba(0,210,255,0.14),rgba(43,92,255,0.12))] p-6 transition hover:border-brand-cyan">
            <PlayCircle className="size-7 text-brand-cyan" aria-hidden />
            <h2 className="mt-4 font-brand text-2xl font-bold text-white">Set up your first match</h2>
            <p className="mt-2 text-muted">From a new account to graphics in OBS that follow the scorer, step by step.</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan">Start here <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
          </Link>
          <div id="troubleshooting" className="scroll-mt-24 rounded-2xl border border-white/10 bg-panel/60 p-6">
            <LifeBuoy className="size-7 text-warning" aria-hidden />
            <h2 className="mt-4 font-brand text-xl font-bold text-white">Something wrong on matchday?</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {docsIn('troubleshooting').map((d) => (
                <li key={d.slug}><Link href={`/docs/${d.slug}`} className="text-white hover:text-brand-cyan">{d.title}</Link></li>
              ))}
              <li><Link href="/docs/scoring/corrections" className="text-white hover:text-brand-cyan">The score looks wrong</Link></li>
              <li><Link href="/docs/support/contact" className="text-white hover:text-brand-cyan">Get help from us</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_SECTIONS.filter((s) => s.key !== 'troubleshooting').map((s) => {
            const list = docsIn(s.key);
            if (!list.length) return null;
            return (
              <Card key={s.key}>
                <h2 id={s.key} className="scroll-mt-24 font-brand text-lg font-semibold text-white">{s.label}</h2>
                <p className="mt-1 text-sm text-muted">{s.blurb}</p>
                <ul className="mt-4 space-y-2">
                  {list.map((d) => (
                    <li key={d.slug}>
                      <Link href={`/docs/${d.slug}`} className="text-sm text-white/90 hover:text-brand-cyan">{d.title}</Link>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
        <Lead className="mt-12 !text-base">Can't find what you need? The <Link href="/faq" className="text-brand-cyan hover:underline">FAQ</Link> answers the common questions, and you can always <Link href="/contact" className="text-brand-cyan hover:underline">contact us</Link>.</Lead>
      </Section>
    </>
  );
}
