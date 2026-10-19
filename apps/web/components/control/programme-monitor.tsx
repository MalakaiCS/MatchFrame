'use client';
// Actual programme pixels for cloud outputs: the HLS output of the live programme session.
import { useGet } from '@/lib/hooks';
import { HlsPlayer } from '@/components/stream/hls-player';

export function ProgrammeMonitor({ matchId, overlayId }: { matchId: string; overlayId: string }) {
  const s = useGet<{ outputs: { overlayId: string | null; session: { state: string; hlsUrl: string | null } | null }[] }>(['streams', matchId], `matches/${matchId}/streams`, { refetchInterval: 5000 });
  const o = s.data?.outputs.find((x) => x.overlayId === overlayId);
  if (!o?.session?.hlsUrl || ['STOPPED', 'FAILED'].includes(o.session.state)) return <p className="mb-2 text-xs text-muted">Programme output is not live. Start the stream from the match Streams tab.</p>;
  return (
    <div className="mb-2">
      <p className="mb-1 text-xs font-medium uppercase text-muted">Actual programme output</p>
      <HlsPlayer src={o.session.hlsUrl} />
    </div>
  );
}
