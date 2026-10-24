'use client';
// Egress template (spec §13.7). Loaded by the media egress browser with url= and token= (room, subscribe-only)
// plus our bootstrap: mode (programme|clean), input identity and, for programme, a compositor capability.
// It subscribes ONLY to the authorised input participant, attaches its video full-frame and its audio, and
// renders the shared graphics renderer on top for programme. Clean outputs carry no graphics.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';
import { AudioPolicyContext, Keyframes, Renderer, Stage, THEMES, customDefsFrom, renderCustomScene } from '@bs/graphics/react';
import { useOutput } from '@/components/output/use-output';
import { useExposureReporter } from '@/components/output/exposure';

function Programme() {
  const q = useSearchParams();
  const wsUrl = q.get('url');
  const token = q.get('token');
  const mode = q.get('mode') === 'clean' ? 'clean' : 'programme';
  const inputId = q.get('input') ?? '';
  const bt = mode === 'programme' ? q.get('bt') : null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioEls = useRef<HTMLMediaElement[]>([]);
  const [hasVideo, setHasVideo] = useState(false);
  const started = useRef(false);
  const out = useOutput('compositor', bt);
  const report = useExposureReporter(out.emit, out.sessionInfo, out.snap);

  const startRecording = useCallback(() => {
    if (started.current) return;
    started.current = true;
    console.log('START_RECORDING'); // egress template readiness signal
  }, []);

  useEffect(() => {
    if (!wsUrl || !token) return;
    const room = new Room({ adaptiveStream: false, dynacast: false });
    const allowed = (p: RemoteParticipant) => p.identity === inputId;
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (!allowed(p)) return track.stop();
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current);
        videoRef.current.onplaying = () => {
          setHasVideo(true);
          startRecording();
        };
      } else if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.volume = 1;
        audioEls.current.push(el);
        document.body.appendChild(el);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) setHasVideo(false);
      track.detach().forEach((el) => {
        audioEls.current = audioEls.current.filter((x) => x !== el);
        if (el.tagName === 'AUDIO') el.remove();
      });
    });
    room.on(RoomEvent.TrackPublished, (pub, p) => allowed(p) && pub.setSubscribed(true));
    let disposed = false;
    // END_RECORDING ends the egress: only signal it for a real room end, never for our own effect cleanup
    room.on(RoomEvent.Disconnected, () => {
      if (!disposed && started.current) console.log('END_RECORDING');
    });
    void room
      .connect(wsUrl, token, { autoSubscribe: false })
      .then(() => room.remoteParticipants.forEach((p) => allowed(p) && p.trackPublications.forEach((pub) => pub.setSubscribed(true))))
      .catch((e) => console.log('room connect failed', String(e)));
    // a missing source still records the holding slate after a bounded wait
    const t = setTimeout(startRecording, 15_000);
    return () => {
      disposed = true;
      clearTimeout(t);
      void room.disconnect();
    };
  }, [wsUrl, token, inputId, startRecording]);

  const audioPolicy = useMemo(() => ({ setProgrammeGain: (g: number) => audioEls.current.forEach((el) => (el.volume = Math.max(0, Math.min(1, g)))) }), []);
  const custom = out.snap ? customDefsFrom(out.snap.data.customTemplates) : [];
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#000' }}>
      <Keyframes />
      <Stage>
        <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, objectFit: 'contain', background: '#000' }} />
        {!hasVideo ? (
          <div data-holding-slate style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#0b1220,#131f32)', color: '#F3F6FB', font: '600 48px "Inter Variable", sans-serif' }}>
            <div style={{ textAlign: 'center' }}>
              <div>We’ll be right back</div>
              <div style={{ fontSize: 24, opacity: 0.7, marginTop: 16 }}>Waiting for the camera feed</div>
            </div>
          </div>
        ) : null}
        {mode === 'programme' && out.snap ? (
          <AudioPolicyContext.Provider value={audioPolicy}>
            <Renderer state={out.snap.state} data={out.snap.data} themes={THEMES} serverNow={out.serverNow} customDefs={custom} renderCustom={renderCustomScene} slots={out.snap.state.slots ?? out.snap.slots} onVisible={report} />
          </AudioPolicyContext.Provider>
        ) : null}
      </Stage>
    </div>
  );
}

export default function ProgrammePage() {
  return (
    <Suspense>
      <Programme />
    </Suspense>
  );
}
