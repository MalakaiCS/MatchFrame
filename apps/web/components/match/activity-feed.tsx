'use client';
// One timeline for a match: scorer facts, control-room commands, graphics on and off air, setup changes.
import { useQueryClient } from '@tanstack/react-query';
import { ErrorNotice, Spinner, StatusPill, cx, type Tone } from '@bs/ui';
import { fmtDate, useGet } from '@/lib/hooks';
import { useRealtime } from '@/lib/realtime';

export interface ActivityLine { at: string; who: string | null; text: string; kind: 'fact' | 'control' | 'graphics' | 'setup' }
const TONE: Record<ActivityLine['kind'], Tone> = { fact: 'primary', control: 'warning', graphics: 'live', setup: 'neutral' };
const LABEL: Record<ActivityLine['kind'], string> = { fact: 'scoring', control: 'desk', graphics: 'on air', setup: 'setup' };

export function ActivityFeed({ matchId, tz, compact = false }: { matchId: string; tz: string; compact?: boolean }) {
  const qc = useQueryClient();
  const q = useGet<ActivityLine[]>(['activity', matchId], `matches/${matchId}/activity`, { refetchInterval: compact ? 5000 : 10_000 });
  useRealtime('match', matchId, (e) => {
    if (e.topic.startsWith('match.')) void qc.invalidateQueries({ queryKey: ['activity', matchId] });
  });
  if (q.isLoading) return <Spinner />;
  return (
    <div>
      <ErrorNotice error={q.error} />
      <ol className={cx('space-y-1 text-sm', compact && 'max-h-64 overflow-y-auto')} aria-label="Activity">
        {(q.data ?? []).map((l, i) => (
          <li key={`${l.at}-${i}`} className="flex items-start gap-2 rounded px-1 py-0.5">
            <span className="w-20 shrink-0 text-xs text-muted tabular">{fmtDate(l.at, tz, { timeStyle: 'medium' })}</span>
            <StatusPill tone={TONE[l.kind]}>{LABEL[l.kind]}</StatusPill>
            <span className="min-w-0 flex-1">{l.text}{l.who ? <span className="text-xs text-muted"> · {l.who}</span> : null}</span>
          </li>
        ))}
        {q.data && !q.data.length ? <li className="text-xs text-muted">Nothing has happened on this match yet.</li> : null}
      </ol>
    </div>
  );
}
