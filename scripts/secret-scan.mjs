#!/usr/bin/env node
// A53: look for secret values where they must never appear — client bundles, list/socket payloads, logs,
// audit export. Reads the real values from .env and the database (stream/destination keys decrypted only
// in memory here), then searches. Prints locations, never the secrets themselves.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/\s+#.*$/, '')]));
const SECRET_KEYS = Object.keys(env).filter((k) => /SECRET|PASSWORD|KEY|TOKEN/.test(k) && !/^LIVEKIT_API_KEY$|S3_ACCESS_KEY|PUBLIC_/.test(k) && env[k].length >= 12);
const secrets = SECRET_KEYS.map((k) => ({ name: k, value: env[k] }));
// stream keys of inputs and destinations, decrypted via the services package (in-process only)
const extra = JSON.parse(execFileSync('npx', ['tsx', '-e', `
  import { loadDotEnv, getConfig } from '@bs/config'; import { createDb, inputs, destinations } from '@bs/db'; import { decryptSecret } from '@bs/services';
  (async () => { loadDotEnv(); const c = getConfig(); const { db, pool } = createDb(c.DATABASE_WORKER_URL);
  const ins = await db.select().from(inputs); const ds = await db.select().from(destinations);
  const out = [...ins.filter((i) => i.streamKeyEnc).map((i) => ({ name: 'input:' + i.id.slice(0, 8), value: decryptSecret(i.streamKeyEnc, c.ENCRYPTION_KEY) })), ...ds.map((d) => ({ name: 'destination:' + d.id.slice(0, 8), value: decryptSecret(d.streamKeyEnc, c.ENCRYPTION_KEY).split('?')[0] }))];
  console.log(JSON.stringify(out.filter((x) => x.value.length >= 8))); await pool.end(); })();`], { cwd: 'packages/services', encoding: 'utf8' }).trim().split('\n').pop());
secrets.push(...extra);

const findings = [];
const scanText = (where, text) => {
  for (const s of secrets) if (text.includes(s.value)) findings.push({ where, secret: s.name });
};
const walk = (dir, filter) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => fs.statSync(f).isFile() && filter(f)) : []);

// 1. client bundles (everything the browser can download)
const client = walk('apps/web/.next/static', () => true);
for (const f of client) scanText(`client:${f}`, fs.readFileSync(f, 'latin1'));
// 2. logs
const logs = walk('.data/logs', (f) => f.endsWith('.log'));
for (const f of logs) {
  const text = fs.readFileSync(f, 'latin1');
  scanText(`log:${f}`, text);
  // capability tokens are not in .env: catch them by shape in request URLs
  const m = text.match(/[?&](?:t|bt|s|token|sig)=(?!\[redacted\])[A-Za-z0-9_.-]{16,}/g);
  if (m) findings.push({ where: `log:${f}`, secret: `url-token x${m.length}` });
}
// 3. API payloads an operator UI receives (lists, socket snapshots) and the audit log export
const BASE = 'http://localhost:3000';
let cookie = '';
const login = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: 'owner@studio.localhost', password: process.env.SMOKE_PASSWORD }) });
cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const matches = (await (await fetch(`${BASE}/api/v1/matches?pageSize=100`, { headers: { cookie } })).json()).items;
const paths = ['/api/v1/inputs', '/api/v1/streams', '/api/v1/sponsors', '/api/v1/clips', '/api/v1/recordings', '/api/v1/exports', '/api/v1/shares', '/api/v1/audit?limit=500', '/api/v1/api-keys', '/api/v1/me', ...matches.flatMap((m) => [`/api/v1/matches/${m.id}/streams`, `/api/v1/matches/${m.id}`, ...(m.overlays ?? []).map((o) => `/api/v1/overlays/${o.id}`)])];
for (const p of paths) {
  const r = await fetch(`${BASE}${p}`, { headers: { cookie } });
  scanText(`api:${p}`, await r.text());
}
// 4. outbox payloads (what realtime clients receive)
const outbox = execFileSync('docker', ['exec', 'broadcast-studio-postgres-1', 'psql', '-U', 'bs_owner', '-d', 'broadcast_studio', '-tAc', 'select payload::text from outbox_events order by position desc limit 20000']).toString();
scanText('outbox/socket payloads', outbox);
const auditRows = execFileSync('docker', ['exec', 'broadcast-studio-postgres-1', 'psql', '-U', 'bs_owner', '-d', 'broadcast_studio', '-tAc', 'select row_to_json(a)::text from audit_logs a']).toString();
scanText('audit_logs table', auditRows);

const summary = { checkedSecrets: secrets.map((s) => s.name), clientFiles: client.length, logFiles: logs.length, apiResponses: paths.length, findings };
fs.mkdirSync('docs/evidence/m7', { recursive: true });
fs.writeFileSync('docs/evidence/m7/secret-scan.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, checkedSecrets: summary.checkedSecrets.length }, null, 2));
process.exit(findings.length ? 1 : 0);
