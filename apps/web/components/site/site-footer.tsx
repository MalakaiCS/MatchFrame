import Link from 'next/link';
import { BRAND, MatchFrameLogo } from './brand';
import { FOOTER } from './nav';

export function SiteFooter() {
  return (
    <footer className="border-t border-white/5 bg-black/20">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <MatchFrameLogo size={22} />
          <p className="mt-3 max-w-xs text-sm text-muted">{BRAND.tagline} Scoring, graphics, automation and sponsors for community and semi-professional sport.</p>
        </div>
        {FOOTER.map((g) => (
          <nav key={g.label} aria-label={g.label}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{g.label}</p>
            <ul className="mt-3 space-y-2">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-white/80 hover:text-brand-cyan">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/5">
        <p className="mx-auto w-full max-w-6xl px-4 py-5 text-xs text-muted sm:px-6">
          © {new Date().getFullYear()} MatchFrame. Sample teams, players and sponsors shown on this site are fictional.
        </p>
      </div>
    </footer>
  );
}
