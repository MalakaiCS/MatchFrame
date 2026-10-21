// Futsal on the scorer phone and the OBS page: a count-down half, accumulated fouls marked at five, a timeout
// that stops the clock, and a send-off counting down the two minutes a team plays short.
import { expect, test } from '@playwright/test';
import { api, clockText, login, startFirstHalf, toSeconds } from './helpers';

test('futsal: fouls, a timeout and a send-off on the scorer phone and the scorebug', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await login(browser);
  const tag = crypto.randomUUID().slice(0, 4);
  const comp = await api<{ id: string }>(page, '/api/v1/competitions', { name: `E2E futsal ${tag}`, sport: 'futsal', defaultTimezone: 'Australia/Sydney' });
  const season = await api<{ id: string }>(page, `/api/v1/competitions/${comp.id}/seasons`, { name: '2026' });
  const home = await api<{ id: string }>(page, '/api/v1/teams', { name: `Bayside Futsal ${tag}`, shortName: 'Bayside', abbreviation: 'BAY', sport: 'futsal', primaryColor: '#1F6FEB', secondaryColor: '#FFFFFF' });
  const away = await api<{ id: string }>(page, '/api/v1/teams', { name: `Northgate Futsal ${tag}`, shortName: 'Northgate', abbreviation: 'NGF', sport: 'futsal', primaryColor: '#E5484D', secondaryColor: '#FFFFFF' });
  const m = await api<{ id: string }>(page, '/api/v1/matches', { competitionId: comp.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2027-03-06 19:00', timezone: 'Australia/Sydney', round: `E2E ${tag}` });
  const [ov] = await api<{ id: string; gamePlanVersionId: string | null }[]>(page, `/api/v1/matches/${m.id}/overlays`);
  expect(ov!.gamePlanVersionId, 'the futsal starter flow is on the match output').toBeTruthy();

  await page.goto(`/score/${m.id}`);
  await startFirstHalf(page);
  const board = page.getByRole('region', { name: 'Score' });
  await expect(board).toContainText('1st Half');
  await expect.poll(async () => toSeconds(await clockText(page)), { message: 'the half counts down from 20:00' }).toBeLessThan(20 * 60);

  const record = async (label: string, team: string, player = true) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: team, exact: true }).click();
    if (player) await page.getByRole('button', { name: 'Skip player' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  // five accumulated fouls: the next one is a 10 m kick
  for (let i = 0; i < 5; i++) await record('Foul', 'Bayside');
  await expect(board).toContainText('Fouls 5 · next is a 10 m kick');
  await expect(page.getByRole('alert').filter({ hasText: 'Home: 5 accumulated fouls, the next one is a 10 m kick' })).toBeVisible();

  // a timeout stops the clock and uses the team's one for the half
  await record('Timeout', 'Northgate', false);
  await expect.poll(async () => (await api<{ clocks: { main: { running: boolean } } }>(page, `/api/v1/matches/${m.id}/state`)).clocks.main.running).toBe(false);
  await expect(board).toContainText('TO 0');

  // a send-off: the team plays a player short for two minutes of playing time (the clock is stopped, so 2:00 stays)
  await record('Red card', 'Northgate');
  await expect(board.getByLabel('Northgate a player short')).toHaveText('4 on court · 2:00');
  await expect(page.getByRole('alert').filter({ hasText: /Away a player short \(4 v 5\)/ })).toBeVisible();

  // the OBS page: the scorebug with the count-down clock and the fouls, marked at five
  const urls = await api<{ production: string }>(page, `/api/v1/overlays/${ov!.id}/urls`);
  const obs = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await obs.goto(urls.production);
  const bug = obs.locator('[data-graphic="scorebug"]');
  await expect(bug).toBeVisible({ timeout: 20_000 });
  await expect(bug).toContainText('F 5 ◆');
  await expect(bug).toContainText(/1[0-9]:[0-5]\d/);
  await obs.screenshot({ path: '../../docs/evidence/e2e/futsal-scorebug.png' });
  await ctx.close();
});
