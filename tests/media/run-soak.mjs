// A51 soak: two concurrent 720p30 programme sessions for SOAK_MINUTES (default 30) on this host.
// Samples session/output states, container CPU and load every 30 s; afterwards measures A/V skew
// (flash/beep markers) at the start, middle and end of each receiver recording. Evidence: docs/evidence/m7.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'http://localhost:3000';
const PASSWORD = process.env.SMOKE_PASSWORD;
const MINUTES = Number(process.env.SOAK_MINUTES ?? 30);
const OUT = path.resolve('docs/evidence/m7');
const SOURCE = path.resolve('tests/media/fixtures/test-source-720p30.mp4');
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/\s+#.*$/, '')]));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
async function api(p, init = {}) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${BASE}${p}`, { ...init, signal: AbortSignal.timeout(30_000), headers: { ...(init.json ? { 'content-type': 'application/json' } : {}), origin: BASE, cookie }, body: init.json ? JSON.stringify(init.json) : undefined });
      const set = r.headers.getSetCookie?.() ?? [];
      if (set.length) cookie = [cookie, ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
      const text = await r.text();
      if (!r.ok) throw Object.assign(new Error(`${p} → ${r.status} ${text.slice(0, 200)}`), { status: r.status });
      return JSON.parse(text);
    } catch (e) {
      if (e.status || i >= 5) throw e;
      await sleep(3000);
    }
  }
}
async function until(label, fn, ms) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
    await sleep(2000);
  }
}

await api('/api/auth/sign-in/email', { method: 'POST', json: { email: 'owner@studio.localhost', password: PASSWORD } });
const items = (await api('/api/v1/matches?pageSize=100')).items;
const ms = [items.find((m) => m.isDemo && m.sport === 'football'), items.find((m) => m.isDemo && m.sport === 'basketball')];
const tag = crypto.randomUUID().slice(0, 6);
const sessions = [];
for (const [i, m] of ms.entries()) {
  let prog = (await api(`/api/v1/matches/${m.id}/streams`)).outputs.find((o) => o.mode === 'PROGRAMME');
  let inputId = prog?.inputId;
  if (!inputId) inputId = (await api('/api/v1/inputs', { method: 'POST', json: { name: `Soak cam ${i + 1}` } })).id;
  prog = await api(`/api/v1/matches/${m.id}/outputs`, { method: 'PUT', json: { mode: 'PROGRAMME', inputId, preset: '720p30', hls: true, record: true } });
  for (const d of (await api(`/api/v1/matches/${m.id}/streams`)).outputs.find((o) => o.id === prog.id).destinations) await api(`/api/v1/destinations/${d.id}`, { method: 'DELETE' });
  const sink = `soak${tag}${i}`;
  await api(`/api/v1/outputs/${prog.id}/destinations`, { method: 'POST', json: { name: 'Sink', serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: `${sink}?user=publisher&pass=${env.RTMP_SINK_PASSWORD}` } });
  const key = await api(`/api/v1/inputs/${inputId}/reveal`, { method: 'POST' });
  sessions.push({ match: m, prog, key, sink });
}
for (const s of sessions) s.start = await api(`/api/v1/matches/${s.match.id}/session/start`, { method: 'POST', json: { outputIds: [s.prog.id] } });
const pushes = sessions.map((s) => spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', SOURCE, '-c', 'copy', '-f', 'flv', `${s.key.serverUrl}/${s.key.streamKey}`], { stdio: 'inherit' }));
const samples = [];
const transitions = [[], []];
try {
  for (const [i, s] of sessions.entries()) await until(`session ${i} LIVE`, async () => (await api(`/api/v1/matches/${s.match.id}/streams`)).outputs.find((o) => o.id === s.prog.id)?.session?.state === 'LIVE', 180_000);
  const liveAt = Date.now();
  log(`both LIVE; soaking ${MINUTES} min`);
  while (Date.now() - liveAt < MINUTES * 60_000) {
    await sleep(30_000);
    const states = [];
    for (const [i, s] of sessions.entries()) {
      const st = await api(`/api/v1/matches/${s.match.id}/streams`).catch(() => null);
      const o = st?.outputs.find((x) => x.id === s.prog.id);
      const v = `${st?.session?.state}/${o?.session?.state}/${o?.destinations?.[0]?.lastStatus?.status}`;
      if (transitions[i].at(-1)?.v !== v) transitions[i].push({ t: Math.round((Date.now() - liveAt) / 1000), v });
      states.push(v);
    }
    const stats = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}} {{.MemUsage}}']).toString().split('\n').filter((l) => /egress|ingress|livekit/.test(l)).map((l) => l.replace('broadcast-studio-', ''));
    samples.push({ t: Math.round((Date.now() - liveAt) / 1000), load1: os.loadavg()[0], memFreeMb: Math.round(os.freemem() / 1048576), states, stats });
    log(`t+${samples.at(-1).t}s load ${samples.at(-1).load1.toFixed(1)} ${states.join(' | ')} ${stats.join(' ; ')}`);
  }
} finally {
  for (const s of sessions) await api(`/api/v1/matches/${s.match.id}/session/stop`, { method: 'POST' }).catch(() => undefined);
  for (const p of pushes) p.kill('SIGKILL');
}
for (const s of sessions) await until('stopped', async () => ['STOPPED', 'FAILED'].includes((await api(`/api/v1/matches/${s.match.id}/streams`)).session?.state), 180_000);

// A/V skew on the receiver recordings: 60 s excerpts at start, middle and end
const analysis = [];
for (const s of sessions) {
  const dir = path.resolve('.data/rtmp-sink/live', s.sink);
  const parts = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).sort();
  const list = path.join(os.tmpdir(), `${s.sink}.txt`);
  fs.writeFileSync(list, parts.map((f) => `file '${path.join(dir, f)}'`).join('\n'));
  const full = path.join(os.tmpdir(), `${s.sink}.mp4`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', full]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', full]).toString());
  const marks = [];
  for (const [label, at] of [['start', 30], ['middle', dur / 2], ['end', Math.max(30, dur - 90)]]) {
    const ex = path.join(os.tmpdir(), `${s.sink}-${label}.mp4`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', full, '-t', '60', '-c', 'copy', ex]);
    const r = JSON.parse(execFileSync('python3', ['tests/media/analyze_markers.py', ex]).toString());
    marks.push({ label, atS: Math.round(at), flashes: r.videoFlashes, beeps: r.audioBeeps, pairs: r.pairs, skew: r.avSkewMs ?? null, driftMs: r.driftMs ?? null });
    fs.rmSync(ex);
  }
  analysis.push({ match: s.match.sport, receiverParts: parts.length, recordedSeconds: Math.round(dur), expectedSeconds: MINUTES * 60, markers: marks });
  fs.rmSync(full);
}
const result = { minutes: MINUTES, host: { cpus: os.cpus().length, memGb: Math.round(os.totalmem() / 1073741824) }, transitions, samples, analysis };
fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(result, null, 2));
log(JSON.stringify({ transitions, analysis }, null, 2));
