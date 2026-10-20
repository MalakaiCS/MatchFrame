'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { MatchFrameMark } from './site/brand';

interface Branding { productName: string; logoUrl: string | null }

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  // white-label: the host decides the name and logo shown before sign-in
  const brand = useQuery({ queryKey: ['public-branding'], queryFn: () => get<Branding>('public/branding'), staleTime: 600_000, retry: 0 });
  const name = brand.data?.productName ?? process.env.NEXT_PUBLIC_PRODUCT_NAME;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center gap-2 font-semibold">
          {brand.data?.logoUrl ? <img src={brand.data.logoUrl} alt="" className="size-7 rounded object-contain" /> : <MatchFrameMark size={28} />}
          {name}
        </Link>
        <div className="rounded-[var(--radius-card)] border border-border bg-panel p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
        {footer ? <div className="mt-4 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </main>
  );
}
