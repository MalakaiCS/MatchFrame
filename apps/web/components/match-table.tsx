'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { Button, StatusPill, Table, type Tone } from '@bs/ui';
import { fmtDate } from '@/lib/hooks';
import { get } from '@/lib/api';

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

export function MatchTable({ rows, tz, view = 'table' }: { rows: MatchRow[]; tz: string; view?: 'table' | 'cards' }) {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  if (!rows.length) return <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">No matches.</p>;

  if (view === 'cards')
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((m) => (
          <Link key={m.id} href={`/app/matches/${m.id}`} className="rounded-[var(--radius-card)] border border-border bg-panel p-3 hover:border-primary">
            <div className="flex justify-between text-xs text-muted"><span>{fmtDate(m.scheduledAt, tz)}</span><StatusPill tone={phaseTone(m.status)}>{m.status === 'live' ? `LIVE · ${m.phase.replace(/_/g, ' ')}` : m.status}</StatusPill></div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-1 text-sm"><Team t={m.home} /><span className="tabular font-semibold">{m.score.home}</span><Team t={m.away} /><span className="tabular font-semibold">{m.score.away}</span></div>
            <div className="mt-2 text-xs text-muted">{m.competition.shortName ?? m.competition.name}{m.round ? ` · ${m.round}` : ''}{m.venue ? ` · ${m.venue.name}` : ''}</div>
          </Link>
        ))}
      </div>
    );

  const copyUrl = async (overlayId: string) => {
    try {
      const r = await get<{ production: string }>(`overlays/${overlayId}/urls`);
      await navigator.clipboard.writeText(r.production);
      setCopied(overlayId);
    } catch {
      setCopied(`err:${overlayId}`);
    }
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Table>
      <thead>
        <tr>
          <th className="w-8"><span className="sr-only">Expand</span></th>
          <th>Kick-off</th><th>Competition</th><th>Match</th><th className="text-right">Score</th><th>Phase</th><th>Scorer</th><th>Programme</th><th>Graphics</th><th><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <Fragment key={m.id}>
            <tr className="hover:bg-elevated/40">
              <td><button aria-expanded={open === m.id} aria-label="Show graphics outputs and streams" onClick={() => setOpen(open === m.id ? null : m.id)} className="text-muted hover:text-text">{open === m.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button></td>
              <td className="whitespace-nowrap tabular">{fmtDate(m.scheduledAt, tz)}</td>
              <td className="text-muted">{m.competition.shortName ?? m.competition.name}{m.round ? <span className="block text-xs">{m.round}</span> : null}</td>
              <td><Link href={`/app/matches/${m.id}`} className="flex flex-col hover:text-primary"><Team t={m.home} /><Team t={m.away} /></Link>{m.venue ? <span className="text-xs text-muted">{m.venue.name}</span> : null}</td>
              <td className="text-right tabular font-semibold">{m.status === 'scheduled' ? '—' : `${m.score.home}–${m.score.away}`}</td>
              <td><StatusPill tone={phaseTone(m.status)}>{m.status === 'live' ? m.phase.replace(/_/g, ' ') : m.status}</StatusPill>{m.isDemo ? <StatusPill className="ml-1" tone="warning">demo</StatusPill> : null}</td>
              <td className="text-muted">{m.scorer?.name ?? 'Nobody scoring'}</td>
              <td>{m.stream ? <StatusPill tone={streamTone(m.stream.state)}>{m.stream.state.replace(/_/g, ' ').toLowerCase()}</StatusPill> : <span className="text-xs text-muted">Not configured</span>}</td>
              <td>{m.overlays.length ? m.overlays.map((o) => <StatusPill key={o.id} className="mr-1" tone={o.inhibited ? 'live' : o.mode === 'manual' ? 'warning' : 'primary'}>{o.inhibited ? 'cleared' : o.mode ?? 'auto'}</StatusPill>) : <span className="text-xs text-muted">No OBS link</span>}</td>
              <td className="whitespace-nowrap text-right"><Button asChild size="sm" variant="ghost"><Link href={`/app/matches/${m.id}`}>Open</Link></Button></td>
            </tr>
            {open === m.id ? (
              <tr>
                <td />
                <td colSpan={9} className="bg-bg/60">
                  <div className="grid grid-cols-1 gap-3 py-2 md:grid-cols-2">
                    <div>
                      <h3 className="mb-1 text-xs font-medium text-muted">Graphics outputs</h3>
                      {m.overlays.length ? m.overlays.map((o) => (
                        <div key={o.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
                          <span className="min-w-32">{o.name}</span>
                          <span className="text-xs text-muted">{(o.displayedRevision ?? 0) >= (o.revision ?? 0) ? 'OBS up to date' : 'OBS catching up'}</span>
                          <Button asChild size="sm" variant="primary"><Link href={`/app/matches/${m.id}/control/${o.id}`}>Control room</Link></Button>
                          <Button asChild size="sm"><Link href={`/app/matches/${m.id}?tab=overlays`}>OBS link</Link></Button>
                          <Button size="sm" variant="ghost" onClick={() => copyUrl(o.id)}><Copy className="size-3.5" />{copied === o.id ? 'Copied' : copied === `err:${o.id}` ? 'Not permitted' : 'Copy OBS link'}</Button>
                        </div>
                      )) : <p className="text-sm text-muted">No OBS link yet. <Link className="text-primary" href={`/app/matches/${m.id}?tab=overlays`}>Create one</Link></p>}
                    </div>
                    <div>
                      <h3 className="mb-1 text-xs font-medium text-muted">Outputs</h3>
                      {m.outputs.length ? m.outputs.map((o) => (
                        <div key={o.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
                          <span className="min-w-32">{o.name}</span><StatusPill tone="neutral">{o.mode}</StatusPill>
                          <Button asChild size="sm"><Link href={`/app/matches/${m.id}?tab=streams`}>Configure</Link></Button>
                          <Button asChild size="sm" variant="ghost"><Link href={`/app/media?matchId=${m.id}`}>Recordings</Link></Button>
                          <Button asChild size="sm" variant="ghost"><Link href={`/app/media?matchId=${m.id}&tab=highlights`}>Highlights</Link></Button>
                        </div>
                      )) : <p className="text-sm text-muted">No outputs. <Link className="text-primary" href={`/app/matches/${m.id}?tab=streams`}>Add one</Link></p>}
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
          </Fragment>
        ))}
      </tbody>
    </Table>
  );
}
