// Public pages only. Account, app, scorer and graphics-output pages are never listed.
import type { MetadataRoute } from 'next';
import { DOCS } from '@/content/docs';
import { publicBase } from '@/lib/site-meta';

// every indexable public page; sign-in, sign-up and the status page (never indexed) are left out
const PAGES = ['/', '/features', '/how-it-works', '/showcase', '/sports', '/sports/football', '/sports/basketball', '/sports/futsal', '/pricing', '/faq', '/docs', '/contact'];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicBase();
  const now = new Date();
  return [...PAGES, ...DOCS.map((d) => `/docs/${d.slug}`)].map((p) => ({ url: `${base}${p}`, lastModified: now, changeFrequency: 'monthly', priority: p === '/' ? 1 : p.startsWith('/docs/') ? 0.5 : 0.7 }));
}
