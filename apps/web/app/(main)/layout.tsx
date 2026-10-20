import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/oswald';
import '@fontsource-variable/outfit';
import '../globals.css';
import { Providers } from '@/lib/providers';
import { publicBase } from '@/lib/site-meta';

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'MatchFrame';

// Account and app pages are never indexed; the public site's pages opt in through siteMetadata() (SITE_INDEXING).
export const metadata: Metadata = {
  metadataBase: new URL(publicBase()),
  title: { default: product, template: `%s · ${product}` },
  description: 'Live scoring, broadcast graphics, automation and sponsor placements in one matchday workflow.',
  robots: { index: false },
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { themeColor: '#0A1020', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
