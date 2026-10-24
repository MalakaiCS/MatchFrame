#!/usr/bin/env node
// pnpm demo:start | demo:stop — local demonstration stack: services (incl. the test RTMP receiver),
// migrations, seed (once), then api/worker/media-worker/web in the background (logs in .data/logs/demo.log).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

const PID = '.data/demo.pid';
const compose = (...a) => execFileSync('docker', ['compose', '-f', 'infra/docker-compose.yml', '--env-file', '.env', '--profile', 'media-test', ...a], { stdio: 'inherit' });
const cmd = process.argv[2];
if (!fs.existsSync('.env')) execFileSync('node', ['scripts/setup.mjs'], { stdio: 'inherit' });

if (cmd === 'start') {
  compose('up', '-d', '--wait');
  execFileSync('pnpm', ['db:migrate'], { stdio: 'inherit' });
  execFileSync('pnpm', ['db:seed'], { stdio: 'inherit' }); // no-op when already seeded
  fs.mkdirSync('.data/logs', { recursive: true });
  const out = fs.openSync('.data/logs/demo.log', 'a');
  const p = spawn('node', ['scripts/dev.mjs'], { detached: true, stdio: ['ignore', out, out] });
  fs.writeFileSync(PID, String(p.pid));
  p.unref();
  console.log(`Demo running (pid ${p.pid}). Open http://localhost:3000 — logs: .data/logs/demo.log. Stop with pnpm demo:stop.`);
} else if (cmd === 'stop') {
  if (fs.existsSync(PID)) {
    const pid = Number(fs.readFileSync(PID, 'utf8'));
    try {
      process.kill(-pid, 'SIGTERM'); // the whole process group started by demo:start
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    fs.rmSync(PID);
  }
  compose('stop');
  console.log('Demo stopped (data kept in .data/; pnpm services:down to remove containers).');
} else {
  console.error('usage: node scripts/demo.mjs start|stop');
  process.exit(2);
}
