// Match thumbnails: the Thumbnails tab shows one for each kind of video in the match's look, downloads each as a
// PNG at YouTube's size or full HD, and shows the score only when asked. The crests and the competition's logo are
// sample images (original shields drawn here) served to the page in place of the match's own, so the evidence shows
// a thumbnail as a club with crests would see it without changing any team; the rest is the match's real data.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshMatch, login } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

const svg = (body: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240">${body}</svg>`).toString('base64')}`;
const shield = (fill: string, band: string, letters: string) =>
  svg(`<path d="M100 6 L188 34 V120 C188 178 146 214 100 234 C54 214 12 178 12 120 V34 Z" fill="#fff"/><path d="M100 18 L176 42 V120 C176 170 140 202 100 220 C60 202 24 170 24 120 V42 Z" fill="${fill}"/><path d="M24 92 H176 V128 H24 Z" fill="${band}"/><text x="100" y="121" font-family="Arial, sans-serif" font-size="30" font-weight="900" text-anchor="middle" fill="${fill}">${letters}</text><circle cx="100" cy="172" r="22" fill="#fff"/><path d="M100 152 l8 14 h16 l-13 10 5 16 -16 -10 -16 10 5 -16 -13 -10 h16 Z" fill="${fill}"/>`);
const badge = svg(`<circle cx="100" cy="120" r="92" fill="#fff"/><circle cx="100" cy="120" r="80" fill="none" stroke="#0B1220" stroke-width="6"/><path d="M60 150 L100 60 L140 150 Z" fill="#0B1220"/><text x="100" y="186" font-family="Arial, sans-serif" font-size="24" font-weight="900" text-anchor="middle" fill="#0B1220">CPL</text>`);

const LOOKS: Record<string, Record<string, unknown>> = {
  premier: { themeKey: 'premier', primary: '#E90052', secondary: '#37003C', accent: '#04F5FF', text: '#37003C', panel: '#FFFFFF', font: "'Outfit Variable', 'Inter Variable', ui-sans-serif, sans-serif", radius: 10 },
  primetime: { themeKey: 'primetime', primary: '#E10600', secondary: '#17191E', accent: '#FFC400', text: '#17191E', panel: '#FFFFFF', font: "'Saira Variable', 'Inter Variable', ui-sans-serif, sans-serif", radius: 0 },
};

/** The match's render data with sample crests, a competition logo and a round; and another look when asked. */
async function sampleCrests(page: Page, look?: string) {
  await page.route('**/render-data', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { data: { theme: Record<string, unknown>; match: { round?: string | null; competition: { logoUrl: string | null }; teams: Record<'home' | 'away', { logoUrl: string | null; primaryColor: string }> } } };
    const m = body.data.match;
    m.round = 'Round 12';
    m.competition.logoUrl = badge;
    m.teams.home = { ...m.teams.home, logoUrl: shield('#1F6FEB', '#FFCE3A', 'HCF'), primaryColor: '#123A8C' };
    m.teams.away = { ...m.teams.away, logoUrl: shield('#E58B12', '#0B1220', 'NGW'), primaryColor: '#5BC8F0' };
    if (look) body.data.theme = { ...body.data.theme, ...LOOKS[look] };
    await route.fulfill({ response: res, json: body });
  });
}

/** A PNG's width and height from its header. */
const pngSize = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

async function download(page: Page, button: ReturnType<Page['getByRole']>, to: string) {
  const [d] = await Promise.all([page.waitForEvent('download'), button.click()]);
  await d.saveAs(to);
  return fs.readFileSync(to);
}

test('thumbnails: one for each kind of video, downloaded at YouTube size and full HD, the score only when asked', async ({ browser }) => {
  test.setTimeout(180_000);
  const { page } = await login(browser, { viewport: { width: 1440, height: 1100 } });
  const matchId = await freshMatch(page);
  await sampleCrests(page);
  await page.goto(`/app/matches/${matchId}`);
  await page.getByRole('tab', { name: 'Thumbnails' }).click();
  const list = page.getByRole('list', { name: 'Thumbnails' });
  for (const [kind, label] of [['live', 'LIVE STREAM'], ['highlights', 'HIGHLIGHTS'], ['extended', 'HIGHLIGHTS'], ['full_match', 'FULL MATCH'], ['custom', 'MATCH REPLAY']]) {
    await expect(list.locator(`[data-thumbnail="${kind}"] [data-thumbnail-label]`)).toContainText(label!);
  }
  await expect(list.locator('[data-thumbnail="extended"] [data-thumbnail-label]')).toContainText('EXTENDED');
  // the match's competition, both teams, no score
  const live = list.locator('[data-thumbnail="live"]');
  await expect(live.locator('[data-thumbnail-competition]')).not.toBeEmpty();
  await expect(live.locator('[data-thumbnail-team]')).toHaveCount(2);
  await expect(live.locator('[data-thumbnail-score]')).toHaveCount(0);
  await expect(live.locator('img')).toHaveCount(3); // the competition's logo and both crests
  // the sticky app header would sit over the top of the capture
  await page.addStyleTag({ content: 'header, nav[aria-label="Main (compact)"] { visibility: hidden !important; }' });
  await page.getByRole('tabpanel').screenshot({ path: `${EVIDENCE}/thumbnails-tab.png` });

  // each kind as a PNG at YouTube's size (kept as evidence), and one at full HD
  const dir = path.resolve(EVIDENCE);
  for (const [kind, name] of [['live', 'live stream'], ['highlights', 'highlights'], ['extended', 'extended highlights'], ['full_match', 'full match']] as const) {
    const png = await download(page, list.getByRole('button', { name: `Download the ${name} thumbnail` }), path.join(dir, `thumbnail-${kind.replace('_', '-')}.png`));
    expect(pngSize(png), kind).toEqual([1280, 720]);
  }
  await page.getByLabel('Your own words').fill('Grand Final');
  await expect(list.locator('[data-thumbnail="custom"] [data-thumbnail-label]')).toContainText('GRAND FINAL');
  await page.getByLabel('Size').selectOption('1920');
  const hd = await download(page, list.getByRole('button', { name: 'Download the own words thumbnail' }), path.join(dir, 'thumbnail-own-words.png'));
  expect(pngSize(hd)).toEqual([1920, 1080]);

  // the score, when asked
  await page.getByRole('switch', { name: 'Show the score' }).click();
  await expect(live.locator('[data-thumbnail-score]')).toHaveText('0–0');
});

test('thumbnails follow the look: the same match in two other looks', async ({ browser }) => {
  test.setTimeout(120_000);
  const { page } = await login(browser, { viewport: { width: 1440, height: 1100 } });
  const matchId = await freshMatch(page);
  for (const look of Object.keys(LOOKS)) {
    await page.unroute('**/render-data');
    await sampleCrests(page, look);
    await page.goto(`/app/matches/${matchId}`);
    await page.getByRole('tab', { name: 'Thumbnails' }).click();
    const list = page.getByRole('list', { name: 'Thumbnails' });
    await expect(list.locator('[data-thumbnail="highlights"] img')).toHaveCount(3);
    const png = await download(page, list.getByRole('button', { name: 'Download the highlights thumbnail' }), path.resolve(EVIDENCE, `thumbnail-highlights-${look}.png`));
    expect(pngSize(png)).toEqual([1280, 720]);
  }
});
