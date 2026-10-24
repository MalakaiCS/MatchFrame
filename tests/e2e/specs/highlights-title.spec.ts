// The highlights title graphics for an edit: Match Highlights and Extended Match Highlights in the match's look, with
// the ground, the date and the kick-off time, downloaded as a ProRes 4444 MOV with transparency (for Premiere, Final
// Cut and DaVinci Resolve) and as a transparent PNG. The files are checked: the codec and its alpha, the size, the
// frame rate and length, see-through outside the panel and solid on it, and stills kept as evidence.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { api, login } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

/** A fixture at one of the organisation's grounds, an hour from now. */
async function matchAtGround(page: Page) {
  const comps = await api<{ id: string; sport: string; currentSeason: { id: string } | null }[]>(page, '/api/v1/competitions');
  const comp = comps.find((c) => c.sport === 'football' && c.currentSeason)!;
  const teams = await api<{ id: string; sport: string; status: string }[]>(page, '/api/v1/teams');
  const [h, a] = teams.filter((t) => t.sport === 'football' && t.status === 'active');
  const [venue] = await api<{ id: string; name: string }[]>(page, '/api/v1/venues');
  const kick = new Date(Date.now() + 3600_000);
  const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(kick).replace(',', '');
  const m = await api<{ id: string }>(page, '/api/v1/matches', { competitionId: comp.id, seasonId: comp.currentSeason!.id, homeTeamId: h!.id, awayTeamId: a!.id, venueId: venue!.id, kickoffLocal: local, timezone: 'Australia/Brisbane', round: 'Round 12' });
  const time = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit', hour12: true }).format(kick).replace(/\s/g, ' ').toUpperCase();
  const date = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(kick).toUpperCase();
  return { id: m.id, venue: venue!.name.toUpperCase(), when: `${date} · ${time}` };
}

/** Mean alpha (0..255) of a box of one frame of a video or picture. */
function alpha(file: string, box: string, frame = 0) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame}),crop=${box},alphaextract,scale=16:16`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
  return raw.reduce((s, b) => s + b, 0) / raw.length;
}

async function download(page: Page, button: ReturnType<Page['getByRole']>, to: string) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 240_000 }), button.click()]);
  await d.saveAs(to);
  return to;
}

test('highlights title graphics: Match Highlights as a ProRes 4444 MOV and Extended Match Highlights as a PNG, both see-through', async ({ browser }) => {
  test.setTimeout(420_000);
  const { page } = await login(browser, { viewport: { width: 1440, height: 1100 } });
  const m = await matchAtGround(page);
  await page.goto(`/app/matches/${m.id}`);
  await page.getByRole('tab', { name: 'Highlights' }).click();
  const card = page.getByRole('list', { name: 'Title graphics' });
  const match = card.locator('[data-title-export="match"] [data-graphic="highlights_intro"]');
  const extended = card.locator('[data-title-export="extended"] [data-graphic="highlights_intro"]');
  // both titles with the round, the ground, the date and the kick-off time
  for (const g of [match, extended]) {
    await expect(g).toContainText('ROUND 12');
    await expect(g).toContainText(m.venue);
    await expect(g).toContainText(m.when);
  }
  await expect(match).toContainText('MATCHHIGHLIGHTS');
  await expect(match.locator('[data-title-kicker]')).toHaveCount(0);
  await expect(extended.locator('[data-title-kicker]')).toHaveText('EXTENDED');
  await page.waitForTimeout(2_000); // the previews settle
  await page.addStyleTag({ content: 'header, nav[aria-label="Main (compact)"] { visibility: hidden !important; }' });
  await page.getByRole('region', { name: 'Title graphics for your edit' }).screenshot({ path: `${EVIDENCE}/highlights-title-export.png` });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-e2e-title-'));
  // Match Highlights: the MOV, 1920×1080 at 25 fps, on screen 5 s then out
  const mov = await download(page, page.getByRole('button', { name: 'Download Match Highlights (MOV)' }), path.join(dir, 'title.mov'));
  await expect(page.getByRole('status').filter({ hasText: /Downloaded .*\.mov/ })).toBeVisible();
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', mov]).toString()) as { streams: { codec_name: string; profile: string; pix_fmt: string; width: number; height: number; r_frame_rate: string; nb_read_frames: string }[]; format: { format_name: string } };
  expect(probe.format.format_name).toContain('mov');
  expect(probe.streams[0]).toMatchObject({ codec_name: 'prores', profile: '4444', width: 1920, height: 1080, r_frame_rate: '25/1' });
  expect(probe.streams[0]!.pix_fmt).toMatch(/^yuva444/);
  const frames = Number(probe.streams[0]!.nb_read_frames);
  expect(frames).toBe(Math.ceil(5.45 * 25) + 1); // whole frames to the end of the exit, then one clear frame
  // see-through before it comes in and after it has gone; on screen, the panel solid and the rest of the frame clear
  expect(alpha(mov, '1920:1080:0:0', 0)).toBeLessThan(2);
  expect(alpha(mov, '400:800:80:140', 50)).toBeGreaterThan(250);
  expect(alpha(mov, '1200:1080:700:0', 50)).toBeLessThan(2);
  expect(alpha(mov, '1920:1080:0:0', frames - 1)).toBeLessThan(2);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mov, '-vf', 'select=eq(n\\,50)', '-frames:v', '1', path.resolve(EVIDENCE, 'highlights-title-match.png')]);

  // Extended Match Highlights: a transparent PNG
  await page.getByLabel('File').selectOption('png');
  const png = await download(page, page.getByRole('button', { name: 'Download Extended Match Highlights (PNG)' }), path.resolve(EVIDENCE, 'highlights-title-extended.png'));
  const b = fs.readFileSync(png);
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1920, 1080]);
  expect(alpha(png, '400:800:80:140')).toBeGreaterThan(250);
  expect(alpha(png, '1200:1080:700:0')).toBeLessThan(2);
  fs.rmSync(dir, { recursive: true, force: true });
});
