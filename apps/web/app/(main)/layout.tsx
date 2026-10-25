import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/oswald';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/archivo';
import '@fontsource-variable/jost';
import '@fontsource-variable/saira';
import '@fontsource-variable/saira/wght-italic.css';
import '@fontsource-variable/exo-2';
import '@fontsource-variable/exo-2/wght-italic.css';
import '@fontsource-variable/outfit';
import '@fontsource-variable/red-hat-display';
import '../globals.css';
import { Providers } from '@/lib/providers';
import { publicBase } from '@/lib/site-meta';
import { THEME_SCRIPT } from '@/lib/theme';

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'MatchFrame';

// Account and app pages are never indexed; the public site's pages opt in through siteMetadata() (SITE_INDEXING).
export const metadata: Metadata = {
  metadataBase: new URL(publicBase()),
  title: { default: product, template: `%s · ${product}` },
  description: 'Live scoring, broadcast graphics, automation and sponsor placements in one matchday workflow.',
  robots: { index: false },
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0B1220' },
    { media: '(prefers-color-scheme: light)', color: '#F4F7FB' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the inline script before first paint, so the server markup cannot know it
    <html lang="en-AU" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
