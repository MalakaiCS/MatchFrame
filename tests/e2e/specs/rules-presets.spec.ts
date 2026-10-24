// Rules of your own: a futsal competition set to 2×18-minute halves with a 5-minute half time through the rules
// form, kept as a preset, offered when the next competition is created, and given to an upcoming match. And timing
// set while a competition is created: hockey in two 35-minute halves with a 10-minute half time, drawn as a
// timeline, saved with the competition, and counted down on the scorer's phone at half time.
import { expect, test } from '@playwright/test';
import { api, endPeriod, login, startFirstHalf } from './helpers';

test('own rules preset: futsal 2×18 with a 5-minute half time', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  const tag = crypto.randomUUID().slice(0, 4);
  const comp = await api<{ id: string }>(page, '/api/v1/competitions', { name: `E2E rules ${tag}`, sport: 'futsal', defaultTimezone: 'Australia/Sydney' });
  const season = await api<{ id: string }>(page, `/api/v1/competitions/${comp.id}/seasons`, { name: '2026' });
  const home = await api<{ id: string }>(page, '/api/v1/teams', { name: `Rules Home ${tag}`, shortName: 'Home', abbreviation: 'HOM', sport: 'futsal' });
  const away = await api<{ id: string }>(page, '/api/v1/teams', { name: `Rules Away ${tag}`, shortName: 'Away', abbreviation: 'AWY', sport: 'futsal' });
  const m = await api<{ id: string }>(page, '/api/v1/matches', { competitionId: comp.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2027-04-03 19:00', timezone: 'Australia/Sydney' });
  const clock = async () => (await api<{ display: { clockText: string } }>(page, `/api/v1/matches/${m.id}/state`)).display.clockText;
  expect(await clock()).toBe('20:00');

  await page.goto(`/app/competitions/${comp.id}`);
  await page.getByRole('button', { name: 'Edit rules' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rules' });
  const name = `Futsal 2×18 ${tag}`;
  await dialog.getByLabel('Name of these rules').fill(name);
  await dialog.getByLabel('Half length (minutes)').fill('18');
  await dialog.getByLabel('Half-time break (minutes)').fill('5');
  await expect(dialog.getByLabel('These rules', { exact: true })).toContainText('2×18-minute halves');
  await expect(dialog.getByLabel('These rules', { exact: true })).toContainText('half time up to 5 minutes');
  // a setting the rules do not allow is pointed out and cannot be saved
  await dialog.getByLabel('Half length (minutes)').fill('45');
  await expect(dialog.getByRole('button', { name: 'Save rules' })).toBeDisabled();
  await dialog.getByLabel('Half length (minutes)').fill('18');
  await dialog.getByLabel(/Keep as one of your presets/).check();
  await expect(dialog.getByLabel(/Also use for upcoming matches/)).toBeChecked();
  await dialog.screenshot({ path: '../../docs/evidence/e2e/rules-editor.png' });
  await dialog.getByRole('button', { name: 'Save rules' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('2×18-minute halves', { exact: false }).first()).toBeVisible();
  // the upcoming match nobody has scored takes the new rules
  await expect.poll(clock).toBe('18:00');

  // the preset is offered when the next futsal competition is created
  await page.goto('/app/competitions');
  await page.getByRole('button', { name: 'New competition' }).first().click();
  const create = page.getByRole('dialog', { name: 'New competition' });
  await create.getByLabel('Sport').selectOption('futsal');
  await expect(create.getByLabel('Rules preset').locator('optgroup[label="Your presets"] option', { hasText: name })).toHaveCount(1);
  await create.getByLabel('Name', { exact: true }).fill(`E2E rules copy ${tag}`);
  await create.getByLabel('Rules preset').selectOption({ label: name });
  await create.getByRole('button', { name: 'Create' }).click();
  await expect(create).toHaveCount(0);
  const comps = await api<{ id: string; name: string }[]>(page, `/api/v1/competitions?search=${encodeURIComponent(`E2E rules copy ${tag}`)}`);
  const copy = await api<{ rulesConfig: { periodMinutes: number; halfTimeMinutes: number } }>(page, `/api/v1/competitions/${comps[0]!.id}`);
  expect(copy.rulesConfig).toMatchObject({ periodMinutes: 18, halfTimeMinutes: 5 });
  await ctx.close();
});

test('own timing when a competition is created: hockey 2×35 halves with a 10-minute half time, counted down at half time', async ({ browser }) => {
  test.setTimeout(90_000);
  const { ctx, page } = await login(browser);
  const tag = crypto.randomUUID().slice(0, 4);
  await page.goto('/app/competitions');
  await page.getByRole('button', { name: 'New competition' }).first().click();
  const create = page.getByRole('dialog', { name: 'New competition' });
  await create.getByLabel('Name', { exact: true }).fill(`E2E timing ${tag}`);
  await create.getByLabel('Sport').selectOption('hockey');
  const timing = create.getByRole('region', { name: 'Match timing' });
  const picture = timing.getByRole('figure', { name: 'Match timing' });
  await expect(picture).toContainText('60 minutes of play'); // the preset: 4×15
  await timing.getByLabel('Halves or quarters').selectOption('halves');
  await expect(timing.getByLabel('Break between quarters (minutes)')).toHaveCount(0);
  await timing.getByLabel('Period length (minutes)').fill('35');
  await timing.getByLabel('Half-time break (minutes)').fill('10');
  await expect(picture).toContainText('70 minutes of play');
  await expect(picture).toContainText('about 80 minutes with the breaks');
  await expect(picture).toContainText('Half Time: 10 minutes');
  await expect(timing).toContainText('changed from the preset');
  await expect(timing.getByLabel('Name of these rules')).toHaveValue('Own rules 2×35, 10-minute half time');
  // a length the rules do not allow cannot be created
  await timing.getByLabel('Period length (minutes)').fill('50');
  await expect(create.getByRole('button', { name: 'Create' })).toBeDisabled();
  await timing.getByLabel('Period length (minutes)').fill('35');
  await create.screenshot({ path: '../../docs/evidence/e2e/new-competition-timing.png' });
  await create.getByRole('button', { name: 'Create' }).click();
  await expect(create).toHaveCount(0);
  const [found] = await api<{ id: string }[]>(page, `/api/v1/competitions?search=${encodeURIComponent(`E2E timing ${tag}`)}`);
  const comp = await api<{ rulesConfig: Record<string, unknown>; rulesDescription: string[] }>(page, `/api/v1/competitions/${found!.id}`);
  expect(comp.rulesConfig).toMatchObject({ format: 'halves', periodMinutes: 35, halfTimeMinutes: 10, label: 'Own rules 2×35, 10-minute half time' });
  expect(comp.rulesDescription[0]).toBe('2×35-minute halves (count-down clock), 10-minute half time');

  // the competition page draws the timing; the editor groups the rules
  await page.goto(`/app/competitions/${found!.id}`);
  await expect(page.getByRole('figure', { name: 'Match timing' })).toContainText('1st Half: 35 minutes');
  await page.getByRole('button', { name: 'Edit rules and timing' }).click();
  const editor = page.getByRole('dialog', { name: 'Rules' });
  for (const h of ['Match timing', 'When the scores are level', 'Other rules']) await expect(editor.getByRole('heading', { name: h })).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel' }).click();

  // a match under these rules: two halves, and half time counts down to the second half on the scorer's phone
  const season = await api<{ id: string }>(page, `/api/v1/competitions/${found!.id}/seasons`, { name: '2026' });
  const home = await api<{ id: string }>(page, '/api/v1/teams', { name: `Timing Home ${tag}`, shortName: 'Home', abbreviation: 'HOM', sport: 'hockey' });
  const away = await api<{ id: string }>(page, '/api/v1/teams', { name: `Timing Away ${tag}`, shortName: 'Away', abbreviation: 'AWY', sport: 'hockey' });
  const m = await api<{ id: string }>(page, '/api/v1/matches', { competitionId: found!.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2027-05-01 15:00', timezone: 'Australia/Brisbane' });
  expect((await api<{ display: { clockText: string } }>(page, `/api/v1/matches/${m.id}/state`)).display.clockText).toBe('35:00');
  await page.goto(`/score/${m.id}`);
  await startFirstHalf(page);
  await expect(page.getByRole('region', { name: 'Score' })).toContainText('1st Half');
  await endPeriod(page, 'Half Time');
  await expect(page.getByRole('timer')).toContainText(/2nd Half due in (10:00|9:\d\d)/);
  await expect(page.getByRole('timer')).toContainText('10-minute break in the rules');
  await ctx.close();
});

