'use client';
// Socket.IO client: authorised resource subscriptions. Sockets are a delivery channel only — consumers
// track versions and refetch a snapshot on gaps or reconnects.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';

export interface RtEvent {
  topic: string;
  position: number;
  seq: number | null;
  payload: Record<string, unknown>;
}

let socket: Socket | null = null;
let status: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
const listeners = new Set<() => void>();
const subs = new Map<string, number>();
let offset = 0; // serverNow - Date.now()
/** Low-data mode: the socket stays closed and pages that can poll do so. */
let paused = false;

function setStatus(s: typeof status) {
  status = s;
  listeners.forEach((l) => l());
}

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(`${process.env.NEXT_PUBLIC_REALTIME_URL}/app`, { withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 5000, autoConnect: !paused });
  if (!paused) setStatus('connecting');
  socket.on('connect', () => {
    setStatus('connected');
    for (const key of subs.keys()) {
      const [kind, id] = key.split(':');
      socket!.emit('subscribe', { kind, id });
    }
    syncTime();
  });
  socket.on('disconnect', () => setStatus('disconnected'));
  socket.on('connect_error', () => setStatus('disconnected'));
  return socket;
}

function syncTime() {
  const samples: { sentAt: number; serverAt: number; receivedAt: number }[] = [];
  let n = 0;
  const one = () => {
    const sentAt = Date.now();
    socket?.emit('time', null, (r: { serverNow: number }) => {
      samples.push({ sentAt, serverAt: r.serverNow, receivedAt: Date.now() });
      if (++n < 5) setTimeout(one, 150);
      else {
        const best = samples.sort((a, b) => a.receivedAt - a.sentAt - (b.receivedAt - b.sentAt))[0]!;
        offset = best.serverAt - (best.sentAt + (best.receivedAt - best.sentAt) / 2);
      }
    });
  };
  one();
}

export const serverNow = () => Date.now() + offset;

/**
 * Pause or resume the realtime socket. While paused nothing is pushed and consumers that can poll do so (the
 * scorer's low-data mode); resuming reconnects and re-subscribes every room.
 */
export function setSocketPaused(p: boolean) {
  if (paused === p) return;
  paused = p;
  if (!socket) return;
  if (p) {
    socket.disconnect();
    setStatus('disconnected');
  } else {
    setStatus('connecting');
    socket.connect();
  }
}
export const isSocketPaused = () => paused;

export function useConnectionStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      getSocket();
      return () => listeners.delete(l);
    },
    () => status,
    () => 'disconnected' as const,
  );
}

/** Subscribe to an authorised room and receive its events. onReconnect lets callers refetch snapshots. */
export function useRealtime(kind: 'match' | 'overlay' | 'ops', id: string | null | undefined, onEvent: (e: RtEvent) => void, onReconnect?: () => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const rc = useRef(onReconnect);
  rc.current = onReconnect;
  useEffect(() => {
    if (kind !== 'ops' && !id) return;
    const s = getSocket();
    const key = `${kind}:${id ?? ''}`;
    subs.set(key, (subs.get(key) ?? 0) + 1);
    if (s.connected) s.emit('subscribe', { kind, id });
    const handler = (e: RtEvent) => cb.current(e);
    const reconnect = () => rc.current?.();
    s.on('event', handler);
    s.on('connect', reconnect);
    return () => {
      s.off('event', handler);
      s.off('connect', reconnect);
      const n = (subs.get(key) ?? 1) - 1;
      if (n <= 0) {
        subs.delete(key);
        s.emit('unsubscribe', { kind, id });
      } else subs.set(key, n);
    };
  }, [kind, id]);
}
