'use client';
// "Continue with …" buttons for the sign-in providers configured on this installation, with each provider's own
// sign-in mark as its branding guidelines ask. The provider used last on this device is marked "Last used".
import { Loader2 } from 'lucide-react';
import { cx } from '@bs/ui';

type Provider = 'google' | 'apple' | 'microsoft' | 'facebook';
export const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', apple: 'Apple', microsoft: 'Microsoft', facebook: 'Facebook' };

function Mark({ p }: { p: Provider }) {
  if (p === 'google')
    return (
      <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    );
  if (p === 'apple')
    return (
      <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden>
        <path d="M16.37 12.73c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.65zM14.1 5.98c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.75-.96 2.79 1.02.08 2.05-.52 2.68-1.27z" />
      </svg>
    );
  if (p === 'microsoft')
    return (
      <svg viewBox="0 0 21 21" className="size-[18px]" aria-hidden>
        <path fill="#F25022" d="M1 1h9v9H1z" />
        <path fill="#7FBA00" d="M11 1h9v9h-9z" />
        <path fill="#00A4EF" d="M1 11h9v9H1z" />
        <path fill="#FFB900" d="M11 11h9v9h-9z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M15.12 15.47 15.65 12h-3.33V9.75c0-.95.47-1.88 1.95-1.88h1.51V4.92s-1.37-.23-2.68-.23c-2.74 0-4.53 1.66-4.53 4.66V12H5.53v3.47h3.04V24a12.1 12.1 0 0 0 3.75 0v-8.53h2.8z" />
    </svg>
  );
}

export function SocialButtons({ providers, onSelect, busy, last, verb = 'Continue' }: { providers: Provider[]; onSelect: (p: Provider) => void; busy: Provider | null; last: string | null; verb?: string }) {
  if (!providers.length) return null;
  return (
    <div className={cx('grid gap-2.5', providers.length > 2 && 'sm:grid-cols-2')}>
      {providers.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSelect(p)}
          disabled={!!busy}
          className={cx(
            'relative inline-flex min-h-12 items-center justify-center gap-2.5 rounded-xl border px-4 text-[15px] font-semibold transition disabled:opacity-60',
            p === 'apple' ? 'border-black bg-black text-white hover:bg-black/85 dark:border-white dark:bg-white dark:text-black dark:hover:bg-white/90' : 'border-border-strong/60 bg-panel text-text hover:border-border-strong hover:bg-elevated',
          )}
        >
          {busy === p ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Mark p={p} />}
          {verb} with {PROVIDER_NAME[p]}
          {last === p ? <span className="absolute -top-2 right-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-primary">Last used</span> : null}
        </button>
      ))}
    </div>
  );
}
