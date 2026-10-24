// Milestone 0 programme template: authorised input track full-frame + live scorebug.
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteParticipant } from 'livekit-client';

const q = new URLSearchParams(location.search);
const wsUrl = q.get('url')!;
const token = q.get('token')!;
const inputIdentity = q.get('input') ?? '';
const dataUrl = q.get('data') ?? '';

const video = document.getElementById('v') as HTMLVideoElement;
const home = document.getElementById('hs')!;
const away = document.getElementById('as')!;
const clock = document.getElementById('clk')!;

function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  const stage = document.getElementById('stage')!;
  stage.style.transform = `scale(${s})`;
}
addEventListener('resize', fit);
fit();

let started = false;
function startRecording() {
  if (started) return;
  started = true;
  console.log('START_RECORDING');
}

async function poll() {
  if (!dataUrl) return;
  try {
    const r = await fetch(dataUrl, { cache: 'no-store' });
    const s = await r.json();
    home.textContent = String(s.home);
    away.textContent = String(s.away);
    clock.textContent = s.clock;
  } catch {
    /* keep last state */
  }
}
setInterval(poll, 250);

const room = new Room({ adaptiveStream: false });
room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
  if (p.identity !== inputIdentity) return;
  if (track.kind === Track.Kind.Video) {
    track.attach(video);
    video.onplaying = () => startRecording();
  } else if (track.kind === Track.Kind.Audio) {
    const el = track.attach() as HTMLAudioElement;
    document.body.appendChild(el);
  }
});
room.on(RoomEvent.Disconnected, (reason) => { console.log('room disconnected', reason); console.log('END_RECORDING'); });
addEventListener('error', (e) => console.log('template error', e.message));

try {
  await room.connect(wsUrl, token, { autoSubscribe: false });
  console.log('room connected', room.name);
} catch (e) {
  console.log('room connect failed', String(e));
}
const subscribeFrom = (p: RemoteParticipant) => {
  if (p.identity !== inputIdentity) return;
  p.trackPublications.forEach((pub) => pub.setSubscribed(true));
};
room.on(RoomEvent.TrackPublished, (pub, p) => p.identity === inputIdentity && pub.setSubscribed(true));
room.remoteParticipants.forEach(subscribeFrom);
// Start even without input after a bounded wait so the holding slate is recorded.
setTimeout(startRecording, 15000);
