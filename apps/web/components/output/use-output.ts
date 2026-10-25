'use client';
// Shared renderer client: explicit snapshot + scoped read-only socket. Used by the production overlay
// (browser source), monitor/rehearsal views and the cloud programme template.
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClockState, MatchProjection } from '@bs/domain';
import type { OverlayPublicState, RenderData } from '@bs/graphics';

export interface Snapshot {
  overlay: { id: string; name: string; purpose: string; matchId: string };
  state: OverlayPublicState;
  data: RenderData;
  serverNow: number;
  slots?: Record<string, { creativeId: string; decisionId: string } | undefined>;
}

export function useOutput(publicId: string, token: string | null, opts: { apiBase?: string; realtimeUrl?: string; refreshBoards?: boolean } = {}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ rendererSessionId: string; reportingAuthority: boolean; purpose: string } | null>(null);
  const offset = useRef(0);
  const sock = useRef<Socket | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;
  const apiBase = opts.apiBase ?? '';

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${apiBase}/api/v1/public/overlay/${publicId}/snapshot`, { headers: { 'x-overlay-token': token }, cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (r.status === 401) {
        setError('invalid');
        setSnap(null);
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const s = (await r.json()) as Snapshot;
      offset.current = s.serverNow - Date.now();
      setSnap(s);
      setError(null);
    } catch {
      setError((e) => e ?? 'unreachable');
    }
  }, [publicId, token, apiBase]);

  useEffect(() => {
    if (!token) return;
    void load();
    const instanceId = `${Math.random().toString(36).slice(2, 10)}`;
    const s = io(`${opts.realtimeUrl ?? process.env.NEXT_PUBLIC_REALTIME_URL}/render`, { auth: { token, instanceId }, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
    sock.current = s;
    const sync = () => {
      const sentAt = Date.now();
      s.emit('time', null, (r: { serverNow: number }) => {
        const rtt = Date.now() - sentAt;
        offset.current = r.serverNow - (sentAt + rtt / 2);
      });
    };
    s.on('connect', () => {
      setConnected(true);
      sync();
      void load(); // current state, not a replay of historic takes
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (e) => {
      if (e.message === 'INVALID_CAPABILITY') {
        setError('invalid');
        setSnap(null);
        s.disconnect();
      }
    });
    s.on('session', (x) => setSessionInfo(x));
    const t = setInterval(sync, 30_000);
    s.on('event', (e: { topic: string; payload: Record<string, unknown> }) => {
      const cur = snapRef.current;
      if (!cur) return;
      const p = e.payload;
      if (e.topic === 'overlay.state.updated') {
        if ((p.themeChanged as boolean) || (p.revision as number) < cur.state.revision) {
          if (p.themeChanged) void load();
          return;
        }
        const st = p as unknown as OverlayPublicState;
        setSnap({ ...cur, state: st });
        // a newly referenced creative or media asset needs fresh signed URLs
        const ids = [...Object.values(st.layers).flatMap((c) => [c?.sponsor?.creativeId, c?.variables?.creative as string | undefined]), ...Object.values(st.slots ?? {}).map((x) => x?.creativeId)].filter((x): x is string => !!x);
        const imgs = Object.values(st.layers).map((c) => c?.variables?.image).filter((x): x is string => typeof x === 'string');
        if (ids.some((i) => !cur.data.creatives[i]) || imgs.some((i) => !cur.data.assets[i])) void load();
      } else if (e.topic === 'overlay.slots.updated') {
        void load();
      } else if (e.topic === 'match.state.updated') {
        if ((p.stateVersion as number) <= cur.data.match.stateVersion) return;
        setSnap({ ...cur, data: { ...cur.data, match: { ...cur.data.match, projection: p.projection as MatchProjection, clocks: p.clocks as Record<string, ClockState>, stateVersion: p.stateVersion as number } } });
      } else if (e.topic === 'clock.anchor.updated') {
        if ((p.stateVersion as number) < cur.data.match.stateVersion) return;
        setSnap({ ...cur, data: { ...cur.data, match: { ...cur.data.match, clocks: p.clocks as Record<string, ClockState> } } });
      } else if (e.topic === 'match.lineup.updated' || e.topic === 'overlay.credentials.rotated') {
        void load();
      }
    });
    return () => {
      clearInterval(t);
      s.disconnect();
    };
  }, [token, load, opts.realtimeUrl]);

  // Boards about other matches (today's matches, the ticker's scores) only change with a fresh snapshot, since the
  // socket carries this output's own match: while one is on air (or the page draws the intermission), take a new
  // snapshot every 20 s.
  const boardOnAir =
    !!opts.refreshBoards ||
    (!!snap &&
    Object.values(snap.state.layers).some(
      (c) => !!c && !c.outAt && (c.templateKey === 'builtin:matches_today' || c.templateKey === 'builtin:intermission' || (c.templateKey === 'builtin:ticker' && c.variables?.mode === 'scores')) && (c.durationMs == null || serverNow() < c.startedAt + c.durationMs),
    ));
  useEffect(() => {
    if (!boardOnAir) return;
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [boardOnAir, load]);

  /** Acknowledge the revision actually displayed (after fonts are ready). */
  const ackRef = useRef(-1);
  useEffect(() => {
    if (!snap || !sock.current) return;
    const rev = snap.state.revision;
    if (rev === ackRef.current) return;
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => {
        ackRef.current = rev;
        sock.current?.emit('displayed', { revision: rev });
      }),
    );
  }, [snap]);

  const emit = useCallback((ev: string, payload: unknown) => sock.current?.emit(ev, payload), []);

  return { snap, error, connected, serverNow, sessionInfo, emit, reload: load };
}
