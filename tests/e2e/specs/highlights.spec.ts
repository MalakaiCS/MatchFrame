// The highlights generator end to end: a match scored through the API (kick-off, a home goal, an away red card, full
// time), a video of it uploaded in the Highlights tab, the kick-off marked in its preview, and a package made: the
// browser draws the graphics, the media worker makes the MP4. The file is downloaded, checked (1920×1080, its
// length) and stills of it kept as evidence: the title panel, the scorebug with the red card, the replay with its
// transition and the goal strap, the full-time score and the end board.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { api, freshMatch, login } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

async function command(page: Page, matchId: string, type: string, payload: Record<string, unknown>) {
  return page.evaluate(
    async ([id, t, p]) => {
      const post = (u: string, b: unknown) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
      const lease = await post(`/api/v1/matches/${id}/scorer-lease`, { action: 'acquire', deviceId: 'e2e-hl' });
      const st = await fetch(`/api/v1/matches/${id}/state`).then((r) => r.json());
      return post(`/api/v1/matches/${id}/commands`, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'e2e-hl', type: t, payload: p });
    },
    [matchId, type, payload] as const,
  );
}

test('highlights: upload the match video, mark the kick-off, make the package', async ({ browser }) => {
  test.setTimeout(900_000);
  const { page } = await login(browser, { viewport: { width: 1440, height: 1000 } });
  const matchId = await freshMatch(page);
  // the match: the kick-off is 25 s into the video; a home goal 1 s in, an away red card 4 s in, full time 16 s in
  await command(page, matchId, 'SET_PHASE', { to: 'first_half' });
  await command(page, matchId, 'ADD_FACT', { type: 'goal', side: 'home', occurredAt: Date.now() + 1000, payload: {} });
  await command(page, matchId, 'ADD_FACT', { type: 'red_card', side: 'away', occurredAt: Date.now() + 4000, payload: {} });
  await page.waitForTimeout(16_000);
  for (const to of ['half_time', 'second_half', 'full_time']) await command(page, matchId, 'SET_PHASE', { to });

  // its video: a minute of test picture with a tone
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-e2e-hl-'));
  const file = path.join(dir, 'match-recording.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=60', '-f', 'lavfi', '-i', 'sine=f=330:d=60', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', file]);

  await page.goto(`/app/matches/${matchId}`);
  await page.getByRole('tab', { name: 'Media' }).click();
  await page.getByLabel('Video of the match').setInputFiles(file);
  const videos = page.getByRole('list', { name: 'Videos' });
  await expect(videos).toContainText('match-recording.mp4', { timeout: 60_000 });
  await expect(videos).toContainText('Ready', { timeout: 120_000 });

  // the kick-off, typed in (Playwright's Chromium does not play H.264, so the preview is not used to find it here)
  await expect(page.getByLabel('Match video')).toBeVisible();
  const kickOffs = page.getByRole('region', { name: 'Kick-off times' });
  const first = kickOffs.getByLabel('1st Half kick-off time');
  await first.fill('0:25');
  await first.press('Enter');
  await expect(first).toHaveValue('0:25');
  // the second half follows the first half's mark (the recording ran through)
  await expect(kickOffs.locator('[data-period="second_half"]')).toContainText('(follows)');
  await kickOffs.getByRole('button', { name: 'Save kick-off times' }).click();

  const moments = page.getByRole('list', { name: 'Moments' });
  await expect(moments.locator('[data-moment="goal"][data-included="true"]')).toHaveCount(1);
  await expect(moments.locator('[data-moment="red_card"][data-included="true"]')).toHaveCount(1);
  await expect(page.locator('[data-summary]')).toContainText('2 moments · 1 replay');
  // the sticky app header would sit over the top of the capture
  await page.addStyleTag({ content: 'header, nav[aria-label="Main (compact)"] { visibility: hidden !important; }' });
  await page.getByRole('tabpanel').screenshot({ path: `${EVIDENCE}/highlights-tab.png` });

  await page.getByRole('button', { name: 'Make the highlights' }).click();
  const started = Date.now();
  await expect(page.getByRole('status').filter({ hasText: /video is being made|Drawing the graphics|Sending the graphics/ })).toBeVisible({ timeout: 30_000 });
  // drawing is in this browser: slower when other pages in it are busy (earlier specs leave theirs open)
  await expect(page.getByText('The graphics are in')).toBeVisible({ timeout: 600_000 });
  const frames = await page.evaluate(() => (window as unknown as { __hlFrames?: number }).__hlFrames ?? null);
  console.log(`highlights: graphics drawn and sent in ${((Date.now() - started) / 1000).toFixed(1)} s${frames ? ` (${frames} frames)` : ''}`);
  const made = page.getByRole('list', { name: 'Highlights made' });
  await expect(made.locator('[data-package="COMPLETED"]')).toHaveCount(1, { timeout: 180_000 });
  await page.getByRole('tabpanel').screenshot({ path: `${EVIDENCE}/highlights-made.png` });

  // the file: downloaded as the browser would, checked, and stills kept
  const [pkg] = await api<{ id: string; durationMs: number; downloadUrl: string; timeline: { kind: string; fromMs: number; toMs: number }[] }[]>(page, `/api/v1/matches/${matchId}/highlight-packages`);
  expect(pkg!.timeline.map((s) => s.kind)).toEqual(['clip', 'replay', 'full_time', 'end_card']);
  const res = await page.request.get(pkg!.downloadUrl);
  expect(res.ok()).toBe(true);
  const out = path.join(dir, 'highlights.mp4');
  fs.writeFileSync(out, await res.body());
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', out]).toString()) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number; duration?: string }[] };
  const video = info.streams.find((s) => s.codec_type === 'video');
  expect(video).toMatchObject({ width: 1920, height: 1080 });
  expect(info.streams.some((s) => s.codec_type === 'audio')).toBe(true);
  expect(Math.abs(Number(info.format.duration) * 1000 - pkg!.durationMs)).toBeLessThan(200);
  // the picture runs the whole package (read from storage over the network, clip by clip)
  expect(Math.abs(Number(video!.duration) * 1000 - pkg!.durationMs)).toBeLessThan(200);
  const at = (kind: string) => pkg!.timeline.find((s) => s.kind === kind)!;
  const still = (ms: number, name: string) => {
    const f = path.resolve(EVIDENCE, `highlights-${name}.png`);
    fs.rmSync(f, { force: true });
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (ms / 1000).toFixed(2), '-i', out, '-frames:v', '1', f]);
    expect(fs.existsSync(f)).toBe(true);
  };
  still(2_000, 'title');
  still(at('clip').toMs - 2_000, 'red-card'); // after the red card: its tab on the scorebug
  still(at('replay').fromMs - 150, 'stinger'); // the replay transition covering the cut
  still(at('replay').fromMs + 3_000, 'replay'); // the goal strap over the slowed picture
  still(at('full_time').toMs - 2_000, 'full-time');
  still(at('end_card').toMs - 800, 'end-board');
  fs.rmSync(dir, { recursive: true, force: true });
});
