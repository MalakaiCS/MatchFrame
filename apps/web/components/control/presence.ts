'use client';
// Who else is in this control room and which layer each desk is preparing. Presence arrives over the overlay
// socket room; a layer lock is advisory for the UI and enforced by the command route (409 LAYER_LOCKED).
import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api';
import { getSocket } from '@/lib/realtime';

export interface PresenceUser { userId: string; name: string; since: number }
export interface LayerLock { layer: string; userId: string; name: string; until: number }
interface Snapshot { overlayId?: string; users: PresenceUser[]; locks: LayerLock[] }

export function usePresence(overlayId: string, selfUserId: string | undefined) {
  const [snap, setSnap] = useState<Snapshot>({ users: [], locks: [] });
  const holding = useRef<string | null>(null);

  useEffect(() => {
    get<Snapshot>(`overlays/${overlayId}/presence`).then(setSnap).catch(() => undefined);
    const s = getSocket();
    const onPresence = (p: Snapshot) => {
      if (p.overlayId === overlayId) setSnap(p);
    };
    s.on('presence', onPresence);
    return () => {
      s.off('presence', onPresence);
    };
  }, [overlayId]);

  const emitLock = useCallback(
    (layer: string, release: boolean) =>
      new Promise<{ ok: boolean; holder?: LayerLock }>((resolve) => {
        const s = getSocket();
        if (!s.connected) return resolve({ ok: true });
        s.timeout(3000).emit('lock', { overlayId, layer, release }, (err: unknown, r: { ok: boolean; holder?: LayerLock }) => resolve(err ? { ok: true } : r));
      }),
    [overlayId],
  );

  /** Hold the lock on the layer this desk is preparing (refreshed every 10 s); null releases it. */
  const hold = useCallback(
    (layer: string | null) => {
      const prev = holding.current;
      if (prev && prev !== layer) void emitLock(prev, true);
      holding.current = layer;
      if (layer) void emitLock(layer, false);
    },
    [emitLock],
  );
  useEffect(() => {
    const t = setInterval(() => {
      if (holding.current) void emitLock(holding.current, false);
    }, 10_000);
    return () => {
      clearInterval(t);
      if (holding.current) void emitLock(holding.current, true);
    };
  }, [emitLock]);

  const others = snap.users.filter((u) => u.userId !== selfUserId);
  const foreignLocks = snap.locks.filter((l) => l.userId !== selfUserId && l.until > Date.now());
  const lockedBy = (layer: string) => foreignLocks.find((l) => l.layer === layer) ?? null;
  return { users: snap.users, others, locks: foreignLocks, hold, lockedBy };
}
