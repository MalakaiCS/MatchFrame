// Replay transition as an OBS / vMix stinger: exported from a look's page (plain) and from a match's OBS link tab
// (with the teams). Each download is checked with FFmpeg: VP9 WebM with an alpha channel, the frame count and rate
// asked for (2 s), transparent at the start and the end, fully covered at the transition point (1000 ms) and through
// the whole cover, and on the way in and out one solid wall (the picture never shows through between the bands).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshMatch, login } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

function probe(file: string) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]).toString()) as { streams: { codec_name: string; width: number; height: number; r_frame_rate: string; nb_read_frames: string; tags?: Record<string, string> }[]; format: { format_name: string } };
  const s = j.streams[0]!;
  return { format: j.format.format_name, codec: s.codec_name, width: s.width, height: s.height, rate: s.r_frame_rate, frames: Number(s.nb_read_frames), alphaMode: Object.entries(s.tags ?? {}).find(([k]) => k.toLowerCase() === 'alpha_mode')?.[1] };
}
/** mean alpha (0..255) of frame n, read with libvpx (the decoder that keeps the alpha channel) */
function alphaOf(file: string, n: number): number {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', file, '-vf', `select=eq(n\\,${n}),alphaextract,scale=96:54`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
  return raw.reduce((a, b) => a + b, 0) / raw.length;
}
/** every frame's alpha (0..255) at 192×108, read with libvpx (the decoder that keeps the alpha channel) */
function alphaFrames(file: string): Uint8Array[] {
  const [w, h] = [192, 108];
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', file, '-vf', `alphaextract,scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  return Array.from({ length: raw.length / (w * h) }, (_, i) => raw.subarray(i * w * h, (i + 1) * w * h));
}
/** how often a row of the frame changes between see-through and covered: a solid wall changes once at most */
function edgesOnRow(f: Uint8Array, y: number, w = 192): number {
  let n = 0;
  for (let x = 1; x < w; x++) if (f[y * w + x - 1]! >= 128 !== f[y * w + x]! >= 128) n++;
  return n;
}
/** the whole export: clear at both ends, covered from `coveredFrom` to `coveredUntil` (frames), one wall in between */
function checkTimeline(frames: Uint8Array[], coveredFrom: number, coveredUntil: number) {
  const min = (f: Uint8Array) => f.reduce((a, b) => Math.min(a, b), 255);
  const max = (f: Uint8Array) => f.reduce((a, b) => Math.max(a, b), 0);
  expect(max(frames[0]!), 'clear before the bands arrive').toBeLessThan(8);
  expect(max(frames[frames.length - 1]!), 'clear again at the end').toBeLessThan(8);
  for (let n = coveredFrom; n <= coveredUntil; n++) expect(min(frames[n]!), `frame ${n} fully covered`).toBeGreaterThan(245);
  for (let n = 0; n < frames.length; n++) for (const y of [10, 54, 98]) expect(edgesOnRow(frames[n]!, y), `frame ${n}, row ${y}: one wall, no gaps`).toBeLessThanOrEqual(1);
}
/** frame n over a mid-grey background, as evidence of what OBS shows over the programme */
function still(file: string, n: number, out: string) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', file, '-f', 'lavfi', '-i', 'color=c=0x3a4250:s=1280x720', '-filter_complex', `[0:v]select=eq(n\\,${n}),setpts=PTS-STARTPTS,scale=1280:720[f];[1:v][f]overlay=shortest=1`, '-frames:v', '1', out]);
}

async function exportFrom(page: Page, opts: { size: string; fps: number; version?: 'teams' | 'plain' }) {
  const dialog = page.getByRole('dialog', { name: 'Replay transition for OBS or vMix' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('replay-preview').locator('[data-graphic="replay"]')).toBeVisible();
  await expect(dialog.getByLabel('How to use it')).toContainText('Transition Point 1000 ms');
  if (opts.version) await dialog.getByLabel('Version').selectOption(opts.version);
  await dialog.getByLabel('Size').selectOption(opts.size);
  await dialog.getByLabel('Frame rate').selectOption(String(opts.fps));
  // every frame is drawn in the browser: about 40 s here, slower on a busy machine
  const download = page.waitForEvent('download', { timeout: 300_000 });
  await dialog.getByRole('button', { name: 'Export WebM' }).click();
  await expect(dialog.getByRole('status')).toContainText(/Drawing frame \d+ of/);
  const d = await download;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bs-replay-')), d.suggestedFilename());
  await d.saveAs(file);
  await expect(dialog.getByRole('status')).toContainText(`Downloaded ${d.suggestedFilename()}`);
  return { file, name: d.suggestedFilename() };
}

test('replay transition from a look page: plain, transparent VP9 WebM, covered at 1000 ms, one wall in and out', async ({ browser }) => {
  test.setTimeout(420_000);
  const { ctx, page } = await login(browser);
  await page.goto('/app/themes/premier');
  // it is one of the look's graphics too
  await expect(page.getByRole('button', { name: /Replay transition/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Replay transition (WebM)' }).click();
  const { file, name } = await exportFrom(page, { size: '1280x720', fps: 25 });
  expect(name).toBe('replay-premier-plain-1280x720-25fps.webm');
  const p = probe(file);
  expect(p).toMatchObject({ codec: 'vp9', width: 1280, height: 720, rate: '25/1', frames: 51, alphaMode: '1' });
  expect(p.format).toContain('webm');
  expect(alphaOf(file, 25)).toBeGreaterThan(252); // covered at the transition point (1000 ms)
  // covered from 500 ms to 1440 ms (frames 13 to 36 at 25 fps)
  checkTimeline(alphaFrames(file), 13, 36);
  still(file, 8, `${EVIDENCE}/replay-premier-sweep.png`);
  still(file, 25, `${EVIDENCE}/replay-premier-plain.png`);
  still(file, 41, `${EVIDENCE}/replay-premier-out.png`);
  await ctx.close();
});

test('replay transition from a match: with the teams, 30 fps, covered at 1000 ms, one wall in and out', async ({ browser }) => {
  test.setTimeout(420_000);
  const { ctx, page } = await login(browser);
  const matchId = await freshMatch(page);
  await page.goto(`/app/matches/${matchId}`);
  await page.getByRole('tab', { name: 'OBS link' }).click();
  await page.getByRole('button', { name: 'Export replay transition' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replay transition for OBS or vMix' });
  await expect(dialog.getByLabel('Version')).toHaveValue('teams');
  const { file, name } = await exportFrom(page, { size: '1280x720', fps: 30 });
  expect(name).toMatch(/^replay-[a-z0-9-]+-v-[a-z0-9-]+-1280x720-30fps\.webm$/);
  expect(probe(file)).toMatchObject({ codec: 'vp9', width: 1280, height: 720, rate: '30/1', frames: 61, alphaMode: '1' });
  expect(alphaOf(file, 30)).toBeGreaterThan(252);
  // covered from 500 ms to 1440 ms (frames 15 to 43 at 30 fps)
  checkTimeline(alphaFrames(file), 15, 43);
  still(file, 30, `${EVIDENCE}/replay-match-teams.png`);
  await ctx.close();
});
