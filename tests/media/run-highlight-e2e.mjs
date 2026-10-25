// Live highlight end to end through the running app (A43, A44, A46): real RTMP source → LiveKit programme →
// goal scored → highlight clip cut from the live HLS while the match is still live → 9:16 export →
// share link plays → revoked link stops serving bytes. Evidence in docs/evidence/m6/.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL ?? 'owner@studio.localhost';
const PASSWORD = process.env.SMOKE_PASSWORD;
const OUT = path.resolve('docs/evidence/m6');
const SOURCE = path.resolve('tests/media/fixtures/test-source-720p30.mp4');
if (!PASSWORD) throw new Error('Set SMOKE_PASSWORD');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
async function api(p, init = {}) {
  const r = await fetch(`${BASE}${p}`, { ...init, signal: AbortSignal.timeout(30_000), headers: { ...(init.json ? { 'content-type': 'application/json' } : {}), origin: BASE, cookie, ...(init.headers ?? {}) }, body: init.json ? JSON.stringify(init.json) : undefined });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = [cookie, ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok && !init.allowFail) throw new Error(`${init.method ?? 'GET'} ${p} → ${r.status} ${text.slice(0, 300)}`);
  return { status: r.status, body };
}
async function until(label, fn, timeoutMs = 120_000, every = 1500) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(every);
  }
}

const results = {};
await api('/api/auth/sign-in/email', { method: 'POST', json: { email: EMAIL, password: PASSWORD } });
const match = (await api('/api/v1/matches?pageSize=50')).body.items.find((m) => m.isDemo && m.sport === 'football');
const streams = (await api(`/api/v1/matches/${match.id}/streams`)).body;
let prog = streams.outputs.find((o) => o.mode === 'PROGRAMME');
let inputId = prog?.inputId;
if (!inputId) inputId = (await api('/api/v1/inputs', { method: 'POST', json: { name: 'Highlight cam' } })).body.id;
prog = (await api(`/api/v1/matches/${match.id}/outputs`, { method: 'PUT', json: { mode: 'PROGRAMME', inputId, preset: '720p30' } })).body;
const key = (await api(`/api/v1/inputs/${inputId}/reveal`, { method: 'POST' })).body;
const start = (await api(`/api/v1/matches/${match.id}/session/start`, { method: 'POST', json: { outputIds: [prog.id] } })).body;
log('session', start.sessionId);
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', SOURCE, '-c', 'copy', '-f', 'flv', `${key.serverUrl}/${key.streamKey}`], { stdio: 'inherit' });
try {
  await until('LIVE', async () => (await api(`/api/v1/matches/${match.id}/streams`)).body.outputs.find((o) => o.id === prog.id)?.session?.state === 'LIVE', 150_000);
  log('LIVE');
  await sleep(20_000); // pre-roll media must exist before the event
  const lease = (await api(`/api/v1/matches/${match.id}/scorer-lease`, { method: 'POST', json: { action: 'acquire', deviceId: 'e2e-hl' } })).body;
  const st = (await api(`/api/v1/matches/${match.id}/state`)).body;
  const goalAt = Date.now();
  const g = (await api(`/api/v1/matches/${match.id}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'e2e-hl', type: 'ADD_FACT', payload: { type: 'goal', side: 'home', occurredAt: goalAt, payload: {} } } })).body;
  log('goal', g.event.eventId);
  const clip = await until('highlight clip READY', async () => {
    const cs = (await api(`/api/v1/clips?matchId=${match.id}`)).body;
    const hs = (await api(`/api/v1/matches/${match.id}/highlights`)).body;
    const h = hs.find((x) => x.factId === g.event.eventId && x.outputId === prog.id);
    if (h && ['FAILED', 'NEEDS_ALIGNMENT', 'STALE'].includes(h.state)) throw new Error(`highlight ${h.state}: ${h.reason}`);
    return h?.clipId ? cs.find((c) => c.id === h.clipId && c.state === 'READY') : null;
  }, 180_000, 1000);
  results.goalToClipReadySeconds = Math.round((Date.now() - goalAt) / 100) / 10;
  const sessionStillLive = (await api(`/api/v1/matches/${match.id}/streams`)).body.outputs.find((o) => o.id === prog.id).session.state;
  results.sessionStateWhenClipReady = sessionStillLive;
  log('clip ready after', results.goalToClipReadySeconds, 's; session', sessionStillLive);
  const clipFile = path.join(OUT, 'live-highlight.mp4');
  fs.writeFileSync(clipFile, Buffer.from(await (await fetch(`${BASE}${clip.mediaUrl}`, { headers: { cookie } })).arrayBuffer()));
  const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f]).toString());
  const pc = probe(clipFile);
  results.clip = { durationS: Number(pc.format.duration), streams: pc.streams.map((s) => `${s.codec_type}:${s.codec_name}${s.width ? `:${s.width}x${s.height}` : ''}`), inMs: clip.inMs, outMs: clip.outMs };
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '12', '-i', clipFile, '-frames:v', '1', path.join(OUT, 'live-highlight-at-event.png')]);
  // vertical export
  const ex = (await api(`/api/v1/clips/${clip.id}/exports`, { method: 'POST', json: { aspect: '9:16', trimInMs: 4000, trimOutMs: 18_000, focusX: 0.5 } })).body;
  const done = await until('export', async () => {
    const j = (await api('/api/v1/exports')).body.find((x) => x.id === ex.id);
    if (j?.state === 'FAILED') throw new Error(j.error);
    return j?.state === 'COMPLETED' ? j : null;
  }, 180_000);
  const exFile = path.join(OUT, 'export-9x16.mp4');
  fs.writeFileSync(exFile, Buffer.from(await (await fetch(`${BASE}${done.downloadUrl}`, { headers: { cookie } })).arrayBuffer()));
  const pe = probe(exFile);
  results.export = { durationS: Number(pe.format.duration), streams: pe.streams.map((s) => `${s.codec_type}:${s.codec_name}${s.width ? `:${s.width}x${s.height}` : ''}`) };
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '8', '-i', exFile, '-frames:v', '1', '-vf', 'scale=270:-2', path.join(OUT, 'export-9x16-frame.png')]);
  // share: works, then revoked link refuses metadata and media bytes
  const sh = (await api('/api/v1/shares', { method: 'POST', json: { resourceType: 'clip', resourceId: clip.id, expiresInHours: 1 } })).body;
  const u = new URL(sh.watchUrl);
  const t = u.searchParams.get('t');
  const meta = await fetch(`${BASE}/api/v1/public/share/${sh.publicId}`, { headers: { 'x-share-token': t } });
  const bytes = await fetch(`${BASE}/api/v1/public/share/${sh.publicId}/media?t=${t}`, { headers: { range: 'bytes=0-1023' } });
  const wrong = await fetch(`${BASE}/api/v1/public/share/${sh.publicId}/media?t=nope`);
  const page = await fetch(`${BASE}/watch/${sh.publicId}`);
  await api(`/api/v1/shares/${sh.id}/revoke`, { method: 'POST' });
  const afterMeta = await fetch(`${BASE}/api/v1/public/share/${sh.publicId}`, { headers: { 'x-share-token': t } });
  const afterBytes = await fetch(`${BASE}/api/v1/public/share/${sh.publicId}/media?t=${t}`, { headers: { range: 'bytes=0-1023' } });
  results.share = { meta: meta.status, rangeBytes: bytes.status, wrongToken: wrong.status, watchPage: page.status, revokedMeta: afterMeta.status, revokedBytes: afterBytes.status };
  log('share', JSON.stringify(results.share));
} finally {
  await api(`/api/v1/matches/${match.id}/session/stop`, { method: 'POST' }).catch((e) => log('stop failed', e.message));
  ff.kill('SIGKILL');
}
await until('STOPPED', async () => ['STOPPED', 'FAILED'].includes((await api(`/api/v1/matches/${match.id}/streams`)).body.session?.state), 120_000);
const checks = {
  clipWhileLive: ['LIVE', 'DEGRADED'].includes(results.sessionStateWhenClipReady),
  clipDuration: results.clip.durationS > 19 && results.clip.durationS < 21,
  clipAv: results.clip.streams.includes('video:h264:1280x720') && results.clip.streams.includes('audio:aac'),
  vertical: results.export.streams.includes('video:h264:1080x1920') && results.export.streams.includes('audio:aac') && Math.abs(results.export.durationS - 14) < 0.6,
  shareWorks: results.share.meta === 200 && results.share.rangeBytes === 206 && results.share.watchPage === 200,
  shareDenied: results.share.wrongToken === 404 && results.share.revokedMeta === 410 && results.share.revokedBytes === 410,
};
results.checks = checks;
fs.writeFileSync(path.join(OUT, 'highlight-results.json'), JSON.stringify(results, null, 2));
log(JSON.stringify(results, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
