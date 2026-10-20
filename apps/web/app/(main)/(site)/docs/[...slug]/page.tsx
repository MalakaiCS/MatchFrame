import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { Container, Rich, plain } from '@/components/site/ui';
import { DOCS, DOC_SECTIONS, docBySlug, docsIn, type Block } from '@/content/docs';
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

function BlockView({ b }: { b: Block }) {
  if ('h' in b) return <h2 className="mt-10 font-brand text-xl font-semibold text-white">{b.h}</h2>;
  if ('p' in b) return <p className="mt-4 leading-relaxed text-white/85"><Rich text={b.p} /></p>;
  if ('list' in b)
    return (
      <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-white/85">
        {b.list.map((x, i) => <li key={i}><Rich text={x} /></li>)}
      </ul>
    );
  if ('note' in b)
    return (
      <div className={`mt-5 flex gap-3 rounded-xl border p-4 text-sm leading-relaxed ${b.tone === 'warning' ? 'border-warning/40 bg-warning/10 text-white' : 'border-brand-cyan/30 bg-brand-cyan/5 text-white/90'}`}>
        {b.tone === 'warning' ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-brand-cyan" aria-hidden />}
        <p><Rich text={b.note} /></p>
      </div>
    );
  if ('steps' in b)
    return (
      <ol className="mt-5 space-y-4">
        {b.steps.map((s, i) => (
          <li key={i} className="flex gap-4">
            <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-blue/25 text-xs font-bold text-brand-cyan">{i + 1}</span>
            <div className="leading-relaxed text-white/90">
              <p><Rich text={s.do} /></p>
              {s.expect ? <p className="mt-1.5 flex gap-2 text-sm text-healthy"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /><span><span className="sr-only">Expected result: </span><Rich text={s.expect} /></span></p> : null}
            </div>
          </li>
        ))}
      </ol>
    );
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.1em] text-muted"><tr>{b.table.head.map((h, i) => <th key={i} scope="col" className="px-4 py-3">{h}</th>)}</tr></thead>
        <tbody>
          {b.table.rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5 align-top">
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row" className="px-4 py-3 font-medium text-white"><Rich text={c} /></th> : <td key={j} className="px-4 py-3 text-white/80"><Rich text={c} /></td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const d = docBySlug(slug.join('/'));
  if (!d) notFound();
  const section = DOC_SECTIONS.find((s) => s.key === d.section)!;
  const related = (d.related ?? []).map(docBySlug).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <Container className="grid gap-10 py-10 lg:grid-cols-[15rem_1fr] lg:py-14">
      <nav aria-label="Documentation" className="hidden lg:block">
        <div className="sticky top-24 space-y-5 text-sm">
          <Link href="/docs" className="block font-medium text-white hover:text-brand-cyan">All documentation</Link>
          {DOC_SECTIONS.map((s) => {
            const list = docsIn(s.key);
            if (!list.length) return null;
            return (
              <div key={s.key}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{s.label}</p>
                <ul className="mt-2 space-y-1.5">
                  {list.map((x) => (
                    <li key={x.slug}><Link href={`/docs/${x.slug}`} aria-current={x.slug === d.slug ? 'page' : undefined} className={x.slug === d.slug ? 'text-brand-cyan' : 'text-white/75 hover:text-white'}>{x.title}</Link></li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </nav>
      <article className="min-w-0 max-w-3xl">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <Link href="/docs" className="hover:text-white">Documentation</Link> <span aria-hidden>/</span> <Link href={`/docs#${section.key}`} className="hover:text-white">{section.label}</Link>
        </nav>
        <h1 className="mt-3 font-brand text-3xl font-bold tracking-tight text-white sm:text-4xl">{d.title}</h1>
        <p className="mt-3 text-lg text-muted"><Rich text={d.outcome} /></p>
        {d.availability || d.prerequisites?.length ? (
          <div className="mt-6 grid gap-3 rounded-xl border border-white/10 bg-panel/60 p-4 text-sm sm:grid-cols-2">
            {d.availability ? <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Applies to</p><p className="mt-1 text-white/90"><Rich text={d.availability} /></p></div> : null}
            {d.prerequisites?.length ? <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Before you start</p><ul className="mt-1 list-disc space-y-1 pl-4 text-white/90">{d.prerequisites.map((p, i) => <li key={i}><Rich text={p} /></li>)}</ul></div> : null}
          </div>
        ) : null}
        <div className="mt-4">{d.body.map((b, i) => <BlockView key={i} b={b} />)}</div>
        {related.length ? (
          <div className="mt-12 border-t border-white/5 pt-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Related guides</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {related.map((r) => (
                <li key={r.slug}><Link href={`/docs/${r.slug}`} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-4 py-3 text-sm text-white hover:border-brand-cyan">{r.title}<ArrowRight className="size-4 text-brand-cyan" aria-hidden /></Link></li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-10 text-xs text-muted">Checked against the product on {new Date(d.verified).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}. Something not matching what you see? <Link href="/contact" className="text-brand-cyan hover:underline">Tell us</Link>.</p>
      </article>
    </Container>
  );
}
