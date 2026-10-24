'use client';
// Search across the help articles' titles, outcomes and text. Results link straight to the article; the arrow keys
// move from the box through the results, Escape clears. The result count and the results are announced politely.
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';

export interface DocIndexEntry {
  slug: string;
  title: string;
  outcome: string;
  section: string;
  text: string;
}

export function DocsSearch({ index }: { index: DocIndexEntry[] }) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
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

  const clear = () => {
    setQ('');
    input.current?.focus();
  };
  const links = () => [...(list.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && q) {
      e.preventDefault();
      clear();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const l = links();
    if (!l.length) return;
    e.preventDefault();
    const i = l.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) {
      if (e.key === 'ArrowDown') l[0]!.focus();
      return;
    }
    const next = i + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) input.current?.focus();
    else l[Math.min(next, l.length - 1)]!.focus();
  };

  return (
    <div className="relative" onKeyDown={onKey}>
      <label className="relative block">
        <span className="sr-only">Search the documentation</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the guides, for example OBS, line-ups or offline"
          aria-describedby="docs-search-hint"
          className="min-h-14 w-full rounded-xl border border-border bg-panel pl-12 pr-12 text-base text-text shadow-card placeholder:text-muted/80 transition hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 [&::-webkit-search-cancel-button]:hidden"
        />
        {q ? (
          <button type="button" onClick={clear} aria-label="Clear the search" className="absolute right-2.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-text">
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </label>
      <p id="docs-search-hint" className="sr-only">Use the arrow keys to move through the results and Escape to clear.</p>
      <div aria-live="polite">
        {terms.length ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-panel shadow-pop">
            <p className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted">{results.length ? `${results.length} ${results.length === 1 ? 'guide matches' : 'guides match'}${results.length === 8 ? ' (best 8 shown)' : ''}` : 'No guides match'}</p>
            {results.length ? (
              <ul ref={list} className="divide-y divide-border">
                {results.map(({ d }) => (
                  <li key={d.slug}>
                    <Link href={`/docs/${d.slug}`} className="group flex items-start gap-3 px-4 py-3 outline-none hover:bg-elevated focus-visible:bg-elevated focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-text">{d.title}</span>
                        <span className="mt-0.5 block text-sm text-muted">{d.outcome}</span>
                        <span className="mt-1 block text-xs font-medium text-primary">{d.section}</span>
                      </span>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-5 text-sm text-muted">
                <p>Nothing matches “{q.trim()}”. Try a shorter word, or look in the <Link href="/faq" className="font-medium text-primary hover:underline">FAQ</Link>, or <Link href="/contact" className="font-medium text-primary hover:underline">ask us</Link>.</p>
                <button type="button" onClick={clear} className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border-strong/70 px-4 text-sm font-semibold text-text hover:border-primary hover:text-primary">
                  <X className="size-4" aria-hidden /> Clear the search
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
