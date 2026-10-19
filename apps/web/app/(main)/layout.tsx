import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '../globals.css';
import { Providers } from '@/lib/providers';

export const metadata: Metadata = {
  title: { default: process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Broadcast Studio', template: `%s · ${process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Broadcast Studio'}` },
  description: 'Sports broadcast graphics, scoring, automation, streaming and highlights.',
  robots: { index: false },
};
export const viewport: Viewport = { themeColor: '#0B1220', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
