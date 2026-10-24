import type { Metadata, Viewport } from 'next';
import { ScorerShell } from '@/components/scorer/scorer-shell';

export const metadata: Metadata = { title: 'Scoring', manifest: '/score.webmanifest' };
export const viewport: Viewport = { themeColor: '#0B1220', width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

export default function ScoreLayout({ children }: { children: React.ReactNode }) {
  return <ScorerShell>{children}</ScorerShell>;
}
