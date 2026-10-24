'use client';
// Automation queue & history for one output: game-plan assignment, manual playlist triggers and an explained
// decision log (fired, queued, skipped, preempted, cancelled — with reasons).
import { useMemo, useState } from 'react';
import { Button, NativeSelect, StatusPill, type Tone } from '@bs/ui';
import { put, post, uuid, get } from '@/lib/api';
import { useGet } from '@/lib/hooks';
import { useQuery } from '@tanstack/react-query';

interface Run {
  id: string;
  playlistId: string;
  triggerId: string;
  state: string;
  reason: string | null;
  priority: number;
  createdAt: string;
  cues: { id: string; action: string; state: string; reason: string | null; dueAt: string; templateKey: string | null }[];
}
interface PlanSummary {
  id: string;
  name: string;
  sport: string;
  versions: { id: string; version: number }[];
}
interface PlanDetail {
  versions: { id: string; version: number; definition: { playlists: { id: string; name: string; triggers: { type: string }[] }[] } }[];
}

const TONE: Record<string, Tone> = { running: 'live', completed: 'healthy', queued: 'warning', skipped: 'neutral', cancelled: 'offline', preempted: 'warning' };

export function AutomationPanel({ overlayId, gamePlanVersionId, sport, canEdit = true, canOperate = true, onChanged }: { overlayId: string; gamePlanVersionId?: string | null; sport?: string; canEdit?: boolean; canOperate?: boolean; onChanged?: () => void }) {
  const log = useGet<Run[]>(['automation', overlayId], `overlays/${overlayId}/automation`, { refetchInterval: 2000 });
  const plans = useGet<PlanSummary[]>(['game-plans'], 'game-plans');
  const [msg, setMsg] = useState<string | null>(null);
  const current = plans.data?.find((p) => p.versions.some((v) => v.id === gamePlanVersionId));
  const detail = useQuery({ queryKey: ['game-plan', current?.id], queryFn: () => get<PlanDetail>(`game-plans/${current!.id}`), enabled: !!current });
  const playlists = useMemo(() => detail.data?.versions.find((v) => v.id === gamePlanVersionId)?.definition.playlists ?? [], [detail.data, gamePlanVersionId]);
  const manual = useMemo(() => playlists.filter((p) => p.triggers.some((t) => t.type === 'manual')), [playlists]);
  const nameOf = (id: string) => (id === '_default_scorebug' ? 'Default scorebug' : (playlists.find((p) => p.id === id)?.name ?? id));

  const assign = async (versionId: string) => {
    await put(`overlays/${overlayId}/game-plan`, { gamePlanVersionId: versionId || null });
    setMsg(versionId ? 'Automation plan set. It applies from the next scorer action.' : 'Automation is off for this output.');
    onChanged?.();
  };
  const fire = async (playlistId: string) => {
    const r = await post<{ started: string[]; queued: string[]; skipped: { reason: string }[] }>(`overlays/${overlayId}/playlists/${playlistId}/trigger`, { requestId: uuid() });
    setMsg(r.started.length ? 'Playlist started.' : r.queued.length ? 'Queued behind a higher-priority playlist.' : `Not started: ${r.skipped[0]?.reason ?? 'no matching trigger'}`);
    void log.refetch();
  };
  const choices = (plans.data ?? []).filter((p) => !sport || p.sport === sport);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`gp-${overlayId}`} className="text-muted">Automation plan</label>
        <NativeSelect id={`gp-${overlayId}`} value={gamePlanVersionId ?? ''} disabled={!canEdit} onChange={(e) => void assign(e.target.value)} className="w-auto">
          <option value="">Off (everything from this desk)</option>
          {choices.map((p) => p.versions.map((v) => <option key={v.id} value={v.id}>{p.name} · v{v.version}</option>))}
        </NativeSelect>
        {manual.map((p) => <Button key={p.id} size="sm" variant="secondary" disabled={!canOperate} onClick={() => void fire(p.id)}>Run “{p.name}”</Button>)}
        {msg ? <span role="status" className="text-xs text-muted">{msg}</span> : null}
      </div>
      {!gamePlanVersionId ? <p className="text-xs text-muted">Automation is off for this output. Choose a published plan and graphics will follow the scorer's taps.</p> : null}
      <ul className="max-h-64 space-y-1 overflow-auto text-xs" aria-label="Automation history">
        {(log.data ?? []).map((r) => (
          <li key={r.id} className="rounded border border-border px-2 py-1">
            <div className="flex items-center gap-2">
              <StatusPill tone={TONE[r.state] ?? 'neutral'}>{r.state}</StatusPill>
              <span className="font-medium">{nameOf(r.playlistId)}</span>
              <span className="text-muted">priority {r.priority}</span>
              <span className="ml-auto text-muted">{new Date(r.createdAt).toLocaleTimeString()}</span>
            </div>
            {r.reason ? <div className="text-muted">{r.reason}</div> : null}
            {r.cues.some((c) => c.state !== 'done') ? (
              <div className="text-muted">{r.cues.filter((c) => c.state !== 'done').map((c) => `${c.action}${c.templateKey ? ` ${c.templateKey.replace('builtin:', '')}` : ''}: ${c.state}${c.reason ? ` (${c.reason})` : ''}`).join(' · ')}</div>
            ) : null}
          </li>
        ))}
        {log.data && !log.data.length ? <li className="text-muted">Nothing has run automatically yet. Entries appear here as the scorer records the match.</li> : null}
      </ul>
    </div>
  );
}
