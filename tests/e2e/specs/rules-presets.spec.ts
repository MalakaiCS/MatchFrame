// Rules of your own: a futsal competition set to 2×18-minute halves with a 5-minute half time through the rules
// form, kept as a preset, offered when the next competition is created, and given to an upcoming match.
import { expect, test } from '@playwright/test';
import { api, login } from './helpers';

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
