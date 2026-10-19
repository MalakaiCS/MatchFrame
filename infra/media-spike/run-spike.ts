// Milestone 0: RTMP test input -> private room -> custom programme template (changing scorebug)
// -> HLS segments + local RTMP receiver + MP4 recording, then verify pixels/audio and cut a clip.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import {
  IngressClient, IngressInput, EgressClient, RoomServiceClient,
} from 'livekit-server-sdk';
import {
  StartEgressRequest, TemplateSource, Output, FileOutput, StreamOutput, SegmentedFileOutput,
  EncodedFileType, StreamProtocol, SegmentedFileProtocol, EncodingOptionsPreset, EgressStatus,
} from '@livekit/protocol';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'out');
const LK_HTTP = 'http://127.0.0.1:7880';
const KEY = 'devkey';
const SECRET = 'devsecret_devsecret_devsecret_devsecret';
const ROOM = `spike-${Date.now()}`;
const INPUT_ID = 'input-cam';
const DURATION_S = Number(process.env.SPIKE_SECONDS ?? 40);
const SOURCE = process.env.SPIKE_SOURCE ?? path.join(HERE, '../../tests/media/fixtures/test-source-720p30.mp4');

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// Score changes every 10 s so recorded frames must differ in the scorebug region.
const t0 = Date.now();
const webhooks: unknown[] = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  if (url.pathname === '/state') {
    const el = Math.floor((Date.now() - t0) / 1000);
    res.setHeader('content-type', 'application/json');
    res.setHeader('access-control-allow-origin', '*');
    res.end(JSON.stringify({ home: Math.floor(el / 10), away: Math.floor(el / 20),
      clock: `${String(Math.floor(el / 60)).padStart(2, '0')}:${String(el % 60).padStart(2, '0')}` }));
    return;
  }
  if (url.pathname === '/webhook') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { try { webhooks.push(JSON.parse(body)); } catch { /* ignore */ } res.end('ok'); });
    return;
  }
  const f = path.join(HERE, url.pathname.replace(/^\/+/, ''));
  if (!f.startsWith(path.join(HERE, 'template')) || !fs.existsSync(f)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html');
  fs.createReadStream(f).pipe(res);
});
await new Promise<void>((r) => server.listen(4100, '127.0.0.1', r));

const ingress = new IngressClient(LK_HTTP, KEY, SECRET);
const egress = new EgressClient(LK_HTTP, KEY, SECRET);
const rooms = new RoomServiceClient(LK_HTTP, KEY, SECRET);

await rooms.createRoom({ name: ROOM, emptyTimeout: 60 });
const ing = await ingress.createIngress(IngressInput.RTMP_INPUT, {
  name: 'spike-input', roomName: ROOM, participantIdentity: INPUT_ID, participantName: 'Camera',
});
log('ingress', ing.ingressId, ing.url, '(key redacted)');

const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', SOURCE,
  '-t', String(DURATION_S + 25), '-c', 'copy', '-f', 'flv', `${ing.url}/${ing.streamKey}`], { stdio: 'inherit' });

for (let i = 0; i < 60; i++) {
  const ps = await rooms.listParticipants(ROOM);
  const p = ps.find((x) => x.identity === INPUT_ID);
  if (p && p.tracks.length >= 2) { log('input published tracks', p.tracks.map((t) => t.type)); break; }
  await sleep(500);
}

const base = `http://127.0.0.1:4100/template/index.html?input=${INPUT_ID}&data=${encodeURIComponent('http://127.0.0.1:4100/state')}`;
const prefix = path.join('/out', ROOM);
const req = new StartEgressRequest({
  roomName: ROOM,
  source: { case: 'template', value: new TemplateSource({ layout: 'programme', customBaseUrl: base }) },
  encoding: { case: 'preset', value: EncodingOptionsPreset.H264_720P_30 },
  outputs: [
    new Output({ config: { case: 'file', value: new FileOutput({ fileType: EncodedFileType.MP4, filepath: `${prefix}/programme.mp4` }) } }),
    new Output({ config: { case: 'segments', value: new SegmentedFileOutput({ protocol: SegmentedFileProtocol.HLS_PROTOCOL,
      filenamePrefix: `${prefix}/hls/seg`, playlistName: 'index.m3u8', livePlaylistName: 'live.m3u8', segmentDuration: 2 }) } }),
    new Output({ config: { case: 'stream', value: new StreamOutput({ protocol: StreamProtocol.RTMP,
      urls: [`rtmp://127.0.0.1:1936/live/${ROOM}?user=publisher&pass=sinkpass`] }) } }),
  ],
});
let api = 'StartEgress (source=template)';
let info;
try {
  info = await egress.startEgress(req);
} catch (e) {
  log('StartEgress failed, falling back to StartRoomCompositeEgress:', (e as Error).message);
  api = 'StartRoomCompositeEgress (customBaseUrl)';
  info = await egress.startRoomCompositeEgress(ROOM, {
    file: new FileOutput({ fileType: EncodedFileType.MP4, filepath: `${prefix}/programme.mp4` }),
    stream: new StreamOutput({ protocol: StreamProtocol.RTMP, urls: [`rtmp://127.0.0.1:1936/live/${ROOM}?user=publisher&pass=sinkpass`] }),
    segments: new SegmentedFileOutput({ protocol: SegmentedFileProtocol.HLS_PROTOCOL, filenamePrefix: `${prefix}/hls/seg`,
      playlistName: 'index.m3u8', livePlaylistName: 'live.m3u8', segmentDuration: 2 }),
  }, { layout: 'programme', customBaseUrl: base, encodingOptions: EncodingOptionsPreset.H264_720P_30 });
}
log('egress', info.egressId, 'via', api, 'status', EgressStatus[info.status]);

let live = false;
for (let i = 0; i < 60; i++) {
  const [e] = await egress.listEgress({ egressId: info.egressId });
  if (e.status === EgressStatus.EGRESS_ACTIVE) { live = true; log('egress ACTIVE'); break; }
  if (e.status >= EgressStatus.EGRESS_ENDING) { log('egress ended early', e.error); break; }
  await sleep(1000);
}
const cpuSamples: string[] = [];
const sample = setInterval(() => {
  try { cpuSamples.push(execFileSync('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'], { encoding: 'utf8' })); } catch { /* ignore */ }
}, 10000);
await sleep(DURATION_S * 1000);
clearInterval(sample);
const sinkList = await fetch('http://127.0.0.1:9997/v3/paths/list').then((r) => r.json()).catch(() => null);
log('sink paths', JSON.stringify(sinkList?.items?.map((p: { name: string; ready: boolean; tracks: string[] }) => [p.name, p.ready, p.tracks])));
await egress.stopEgress(info.egressId).catch((e) => log("stop:", e.message));
let final;
for (let i = 0; i < 60; i++) {
  [final] = await egress.listEgress({ egressId: info.egressId });
  if (final.status >= EgressStatus.EGRESS_COMPLETE) break;
  await sleep(1000);
}
log('final egress status', EgressStatus[final!.status], final!.error || '');
ff.kill('SIGINT');
await ingress.deleteIngress(ing.ingressId);
await rooms.deleteRoom(ROOM);
server.close();
fs.mkdirSync(path.join(OUT, ROOM), { recursive: true });
fs.writeFileSync(path.join(OUT, ROOM, 'spike-result.json'), JSON.stringify({ room: ROOM, api, live,
  egress: { id: info.egressId, status: EgressStatus[final!.status], error: final!.error,
    files: final!.fileResults, segments: final!.segmentResults, streams: final!.streamResults },
  cpuSamples, webhookCount: webhooks.length, webhookEvents: webhooks.map((w) => (w as { event: string }).event) }, null, 2));
log('wrote', path.join(OUT, ROOM));
