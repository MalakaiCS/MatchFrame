#!/usr/bin/env node
// Single-container entry point for hosted platforms (Railway, Render, Fly.io) that give a service one public
// port. Runs api, worker, media-worker and web inside the container and serves them from one origin on $PORT:
// /api/* and /socket.io/* (including WebSocket upgrades) go to the API, everything else to Next.js.
// Optional: MIGRATE_ON_START=true applies database migrations (DATABASE_ADMIN_URL) before anything starts.
// Any process exiting stops the container so the platform restarts it.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.PORT ?? 8080);
const API_PORT = Number(process.env.API_PORT ?? 4000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const env = { ...process.env, API_PORT: String(API_PORT), NODE_ENV: process.env.NODE_ENV ?? 'production' };

if (process.env.MIGRATE_ON_START === 'true') {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), ['packages/db/src/migrate.ts'], { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('[start] migrations failed; not starting');
    process.exit(1);
  }
}

const procs = [
  ['api', 'node', ['apps/api/dist/main.js'], root],
  ['worker', 'node', ['apps/worker/dist/main.js'], root],
  ['media', 'node', ['apps/media-worker/dist/main.js'], root],
  ['web', path.join(root, 'apps/web/node_modules/.bin/next'), ['start', '-H', '127.0.0.1', '-p', String(WEB_PORT)], path.join(root, 'apps/web')],
];
let stopping = false;
const children = procs.map(([name, cmd, args, cwd]) => {
  const p = spawn(cmd, args, { cwd, env, stdio: 'inherit' });
  p.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[start] ${name} exited (${code ?? signal}); stopping container`);
    shutdown(1);
  });
  return p;
});

const toApi = (url = '/') => url.startsWith('/api/') || url.startsWith('/socket.io/');
const target = (url) => ({ host: '127.0.0.1', port: toApi(url) ? API_PORT : WEB_PORT });

const server = http.createServer((req, res) => {
  const up = http.request({ ...target(req.url), method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.rawHeaders);
    r.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Starting up, try again in a moment');
  });
  req.pipe(up);
});
// WebSocket upgrades (Socket.IO): replay the request head to the backend, then splice the sockets.
server.on('upgrade', (req, socket, head) => {
  const t = target(req.url);
  const up = net.connect(t.port, t.host, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket).pipe(up);
  });
  const close = () => {
    socket.destroy();
    up.destroy();
  };
  up.on('error', close);
  socket.on('error', close);
});
server.listen(PORT, '0.0.0.0', () => console.log(`[start] serving on :${PORT} (api :${API_PORT}, web :${WEB_PORT})`));

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  server.close();
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5000).unref();
  Promise.all(children.map((c) => new Promise((r) => (c.exitCode !== null ? r() : c.on('exit', r))))).then(() => process.exit(code));
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
