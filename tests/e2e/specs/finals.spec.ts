// Finals on the competition page: the first round from the ladder (top 4: semi-finals 1v4 and 2v3), created with
// kick-off times, then the matches are finals (knockout rules, left out of the ladder) and the next round waits for
// winners. A finals match added by hand gets the same rules.
import { expect, test } from '@playwright/test';
import { api, login } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

test('finals: semi-finals from the ladder, knockout rules, Grand Final waits for the winners', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, page } = await login(browser);
  const tag = crypto.randomUUID().slice(0, 4);
  const comp = await api<{ id: string }>(page, '/api/v1/competitions', { name: `E2E finals ${tag}`, sport: 'football', defaultTimezone: 'Australia/Brisbane', rulesPreset: 'league' });
  const season = await api<{ id: string }>(page, `/api/v1/competitions/${comp.id}/seasons`, { name: '2026' });
  const teams = (await api<{ id: string; name: string; sport: string; status: string }[]>(page, '/api/v1/teams')).filter((t) => t.sport === 'football' && t.status === 'active').slice(0, 4);
  expect(teams).toHaveLength(4);
  // the regular season: two rounds still to play, so all four teams are on the ladder
  for (const [i, [h, a]] of [[0, 1], [2, 3]].entries()) await api(page, '/api/v1/matches', { competitionId: comp.id, seasonId: season.id, homeTeamId: teams[h]!.id, awayTeamId: teams[a]!.id, kickoffLocal: `2027-04-0${i + 1} 15:00`, timezone: 'Australia/Brisbane', round: '1' });

  await page.goto(`/app/competitions/${comp.id}`);
  await expect(page.getByRole('heading', { name: 'Seasons' })).toBeVisible();
  await page.getByRole('tab', { name: 'Finals' }).click();
  const next = page.getByRole('region', { name: 'Next in the finals' });
  await expect(next.getByRole('heading', { name: 'Start the finals' })).toBeVisible();
  await expect(next.getByRole('status')).toContainText('2 regular-season matches still to be played');
  // finals rules: the league's rules with extra time and penalties
  await expect(page.getByText('Extra time: 2×15 minutes when level')).toBeVisible();
  await expect(page.getByText(/The competition's rules, with extra time and penalties when level/)).toBeVisible();
  await next.getByLabel('Format').selectOption('top4');
  const round = next.getByRole('list', { name: 'Semi-finals' });
  await expect(round.getByRole('listitem')).toHaveCount(2);
  await expect(round.getByRole('listitem').first()).toContainText('1st');
  await expect(round.getByRole('listitem').first()).toContainText('4th');
  await next.getByLabel('Kick-off').first().fill('2027-05-01T15:00');
  await next.getByLabel('Kick-off').nth(1).fill('2027-05-02T15:00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scrolling').toBeLessThanOrEqual(1600);
  await page.screenshot({ path: `${EVIDENCE}/finals-start.png`, fullPage: true });
  await next.getByRole('button', { name: 'Create semi-finals' }).click();
  await expect(next.getByRole('heading', { name: 'Waiting for winners' })).toBeVisible({ timeout: 15_000 });
  await expect(next).toContainText('A level score goes to extra time and penalties');
  await expect(page.getByRole('heading', { name: 'Finals matches' }).locator('..')).toContainText('Semi-final');

  // the semi-finals are finals matches with knockout rules, and the ladder leaves them out
  const fx = await api<{ rounds: { round: string; stage: string; matches: { id: string }[] }[] }>(page, `/api/v1/seasons/${season.id}/fixtures`);
  const semis = fx.rounds.find((r) => r.round === 'Semi-final')!;
  expect(semis).toMatchObject({ stage: 'finals' });
  expect(semis.matches).toHaveLength(2);
  const sf = await api<{ stage: string; rules: { knockout: { on: boolean } } }>(page, `/api/v1/matches/${semis.matches[0]!.id}`);
  expect(sf).toMatchObject({ stage: 'finals', rules: { knockout: { on: true } } });
  await page.goto(`/app/matches/${semis.matches[0]!.id}`);
  await expect(page.getByText('Finals', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Stage')).toHaveValue('finals');
  await expect(page.getByRole('switch', { name: /Knockout: extra time and penalties when level/ })).toBeChecked();
  await page.screenshot({ path: `${EVIDENCE}/finals-semi-final.png` });

  // Fixtures and results, by round: the finals after the regular season
  await page.goto(`/app/competitions/${comp.id}`);
  await expect(page.getByRole('heading', { name: 'Seasons' })).toBeVisible();
  await page.getByRole('tab', { name: /^Fixtures and results/ }).click();
  const headings = page.getByRole('tabpanel').getByRole('heading', { level: 3 });
  await expect(headings).toHaveText(['Round 1', 'Semi-finalFinals']);
  await ctx.close();
});
