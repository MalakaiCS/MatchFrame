'use client';
// Public site header: logo, grouped menus (Product, Sports, Resources), Pricing, Contact, Log in and Get started.
// Desktop menus open on click or keyboard and close on Escape or an outside click; the mobile menu lists the same
// destinations.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { MatchFrameLogo } from './brand';
import { NAV, isGroup } from './nav';

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(null);
    setMobile(false);
  }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null);
        setMobile(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (bar.current && !bar.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-brand-navy/85 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded focus:bg-brand-cyan focus:px-3 focus:py-2 focus:text-brand-navy">
        Skip to content
      </a>
      <div ref={bar} className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="MatchFrame home" className="shrink-0">
          <MatchFrameLogo size={24} />
        </Link>
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((item) =>
            isGroup(item) ? (
              <div key={item.label} className="relative">
                <button
                  type="button"
                  aria-expanded={open === item.label}
                  aria-controls={`menu-${item.label}`}
                  onClick={() => setOpen(open === item.label ? null : item.label)}
                  className={`inline-flex min-h-10 items-center gap-1 rounded-md px-3 text-sm transition hover:text-white ${item.links.some((l) => active(l.href)) ? 'text-white' : 'text-muted'}`}
                >
                  {item.label}
                  <ChevronDown className={`size-4 transition ${open === item.label ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                {open === item.label ? (
                  <div id={`menu-${item.label}`} className="absolute left-0 top-full mt-2 w-80 rounded-xl border border-white/10 bg-panel p-2 shadow-2xl">
                    {item.links.map((l) => (
                      <Link key={l.href} href={l.href} className="block rounded-lg px-3 py-2.5 hover:bg-white/5 focus-visible:bg-white/5">
                        <span className={`block text-sm font-medium ${active(l.href) ? 'text-brand-cyan' : 'text-white'}`}>{l.label}</span>
                        {l.note ? <span className="mt-0.5 block text-xs text-muted">{l.note}</span> : null}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} className={`inline-flex min-h-10 items-center rounded-md px-3 text-sm transition hover:text-white ${active(item.href) ? 'text-white' : 'text-muted'}`}>
                {item.label}
              </Link>
            ),
          )}
        </nav>
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <Link href="/login" className="inline-flex min-h-10 items-center rounded-md px-3 text-sm text-muted hover:text-white">
            Log in
          </Link>
          <Link href="/register" className="inline-flex min-h-10 items-center rounded-lg bg-brand-cyan px-4 text-sm font-semibold text-brand-navy hover:bg-white">
            Get started
          </Link>
        </div>
        <button type="button" className="ml-auto inline-flex size-11 items-center justify-center rounded-md text-white lg:hidden" aria-expanded={mobile} aria-controls="mobile-menu" aria-label={mobile ? 'Close menu' : 'Open menu'} onClick={() => setMobile(!mobile)}>
          {mobile ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
        </button>
      </div>
      {mobile ? (
        <nav id="mobile-menu" aria-label="Main (mobile)" className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-white/5 bg-brand-navy px-4 pb-6 lg:hidden">
          {NAV.map((item) =>
            isGroup(item) ? (
              <div key={item.label} className="border-b border-white/5 py-3">
                <p className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted">{item.label}</p>
                <ul className="mt-1">
                  {item.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="flex min-h-11 items-center px-1 text-base text-white">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Link key={item.href} href={item.href} className="flex min-h-12 items-center border-b border-white/5 px-1 text-base text-white">
                {item.label}
              </Link>
            ),
          )}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Link href="/login" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/20 text-sm text-white">
              Log in
            </Link>
            <Link href="/register" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-cyan text-sm font-semibold text-brand-navy">
              Get started
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
