'use client';
// Public status page: what the installation's own status endpoint reports, in plain words.
import { useQuery } from '@tanstack/react-query';
import { Card, Spinner, StatusPill, type Tone } from '@bs/ui';
import { get } from '@/lib/api';

interface Status { status: 'ok' | 'degraded'; checks: Record<string, string>; liveMatches: number | null; connectedRenderers: number | null; generatedAt: string }
const NAMES: Record<string, string> = { database: 'Database', redis: 'Realtime cache', storage: 'Media storage', mail: 'Email', streaming: 'Streaming', worker: 'Background worker' };
const WORDS: Record<string, { tone: Tone; text: string }> = {
  ok: { tone: 'healthy', text: 'Working' },
  configured: { tone: 'healthy', text: 'Configured' },
  enabled: { tone: 'healthy', text: 'Enabled' },
  graphics_only: { tone: 'neutral', text: 'Graphics only (no streaming)' },
  not_configured: { tone: 'neutral', text: 'Not set up' },
  no_lease: { tone: 'warning', text: 'No worker running' },
  unavailable: { tone: 'live', text: 'Unavailable' },
  unknown: { tone: 'warning', text: 'Unknown' },
};

export default function StatusPage() {
  const q = useQuery<Status>({ queryKey: ['status'], queryFn: () => get<Status>('status'), refetchInterval: 15_000, retry: 1 });
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-xl font-semibold">System status</h1>
      <p className="mb-4 text-sm text-muted">Refreshes every 15 seconds. Metrics for monitoring tools are at /metrics.</p>
      {q.isLoading ? <Spinner /> : q.error || !q.data ? (
        <Card className="border-live/60 p-4"><StatusPill tone="live">Unreachable</StatusPill><p className="mt-2 text-sm text-muted">The service did not answer. If this persists, the installation is down.</p></Card>
      ) : (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2"><StatusPill tone={q.data.status === 'ok' ? 'healthy' : 'warning'}>{q.data.status === 'ok' ? 'All systems working' : 'Degraded'}</StatusPill><span className="text-xs text-muted">as of {new Date(q.data.generatedAt).toLocaleTimeString('en-AU')}</span></div>
          <ul className="divide-y divide-border text-sm">
            {Object.entries(q.data.checks).map(([k, v]) => {
              const w = WORDS[v] ?? { tone: 'neutral' as Tone, text: v };
              return <li key={k} className="flex items-center justify-between py-2"><span>{NAMES[k] ?? k}</span><StatusPill tone={w.tone}>{w.text}</StatusPill></li>;
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">{q.data.liveMatches ?? 0} live match{(q.data.liveMatches ?? 0) === 1 ? '' : 'es'} · {q.data.connectedRenderers ?? 0} connected graphics output{(q.data.connectedRenderers ?? 0) === 1 ? '' : 's'}</p>
        </Card>
      )}
    </main>
  );
}
