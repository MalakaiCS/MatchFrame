'use client';
// Searchable FAQ. Every question and answer is in the page (native <details>), so it reads without JavaScript
// and with assistive technology; search only hides what does not match. A link to #question-id opens it.
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { FAQ_CATEGORIES, type Faq } from '@/content/faq';
import { Rich, plain } from './ui';

export function FaqBrowser({ faqs }: { faqs: Faq[] }) {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && faqs.some((f) => f.id === id)) {
        setOpenId(id);
        requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
      }
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [faqs]);

  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = useMemo(() => {
    const index = new Map(faqs.map((f) => [f.id, `${f.q} ${f.a.map(plain).join(' ')}`.toLowerCase()]));
    return (f: Faq) => terms.every((t) => index.get(f.id)!.includes(t));
  }, [faqs, terms.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = faqs.filter(match);

  return (
    <div className="grid gap-10 lg:grid-cols-[14rem_1fr]">
      <nav aria-label="FAQ categories" className="lg:sticky lg:top-24 lg:self-start">
        <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
          {FAQ_CATEGORIES.map((c) => (
            <li key={c.key}>
              <a href={`#cat-${c.key}`} className="block rounded-md px-3 py-2 text-sm text-muted hover:bg-white/5 hover:text-white">{c.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div>
        <label className="relative block">
          <span className="sr-only">Search the questions</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the questions, for example OBS or offline" className="min-h-12 w-full rounded-xl border border-white/10 bg-panel pl-10 pr-4 text-white placeholder:text-muted focus:border-brand-cyan focus:outline-none" />
        </label>
        <p className="mt-2 text-xs text-muted" aria-live="polite">{terms.length ? `${shown.length} of ${faqs.length} questions match` : `${faqs.length} questions`}</p>
        {terms.length && !shown.length ? (
          <p className="mt-8 text-muted">No question matches that. Try a shorter word, browse the <a href="/docs" className="text-brand-cyan hover:underline">documentation</a>, or <a href="/contact" className="text-brand-cyan hover:underline">ask us</a>.</p>
        ) : null}
        {FAQ_CATEGORIES.map((c) => {
          const list = shown.filter((f) => f.category === c.key);
          if (!list.length) return null;
          return (
            <section key={c.key} id={`cat-${c.key}`} aria-labelledby={`h-${c.key}`} className="mt-8 scroll-mt-24">
              <h2 id={`h-${c.key}`} className="font-brand text-xl font-semibold text-white">{c.label}</h2>
              <div className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10 bg-panel/50">
                {list.map((f) => (
                  <details key={f.id} id={f.id} open={openId === f.id || terms.length > 0} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpenId(f.id); }} className="group scroll-mt-24 px-4 py-1 sm:px-5">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-2 font-medium text-white marker:hidden">
                      <span>{f.q}</span>
                      <span aria-hidden className="text-brand-cyan transition group-open:rotate-45">+</span>
                    </summary>
                    <div className="space-y-3 pb-4 text-sm leading-relaxed text-muted">
                      {f.a.map((p, i) => <p key={i}><Rich text={p} /></p>)}
                      <p><a href={`#${f.id}`} className="text-xs text-white/50 hover:text-brand-cyan">Link to this answer</a></p>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
