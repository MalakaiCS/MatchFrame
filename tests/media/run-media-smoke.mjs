// Real media smoke test through the application (A35, A37, A46 HLS gateway, recording finalisation).
// Requires: pnpm services:up --profile media-test (LiveKit, ingress, egress, MinIO, RTMP sink), pnpm dev,
// seeded data and SMOKE_EMAIL / SMOKE_PASSWORD for an owner. Writes evidence to docs/evidence/m5/.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL ?? 'owner@studio.localhost';
const PASSWORD = process.env.SMOKE_PASSWORD;
const OUT = path.resolve('docs/evidence/m5');
const SOURCE = path.resolve('tests/media/fixtures/test-source-720p30.mp4');
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/\s+#.*$/, '')]));
if (!PASSWORD) throw new Error('Set SMOKE_PASSWORD (the seeded owner password)');
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(SOURCE)) execFileSync('bash', ['tests/media/gen-fixture.sh', SOURCE], { stdio: 'inherit' });

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
let cookie = '';
async function api(p, init = {}, attempt = 0) {
  const r = await fetch(`${BASE}${p}`, { ...init, headers: { ...(init.json ? { 'content-type': 'application/json' } : {}), origin: BASE, cookie, ...(init.headers ?? {}) }, body: init.json ? JSON.stringify(init.json) : init.body, redirect: 'manual', signal: AbortSignal.timeout(30_000) }).catch(async (e) => {
    if (attempt >= 2) throw e;
    await sleep(2000);
    return null;
  });
  if (!r) return api(p, init, attempt + 1);
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = [cookie, ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { j = text; }
  if (!r.ok && !init.allowFail) throw new Error(`${init.method ?? 'GET'} ${p} → ${r.status} ${text.slice(0, 300)}`);
  return { status: r.status, body: j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, fn, timeoutMs = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(1500);
  }
}

const results = {};
await api('/api/auth/sign-in/email', { method: 'POST', json: { email: EMAIL, password: PASSWORD } });
const matches = (await api('/api/v1/matches?pageSize=50')).body.items;
const match = matches.find((m) => m.isDemo && m.sport === 'football');
log('match', match.id);
const input = (await api('/api/v1/inputs', { method: 'POST', json: { name: `Smoke cam ${crypto.randomUUID().slice(0, 4)}` } })).body;
const prog = (await api(`/api/v1/matches/${match.id}/outputs`, { method: 'PUT', json: { mode: 'PROGRAMME', inputId: input.id, preset: '720p30' } })).body;
const clean = (await api(`/api/v1/matches/${match.id}/outputs`, { method: 'PUT', json: { mode: 'CLEAN', inputId: input.id, preset: '720p30' } })).body;
const tag = crypto.randomUUID().slice(0, 6);
for (const [o, name] of [[prog, `prog${tag}`], [clean, `clean${tag}`]]) {
  const existing = (await api(`/api/v1/matches/${match.id}/streams`)).body.outputs.find((x) => x.id === o.id).destinations;
  for (const d of existing) await api(`/api/v1/destinations/${d.id}`, { method: 'DELETE' });
  await api(`/api/v1/outputs/${o.id}/destinations`, { method: 'POST', json: { name: 'Local sink', serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: `${name}?user=publisher&pass=${env.RTMP_SINK_PASSWORD}` } });
}
const key = (await api(`/api/v1/inputs/${input.id}/reveal`, { method: 'POST', json: {} })).body;
const start = (await api(`/api/v1/matches/${match.id}/session/start`, { method: 'POST', json: {} })).body;
log('session', start.sessionId, start.state);
await until('WAITING_FOR_INPUT', async () => (await api(`/api/v1/matches/${match.id}/streams`)).body.session?.state === 'WAITING_FOR_INPUT', 60_000);
const push = () => spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', SOURCE, '-c', 'copy', '-f', 'flv', `${key.serverUrl}/${key.streamKey}`], { stdio: 'inherit' });
let ff = push();
try {
  const t0 = Date.now();
  const live = await until('LIVE', async () => {
    const s = (await api(`/api/v1/matches/${match.id}/streams`)).body;
    return s.outputs.every((o) => o.session?.state === 'LIVE') ? s : null;
  }, 150_000);
  results.secondsToLive = Math.round((Date.now() - t0) / 1000);
  log('LIVE after', results.secondsToLive, 's', live.session.state);
  const progOut = live.outputs.find((o) => o.mode === 'PROGRAMME');
  results.destinations = live.outputs.map((o) => [o.mode, o.destinations.map((d) => d.lastStatus.status)]);
  // the RTMP receiver records what each destination actually received (analysed after stop)
  results.liveObservedAt = Date.now();
  await sleep(4000);
  // graphics: scorebug for the whole window, full-frame slate from ~8s to ~16s
  const ovId = progOut.overlayId;
  const cmd = (command) => api(`/api/v1/overlays/${ovId}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), command } });
  await cmd({ type: 'SET_MODE', mode: 'manual' });
  await cmd({ type: 'CLEAR_LAYER', layer: 'background' });
  await cmd({ type: 'SHOW_SCOREBUG' });
  await sleep(8000);
  const slateAt = Date.now();
  await cmd({ type: 'TAKE_IN', templateKey: 'builtin:slate', variables: { message: 'interval' }, durationMs: null });
  await sleep(8000);
  await cmd({ type: 'CLEAR_LAYER', layer: 'background' });
  results.slateWindowMs = Date.now() - slateAt;
  log('graphics sequence sent');
  await sleep(3000);
  // HLS gateway: playlist and a segment with the session cookie; denied without it
  const pl = await api(progOut.session.hlsUrl);
  const seg = String(pl.body).split('\n').find((l) => l.endsWith('.ts'));
  const segUrl = progOut.session.hlsUrl.replace(/live\.m3u8$/, seg.split('/').pop());
  const segOk = await fetch(`${BASE}${segUrl}`, { headers: { cookie } });
  const segAnon = await fetch(`${BASE}${segUrl}`);
  const plAnon = await fetch(`${BASE}${progOut.session.hlsUrl}`);
  results.hls = { playlist: pl.status, segment: segOk.status, segmentBytes: (await segOk.arrayBuffer()).byteLength, anonymousSegment: segAnon.status, anonymousPlaylist: plAnon.status };
  log('hls', JSON.stringify(results.hls));
  await cmd({ type: 'SET_MODE', mode: 'auto' }).catch(() => undefined);
  // A39: lose the source for 10 s, then reconnect; observe states, single session, preserved recording
  const sessionBefore = (await api(`/api/v1/matches/${match.id}/streams`)).body.session.id;
  results.sourceLostAt = Date.now();
  ff.kill('SIGKILL');
  const seen = new Set();
  const lossAt = Date.now();
  while (Date.now() - lossAt < 10_000) {
    const s = (await api(`/api/v1/matches/${match.id}/streams`)).body;
    seen.add(`${s.session.state}${s.session.error?.code ? `:${s.session.error.code}` : ''}`);
    await sleep(1500);
  }
  ff = push();
  const recovered = await until('recovered LIVE', async () => {
    const s = (await api(`/api/v1/matches/${match.id}/streams`)).body;
    seen.add(`${s.session.state}${s.session.error?.code ? `:${s.session.error.code}` : ''}`);
    return s.session.state === 'LIVE' ? s : null;
  }, 90_000);
  results.sourceLoss = { statesObserved: [...seen], recoveredAfterSeconds: Math.round((Date.now() - lossAt) / 1000), sameSession: recovered.session.id === sessionBefore, outputStates: recovered.outputs.map((o) => [o.mode, o.session.state, o.recording.map((r) => r.state)]) };
  log('source loss', JSON.stringify(results.sourceLoss));
} finally {
  log('stopping');
  await api(`/api/v1/matches/${match.id}/session/stop`, { method: 'POST', json: {} }).catch((e) => log('stop failed', e.message));
  ff.kill('SIGTERM');
}
const stopped = await until('STOPPED', async () => {
  const s = (await api(`/api/v1/matches/${match.id}/streams`)).body;
  return ['STOPPED', 'FAILED'].includes(s.session?.state) ? s : null;
}, 120_000);
// ---- analysis of what the RTMP receiver recorded (before the deliberate source loss)
const sinkDir = path.resolve('.data/rtmp-sink/live');
const concatSink = (name, out) => {
  const dir = path.join(sinkDir, name);
  const parts = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).sort() : [];
  if (!parts.length) throw new Error(`receiver has no recording for ${name}`);
  const list = path.join(OUT, `${name}.txt`);
  fs.writeFileSync(list, parts.map((f) => `file '${path.join(dir, f)}'`).join('\n'));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  fs.rmSync(list);
  return { out, parts: parts.length };
};
const progFile = path.join(OUT, 'sink-programme.mp4');
const cleanFile = path.join(OUT, 'sink-clean.mp4');
results.receiverParts = { programme: concatSink(`prog${tag}`, progFile).parts, clean: concatSink(`clean${tag}`, cleanFile).parts };
const window = Math.max(5, Math.floor((results.sourceLostAt - results.liveObservedAt) / 1000));
results.analysisWindowSeconds = window;
// analysis: luma per second (the full-frame slate is dark; the test source is bright), audio level
const satOf = (file) => {
  const r = spawnSyncOut('ffmpeg', ['-hide_banner', '-ss', '0.5', '-t', String(window), '-i', file, '-vf', 'fps=1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-']);
  return [...r.matchAll(/YAVG=([\d.]+)/g)].map((m) => Math.round(Number(m[1])));
};
const vol = (file) => {
  const r = spawnSyncOut('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
  return Number(/max_volume: (-?[\d.]+) dB/.exec(r)?.[1] ?? NaN);
};
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]).toString()).streams.map((s) => `${s.codec_type}:${s.codec_name}${s.width ? `:${s.width}x${s.height}` : ''}`);
results.programme = { probe: probe(progFile), lumaPerSecond: satOf(progFile), maxVolumeDb: vol(progFile) };
results.clean = { probe: probe(cleanFile), lumaPerSecond: satOf(cleanFile), maxVolumeDb: vol(cleanFile) };
const p = results.programme.lumaPerSecond;
const c = results.clean.lumaPerSecond;
// dark full-frame slate (luma < 50) vs the bright test source; white marker flashes are > 200
results.programmeDarkSeconds = p.filter((y) => y < 50).length;
results.cleanDarkSeconds = c.filter((y) => y < 50).length;
for (const [t, f] of [[8, 'frame-programme-scorebug.png'], [17, 'frame-programme-slate.png']]) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', progFile, '-frames:v', '1', path.join(OUT, f)]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '17', '-i', cleanFile, '-frames:v', '1', path.join(OUT, 'frame-clean.png')]);

results.final = { session: stopped.session.state, recordings: stopped.outputs.map((o) => [o.mode, o.recording.map((r) => r.state)]) };
log(JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(OUT, 'smoke-results.json'), JSON.stringify(results, null, 2));
const checks = {
  live: results.secondsToLive > 0,
  hlsAuthorised: results.hls.playlist === 200 && results.hls.segment === 200 && results.hls.segmentBytes > 1000,
  hlsDenied: results.hls.anonymousSegment === 401 && results.hls.anonymousPlaylist === 401,
  programmeGraphicsChangedPixels: results.programmeDarkSeconds >= 5,
  cleanHasNoGraphics: results.cleanDarkSeconds === 0,
  audioInBoth: results.programme.maxVolumeDb > -30 && results.clean.maxVolumeDb > -30,
  recordingsReady: stopped.outputs.every((o) => o.recording.every((r) => ['READY', 'PARTIAL'].includes(r.state))),
  sourceLossDegradedThenRecovered: !!results.sourceLoss && results.sourceLoss.statesObserved.some((x) => x.startsWith('DEGRADED')) && results.sourceLoss.sameSession,
};
log('checks', JSON.stringify(checks));
fs.writeFileSync(path.join(OUT, 'smoke-checks.json'), JSON.stringify(checks, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);

function spawnSyncOut(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}
