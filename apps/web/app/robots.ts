// Crawling rules. Until SITE_INDEXING=true is set for the deployment, the whole site asks not to be indexed (each
// public page also says noindex), so a staging address never ends up in search results by accident.
import type { MetadataRoute } from 'next';
import { publicBase, siteIndexing } from '@/lib/site-meta';

const PRIVATE = ['/app', '/score', '/onboarding', '/invite', '/login', '/register', '/reset-password', '/verify-email', '/overlay', '/render', '/embed', '/watch', '/m/', '/api'];

export default function robots(): MetadataRoute.Robots {
  const base = publicBase();
  if (!siteIndexing()) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return { rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE }], sitemap: `${base}/sitemap.xml` };
}
