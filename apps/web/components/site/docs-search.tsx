'use client';
// Search across the help articles' titles, outcomes and text. Results link straight to the article.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

export interface DocIndexEntry {
  slug: string;
  title: string;
  outcome: string;
  section: string;
  text: string;
}

export function DocsSearch({ index }: { index: DocIndexEntry[] }) {
  const [q, setQ] = useState('');
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = useMemo(() => {
    if (!terms.length) return [];
    return index
      .map((d) => {
        const title = d.title.toLowerCase();
        const all = `${title} ${d.outcome.toLowerCase()} ${d.text.toLowerCase()}`;
        if (!terms.every((t) => all.includes(t))) return null;
        const score = terms.reduce((s, t) => s + (title.includes(t) ? 3 : 0) + (d.outcome.toLowerCase().includes(t) ? 2 : 0) + 1, 0);
        return { d, score };
      })
      .filter((x): x is { d: DocIndexEntry; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [index, terms.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative">
      <label className="relative block">
        <span className="sr-only">Search the documentation</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guides, for example OBS, line-ups or offline" className="min-h-14 w-full rounded-xl border border-white/10 bg-panel pl-12 pr-4 text-base text-white placeholder:text-muted focus:border-brand-cyan focus:outline-none" />
      </label>
      {terms.length ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-panel" aria-live="polite">
          {results.length ? (
            <ul className="divide-y divide-white/5">
              {results.map(({ d }) => (
                <li key={d.slug}>
                  <Link href={`/docs/${d.slug}`} className="block px-4 py-3 hover:bg-white/5">
                    <span className="block font-medium text-white">{d.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">{d.outcome}</span>
                    <span className="mt-1 block text-xs text-brand-cyan">{d.section}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-muted">
              No guide matches that yet. Try the <Link href="/faq" className="text-brand-cyan hover:underline">FAQ</Link>, or <Link href="/contact" className="text-brand-cyan hover:underline">ask us</Link>.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
