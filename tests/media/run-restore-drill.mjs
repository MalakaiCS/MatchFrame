// A52 restore drill: backup → restore into a clean environment → verify, without re-seeding.
//  1. pg_dumpall --roles-only + pg_dump (custom) from the running database; object mirror of the bucket
//  2. fresh PostgreSQL (port 5433) and fresh MinIO (port 9100) containers with empty data directories
//  3. restore roles + database, mirror objects, start a separate API (port 4100) against the restored state
//  4. verify: owner login, match history, tenant isolation, recording plays (byte ranges)
// Evidence: docs/evidence/m7/restore-drill.json. Cleans up its containers afterwards.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/\s+#.*$/, '')]));
const PASSWORD = process.env.SMOKE_PASSWORD;
const PASSWORD_B = process.env.SMOKE_PASSWORD_B;
const WORK = path.resolve('.data/restore-drill');
const OUT = path.resolve('docs/evidence/m7');
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30, ...opts });
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(WORK, 'pg'), { recursive: true });
fs.mkdirSync(path.join(WORK, 'minio'), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const PGIMG = 'postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297';
const MINIOIMG = 'pgsty/minio:RELEASE.2026-08-04T00-00-00Z';
const res = { startedAt: new Date().toISOString() };
const t0 = Date.now();

// ---- 1. backup
log('backup: roles + database');
const pgx = (args) => sh('docker', ['exec', '-e', `PGPASSWORD=${env.POSTGRES_ADMIN_PASSWORD}`, 'broadcast-studio-postgres-1', ...args]);
fs.writeFileSync(path.join(WORK, 'roles.sql'), pgx(['pg_dumpall', '-h', '127.0.0.1', '-U', env.POSTGRES_ADMIN_USER, '--roles-only']).toString().split('\n').filter((l) => !/ROLE (postgres|bs_owner)\b/.test(l) || /^GRANT/.test(l)).join('\n'));
fs.writeFileSync(path.join(WORK, 'db.dump'), pgx(['pg_dump', '-h', '127.0.0.1', '-U', env.POSTGRES_ADMIN_USER, '-Fc', env.POSTGRES_DB]));
res.dumpBytes = fs.statSync(path.join(WORK, 'db.dump')).size;

// ---- 2. clean environment
log('clean environment: fresh postgres:5433 and minio:9100');
for (const n of ['bs-restore-pg', 'bs-restore-minio']) try { sh('docker', ['rm', '-f', n]); } catch { /* none */ }
sh('docker', ['run', '-d', '--name', 'bs-restore-pg', '--network', 'host', '-e', `POSTGRES_USER=${env.POSTGRES_ADMIN_USER}`, '-e', `POSTGRES_PASSWORD=${env.POSTGRES_ADMIN_PASSWORD}`, '-e', `POSTGRES_DB=${env.POSTGRES_DB}`, '-v', `${WORK}/pg:/var/lib/postgresql/data`, PGIMG, 'postgres', '-c', 'listen_addresses=127.0.0.1', '-c', 'port=5433']);
sh('docker', ['run', '-d', '--name', 'bs-restore-minio', '--network', 'host', '-e', `MINIO_ROOT_USER=${env.S3_ACCESS_KEY}`, '-e', `MINIO_ROOT_PASSWORD=${env.S3_SECRET_KEY}`, '-v', `${WORK}/minio:/data`, MINIOIMG, 'server', '/data', '--address', '127.0.0.1:9100', '--console-address', '127.0.0.1:9101']);
for (let i = 0; i < 60; i++) {
  try { sh('docker', ['exec', 'bs-restore-pg', 'pg_isready', '-h', '127.0.0.1', '-p', '5433']); break; } catch { await sleep(1000); }
}
await sleep(3000);
const pgr = (args, input) => execFileSync('docker', ['exec', '-i', '-e', `PGPASSWORD=${env.POSTGRES_ADMIN_PASSWORD}`, 'bs-restore-pg', ...args], { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 30 });

// ---- 3. restore
log('restore: roles, database');
pgr(['psql', '-h', '127.0.0.1', '-p', '5433', '-U', env.POSTGRES_ADMIN_USER, '-d', 'postgres', '-v', 'ON_ERROR_STOP=0', '-q'], fs.readFileSync(path.join(WORK, 'roles.sql')));
pgr(['pg_restore', '-h', '127.0.0.1', '-p', '5433', '-U', env.POSTGRES_ADMIN_USER, '-d', env.POSTGRES_DB, '--clean', '--if-exists', '--no-owner', '--role', env.POSTGRES_ADMIN_USER], fs.readFileSync(path.join(WORK, 'db.dump')));
res.restoredTables = Number(pgr(['psql', '-h', '127.0.0.1', '-p', '5433', '-U', env.POSTGRES_ADMIN_USER, '-d', env.POSTGRES_DB, '-tAc', "select count(*) from pg_tables where schemaname='public' and rowsecurity"]).toString().trim());
log('restore: objects');
const mirror = sh('npx', ['tsx', '-e', `
  import { loadDotEnv, getConfig } from '@bs/config'; import { createStorage } from './src/storage';
  (async () => { loadDotEnv(); const c = getConfig(); const src = createStorage(c); const dst = createStorage({ ...c, S3_ENDPOINT: 'http://127.0.0.1:9100' });
  await dst.ensureBucket(); let n = 0, bytes = 0;
  for (const o of await src.list('')) { const b = await src.getBuffer(o.key); await dst.put(o.key, b, 'application/octet-stream', b.length); n++; bytes += b.length; }
  console.log(JSON.stringify({ objects: n, bytes })); })();`], { cwd: 'packages/services' }).toString().trim().split('\n').pop();
Object.assign(res, { mirror: JSON.parse(mirror) });

// ---- 4. separate API on the restored state (Redis is a transient bus, not restored state)
log('start restored API on :4100');
const dbUrl = (u) => u.replace(':5432/', ':5433/');
const api = spawn('npx', ['tsx', 'src/main.ts'], { cwd: 'apps/api', env: { ...process.env, ...env, API_PORT: '4100', DATABASE_URL: dbUrl(env.DATABASE_URL), DATABASE_WORKER_URL: dbUrl(env.DATABASE_WORKER_URL), DATABASE_ADMIN_URL: dbUrl(env.DATABASE_ADMIN_URL), S3_ENDPOINT: 'http://127.0.0.1:9100', REDIS_URL: env.REDIS_URL.replace(/\/0$/, '/3') }, stdio: ['ignore', fs.openSync(path.join(WORK, 'api.log'), 'w'), fs.openSync(path.join(WORK, 'api.log'), 'a')] });
const BASE = 'http://127.0.0.1:4100';
const ORIGIN = env.PUBLIC_WEB_URL;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/v1/time`)).ok) break; } catch { /* starting */ }
    await sleep(1000);
  }
  const session = async (email, password) => {
    const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password }) });
    return { status: r.status, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
  };
  const a = await session('owner@studio.localhost', PASSWORD);
  res.ownerLogin = a.status;
  const get = (p, cookie, headers = {}) => fetch(`${BASE}${p}`, { headers: { cookie, ...headers } });
  const matches = (await (await get('/api/v1/matches?pageSize=100', a.cookie)).json()).items;
  const withFacts = [];
  for (const m of matches) {
    const facts = await (await get(`/api/v1/matches/${m.id}/facts`, a.cookie)).json();
    if (Array.isArray(facts) && facts.length) withFacts.push({ id: m.id, facts: facts.length });
  }
  res.matchesVisible = matches.length;
  res.matchesWithHistory = withFacts.length;
  res.factsVisible = withFacts.reduce((n, x) => n + x.facts, 0);
  const recs = await (await get('/api/v1/recordings', a.cookie)).json();
  const playable = recs.find((r) => r.mediaUrl);
  res.recordings = recs.length;
  if (playable) {
    const r = await get(playable.mediaUrl, a.cookie, { range: 'bytes=0-1048575' });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(path.join(WORK, 'head.mp4'), buf);
    res.recordingRange = { status: r.status, bytes: buf.length, contentRange: r.headers.get('content-range') };
    const full = await get(playable.mediaUrl, a.cookie);
    const fileBuf = Buffer.from(await full.arrayBuffer());
    fs.writeFileSync(path.join(WORK, 'rec.mp4'), fileBuf);
    res.recordingProbe = JSON.parse(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', path.join(WORK, 'rec.mp4')]).toString());
    if (PASSWORD_B) {
      const b = await session('owner-b@studio.localhost', PASSWORD_B);
      res.otherTenantRecording = (await get(playable.mediaUrl, b.cookie)).status;
      res.otherTenantFacts = (await get(`/api/v1/matches/${withFacts[0].id}/facts`, b.cookie)).status;
    }
  }
  res.anonymousMatches = (await get('/api/v1/matches', '')).status;
  // tenant isolation on the restored data: as bs_app scoped to the other organisation, org A rows are invisible
  const q = (sql) => pgr(['psql', '-h', '127.0.0.1', '-p', '5433', '-U', env.POSTGRES_ADMIN_USER, '-d', env.POSTGRES_DB, '-tAc', sql]).toString().trim();
  const orgA = q("select organisation_id from memberships m join users u on u.id = m.user_id where u.email = 'owner@studio.localhost' limit 1");
  const orgB = q(`select id from organisations where id <> '${orgA}' limit 1`);
  const asApp = (org) => pgr(['psql', `postgres://bs_app:${encodeURIComponent(new URL(env.DATABASE_URL).password)}@127.0.0.1:5433/${env.POSTGRES_DB}`, '-tAc', `begin; select set_config('app.org_id', '${org}', true); select count(*) from recordings where organisation_id = '${orgA}'; commit;`]).toString().split('\n').map((l) => l.trim()).filter((l) => /^\d+$/.test(l)).pop();
  res.rlsRowsOfAVisibleToA = Number(asApp(orgA));
  res.rlsRowsOfAVisibleToB = Number(asApp(orgB));
} finally {
  api.kill('SIGTERM');
  await sleep(1500);
  for (const n of ['bs-restore-pg', 'bs-restore-minio']) try { sh('docker', ['rm', '-f', n]); } catch { /* gone */ }
}
res.durationSeconds = Math.round((Date.now() - t0) / 1000);
const checks = {
  restoredWithRls: res.restoredTables > 50,
  objectsMirrored: res.mirror.objects > 0,
  ownerLogin: res.ownerLogin === 200,
  historyOpens: res.matchesWithHistory > 0 && res.factsVisible > 0,
  recordingPlays: res.recordingRange?.status === 206 && (res.recordingProbe?.streams ?? []).some((s) => s.codec_type === 'video'),
  tenantIsolation: res.rlsRowsOfAVisibleToA > 0 && res.rlsRowsOfAVisibleToB === 0 && (!PASSWORD_B || (res.otherTenantRecording === 404 && res.otherTenantFacts === 404)),
  anonymousDenied: res.anonymousMatches === 401,
};
res.checks = checks;
fs.writeFileSync(path.join(OUT, 'restore-drill.json'), JSON.stringify(res, null, 2));
log(JSON.stringify(res, null, 2));
fs.rmSync(WORK, { recursive: true, force: true });
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
