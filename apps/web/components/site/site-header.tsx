'use client';
// Public site header: logo, grouped menus (Product, Sports, Resources), Pricing, Contact, the light/dark switch,
// Log in and Get started. Menus open on click, tap or Enter/Space, move with the arrow keys, and close on Escape
// (focus returns to their button), an outside click or when focus leaves them. The mobile menu puts Pricing, the
// live demo, Log in and Get started first.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, PlayCircle, X } from 'lucide-react';
import { ThemeChoices, ThemeToggle } from '@/components/theme-toggle';
import { MatchFrameLogo } from './brand';
import { NAV, isGroup, type NavGroup } from './nav';

function MenuGroup({ item, open, setOpen, active }: { item: NavGroup; open: boolean; setOpen: (v: string | null) => void; active: (href: string) => boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = `menu-${item.label.toLowerCase()}`;
  const links = () => [...(panel.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];
  useEffect(() => {
    if (open) requestAnimationFrame(() => panel.current?.dataset.focusFirst === '1' && links()[0]?.focus());
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(null);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        if (panel.current) panel.current.dataset.focusFirst = '1';
        setOpen(item.label);
        return;
      }
      const l = links();
      const i = l.indexOf(document.activeElement as HTMLAnchorElement);
      l[(i + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length]?.focus();
    }
  };
  return (
    <div
      className="relative"
      onKeyDown={onKey}
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(null);
      }}
    >
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(open ? null : item.label)}
        className={`inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium transition hover:bg-elevated hover:text-text ${item.links.some((l) => active(l.href)) ? 'text-text' : 'text-muted'}`}
      >
        {item.label}
        <ChevronDown className={`size-4 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div ref={panel} id={id} hidden={!open} className="absolute left-0 top-full z-50 mt-2 w-[22rem] rounded-2xl border border-border bg-panel p-2 shadow-pop">
        {item.links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={active(l.href) ? 'page' : undefined} className="flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none hover:bg-elevated focus-visible:bg-elevated focus-visible:ring-2 focus-visible:ring-primary">
            {l.icon ? <l.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /> : null}
            <span>
              <span className={`block text-sm font-semibold ${active(l.href) ? 'text-primary' : 'text-text'}`}>{l.label}</span>
              {l.note ? <span className="mt-0.5 block text-xs leading-snug text-muted">{l.note}</span> : null}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(null);
    setMobile(false);
  }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !mobile) return;
      setMobile(false);
      toggle.current?.focus();
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
  }, [mobile]);
  // the open mobile menu covers the page: keep the page behind it from scrolling
  useEffect(() => {
    document.documentElement.style.overflow = mobile ? 'hidden' : '';
    return () => void (document.documentElement.style.overflow = '');
  }, [mobile]);

  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-on-primary">
        Skip to content
      </a>
      <div ref={bar} className="mx-auto flex h-16 w-full max-w-[1248px] items-center gap-2 px-5 sm:px-8 lg:px-12">
        <Link href="/" aria-label="MatchFrame home" className="mr-4 shrink-0 rounded-lg">
          <MatchFrameLogo size={24} />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
          {NAV.map((item) =>
            isGroup(item) ? (
              <MenuGroup key={item.label} item={item} open={open === item.label} setOpen={setOpen} active={active} />
            ) : (
              <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium transition hover:bg-elevated hover:text-text ${active(item.href) ? 'text-text' : 'text-muted'}`}>
                {item.label}
              </Link>
            ),
          )}
        </nav>
        <div className="ml-auto hidden items-center gap-1.5 lg:flex">
          <ThemeToggle />
          <Link href="/login" className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-muted hover:bg-elevated hover:text-text">
            Log in
          </Link>
          <Link href="/register" className="inline-flex min-h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary shadow-sm hover:bg-primary-strong">
            Get started
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-1 lg:hidden">
          <ThemeToggle />
          <button ref={toggle} type="button" className="inline-flex size-11 items-center justify-center rounded-lg text-text hover:bg-elevated" aria-expanded={mobile} aria-controls="mobile-menu" aria-label={mobile ? 'Close menu' : 'Open menu'} onClick={() => setMobile(!mobile)}>
            {mobile ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
          </button>
        </div>
      </div>
      {mobile ? (
        <nav id="mobile-menu" aria-label="Main (mobile)" className="h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t border-border bg-bg px-5 pb-10 pt-4 sm:px-8 lg:hidden">
          <div className="grid grid-cols-2 gap-3">
            <Link href="/register" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-on-primary">
              Get started
            </Link>
            <Link href="/login" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border-strong/70 text-sm font-semibold text-text">
              Log in
            </Link>
            <Link href="/showcase" className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-panel text-sm font-semibold text-text">
              <PlayCircle className="size-4 text-primary" aria-hidden /> Try the live demo
            </Link>
          </div>
          <Link href="/pricing" className="mt-4 flex min-h-12 items-center border-b border-border px-1 text-base font-semibold text-text">
            Pricing
          </Link>
          {NAV.filter((item) => isGroup(item) || item.href !== '/pricing').map((item) =>
            isGroup(item) ? (
              <div key={item.label} className="border-b border-border py-3">
                <p className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted">{item.label}</p>
                <ul className="mt-1">
                  {item.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} aria-current={active(l.href) ? 'page' : undefined} className="flex min-h-11 items-center px-1 text-base text-text">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} className="flex min-h-12 items-center border-b border-border px-1 text-base font-semibold text-text">
                {item.label}
              </Link>
            ),
          )}
          <div className="mt-6 flex items-center justify-between gap-3">
            <span className="text-sm text-muted">Appearance</span>
            <ThemeChoices />
          </div>
        </nav>
      ) : null}
    </header>
  );
}
