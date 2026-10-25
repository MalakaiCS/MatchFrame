'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ClockState, MatchProjection } from '@bs/domain';
import type { OverlayCommand, OverlayPublicState, RenderData } from '@bs/graphics';
import { ApiError, get, post, uuid } from '@/lib/api';
import { serverNow, useRealtime } from '@/lib/realtime';

export interface OverlayDetail {
  overlay: { id: string; name: string; kind: string; matchId: string; publicId: string; gamePlanVersionId: string | null; pendingThemeProfileVersionId: string | null };
  state: OverlayPublicState;
  displayedRevision: number;
  displayedAt: string | null;
  renderers: { id: string; purpose: string; displayedRevision: number; lastSeenAt: string; reporting: boolean }[];
  history: { id: string; type: string; source: string; status: string; reason: string | null; revision: number | null; createdAt: string }[];
  canOperate: boolean;
}

export interface PendingCommand {
  commandId: string;
  type: string;
  label: string;
  status: 'requested' | 'accepted' | 'displayed' | 'rejected';
  revision?: number;
  error?: string;
  at: number;
}

/** Control-room data: overlay state, render snapshot, live match data and command lifecycle tracking. */
export function useControl(overlayId: string) {
  const qc = useQueryClient();
  const [detail, setDetail] = useState<OverlayDetail | null>(null);
  const [data, setData] = useState<RenderData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<PendingCommand[]>([]);
  const [displayed, setDisplayed] = useState(0);
  const detailRef = useRef<OverlayDetail | null>(null);
  detailRef.current = detail;

  const load = useCallback(async () => {
    try {
      const [d, snap] = await Promise.all([get<OverlayDetail>(`overlays/${overlayId}`), get<{ data: RenderData; state: OverlayPublicState }>(`overlays/${overlayId}/render-data`)]);
      setDetail(d);
      setData(snap.data);
      setDisplayed((x) => Math.max(x, d.displayedRevision));
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    }
  }, [overlayId]);

  useEffect(() => {
    void load();
  }, [load]);

  // displayed acknowledgements move pending commands to "displayed"
  useEffect(() => {
    setPending((ps) => ps.map((p) => (p.status === 'accepted' && p.revision != null && p.revision <= displayed ? { ...p, status: 'displayed' } : p)));
  }, [displayed]);

  useRealtime('overlay', overlayId, (e) => {
    const p = e.payload;
    if (e.topic === 'overlay.state.updated') {
      setDetail((d) => (d && (p.revision as number) >= d.state.revision ? { ...d, state: p as unknown as OverlayPublicState } : d));
      if (p.themeChanged) void load();
    }
    if (e.topic === 'renderer.revision.displayed') setDisplayed((x) => Math.max(x, p.revision as number));
    if (e.topic === 'overlay.command.accepted' || e.topic.startsWith('automation.')) void qc.invalidateQueries({ queryKey: ['automation', overlayId] });
    if (e.topic === 'overlay.theme.pending') void load();
  }, () => void load());

  const matchId = detail?.overlay.matchId;
  useRealtime('match', matchId, (e) => {
    const p = e.payload;
    if (e.topic === 'match.state.updated')
      setData((d) => (d && (p.stateVersion as number) > d.match.stateVersion ? { ...d, match: { ...d.match, projection: p.projection as MatchProjection, clocks: p.clocks as Record<string, ClockState>, stateVersion: p.stateVersion as number } } : d));
    if (e.topic === 'clock.anchor.updated') setData((d) => (d ? { ...d, match: { ...d.match, clocks: p.clocks as Record<string, ClockState> } } : d));
    if (e.topic === 'match.lineup.updated') void load();
    if (e.topic === 'match.fact.accepted' || e.topic === 'match.fact.corrected') void qc.invalidateQueries({ queryKey: ['facts', matchId] });
  });

  const send = useCallback(
    async (command: OverlayCommand, label: string) => {
      const commandId = uuid();
      setPending((ps) => [{ commandId, type: command.type, label, status: 'requested' as const, at: Date.now() }, ...ps].slice(0, 30));
      try {
        const r = await post<{ revision: number; state: OverlayPublicState }>(`overlays/${overlayId}/commands`, { commandId, command, knownRevision: detailRef.current?.state.revision });
        setPending((ps) => ps.map((p) => (p.commandId === commandId ? { ...p, status: 'accepted', revision: r.revision } : p)));
        setDetail((d) => (d && r.revision >= d.state.revision ? { ...d, state: r.state } : d));
        return r;
      } catch (e) {
        const ae = e as ApiError;
        setPending((ps) => ps.map((p) => (p.commandId === commandId ? { ...p, status: 'rejected', error: ae.message } : p)));
        throw ae;
      }
    },
    [overlayId],
  );

  return { detail, data, error, pending, displayed, send, reload: load, serverNow };
}
