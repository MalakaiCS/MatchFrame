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
import './render.css';

export const metadata: Metadata = { title: 'Output', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Isolated root for overlay / programme / embed renderers: transparent, no app shell, no scrollbars.
export default function RenderRoot({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
