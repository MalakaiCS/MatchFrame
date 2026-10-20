'use client';
// "What happens next": the automation this output will run when the scorer presses the next phase button,
// read from the assigned plan, so the producer is never surprised by a graphic.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@bs/domain';
import type { RenderData } from '@bs/graphics';
import { get } from '@/lib/api';
import { useGet } from '@/lib/hooks';

interface PlanSummary { id: string; name: string; versions: { id: string; version: number }[] }
interface Trigger { type: string; phaseIds?: string[]; phaseTags?: string[]; eventTypes?: string[] }
interface PlanDetail { versions: { id: string; definition: { playlists: { id: string; name: string; triggers: Trigger[] }[] } }[] }

export function ComingNext({ data, gamePlanVersionId, mode }: { data: RenderData; gamePlanVersionId: string | null; mode: string }) {
  const plans = useGet<PlanSummary[]>(['game-plans'], 'game-plans', { enabled: !!gamePlanVersionId });
  const planId = plans.data?.find((p) => p.versions.some((v) => v.id === gamePlanVersionId))?.id;
  const detail = useQuery({ queryKey: ['game-plan', planId], queryFn: () => get<PlanDetail>(`game-plans/${planId}`), enabled: !!planId });
  const playlists = useMemo(() => detail.data?.versions.find((v) => v.id === gamePlanVersionId)?.definition.playlists ?? [], [detail.data, gamePlanVersionId]);

  const { next, onNext, onEvents } = useMemo(() => {
    const adapter = getAdapter(data.match.sport);
    const cfg = data.match.rulesConfig as never;
    const defs = adapter.allowedTransitions(cfg, data.match.projection).map((id) => adapter.phase(cfg, id)!);
    const next = defs.find((p) => p.kind !== 'terminal' && p.tags.length) ?? defs.find((p) => p.kind !== 'terminal') ?? null;
    const matches = (t: Trigger) => !!next && t.type === 'phase' && ((t.phaseIds ?? []).includes(next.id) || (t.phaseTags ?? []).some((x) => next.tags.includes(x)));
    const onNext = playlists.filter((p) => p.triggers.some(matches)).map((p) => p.name);
    const eventTypes = new Set(playlists.flatMap((p) => p.triggers.filter((t) => t.type === 'event').flatMap((t) => t.eventTypes ?? [])));
    const labels = adapter.eventTypes(cfg).filter((e) => eventTypes.has(e.type)).map((e) => e.label.toLowerCase());
    return { next, onNext, onEvents: labels };
  }, [data, playlists]);

  if (!gamePlanVersionId) return <p className="text-xs text-muted">Automation is off for this output: everything goes to air from this desk.</p>;
  if (mode === 'manual') return <p className="text-xs text-warning">Manual mode: automation is paused. Switch back to Auto for graphics to follow the scorer.</p>;
  return (
    <div className="text-xs text-muted">
      {next ? (
        <p>When the scorer presses <b className="text-text">{next.label}</b>: {onNext.length ? <span className="text-text">{onNext.join(' · ')}</span> : 'nothing automatic'}</p>
      ) : <p>The match is finished; nothing more runs automatically.</p>}
      {onEvents.length ? <p className="mt-1">Automatic graphics for {onEvents.join(', ')}.</p> : null}
    </div>
  );
}
