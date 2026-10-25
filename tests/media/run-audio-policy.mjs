// A38: sponsor video audio policies measured on the recorded programme, not on browser controls.
// Source: 1 kHz beep (100 ms) at every second. Sponsor video: continuous 3 kHz tone.
//   replace → 1 kHz silent, 3 kHz present | duck → 1 kHz ≈ −14 dB, 3 kHz present
//   muted   → 1 kHz unchanged, 3 kHz absent | interrupted replace → 1 kHz back at full level afterwards
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const PASSWORD = process.env.SMOKE_PASSWORD;
const OUT = path.resolve('docs/evidence/m5');
const SOURCE = path.resolve('tests/media/fixtures/test-source-720p30.mp4');
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/\s+#.*$/, '')]));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
async function api(p, init = {}) {
  const r = await fetch(`${BASE}${p}`, { ...init, signal: AbortSignal.timeout(30_000), headers: { ...(init.json ? { 'content-type': 'application/json' } : {}), origin: BASE, cookie }, body: init.json ? JSON.stringify(init.json) : undefined });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = [cookie, ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${p} → ${r.status} ${text.slice(0, 300)}`);
  return body;
}
async function until(label, fn, ms = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
    await sleep(1500);
  }
}

await api('/api/auth/sign-in/email', { method: 'POST', json: { email: 'owner@studio.localhost', password: PASSWORD } });
// sponsor video creative: 8 s, 3 kHz tone, magenta frame
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-a38-'));
const vid = path.join(tmp, 'sponsor.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xC0208A:s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=frequency=3000:sample_rate=48000', '-t', '8', '-af', 'volume=0.6', '-ac', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid]);
const bytes = fs.statSync(vid).size;
const up = await api('/api/v1/assets/uploads', { method: 'POST', json: { name: 'A38 sponsor video', kind: 'video', mime: 'video/mp4', bytes } });
await fetch(up.uploadUrl, { method: 'PUT', headers: up.headers, body: fs.readFileSync(vid) });
await api(`/api/v1/assets/${up.assetId}/complete`, { method: 'POST' });
await until('asset READY', async () => (await api('/api/v1/assets?kind=video')).find((a) => a.id === up.assetId && a.state === 'READY'));
const brand = await api('/api/v1/brands', { method: 'POST', json: { name: `A38 Audio ${crypto.randomUUID().slice(0, 4)}` } });
const cr = await api('/api/v1/creatives', { method: 'POST', json: { creativeSetId: brand.creativeSetId, assetId: up.assetId, name: 'A38 video' } });
await api(`/api/v1/creatives/${cr.id}/approval`, { method: 'POST', json: { status: 'approved' } });
log('creative', cr.id);

const match = (await api('/api/v1/matches?pageSize=50')).items.find((m) => m.isDemo && m.sport === 'football');
const streams = await api(`/api/v1/matches/${match.id}/streams`);
const prog = streams.outputs.find((o) => o.mode === 'PROGRAMME');
for (const d of prog.destinations) await api(`/api/v1/destinations/${d.id}`, { method: 'DELETE' });
const tag = `audio${crypto.randomUUID().slice(0, 6)}`;
await api(`/api/v1/outputs/${prog.id}/destinations`, { method: 'POST', json: { name: 'Sink', serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: `${tag}?user=publisher&pass=${env.RTMP_SINK_PASSWORD}` } });
const key = await api(`/api/v1/inputs/${prog.inputId}/reveal`, { method: 'POST' });
await api(`/api/v1/matches/${match.id}/session/start`, { method: 'POST', json: { outputIds: [prog.id] } });
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', SOURCE, '-c', 'copy', '-f', 'flv', `${key.serverUrl}/${key.streamKey}`], { stdio: 'inherit' });
const marks = {};
try {
  await until('LIVE', async () => (await api(`/api/v1/matches/${match.id}/streams`)).outputs.find((o) => o.id === prog.id)?.session?.state === 'LIVE', 150_000);
  marks.live = Date.now();
  const cmd = (command) => api(`/api/v1/overlays/${prog.overlayId}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), command } });
  await cmd({ type: 'SET_MODE', mode: 'manual' });
  await cmd({ type: 'CLEAR_LAYER', layer: 'background' });
  await sleep(8000);
  for (const policy of ['replace', 'duck', 'muted']) {
    marks[policy] = Date.now();
    await cmd({ type: 'TAKE_IN', templateKey: 'builtin:full_frame_media', variables: { creative: cr.id, audio: policy, fit: 'contain' }, durationMs: 6000 });
    await sleep(10_000);
  }
  marks.interrupt = Date.now();
  await cmd({ type: 'TAKE_IN', templateKey: 'builtin:full_frame_media', variables: { creative: cr.id, audio: 'replace', fit: 'contain' }, durationMs: 6000 });
  await sleep(2500);
  await cmd({ type: 'CLEAR_LAYER', layer: 'fullframe' });
  marks.interruptedAt = Date.now();
  await sleep(8000);
  await cmd({ type: 'SET_MODE', mode: 'auto' });
} finally {
  await api(`/api/v1/matches/${match.id}/session/stop`, { method: 'POST' }).catch(() => undefined);
  ff.kill('SIGKILL');
}
await until('STOPPED', async () => ['STOPPED', 'FAILED'].includes((await api(`/api/v1/matches/${match.id}/streams`)).session?.state), 120_000);

// ---- analysis of the receiver's recording
const dir = path.resolve('.data/rtmp-sink/live', tag);
const parts = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).sort();
const list = path.join(tmp, 'l.txt');
fs.writeFileSync(list, parts.map((f) => `file '${path.join(dir, f)}'`).join('\n'));
const rec = path.join(OUT, 'a38-programme.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', rec]);
const pcm = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', rec, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 512 * 1024 * 1024 }).stdout;
const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
const SR = 48000;
const goertzel = (from, n, f) => {
  const k = (2 * Math.PI * f) / SR;
  const c = 2 * Math.cos(k);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = samples[from + i] / 32768 + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / (n / 2);
};
const db = (x) => Math.round(20 * Math.log10(Math.max(x, 1e-6)) * 10) / 10;
// per second: max 1 kHz in 20 ms windows (catches the 100 ms beep), mean 3 kHz
const secs = [];
for (let s = 0; (s + 1) * SR <= samples.length; s++) {
  let k1 = 0, k3 = 0, n3 = 0;
  for (let w = 0; w < 50; w++) {
    const from = s * SR + w * 960;
    k1 = Math.max(k1, goertzel(from, 960, 1000));
    k3 += goertzel(from, 960, 3000);
    n3++;
  }
  secs.push({ s, k1: db(k1), k3: db(k3 / n3) });
}
// align: the first second with strong 3 kHz is the start of the replace cue
const firstTone = secs.find((x) => x.k3 > -30);
if (!firstTone) throw new Error('sponsor tone never appeared in the programme audio');
const t0 = firstTone.s;
const at = (mark) => t0 + Math.round((marks[mark] - marks.replace) / 1000);
const win = (a, b) => secs.filter((x) => x.s >= a && x.s < b);
const avg = (xs, k) => Math.round((xs.reduce((n, x) => n + x[k], 0) / xs.length) * 10) / 10;
const baseline = win(t0 - 7, t0 - 1);
const phase = (start) => win(start + 1, start + 5); // inside the 6 s cue, away from edges
const result = {
  baseline: { k1: avg(baseline, 'k1'), k3: avg(baseline, 'k3') },
  replace: { k1: avg(phase(at('replace')), 'k1'), k3: avg(phase(at('replace')), 'k3') },
  duck: { k1: avg(phase(at('duck')), 'k1'), k3: avg(phase(at('duck')), 'k3') },
  muted: { k1: avg(phase(at('muted')), 'k1'), k3: avg(phase(at('muted')), 'k3') },
  afterInterruption: { k1: avg(win(at('interruptedAt') + 2, at('interruptedAt') + 7), 'k1'), k3: avg(win(at('interruptedAt') + 2, at('interruptedAt') + 7), 'k3') },
};
const checks = {
  replaceSilencesSource: result.replace.k1 < result.baseline.k1 - 25 && result.replace.k3 > -30,
  duckLowersSource: result.duck.k1 < result.baseline.k1 - 8 && result.duck.k1 > result.baseline.k1 - 22 && result.duck.k3 > -30,
  mutedKeepsSource: Math.abs(result.muted.k1 - result.baseline.k1) < 3 && result.muted.k3 < -40,
  gainRestoredAfterInterruption: Math.abs(result.afterInterruption.k1 - result.baseline.k1) < 3 && result.afterInterruption.k3 < -40,
};
fs.writeFileSync(path.join(OUT, 'a38-audio-policy.json'), JSON.stringify({ marksRelativeS: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, (v - marks.replace) / 1000])), alignSecond: t0, result, checks, perSecond: secs }, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });
log(JSON.stringify({ result, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
