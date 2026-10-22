import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/saira/standard.css';
import '@fontsource-variable/saira/standard-italic.css';
import { ScorerShell } from '@/components/scorer/scorer-shell';

export const metadata: Metadata = { title: 'Scoring', manifest: '/score.webmanifest' };
export const viewport: Viewport = { themeColor: '#161A21', width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

export default function ScoreLayout({ children }: { children: React.ReactNode }) {
  return <ScorerShell>{children}</ScorerShell>;
}
