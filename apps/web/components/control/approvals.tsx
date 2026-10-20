'use client';
// Cues parked by an approval-mode playlist: the producer sends each one now or skips it.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { findTemplate, type TemplateDef } from '@bs/graphics';
import { Button, StatusPill } from '@bs/ui';
import { post } from '@/lib/api';
import { useGet } from '@/lib/hooks';
import { layerLabel } from '@/lib/labels';
import { useRealtime } from '@/lib/realtime';

export interface AwaitingCue { cueId: string; playlistId: string; action: string; templateKey: string | null; placement: string | null; variables: Record<string, unknown>; durationMs: number | null; queuedAt: string }

/** The cues waiting for a decision on one output; refreshed by automation events and a slow poll. */
export function useAwaiting(overlayId: string | null) {
  const qc = useQueryClient();
  const q = useGet<AwaitingCue[]>(['awaiting', overlayId], overlayId ? `overlays/${overlayId}/awaiting` : null, { refetchInterval: 4000 });
  useRealtime('overlay', overlayId, (e) => {
    if (e.topic.startsWith('automation.') || e.topic === 'overlay.command.accepted') void qc.invalidateQueries({ queryKey: ['awaiting', overlayId] });
  });
  return q;
}

export function ApprovalsPanel({ overlayId, canOperate, custom, describe }: { overlayId: string; canOperate: boolean; custom: TemplateDef[]; describe: (key: string, value: unknown) => string | null }) {
  const qc = useQueryClient();
  const q = useAwaiting(overlayId);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (cueId: string, decision: 'approve' | 'skip') => {
    setBusy(cueId);
    setErr(null);
    try {
      await post(`overlays/${overlayId}/cues/${cueId}/${decision}`);
      await qc.invalidateQueries({ queryKey: ['awaiting', overlayId] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (!q.data?.length) return null;
  return (
    <section aria-label="Waiting for approval" className="rounded-[var(--radius-card)] border border-warning/60 bg-warning/10 p-3">
      <h3 className="mb-2 text-sm font-medium text-warning">Waiting for your go-ahead ({q.data.length})</h3>
      <ul className="space-y-2">
        {q.data.map((c) => {
          const t = c.templateKey ? findTemplate(c.templateKey, custom) : null;
          const details = Object.entries(c.variables).map(([k, v]) => describe(k, v)).filter(Boolean).join(' · ');
          const age = Math.max(0, Math.round((Date.now() - new Date(c.queuedAt).getTime()) / 1000));
          return (
            <li key={c.cueId} className="flex flex-wrap items-center gap-2 rounded-md bg-panel px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t?.name ?? c.action.replace(/_/g, ' ')}</span>
                {t ? <span className="text-xs text-muted"> · {layerLabel(t.layer)}</span> : null}
                {details ? <span className="block truncate text-xs text-muted">{details}</span> : null}
              </span>
              <StatusPill tone="warning">{age < 60 ? `${age} s` : `${Math.floor(age / 60)} min`} waiting</StatusPill>
              <Button size="sm" variant="live" disabled={!canOperate || busy === c.cueId} onClick={() => decide(c.cueId, 'approve')}>Send now</Button>
              <Button size="sm" variant="ghost" disabled={!canOperate || busy === c.cueId} onClick={() => decide(c.cueId, 'skip')}>Skip</Button>
            </li>
          );
        })}
      </ul>
      {err ? <p role="alert" className="mt-2 text-xs text-live">{err}</p> : null}
    </section>
  );
}
