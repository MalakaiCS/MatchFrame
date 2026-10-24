'use client';
// Sponsor delivery evidence. Only renderers the server nominated as reporting authority emit; the server
// re-checks authority and ignores previews, monitors and extra browser-source copies (spec §12.5).
import { useCallback, useEffect, useRef } from 'react';
import type { Cue } from '@bs/graphics';
import type { Snapshot } from './use-output';

interface Shown {
  cueId: string;
  creativeId: string;
  placement: string;
  decisionId: string | null;
  campaignId: string | null;
}

const HEARTBEAT_MS = 2000;

function shownItems(visible: Cue[], snap: Snapshot | null): Shown[] {
  if (!snap) return [];
  const out: Shown[] = [];
  for (const c of visible) {
    if (c.outAt) continue;
    if (c.sponsor && snap.data.creatives[c.sponsor.creativeId]) out.push({ cueId: c.cueId, creativeId: c.sponsor.creativeId, placement: c.sponsor.placement, decisionId: c.sponsor.decisionId, campaignId: c.sponsor.campaignId });
    if (c.layer === 'scoreboard' && c.variables.showSponsor !== false) {
      const s = (snap.state.slots ?? snap.slots)?.scorebug_logo;
      if (s && snap.data.creatives[s.creativeId]) out.push({ cueId: `${c.cueId}:slot:${s.decisionId}`, creativeId: s.creativeId, placement: 'scorebug_logo', decisionId: s.decisionId, campaignId: (s as { campaignId?: string | null }).campaignId ?? null });
    }
  }
  return out;
}

export function useExposureReporter(emit: (ev: string, p: unknown) => void, session: { reportingAuthority: boolean } | null, snap: Snapshot | null) {
  const visibleRef = useRef<Cue[]>([]);
  const open = useRef(new Map<string, Shown>());
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const authority = !!session?.reportingAuthority;

  const flush = useCallback(() => {
    if (!authority) return;
    const s = snapRef.current;
    const now = shownItems(visibleRef.current, s);
    const keys = new Set(now.map((x) => `${x.cueId}|${x.creativeId}`));
    for (const [k, x] of open.current) {
      if (!keys.has(k)) {
        emit('exposure', { ...x, revision: s?.state.revision ?? 0, visible: false });
        open.current.delete(k);
      }
    }
    for (const x of now) {
      open.current.set(`${x.cueId}|${x.creativeId}`, x);
      emit('exposure', { ...x, revision: s?.state.revision ?? 0, visible: true });
    }
  }, [authority, emit]);

  useEffect(() => {
    if (!authority) return;
    const t = setInterval(flush, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [authority, flush]);
  // slot rotations change what is visible without changing the cue set
  useEffect(() => flush(), [snap?.state.revision, flush]);

  return useCallback(
    (visible: Cue[]) => {
      visibleRef.current = visible;
      flush();
    },
    [flush],
  );
}
