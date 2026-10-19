import Link from 'next/link';

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded bg-primary text-bg">▶</span>
          {process.env.NEXT_PUBLIC_PRODUCT_NAME}
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
