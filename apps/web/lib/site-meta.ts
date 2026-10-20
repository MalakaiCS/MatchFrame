// Metadata for public-site pages. Search engines index them only when SITE_INDEXING=true is set for the
// deployment (a deliberate launch choice); account, app and output pages stay out of the index regardless.
import type { Metadata } from 'next';

export const siteIndexing = () => process.env.SITE_INDEXING === 'true';

/** The site's public address: PUBLIC_WEB_URL, else the hosting platform's generated domain (as the server does). */
export function publicBase() {
  const platform = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : process.env.RENDER_EXTERNAL_URL;
  return (process.env.PUBLIC_WEB_URL || platform || 'http://localhost:3000').replace(/\/$/, '');
}

export function siteMetadata({ title, description, path }: { title?: string; description: string; path: string }): Metadata {
  return {
    title: title ? { absolute: `${title} · MatchFrame` } : { absolute: 'MatchFrame · Every game. Broadcast ready.' },
    description,
    alternates: { canonical: path },
    robots: siteIndexing() ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: 'website', siteName: 'MatchFrame', title: title ?? 'MatchFrame', description, url: path, locale: 'en_AU' },
    twitter: { card: 'summary_large_image', title: title ?? 'MatchFrame', description },
  };
}
