import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Info, TriangleAlert } from 'lucide-react';
import { Container, Rich, plain } from '@/components/site/ui';
import { DOCS, DOC_SECTIONS, docBySlug, docsIn, type Block, type DocArticle } from '@/content/docs';
import { siteMetadata } from '@/lib/site-meta';

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug.split('/') }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const d = docBySlug(slug.join('/'));
  if (!d) return {};
  return siteMetadata({ title: d.title, description: plain(d.outcome), path: `/docs/${d.slug}` });
}

/** Every guide in reading order: sections in their listed order, guides in each section as written. */
const ORDER: DocArticle[] = DOC_SECTIONS.flatMap((s) => docsIn(s.key));

function BlockView({ b, title }: { b: Block; title: string }) {
  if ('h' in b) return <h2 className="mt-10 scroll-mt-24 font-brand text-xl font-semibold text-text sm:text-2xl">{b.h}</h2>;
  if ('p' in b) return <p className="mt-4 leading-[1.7] text-text/90"><Rich text={b.p} /></p>;
  if ('list' in b)
    return (
      <ul className="mt-4 list-disc space-y-2 pl-5 leading-[1.7] text-text/90 marker:text-muted">
        {b.list.map((x, i) => <li key={i}><Rich text={x} /></li>)}
      </ul>
    );
  if ('note' in b)
    return (
      <div role="note" className={`mt-6 flex gap-3 rounded-xl border p-4 text-[15px] leading-relaxed text-text ${b.tone === 'warning' ? 'border-warning/45 bg-warning/10' : 'border-primary/30 bg-primary/[0.06]'}`}>
        {b.tone === 'warning' ? <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden /> : <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />}
        <p><span className="sr-only">{b.tone === 'warning' ? 'Warning: ' : 'Note: '}</span><Rich text={b.note} /></p>
      </div>
    );
  if ('steps' in b)
    return (
      <ol className="mt-6 space-y-5">
        {b.steps.map((s, i) => (
          <li key={i} className="flex gap-4">
            <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/12 font-brand text-sm font-bold text-primary ring-1 ring-primary/30">{i + 1}</span>
            <div className="min-w-0 leading-[1.7] text-text/90">
              <p><span className="sr-only">Step {i + 1}: </span><Rich text={s.do} /></p>
              {s.expect ? (
                <p className="mt-2 flex gap-2 rounded-lg bg-healthy/10 px-3 py-2 text-sm text-text">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-healthy" aria-hidden />
                  <span><span className="font-semibold">Expected: </span><Rich text={s.expect} /></span>
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    );
  return (
    <div role="region" tabIndex={0} aria-label={`Table: ${b.table.head.join(', ')} (${title})`} className="mt-6 relative overflow-x-auto rounded-xl border border-border bg-panel shadow-card focus-visible:outline-2 focus-visible:outline-primary">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-elevated/70 text-xs uppercase tracking-[0.1em] text-muted"><tr>{b.table.head.map((h, i) => <th key={i} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody>
          {b.table.rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row" className="px-4 py-3 font-medium text-text"><Rich text={c} /></th> : <td key={j} className="px-4 py-3 text-text/85"><Rich text={c} /></td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GuideList({ current }: { current: string }) {
  return (
    <div className="space-y-6 text-sm">
      {DOC_SECTIONS.map((s) => {
        const list = docsIn(s.key);
        if (!list.length) return null;
        return (
          <div key={s.key}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{s.label}</p>
            <ul className="mt-2 space-y-0.5 border-l border-border">
              {list.map((x) => (
                <li key={x.slug}>
                  <Link
                    href={`/docs/${x.slug}`}
                    aria-current={x.slug === current ? 'page' : undefined}
                    className={`-ml-px block border-l-2 py-1.5 pl-3 leading-snug ${x.slug === current ? 'border-primary font-semibold text-primary' : 'border-transparent text-text/75 hover:border-border-strong hover:text-text'}`}
                  >
                    {x.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const d = docBySlug(slug.join('/'));
  if (!d) notFound();
  const section = DOC_SECTIONS.find((s) => s.key === d.section)!;
  const related = (d.related ?? []).map(docBySlug).filter((x): x is NonNullable<typeof x> => !!x);
  const at = ORDER.findIndex((x) => x.slug === d.slug);
  const prev = at > 0 ? ORDER[at - 1] : null;
  const next = at >= 0 && at < ORDER.length - 1 ? ORDER[at + 1] : null;
  const inSection = docsIn(d.section);
  return (
    <Container className="grid grid-cols-1 gap-10 py-8 sm:py-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14 lg:py-14">
      <nav aria-label="Documentation" className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6 pr-2">
          <Link href="/docs" className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-text hover:text-primary"><ArrowLeft className="size-4" aria-hidden /> All documentation</Link>
          <GuideList current={d.slug} />
        </div>
      </nav>
      <article className="min-w-0">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
            <li><Link href="/docs" className="hover:text-primary hover:underline">Documentation</Link></li>
            <li aria-hidden>/</li>
            <li><Link href={`/docs#${section.key}`} className="hover:text-primary hover:underline">{section.label}</Link></li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-text/80">{d.title}</li>
          </ol>
        </nav>
        {inSection.length > 1 ? (
          <details className="group mt-4 rounded-xl border border-border bg-panel lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-text [&::-webkit-details-marker]:hidden">
              In this section: {section.label}
              <ChevronDown className="size-4 text-muted transition group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="border-t border-border px-4 py-2">
              {inSection.map((x) => (
                <li key={x.slug}><Link href={`/docs/${x.slug}`} aria-current={x.slug === d.slug ? 'page' : undefined} className={`block py-2 text-sm ${x.slug === d.slug ? 'font-semibold text-primary' : 'text-text/80 hover:text-text'}`}>{x.title}</Link></li>
              ))}
              <li><Link href="/docs" className="block py-2 text-sm text-muted hover:text-text">All documentation</Link></li>
            </ul>
          </details>
        ) : null}
        <div className="max-w-[70ch]">
          <h1 className="mt-5 font-brand text-3xl font-bold leading-tight tracking-tight text-text sm:text-4xl">{d.title}</h1>
          <p className="mt-3 text-lg leading-relaxed text-muted"><Rich text={d.outcome} /></p>
          {d.availability || d.prerequisites?.length ? (
            <div className="mt-6 grid grid-cols-1 gap-4 rounded-xl border border-border bg-panel p-5 text-sm shadow-card sm:grid-cols-2">
              {d.availability ? <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Applies to</p><p className="mt-1.5 leading-relaxed text-text/90"><Rich text={d.availability} /></p></div> : null}
              {d.prerequisites?.length ? <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Before you start</p><ul className="mt-1.5 list-disc space-y-1 pl-4 leading-relaxed text-text/90">{d.prerequisites.map((p, i) => <li key={i}><Rich text={p} /></li>)}</ul></div> : null}
            </div>
          ) : null}
          <div className="mt-4">{d.body.map((b, i) => <BlockView key={i} b={b} title={d.title} />)}</div>

          {related.length ? (
            <div className="mt-12 border-t border-border pt-6">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Related guides</h2>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {related.map((r) => (
                  <li key={r.slug}><Link href={`/docs/${r.slug}`} className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-border bg-panel px-4 py-3 text-sm font-medium text-text shadow-card hover:border-primary">{r.title}<ArrowRight className="size-4 shrink-0 text-primary" aria-hidden /></Link></li>
                ))}
              </ul>
            </div>
          ) : null}

          {prev || next ? (
            <nav aria-label="Previous and next guides" className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {prev ? (
                <Link href={`/docs/${prev.slug}`} className="group rounded-xl border border-border px-4 py-3 hover:border-primary">
                  <span className="flex items-center gap-1 text-xs text-muted"><ArrowLeft className="size-3.5" aria-hidden /> Previous</span>
                  <span className="mt-0.5 block text-sm font-semibold text-text group-hover:text-primary">{prev.title}</span>
                </Link>
              ) : <span />}
              {next ? (
                <Link href={`/docs/${next.slug}`} className="group rounded-xl border border-border px-4 py-3 text-right hover:border-primary">
                  <span className="flex items-center justify-end gap-1 text-xs text-muted">Next <ArrowRight className="size-3.5" aria-hidden /></span>
                  <span className="mt-0.5 block text-sm font-semibold text-text group-hover:text-primary">{next.title}</span>
                </Link>
              ) : null}
            </nav>
          ) : null}

          <p className="mt-10 text-xs text-muted">Checked against the product on {new Date(d.verified).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}. Something not matching what you see? <Link href="/contact" className="font-medium text-primary hover:underline">Tell us</Link>.</p>
        </div>
      </article>
    </Container>
  );
}
