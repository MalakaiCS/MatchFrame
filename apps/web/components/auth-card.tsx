'use client';
// The frame of every sign-in page (log in, create an account, codes, reset, verify, invitations, onboarding): the
// form on a calm surface, and on wide screens a broadcast panel beside it. White-label installations show their own
// name and logo instead of MatchFrame's.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { cx } from '@bs/ui';
import { get } from '@/lib/api';
import { ThemeToggle } from './theme-toggle';
import { MatchFrameMark } from './site/brand';

interface Branding { productName: string; logoUrl: string | null }

export function AuthCard({ title, subtitle, children, footer, wide = false }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  // white-label: the host decides the name and logo shown before sign-in
  const brand = useQuery({ queryKey: ['public-branding'], queryFn: () => get<Branding>('public/branding'), staleTime: 600_000, retry: 0 });
  const name = brand.data?.productName ?? process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'MatchFrame';
  const own = !brand.data?.logoUrl && name === 'MatchFrame';
  return (
    <div className="grid grid-cols-1 min-h-screen bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main id="main" className="flex min-h-screen flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 rounded-lg font-brand text-lg font-extrabold tracking-[-0.02em] text-text">
            {brand.data?.logoUrl ? <img src={brand.data.logoUrl} alt="" className="size-7 rounded object-contain" /> : <MatchFrameMark size={28} />}
            {name}
          </Link>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className={cx('w-full', wide ? 'max-w-xl' : 'max-w-[26rem]')}>
            <h1 className="font-brand text-[28px] font-bold leading-tight tracking-[-0.015em] text-text">{title}</h1>
            {subtitle ? <div className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</div> : null}
            <div className="mt-7">{children}</div>
            {footer ? <div className="mt-8 text-center text-sm text-muted">{footer}</div> : null}
          </div>
        </div>
        <p className="text-center text-xs text-muted">Need a hand? <Link href="/contact" className="font-medium text-primary hover:underline">Contact us</Link> · <Link href="/docs" className="font-medium text-primary hover:underline">Documentation</Link></p>
      </main>
      <aside aria-hidden className="relative hidden overflow-hidden bg-[#05080d] lg:block">
        <div className="absolute inset-0 bg-[url('/site/scene-pitch.svg')] bg-cover bg-center opacity-80" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,8,13,0.2),rgba(5,8,13,0.85))]" />
        {own ? (
          <div className="absolute inset-x-12 bottom-14 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00c8f0]">Every game. Broadcast ready.</p>
            <p className="mt-3 max-w-md font-brand text-4xl font-bold leading-tight">Score from a phone. Graphics on air in your club’s colours.</p>
            <p className="mt-4 max-w-md text-white/75">Live scoring, broadcast graphics, automation and sponsor placements in one matchday workflow.</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
