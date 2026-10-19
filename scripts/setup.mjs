#!/usr/bin/env node
// One-time local setup: generate .env secrets (once), detect the ICE node IP, render media configs,
// create data directories. Safe to re-run; existing secrets are never replaced.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, render } from './env.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);

function detectNodeIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('No non-loopback IPv4 interface found; set LIVEKIT_NODE_IP in .env manually');
}

if (!fs.existsSync('.env')) {
  const txt = fs
    .readFileSync('.env.example', 'utf8')
    .replace(/__GENERATE_KEY__/g, () => crypto.randomBytes(32).toString('base64'))
    .replace(/__GENERATE__/g, () => crypto.randomBytes(24).toString('base64url'))
    .replace(/__DETECT__/g, detectNodeIp());
  fs.writeFileSync('.env', txt, { mode: 0o600 });
  console.log('Created .env with generated development secrets (gitignored).');
} else console.log('.env exists; keeping its secrets.');

const env = loadEnv('.env');
for (const d of ['.data/config', '.data/postgres', '.data/redis', '.data/minio', '.data/egress-tmp', '.data/rtmp-sink', '.data/tmp']) fs.mkdirSync(d, { recursive: true });
fs.chmodSync('.data/egress-tmp', 0o1777); // egress runs as uid 1001
for (const f of ['livekit.yaml', 'ingress.yaml', 'egress.yaml', 'mediamtx.yml']) {
  fs.writeFileSync(path.join('.data/config', f), render(fs.readFileSync(path.join('infra/templates', f), 'utf8'), env), { mode: 0o644 });
}
console.log('Rendered .data/config/{livekit,ingress,egress,mediamtx} from .env');
console.log(`LIVEKIT_NODE_IP=${env.LIVEKIT_NODE_IP}`);
console.log('\nNext:  pnpm services:up && pnpm db:migrate && pnpm db:seed && pnpm dev');
