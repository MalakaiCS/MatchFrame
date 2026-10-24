import Link from 'next/link';
import { ThemeChoices } from '@/components/theme-toggle';
import { BRAND, MatchFrameLogo } from './brand';
import { FOOTER } from './nav';

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-panel/50">
      <div className="mx-auto grid grid-cols-1 w-full max-w-[1248px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.5fr_repeat(4,1fr)] lg:px-12">
        <div>
          <Link href="/" aria-label="MatchFrame home" className="inline-block rounded-lg">
            <MatchFrameLogo size={22} />
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            {BRAND.tagline} Live scoring, broadcast graphics, automation and sponsor placements for clubs, competitions and small production crews.
          </p>
        </div>
        {FOOTER.map((g) => (
          <nav key={g.label} aria-label={g.label}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{g.label}</p>
            <ul className="mt-3 space-y-1">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-text/85 hover:text-primary">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1248px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-12">
          <p className="text-xs text-muted">© {new Date().getFullYear()} MatchFrame. Teams, players and sponsors shown on this site are fictional samples.</p>
          <ThemeChoices />
        </div>
      </div>
    </footer>
  );
}
