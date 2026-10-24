'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { StatusPill, Table, cx, type Tone } from '@bs/ui';
import { fmtDate } from '@/lib/hooks';

export interface MatchRow {
  id: string;
  scheduledAt: string;
  timezone: string;
  round: string | null;
  status: string;
  phase: string;
  isDemo: boolean;
  competition: { id: string; name: string; shortName: string | null };
  venue: { name: string } | null;
  home: { name: string; shortName?: string; abbreviation: string; primaryColor: string; logoAssetId?: string | null } | null;
  away: { name: string; shortName?: string; abbreviation: string; primaryColor: string; logoAssetId?: string | null } | null;
  score: { home: number; away: number };
  scorer: { name: string | null } | null;
  stateUpdatedAt?: string;
  overlays: { id: string; name: string; kind: string; mode?: string; inhibited?: boolean; revision?: number; displayedRevision?: number }[];
  outputs: { id: string; name: string; mode: string }[];
  stream: { id: string; state: string; error: unknown } | null;
  /** the match-day checklist in short (lists only) */
  ready?: { done: number; total: number; todo: string[] };
}

export const phaseTone = (status: string): Tone => (status === 'live' ? 'live' : status === 'completed' ? 'neutral' : ['postponed', 'cancelled', 'abandoned'].includes(status) ? 'warning' : 'primary');
export const streamTone = (s?: string): Tone => (!s ? 'offline' : s === 'LIVE' ? 'healthy' : ['FAILED', 'DEGRADED'].includes(s) ? 'live' : ['STARTING', 'WAITING_FOR_INPUT', 'STOPPING'].includes(s) ? 'warning' : 'neutral');

function Team({ t }: { t: MatchRow['home'] }) {
  if (!t) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ background: t.primaryColor }} aria-hidden />
      <span className="max-w-40 truncate" title={t.name}>{t.name}</span>
    </span>
  );
}

/** What a row says about the match: live → phase and scorer; not started → how ready it is; otherwise its result. */
function Status({ m }: { m: MatchRow }) {
  if (m.status === 'live') {
    return (
      <span className="flex flex-col items-start gap-0.5">
        <StatusPill tone="live">{m.phase.replace(/_/g, ' ')}</StatusPill>
        <span className={cx('text-xs', m.scorer?.name ? 'text-muted' : 'text-warning')}>{m.scorer?.name ? `Scoring: ${m.scorer.name}` : 'No scorer connected'}</span>
      </span>
    );
  }
  if (m.status === 'scheduled' && m.ready) {
    const { done, total, todo } = m.ready;
    return done === total ? <StatusPill tone="healthy">Ready</StatusPill> : (
      <span className="flex flex-col items-start gap-0.5" title={`Still to do: ${todo.join(', ')}`}>
        <StatusPill tone="primary">{done} of {total} ready</StatusPill>
        <span className="text-xs text-muted">Needs {todo.join(', ')}</span>
      </span>
    );
  }
  return <StatusPill tone={phaseTone(m.status)}>{m.status === 'completed' ? 'full time' : m.status}</StatusPill>;
}

export function MatchTable({ rows, tz, view = 'table', sort, onSort }: { rows: MatchRow[]; tz: string; view?: 'table' | 'cards'; sort?: 'scheduledAt' | '-scheduledAt'; onSort?: () => void }) {
  const router = useRouter();
  if (!rows.length) return <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">No matches.</p>;

  if (view === 'cards')
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((m) => (
          <Link key={m.id} href={`/app/matches/${m.id}`} className="rounded-[var(--radius-card)] border border-border bg-panel p-3 hover:border-primary">
            <div className="flex justify-between text-xs text-muted"><span>{fmtDate(m.scheduledAt, tz)}</span><StatusPill tone={phaseTone(m.status)}>{m.status === 'live' ? `LIVE · ${m.phase.replace(/_/g, ' ')}` : m.status === 'completed' ? 'full time' : m.status}</StatusPill></div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-1 text-sm"><Team t={m.home} /><span className="tabular font-semibold">{m.status === 'scheduled' ? '' : m.score.home}</span><Team t={m.away} /><span className="tabular font-semibold">{m.status === 'scheduled' ? '' : m.score.away}</span></div>
            <div className="mt-2 text-xs text-muted">{m.competition.shortName ?? m.competition.name}{m.round ? ` · ${m.round}` : ''}{m.venue ? ` · ${m.venue.name}` : ''}</div>
          </Link>
        ))}
      </div>
    );

  const Arrow = sort === 'scheduledAt' ? ArrowUp : ArrowDown;
  return (
    <Table>
      <thead>
        <tr>
          <th aria-sort={onSort ? (sort === 'scheduledAt' ? 'ascending' : 'descending') : undefined}>
            {onSort ? <button type="button" onClick={onSort} className="inline-flex items-center gap-1 hover:text-text" title={sort === 'scheduledAt' ? 'Oldest first. Click for newest first.' : 'Newest first. Click for oldest first.'}>Kick-off <Arrow className="size-3.5" aria-hidden /><span className="sr-only">{sort === 'scheduledAt' ? '(oldest first)' : '(newest first)'}</span></button> : 'Kick-off'}
          </th>
          <th>Match</th><th className="max-md:hidden">Competition</th><th className="text-right">Score</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          // the whole row opens the match; the link in it is what keyboards and screen readers use
          <tr key={m.id} className="cursor-pointer hover:bg-elevated/40" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) router.push(`/app/matches/${m.id}`); }}>
            <td className="whitespace-nowrap tabular">{fmtDate(m.scheduledAt, tz)}</td>
            <td>
              <Link href={`/app/matches/${m.id}`} className="flex flex-col hover:text-primary"><Team t={m.home} /><Team t={m.away} /></Link>
              <span className="text-xs text-muted md:hidden">{m.competition.shortName ?? m.competition.name}{m.round ? ` · ${m.round}` : ''}</span>
            </td>
            <td className="text-muted max-md:hidden">{m.competition.shortName ?? m.competition.name}{m.round ? <span className="block text-xs">{/^\d+$/.test(m.round) ? `Round ${m.round}` : m.round}</span> : null}{m.venue ? <span className="block text-xs">{m.venue.name}</span> : null}</td>
            <td className="text-right tabular font-semibold">{m.status === 'scheduled' ? '' : `${m.score.home}–${m.score.away}`}</td>
            <td><span className="flex flex-wrap items-start gap-1"><Status m={m} />{m.isDemo ? <StatusPill tone="warning">demo</StatusPill> : null}</span></td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
