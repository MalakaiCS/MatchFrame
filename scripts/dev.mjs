#!/usr/bin/env node
// Runs api, worker, media-worker (tsx watch) and web (next dev) with prefixed logs.
import { spawn } from 'node:child_process';

const procs = [
  ['api', 'pnpm', ['--filter', '@bs/api', 'dev']],
  ['worker', 'pnpm', ['--filter', '@bs/worker', 'dev']],
  ['media', 'pnpm', ['--filter', '@bs/media-worker', 'dev']],
  ['web', 'pnpm', ['--filter', '@bs/web', 'dev']],
].filter(([n]) => !(process.env.DEV_ONLY && !process.env.DEV_ONLY.split(',').includes(n)));
const colors = { api: 36, worker: 35, media: 33, web: 32 };
const children = procs.map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const out = (d) => d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`\x1b[${colors[name]}m${name.padEnd(6)}\x1b[0m ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (c) => console.log(`${name} exited (${c})`));
  return p;
});
const stop = () => { children.forEach((c) => c.kill('SIGTERM')); setTimeout(() => process.exit(0), 1500); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
