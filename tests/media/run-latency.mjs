// §22 latency measurements against the running stack (no media needed):
//  * scoring command: client-observed round trip at 10 commands/s across 5 matches for 60 s
//  * operator take → output renderer acknowledgement (renderer.revision.displayed) for 60 takes
//  * data → overlay: scoring commit → production renderer displays the new score (DOM observed)
// Results: docs/evidence/m7/latency.json. Same-host measurements (no WAN), stated as such.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../node_modules/.pnpm/node_modules/playwright-core/index.mjs';

const BASE = 'http://localhost:3000';
const PASSWORD = process.env.SMOKE_PASSWORD;
const OUT = path.resolve('docs/evidence/m7');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync('docker', ['exec', 'broadcast-studio-postgres-1', 'psql', '-U', 'bs_owner', '-d', 'broadcast_studio', '-tAc', q]).toString().trim();
let cookie = '';
async function api(p, init = {}) {
  const r = await fetch(`${BASE}${p}`, { ...init, headers: { ...(init.json ? { 'content-type': 'application/json' } : {}), origin: BASE, cookie }, body: init.json ? JSON.stringify(init.json) : undefined });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = [cookie, ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
  const text = await r.text();
  if (!r.ok) throw new Error(`${p} → ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};
const summary = (xs) => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: Math.round(Math.max(...xs)) });

await api('/api/auth/sign-in/email', { method: 'POST', json: { email: 'owner@studio.localhost', password: PASSWORD } });
const items = (await api('/api/v1/matches?pageSize=100')).items.filter((m) => m.sport === 'football' && !m.isDemo && ['scheduled', 'live'].includes(m.status)).slice(0, 5);
// each match: own scorer lease + play phase (synthetic, labelled latency test fixtures are ordinary matches here)
const ctxs = [];
for (const m of items) {
  const lease = await api(`/api/v1/matches/${m.id}/scorer-lease`, { method: 'POST', json: { action: 'acquire', deviceId: `lat-${m.id.slice(0, 4)}` } });
  const st = await api(`/api/v1/matches/${m.id}/state`);
  ctxs.push({ m, lease, version: st.stateVersion, device: `lat-${m.id.slice(0, 4)}` });
  if (st.phase === 'scheduled') {
    const r = await api(`/api/v1/matches/${m.id}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: ctxs.at(-1).device, type: 'SET_PHASE', payload: { to: 'first_half' } } });
    ctxs.at(-1).version = r.state.stateVersion;
  }
}

// 1. scoring commands at 10/s for 60 s (round-robin across matches; corners don't change the score)
const cmdMs = [];
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < 60_000) {
  const c = ctxs[i++ % ctxs.length];
  const start = performance.now();
  const r = await api(`/api/v1/matches/${c.m.id}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), expectedStateVersion: c.version, scorerLeaseVersion: c.lease.leaseVersion, deviceId: c.device, type: 'ADD_FACT', payload: { type: 'corner', side: i % 2 ? 'home' : 'away', occurredAt: Date.now(), payload: {} } } });
  cmdMs.push(performance.now() - start);
  c.version = r.state.stateVersion;
  if (i % 20 === 0) for (const x of ctxs) await api(`/api/v1/matches/${x.m.id}/scorer-lease`, { method: 'POST', json: { action: 'renew', deviceId: x.device, leaseVersion: x.lease.leaseVersion } }).then((l) => (x.lease = l)).catch(() => undefined);
  const wait = t0 + i * 100 - Date.now();
  if (wait > 0) await sleep(wait);
}

// 2 + 3. a production renderer on a fresh overlay of the first match
const target = ctxs[0];
const ov = await api(`/api/v1/matches/${target.m.id}/overlays`, { method: 'POST', json: { name: `Latency ${crypto.randomUUID().slice(0, 4)}` } });
const urls = await api(`/api/v1/overlays/${ov.id}/urls`);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.goto(urls.production);
await sleep(3000);
await api(`/api/v1/overlays/${ov.id}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), command: { type: 'SET_MODE', mode: 'manual' } } });
await api(`/api/v1/overlays/${ov.id}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), command: { type: 'SHOW_SCOREBUG' } } });
await page.waitForSelector('[data-graphic="scorebug"]');
const takeMs = [];
for (let k = 0; k < 60; k++) {
  const start = Date.now();
  const r = await api(`/api/v1/overlays/${ov.id}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), command: k % 2 ? { type: 'TAKE_OUT', layer: 'lower' } : { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: `Take ${k}` } } } });
  // wait for the renderer's displayed acknowledgement of this revision
  for (let w = 0; w < 400; w++) {
    const d = await api(`/api/v1/overlays/${ov.id}`);
    if (d.displayedRevision >= r.revision) {
      takeMs.push(Date.now() - start);
      break;
    }
    await sleep(5);
  }
  await sleep(150);
}
// data → overlay: score change committed → scorebug text changes in the renderer DOM
const propMs = [];
await page.exposeFunction('seen', () => undefined);
for (let k = 0; k < 20; k++) {
  const before = await page.locator('[data-graphic="scorebug"]').textContent();
  const start = Date.now();
  const r = await api(`/api/v1/matches/${target.m.id}/commands`, { method: 'POST', json: { commandId: crypto.randomUUID(), expectedStateVersion: target.version, scorerLeaseVersion: target.lease.leaseVersion, deviceId: target.device, type: 'ADD_FACT', payload: { type: 'goal', side: 'home', occurredAt: Date.now(), payload: {} } } });
  const committed = Date.now();
  target.version = r.state.stateVersion;
  await page.waitForFunction((b) => document.querySelector('[data-graphic="scorebug"]')?.textContent !== b, before, { timeout: 10_000, polling: 'raf' });
  propMs.push(Date.now() - committed);
  void start;
  await sleep(300);
}
await browser.close();
const result = {
  host: '4 vCPU / 15 GiB cloud container; client, API, DB and renderer on the same host (no WAN)',
  scoringCommandRoundTripMs: { ...summary(cmdMs), ratePerSecond: Math.round((cmdMs.length / 60) * 10) / 10, matches: ctxs.length },
  operatorTakeToRendererAckMs: summary(takeMs),
  commitToOverlayDisplayMs: summary(propMs),
  outboxLagAfter: psql("select count(*) from outbox_events where state='pending'"),
};
fs.writeFileSync(path.join(OUT, 'latency.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
