// Match officials on air: football's added time (the fourth official's board, then "+N" under the scorebug), a
// rugby league sin bin counting down on the scorebug and the phone, a video review ("TRY?" while it is checked, then
// the decision, the try going on the score), and team colours taken from an uploaded crest.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { api, freshMatch, login, sheetCell, startFirstHalf } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';
const PHONE = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true };

/** A new output for the match on a fresh copy of the sport's starter flow, open on an OBS page. */
async function obsPage(browser: Browser, page: Page, matchId: string, sport: string) {
  const tag = matchId.slice(0, 4);
  const plan = await api<{ id: string }>(page, '/api/v1/game-plans', { name: `E2E officials ${sport} ${tag}`, sport, fromStarter: true });
  const version = await api<{ id: string }>(page, `/api/v1/game-plans/${plan.id}/publish`, {});
  const ov = await api<{ id: string }>(page, `/api/v1/matches/${matchId}/overlays`, { name: `E2E officials ${tag}` });
  await page.evaluate(async ([o, v]) => fetch(`/api/v1/overlays/${o}/game-plan`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gamePlanVersionId: v }) }), [ov.id, version.id]);
  const urls = await api<{ production: string }>(page, `/api/v1/overlays/${ov.id}/urls`);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const obs = await ctx.newPage();
  await obs.goto(urls.production);
  return obs;
}
/** The kick-off banner has been on air and gone. */
async function kickOffBannerGone(obs: Page) {
  const banner = obs.locator('[data-graphic$="period_banner"]');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toHaveCount(0, { timeout: 20_000 });
}
const seconds = (t: string) => {
  const m = /(\d+):(\d\d)/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
};

test("added time: the fourth official's board on air, then +N under the scorebug", async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, page } = await login(browser);
  const id = await freshMatch(page);
  const obs = await obsPage(browser, page, id, 'football');
  const phone = await (await browser.newContext({ ...PHONE, storageState: await ctx.storageState() })).newPage();
  await phone.goto(`/score/${id}`);
  await startFirstHalf(phone);
  await expect(obs.locator('[data-graphic="scorebug"]')).toBeVisible({ timeout: 30_000 });
  // the kick-off banner has come and gone (added time comes at the end of a half, long after it)
  await kickOffBannerGone(obs);

  // the scorer enters the minutes from the board
  await phone.getByRole('button', { name: 'Added time', exact: true }).click();
  const dlg = phone.getByRole('dialog', { name: 'Added time' });
  await dlg.getByRole('button', { name: '+3', exact: true }).click();
  await expect(dlg).toHaveCount(0);
  await expect(phone.getByRole('button', { name: 'Added time +3' })).toBeVisible();

  const board = obs.locator('[data-graphic="builtin:added_time"]');
  await expect(board).toBeVisible({ timeout: 15_000 });
  await expect(board.locator('[data-added-minutes="3"]')).toHaveText('+3');
  await expect(board).toContainText('3 minutes');
  const tab = obs.locator('[data-graphic="scorebug"] [data-tab="added"]');
  await expect(tab).toContainText('+3');
  await obs.waitForTimeout(900); // the board's entrance has finished
  await obs.screenshot({ path: `${EVIDENCE}/added-time-board.png` });
  // the board goes after 8 s; "+3" stays on the scorebug for the rest of the half
  await expect(board).toHaveCount(0, { timeout: 15_000 });
  await expect(tab).toContainText('+3');
  await obs.screenshot({ path: `${EVIDENCE}/added-time-scorebug.png` });
  await obs.context().close();
  await phone.context().close();
  await ctx.close();
});

test('rugby league: a sin bin counting down on the scorebug, a video review and its decision', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await login(browser);
  const tag = crypto.randomUUID().slice(0, 4);
  const comp = await api<{ id: string }>(page, '/api/v1/competitions', { name: `E2E league ${tag}`, sport: 'rugby_league', defaultTimezone: 'Australia/Sydney' });
  const season = await api<{ id: string }>(page, `/api/v1/competitions/${comp.id}/seasons`, { name: '2026' });
  const home = await api<{ id: string }>(page, '/api/v1/teams', { name: `Harbour Sharks ${tag}`, shortName: 'Harbour', abbreviation: 'HAR', sport: 'rugby_league', primaryColor: '#1F6FEB', secondaryColor: '#FFFFFF' });
  const away = await api<{ id: string }>(page, '/api/v1/teams', { name: `Northgate Bears ${tag}`, shortName: 'Northgate', abbreviation: 'NGB', sport: 'rugby_league', primaryColor: '#E5484D', secondaryColor: '#FFFFFF' });
  const m = await api<{ id: string }>(page, '/api/v1/matches', { competitionId: comp.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2027-03-06 19:00', timezone: 'Australia/Sydney', round: `E2E ${tag}` });
  const obs = await obsPage(browser, page, m.id, 'rugby_league');
  const phone = await (await browser.newContext({ ...PHONE, storageState: await ctx.storageState() })).newPage();
  await phone.goto(`/score/${m.id}`);
  await startFirstHalf(phone);
  await expect(obs.locator('[data-graphic="scorebug"]')).toBeVisible({ timeout: 30_000 });
  await kickOffBannerGone(obs);

  // a sin bin: ten minutes of playing time, counting down on the phone and under the scorebug
  await sheetCell(phone, 'away', 'sin_bin').click();
  const onPhone = phone.locator('[data-sin-bin="away"]');
  await expect(onPhone).toHaveText(/Sin bin (9:[0-5]\d|10:00)/);
  const tab = obs.locator('[data-graphic="scorebug"] [data-tab="sin_bin"][data-side="away"]');
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await expect(tab).toContainText('NGB');
  await expect(tab).toContainText('SIN BIN');
  const first = seconds((await tab.textContent())!);
  expect(first).toBeGreaterThan(9 * 60);
  await expect.poll(async () => seconds((await tab.textContent())!), { message: 'the countdown runs with the clock', timeout: 10_000 }).toBeLessThan(first - 1);
  await obs.screenshot({ path: `${EVIDENCE}/sin-bin-scorebug.png` });
  // the sin-bin card has gone; the countdown stays under the scorebug
  await expect(obs.locator('[data-graphic$=":card"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(tab).toBeVisible();

  // a video review of a home try: "TRY?" while it is checked
  await sheetCell(phone, 'home', 'video_review').click();
  await phone.getByRole('dialog', { name: /Video review/ }).getByRole('button', { name: 'Try', exact: true }).click();
  const review = obs.locator('[data-graphic="review"]');
  await expect(review).toBeVisible({ timeout: 15_000 });
  await expect(review).toHaveAttribute('data-review-state', 'pending');
  await expect(review).toContainText('Harbour');
  await expect(review.locator('[data-review-headline]')).toHaveText('TRY?');
  const banner = phone.getByRole('region', { name: 'Video review' });
  await expect(banner).toContainText('Video review · Harbour try?');
  await expect(sheetCell(phone, 'away', 'video_review')).toBeDisabled();
  await obs.waitForTimeout(900); // the graphic's entrance has finished
  await obs.screenshot({ path: `${EVIDENCE}/review-pending.png` });

  // the decision: a try, on the score at once, and the graphic turns green; it leaves 6 s later
  await banner.getByRole('button', { name: 'Try', exact: true }).click();
  await expect(review).toHaveAttribute('data-review-state', 'awarded', { timeout: 10_000 });
  await expect(review.locator('[data-review-headline]')).toHaveText('TRY');
  await expect(phone.locator('[data-score-side="home"]')).toHaveText('4');
  await expect(banner).toHaveCount(0);
  await obs.waitForTimeout(800); // the flip to the decision has finished
  await obs.screenshot({ path: `${EVIDENCE}/review-try.png` });
  await expect(review).toHaveCount(0, { timeout: 15_000 });

  // a captain's challenge that fails: no change to the score
  await sheetCell(phone, 'away', 'video_review').click();
  await phone.getByRole('dialog', { name: /Video review/ }).getByRole('button', { name: "Captain's challenge" }).click();
  await expect(review.locator('[data-review-headline]')).toHaveText('CHALLENGE', { timeout: 15_000 });
  await phone.getByRole('region', { name: 'Video review' }).getByRole('button', { name: 'Unsuccessful' }).click();
  await expect(review).toHaveAttribute('data-review-state', 'denied', { timeout: 10_000 });
  await expect(review.locator('[data-review-headline]')).toHaveText('UNSUCCESSFUL');
  await expect(phone.locator('[data-score-side]')).toHaveText(['4', '0']);
  await phone.screenshot({ path: `${EVIDENCE}/scorer-sin-bin.png` });
  await obs.context().close();
  await phone.context().close();
  await ctx.close();
});

test('team colours from the crest: filled in for a new team, offered for an existing one', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await login(browser);
  const tag = crypto.randomUUID().slice(0, 4);
  // a red crest with a white ring and a black outline, on a see-through background
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#111111"/><circle cx="60" cy="60" r="50" fill="#FFFFFF"/><circle cx="60" cy="60" r="40" fill="#C8102E"/></svg>`);

  // the New team dialog fills both colours in from the crest (closed without creating: specs add no football teams)
  await page.goto('/app/assets');
  await page.getByRole('button', { name: 'New team' }).click();
  const dlg = page.getByRole('dialog', { name: 'New team' });
  await dlg.getByLabel('Upload team logo').setInputFiles({ name: 'crest.svg', mimeType: 'image/svg+xml', buffer: svg });
  await expect(dlg.getByRole('group', { name: 'Colours from the crest' })).toBeVisible({ timeout: 15_000 });
  await expect(dlg.getByLabel('Primary')).toHaveValue('#c8102e');
  await expect(dlg.getByLabel('Secondary')).toHaveValue('#ffffff');
  await expect(dlg.getByRole('button', { name: 'Crest colours in use' })).toBeDisabled();
  await page.screenshot({ path: `${EVIDENCE}/crest-colours.png` });
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  // an existing team keeps its colours until "Use crest colours"
  const name = `Crest Netball ${tag}`;
  const team = await api<{ id: string }>(page, '/api/v1/teams', { name, shortName: 'Crest', abbreviation: 'CRN', sport: 'netball', primaryColor: '#1F6FEB', secondaryColor: '#0B1220' });
  await page.reload();
  await page.getByLabel('Search teams').fill(name);
  await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: new RegExp(name) }).click();
  const td = page.getByRole('dialog', { name });
  await td.getByLabel('Upload team logo').setInputFiles({ name: 'crest.svg', mimeType: 'image/svg+xml', buffer: svg });
  const group = td.getByRole('group', { name: 'Colours from the crest' });
  await expect(group).toBeVisible({ timeout: 15_000 });
  expect((await api<{ primaryColor: string }>(page, `/api/v1/teams/${team.id}`)).primaryColor).toBe('#1F6FEB');
  await group.getByRole('button', { name: 'Use crest colours' }).click();
  await expect.poll(async () => (await api<{ primaryColor: string; secondaryColor: string }>(page, `/api/v1/teams/${team.id}`)).primaryColor).toBe('#C8102E');
  expect((await api<{ secondaryColor: string }>(page, `/api/v1/teams/${team.id}`)).secondaryColor).toBe('#FFFFFF');
  await expect(td.getByLabel('Primary')).toHaveValue('#c8102e');
  await ctx.close();
});
