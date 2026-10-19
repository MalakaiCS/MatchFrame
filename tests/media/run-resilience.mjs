// Resilience drills against the running stack.
//  A49: Redis down while a goal is scored → fact durable, no false "displayed", automation/realtime recover once.
//  A50: API + workers restarted during a live session → provider egress keeps running, state reconciles,
//       no duplicate egress, match/clock retained.
// Requires: stack started with `DEV_ONLY=api,worker,media node scripts/dev.mjs` (this script restarts it),
// web on :3000, media-test services, SMOKE_PASSWORD.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from '../../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { EgressClient } from '../../node_modules/.pnpm/livekit-server-sdk@2.19.1/node_modules/livekit-server-sdk/dist/index.js';

const BASE = 'http://localhost:3000';
const PASSWORD = process.env.SMOKE_PASSWORD;
const OUT = path.resolve('docs/evidence/m7');
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/\s+#.*$/, '')]));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync('docker', ['exec', 'broadcast-studio-postgres-1', 'psql', '-U', 'bs_owner', '-d', 'broadcast_studio', '-tAc', q]).toString().trim();
const compose = (...a) => execFileSync('docker', ['compose', '-f', 'infra/docker-compose.yml', '--env-file', '.env', ...a], { stdio: 'pipe' });
let cookie = '';
async function api(p, init = {}) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${BASE}${p}`, { ...init, signal: AbortSignal.timeout(20_000), headers: { ...(init.json ? { 'content-type': 'application/json' } : {}), origin: BASE, cookie }, body: init.json ? JSON.stringify(init.json) : undefined });
      const set = r.headers.getSetCookie?.() ?? [];
      if (set.length) cookie = [cookie, ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
      const text = await r.text();
      if (!r.ok) throw Object.assign(new Error(`${p} → ${r.status} ${text.slice(0, 200)}`), { status: r.status });
      return JSON.parse(text);
    } catch (e) {
      if (e.status || i >= 10) throw e;
      await sleep(2000); // API restarting
    }
  }
}
async function until(label, fn, ms = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
    await sleep(1000);
  }
}
const results = {};

const startStack = () => {
  spawn('node', ['scripts/dev.mjs'], { env: { ...process.env, DEV_ONLY: 'api,worker,media' }, stdio: ['ignore', fs.openSync('.data/logs/dev.log', 'a'), fs.openSync('.data/logs/dev.log', 'a')], detached: true });
};
const killStack = () => {
  // kill every api/worker/media-worker process (whoever started them), never other sessions' processes
  const pids = execFileSync('bash', ['-c', "ps -eo pid,args | grep -E 'scripts/dev.mjs|apps/(api|worker|media-worker)|tsx.*src/main.ts' | grep -v grep | awk '{print $1}'"]).toString().split('\n').filter(Boolean);
  for (const p of pids) try { process.kill(Number(p), 'SIGKILL'); } catch { /* gone */ }
  return pids.length;
};

await api('/api/auth/sign-in/email', { method: 'POST', json: { email: 'owner@studio.localhost', password: PASSWORD } });
const match = (await api('/api/v1/matches?pageSize=50')).items.find((m) => m.isDemo && m.sport === 'football');
const ov = match.overlays.find((o) => o.kind !== 'programme') ?? match.overlays[0];
const urls = await api(`/api/v1/overlays/${ov.id}/urls`);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const obs = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await obs.goto(urls.production);
await sleep(3000);
const goal = async () => {
  const lease = await api(`/api/v1/matches/${match.id}/scorer-lease`, { method: 'POST', json: { action: 'acquire', deviceId: 'resilience' } });
  const st = await api(`/api/v1/matches/${match.id}/state`);
  return api(`/api/v1/matches/${match.id}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'resilience', type: 'ADD_FACT', payload: { type: 'goal', side: 'home', occurredAt: Date.now(), payload: {} } } });
};
await api(`/api/v1/overlays/${ov.id}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), command: { type: 'SET_MODE', mode: 'auto' } } }).catch(() => undefined);

// ---------------- A49
log('A49: stopping Redis');
const before = await api(`/api/v1/overlays/${ov.id}`);
compose('stop', 'redis');
await sleep(2000);
const g = await goal();
results.a49 = { factAcceptedWhileRedisDown: !!g.event?.eventId, factId: g.event.eventId };
await sleep(8000);
const during = await api(`/api/v1/overlays/${ov.id}`);
results.a49.outboxPendingDuringOutage = Number(psql("select count(*) from outbox_events where state='pending'"));
results.a49.displayedBefore = before.displayedRevision;
results.a49.duringRevision = during.state.revision;
results.a49.duringDisplayed = during.displayedRevision;
results.a49.goalGraphicOnOutputDuringOutage = await obs.locator('[data-graphic$="goal"]').count();
log('A49 during', JSON.stringify(results.a49));
compose('start', 'redis');
const recovered = await until('outbox drained & displayed', async () => {
  const pending = Number(psql("select count(*) from outbox_events where state='pending'"));
  const d = await api(`/api/v1/overlays/${ov.id}`);
  return pending === 0 && d.displayedRevision >= d.state.revision ? d : null;
}, 120_000);
results.a49.recoveredDisplayed = recovered.displayedRevision;
results.a49.goalRuns = Number(psql(`select count(*) from automation_runs where source_fact_id = '${g.event.eventId}' and playlist_id = 'goal'`));
results.a49.dead = Number(psql("select count(*) from outbox_events where state='dead'"));
log('A49 after', JSON.stringify(results.a49));

// ---------------- A50
const streams = await api(`/api/v1/matches/${match.id}/streams`);
const prog = streams.outputs.find((o) => o.mode === 'PROGRAMME');
const key = await api(`/api/v1/inputs/${prog.inputId}/reveal`, { method: 'POST' });
const startR = await api(`/api/v1/matches/${match.id}/session/start`, { method: 'POST', json: { outputIds: [prog.id] } });
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', 'tests/media/fixtures/test-source-720p30.mp4', '-c', 'copy', '-f', 'flv', `${key.serverUrl}/${key.streamKey}`], { stdio: 'inherit' });
const egress = new EgressClient(env.INTERNAL_LIVEKIT_HTTP, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
const room = `bs_${startR.sessionId}`;
const activeEgress = async () => (await egress.listEgress({ roomName: room })).filter((e) => e.status === 1 || e.status === 0).map((e) => e.egressId);
try {
  await until('LIVE', async () => (await api(`/api/v1/matches/${match.id}/streams`)).outputs.find((o) => o.id === prog.id)?.session?.state === 'LIVE', 150_000);
  const stBefore = await api(`/api/v1/matches/${match.id}/state`);
  const egBefore = await activeEgress();
  log('A50 live; egress', egBefore);
  const killed = killStack();
  log('A50 killed', killed, 'processes');
  await sleep(15_000);
  const egDuring = await activeEgress(); // provider keeps streaming without our control plane
  startStack();
  await until('API back', async () => (await fetch(`${BASE}/api/v1/time`)).ok, 90_000);
  await sleep(20_000); // reconcile loop + orphan check
  const after = await api(`/api/v1/matches/${match.id}/streams`);
  const stAfter = await api(`/api/v1/matches/${match.id}/state`);
  const egAfter = await activeEgress();
  results.a50 = {
    egressBefore: egBefore,
    egressWhileControlPlaneDown: egDuring,
    egressAfter: egAfter,
    sessionStateAfter: after.session.state,
    outputStateAfter: after.outputs.find((o) => o.id === prog.id).session.state,
    sameSession: after.session.id === startR.sessionId,
    stateVersionKept: stAfter.stateVersion >= stBefore.stateVersion,
    clockRunningKept: stAfter.clocks.main?.running === stBefore.clocks.main?.running,
    scoreKept: JSON.stringify(stAfter.projection.score) === JSON.stringify(stBefore.projection.score),
  };
  log('A50', JSON.stringify(results.a50));
} finally {
  await api(`/api/v1/matches/${match.id}/session/stop`, { method: 'POST' }).catch((e) => log('stop', e.message));
  ff.kill('SIGKILL');
  await browser.close();
}
await until('STOPPED', async () => ['STOPPED', 'FAILED'].includes((await api(`/api/v1/matches/${match.id}/streams`)).session?.state), 120_000);
const checks = {
  a49FactDurable: results.a49.factAcceptedWhileRedisDown,
  a49NoFalseDisplayed: results.a49.duringDisplayed < results.a49.duringRevision || results.a49.duringRevision === results.a49.displayedBefore,
  a49Recovered: results.a49.recoveredDisplayed >= results.a49.duringRevision && results.a49.dead === 0,
  a49AutomationOnce: results.a49.goalRuns === 1,
  a50EgressSurvived: results.a50.egressWhileControlPlaneDown.length === 1 && results.a50.egressWhileControlPlaneDown[0] === results.a50.egressBefore[0],
  a50NoDuplicateEgress: results.a50.egressAfter.length === 1 && results.a50.egressAfter[0] === results.a50.egressBefore[0],
  a50Reconciled: results.a50.sameSession && ['LIVE', 'DEGRADED'].includes(results.a50.sessionStateAfter) && results.a50.outputStateAfter === 'LIVE',
  a50MatchStateKept: results.a50.stateVersionKept && results.a50.clockRunningKept && results.a50.scoreKept,
};
fs.writeFileSync(path.join(OUT, 'resilience.json'), JSON.stringify({ results, checks }, null, 2));
log(JSON.stringify(checks));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
