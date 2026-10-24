// Records the /reel page (the broadcast looks played by the real renderer) to apps/web/public/media/ as an H.264
// MP4 and a poster frame. The reel plays in slow motion (CSS animations through DevTools, the page clock through
// Date.now) while Chromium's screencast captures it, and each frame is put back on the reel's own time, so a
// headless browser that draws ~17 frames a second still gives a smooth 30 fps video. Needs the web app running and
// ffmpeg on the PATH. Re-run after changing a look:
//   BASE_URL=http://localhost:3000 pnpm record:reel
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const outDir = path.resolve(import.meta.dirname, '../../apps/web/public/media');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-'));
fs.mkdirSync(outDir, { recursive: true });

const SLOW = Number(process.env.REEL_SLOW ?? 0.25);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => {
  const real = Date.now.bind(Date);
  let scale = 1;
  let realOrigin = real();
  let fakeOrigin = realOrigin;
  Date.now = () => fakeOrigin + (real() - realOrigin) * scale;
  window.__realNow = real;
  window.__setTimeScale = (s) => {
    fakeOrigin = Date.now();
    realOrigin = real();
    scale = s;
  };
});
await page.goto(`${base}/reel?wait=1`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);

const cdp = await page.context().newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const file = path.join(work, `f${String(frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await page.waitForTimeout(500);
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: SLOW });
const startedAt = await page.evaluate((s) => {
  window.__setTimeScale(s);
  window.__startReel();
  return window.__realNow() / 1000;
}, SLOW);
const ms = await page.evaluate(() => window.__reelMs);
await page.waitForTimeout(ms / SLOW + 800);
await cdp.send('Page.stopScreencast');
await browser.close();

// keep the frame on screen at the start and everything after it; each frame lasts until the next one arrived
// (frame times are real seconds; reel time runs SLOW times as fast)
let first = frames.findLastIndex((f) => f.t <= startedAt);
if (first < 0) first = 0;
const kept = frames.slice(first);
const reel = (t) => Math.max(0, (t - startedAt) * SLOW);
const end = ms / 1000;
const lines = [];
kept.forEach((f, i) => {
  const from = reel(f.t);
  const to = Math.min(kept[i + 1] ? reel(kept[i + 1].t) : end, end);
  if (to <= from) return;
  lines.push(`file '${f.file}'`, `duration ${(to - from).toFixed(4)}`);
});
lines.push(`file '${kept.at(-1).file}'`);
fs.writeFileSync(path.join(work, 'frames.txt'), lines.join('\n'));

const mp4 = path.join(outDir, 'matchframe-looks.mp4');
const poster = path.join(outDir, 'matchframe-looks.jpg');
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
ff(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart', '-an', mp4]);
ff(['-ss', '9.5', '-i', mp4, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', poster]);
fs.rmSync(work, { recursive: true, force: true });
const fps = kept.length / (ms / 1000);
console.log(`recorded ${kept.length} frames over ${(ms / 1000).toFixed(1)} s (${fps.toFixed(1)} captured frames/s) → ${path.relative(process.cwd(), mp4)} (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB)`);
