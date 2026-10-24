'use client';
// Searchable FAQ. Every question and answer is in the page (native <details>), so it reads without JavaScript
// and with assistive technology; search only hides what does not match. A link to #question-id opens it, and
// each answer can copy its own link. Categories scroll sideways on phones and stay in view on wide screens.
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Link2, Search, X } from 'lucide-react';
// types only: the content (and the graphics registry it counts from) stays on the server and arrives as props
import type { Faq, FaqCategory } from '@/content/faq';
import { Rich, plain } from './ui';

/** The guide that goes deeper on each category. */
const GUIDES: Record<FaqCategory, { href: string; label: string }> = {
  'getting-started': { href: '/docs/getting-started/first-match', label: 'Set up your first match' },
  'graphics-scoring': { href: '/docs/scoring/corrections', label: 'Scoring and corrections' },
  production: { href: '/docs/production/choose-a-workflow', label: 'Choose a production workflow' },
  'sponsors-highlights': { href: '/docs/sponsors/reports', label: 'Sponsors and reports' },
  'accounts-pricing': { href: '/pricing', label: 'Compare the plans' },
  support: { href: '/docs/support/contact', label: 'How to get help' },
};

function CopyLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = `${window.location.origin}/faq#${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // no clipboard (insecure origin or permission): put the link in the address bar instead
      window.history.replaceState(null, '', `#${id}`);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
      <button type="button" onClick={() => void copy()} className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-muted hover:text-primary">
        {copied ? <Check className="size-3.5 text-healthy" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
        {copied ? 'Link copied' : 'Copy link to this answer'}
      </button>
      <a href={`#${id}`} className="text-xs text-muted hover:text-primary">Link to this answer</a>
      <span className="sr-only" aria-live="polite">{copied ? 'Link copied' : ''}</span>
    </span>
  );
}

export function FaqBrowser({ faqs, categories: FAQ_CATEGORIES }: { faqs: Faq[]; categories: { key: FaqCategory; label: string }[] }) {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [current, setCurrent] = useState<FaqCategory>(FAQ_CATEGORIES[0]!.key);
  const input = useRef<HTMLInputElement>(null);

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

  // the category being read is highlighted in the category list
  useEffect(() => {
    const sections = FAQ_CATEGORIES.map((c) => document.getElementById(`cat-${c.key}`)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setCurrent(top.target.id.slice(4) as FaqCategory);
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [q, FAQ_CATEGORIES]);

  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = useMemo(() => {
    const index = new Map(faqs.map((f) => [f.id, `${f.q} ${f.a.map(plain).join(' ')}`.toLowerCase()]));
    return (f: Faq) => terms.every((t) => index.get(f.id)!.includes(t));
  }, [faqs, terms.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = faqs.filter(match);
  const clear = () => {
    setQ('');
    input.current?.focus();
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
      <nav aria-label="FAQ categories" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <p className="mb-2 hidden text-xs font-semibold uppercase tracking-[0.16em] text-muted lg:block">Categories</p>
        <ul className="-mx-5 flex gap-2 relative overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0">
          {FAQ_CATEGORIES.map((c) => {
            const n = shown.filter((f) => f.category === c.key).length;
            return (
              <li key={c.key} className="shrink-0">
                <a
                  href={`#cat-${c.key}`}
                  aria-current={current === c.key ? 'true' : undefined}
                  className={`flex min-h-10 items-center justify-between gap-3 whitespace-nowrap rounded-full border px-3.5 text-sm transition lg:rounded-lg lg:border-transparent lg:px-3 ${current === c.key ? 'border-primary/50 bg-primary/10 font-semibold text-text' : 'border-border text-muted hover:bg-elevated hover:text-text'} ${terms.length && !n ? 'opacity-50' : ''}`}
                >
                  {c.label}
                  <span className="text-xs tabular-nums text-muted">{n}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0">
        <label className="relative block">
          <span className="sr-only">Search the questions</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && q) {
                e.preventDefault();
                setQ('');
              }
            }}
            placeholder="Search the questions, for example OBS or offline"
            className="min-h-13 w-full rounded-xl border border-border bg-panel py-3 pl-12 pr-12 text-base text-text shadow-card placeholder:text-muted/80 transition hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 [&::-webkit-search-cancel-button]:hidden"
          />
          {q ? (
            <button type="button" onClick={clear} aria-label="Clear the search" className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-text">
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </label>
        <p className="mt-2.5 text-sm text-muted" aria-live="polite">{terms.length ? `${shown.length} of ${faqs.length} questions match` : `${faqs.length} questions`}</p>
        {terms.length && !shown.length ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border-strong/60 p-6 text-center">
            <p className="font-semibold text-text">No question matches “{q.trim()}”</p>
            <p className="mt-2 text-sm text-muted">Try a shorter or different word, search the <Link href="/docs" className="font-medium text-primary hover:underline">documentation</Link>, or <Link href="/contact" className="font-medium text-primary hover:underline">ask us</Link>.</p>
            <button type="button" onClick={clear} className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border-strong/70 px-4 text-sm font-semibold text-text hover:border-primary hover:text-primary">
              <X className="size-4" aria-hidden /> Clear the search
            </button>
          </div>
        ) : null}
        {FAQ_CATEGORIES.map((c) => {
          const list = shown.filter((f) => f.category === c.key);
          if (!list.length) return null;
          return (
            <section key={c.key} id={`cat-${c.key}`} aria-labelledby={`h-${c.key}`} className="mt-10 scroll-mt-24 first-of-type:mt-8">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 id={`h-${c.key}`} className="font-brand text-xl font-semibold text-text sm:text-2xl">{c.label}</h2>
                <Link href={GUIDES[c.key].href} className="group inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary hover:underline">
                  {GUIDES[c.key].label} <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </div>
              <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-panel shadow-card">
                {list.map((f) => (
                  <details
                    key={f.id}
                    id={f.id}
                    open={openId === f.id || terms.length > 0}
                    onToggle={(e) => {
                      if ((e.currentTarget as HTMLDetailsElement).open) setOpenId(f.id);
                    }}
                    className="group scroll-mt-24 px-5 sm:px-6"
                  >
                    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[15px] font-semibold text-text marker:hidden sm:text-base [&::-webkit-details-marker]:hidden">
                      <span>{f.q}</span>
                      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border border-border text-lg leading-none text-primary transition group-open:rotate-45">+</span>
                    </summary>
                    <div className="max-w-[70ch] space-y-3 pb-5 text-[15px] leading-relaxed text-muted">
                      {f.a.map((p, i) => <p key={i}><Rich text={p} /></p>)}
                      <p className="pt-1"><CopyLink id={f.id} /></p>
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
