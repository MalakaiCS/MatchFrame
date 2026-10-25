'use client';
// Receive-only WebRTC preview of the bound input (scoped hidden token). Labelled as input, not programme.
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import { Button } from '@bs/ui';
import { post } from '@/lib/api';

export function InputPreview({ matchId }: { matchId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let room: Room | null = null;
    void (async () => {
      try {
        const t = await post<{ url: string; token: string; inputIdentity: string; demo: boolean }>(`matches/${matchId}/input-preview`);
        if (t.demo) return setMsg('Demo media mode: no real input preview.');
        room = new Room();
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _p, part: RemoteParticipant) => {
          if (part.identity === t.inputIdentity && track.kind === Track.Kind.Video && ref.current) track.attach(ref.current);
        });
        await room.connect(t.url, t.token);
        setMsg(room.remoteParticipants.has(t.inputIdentity) ? null : 'Input connected to the room but not publishing yet.');
      } catch (e) {
        setMsg((e as Error).message);
      }
    })();
    return () => void room?.disconnect();
  }, [on, matchId]);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs"><span className="text-muted">Input preview (WebRTC, receive-only)</span><Button size="sm" variant="ghost" onClick={() => setOn((x) => !x)}>{on ? 'Close' : 'Open'}</Button></div>
      {on ? <video ref={ref} autoPlay muted playsInline className="aspect-video w-full bg-black" aria-label="Input preview" /> : null}
      {msg ? <p className="text-xs text-muted">{msg}</p> : null}
    </div>
  );
}
