'use client';
// Actual programme output via our authorised HLS gateway, with an explicit latency label (spec §13.5).
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

export function HlsPlayer({ src, muted = true, className, label = true, paused = false }: { src: string; muted?: boolean; className?: string; label?: boolean; paused?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'loading' | 'playing' | 'waiting' | 'error'>('loading');
  const [latency, setLatency] = useState<number | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || paused) return;
    let hls: Hls | null = null;
    let retry: NodeJS.Timeout | null = null;
    const start = () => {
      if (Hls.isSupported()) {
        hls = new Hls({ liveSyncDurationCount: 3, manifestLoadingMaxRetry: 2, xhrSetup: (x) => { x.withCredentials = true; } });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            setStatus(data.response?.code === 404 ? 'waiting' : 'error');
            hls?.destroy();
            retry = setTimeout(start, 4000);
          }
        });
        hls.on(Hls.Events.FRAG_CHANGED, () => setLatency(hls?.latency != null ? Math.round(hls.latency * 10) / 10 : null));
        hls.loadSource(src);
        hls.attachMedia(v);
      } else v.src = src;
      void v.play().catch(() => undefined);
    };
    v.onplaying = () => setStatus('playing');
    start();
    return () => {
      if (retry) clearTimeout(retry);
      hls?.destroy();
    };
  }, [src, paused]);
  return (
    <div className={`relative bg-black ${className ?? ''}`}>
      <video ref={ref} muted={muted} playsInline className="aspect-video w-full" aria-label="Programme output" />
      {label ? (
        <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs text-white">
          {status === 'playing' ? `Actual output (HLS) · ~${latency ?? '?'}s behind live` : status === 'waiting' ? 'Waiting for output segments…' : status === 'error' ? 'Output unavailable, retrying…' : 'Loading output…'}
        </span>
      ) : null}
    </div>
  );
}
