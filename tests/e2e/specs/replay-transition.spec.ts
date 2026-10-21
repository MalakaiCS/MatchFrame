// Replay transition as an OBS / vMix stinger: exported from a look's page (plain) and from a match's OBS link tab
// (with the teams). Each download is checked with FFmpeg: VP9 WebM with an alpha channel, the frame count and rate
// asked for, transparent at the start and the end and fully covered at the transition point (800 ms).
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
/** frame n over a mid-grey background, as evidence of what OBS shows over the programme */
function still(file: string, n: number, out: string) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', file, '-f', 'lavfi', '-i', 'color=c=0x3a4250:s=1280x720', '-filter_complex', `[0:v]select=eq(n\\,${n}),setpts=PTS-STARTPTS,scale=1280:720[f];[1:v][f]overlay=shortest=1`, '-frames:v', '1', out]);
}

async function exportFrom(page: Page, opts: { size: string; fps: number; version?: 'teams' | 'plain' }) {
  const dialog = page.getByRole('dialog', { name: 'Replay transition for OBS or vMix' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('replay-preview').locator('[data-graphic="replay"]')).toBeVisible();
  await expect(dialog.getByLabel('How to use it')).toContainText('Transition Point 800 ms');
  if (opts.version) await dialog.getByLabel('Version').selectOption(opts.version);
  await dialog.getByLabel('Size').selectOption(opts.size);
  await dialog.getByLabel('Frame rate').selectOption(String(opts.fps));
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await dialog.getByRole('button', { name: 'Export WebM' }).click();
  await expect(dialog.getByRole('status')).toContainText(/Drawing frame \d+ of/);
  const d = await download;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bs-replay-')), d.suggestedFilename());
  await d.saveAs(file);
  await expect(dialog.getByRole('status')).toContainText(`Downloaded ${d.suggestedFilename()}`);
  return { file, name: d.suggestedFilename() };
}

test('replay transition from a look page: plain, transparent VP9 WebM, covered at 800 ms', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page } = await login(browser);
  await page.goto('/app/themes/premier');
  // it is one of the look's graphics too
  await expect(page.getByRole('button', { name: /Replay transition/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Replay transition (WebM)' }).click();
  const { file, name } = await exportFrom(page, { size: '1280x720', fps: 25 });
  expect(name).toBe('replay-premier-plain-1280x720-25fps.webm');
  const p = probe(file);
  expect(p).toMatchObject({ codec: 'vp9', width: 1280, height: 720, rate: '25/1', frames: 41, alphaMode: '1' });
  expect(p.format).toContain('webm');
  expect(alphaOf(file, 0)).toBeLessThan(3); // clear before the bands arrive
  expect(alphaOf(file, 20)).toBeGreaterThan(252); // covered at the transition point (800 ms)
  expect(alphaOf(file, 40)).toBeLessThan(3); // clear again at the end
  still(file, 6, `${EVIDENCE}/replay-premier-sweep.png`);
  still(file, 20, `${EVIDENCE}/replay-premier-plain.png`);
  await ctx.close();
});

test('replay transition from a match: with the teams, 30 fps, covered at 800 ms', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page } = await login(browser);
  const matchId = await freshMatch(page);
  await page.goto(`/app/matches/${matchId}`);
  await page.getByRole('tab', { name: 'OBS link' }).click();
  await page.getByRole('button', { name: 'Export replay transition' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replay transition for OBS or vMix' });
  await expect(dialog.getByLabel('Version')).toHaveValue('teams');
  const { file, name } = await exportFrom(page, { size: '1280x720', fps: 30 });
  expect(name).toMatch(/^replay-[a-z0-9-]+-v-[a-z0-9-]+-1280x720-30fps\.webm$/);
  expect(probe(file)).toMatchObject({ codec: 'vp9', width: 1280, height: 720, rate: '30/1', frames: 49, alphaMode: '1' });
  expect(alphaOf(file, 0)).toBeLessThan(3);
  expect(alphaOf(file, 24)).toBeGreaterThan(252);
  expect(alphaOf(file, 48)).toBeLessThan(3);
  still(file, 24, `${EVIDENCE}/replay-match-teams.png`);
  await ctx.close();
});
