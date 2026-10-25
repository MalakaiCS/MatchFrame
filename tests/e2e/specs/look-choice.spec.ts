// Choosing a look for a tournament and for a match, from all eleven built-in looks: upcoming matches follow the
// tournament, a match can have its own, and "Same as the tournament" puts it back. A look applies as soon as it is
// chosen (no Apply button).
import { expect, test } from '@playwright/test';
import { api, login } from './helpers';

test('tournament look and match look from the built-in looks', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  const tag = crypto.randomUUID().slice(0, 4);
  // a tournament of its own, so no other spec's matches change look
  const comp = await api<{ id: string }>(page, '/api/v1/competitions', { name: `E2E looks ${tag}`, sport: 'football', defaultTimezone: 'Australia/Brisbane' });
  const season = await api<{ id: string }>(page, `/api/v1/competitions/${comp.id}/seasons`, { name: '2026' });
  const teams = await api<{ id: string; sport: string; status: string }[]>(page, '/api/v1/teams');
  const [h, a] = teams.filter((t) => t.sport === 'football' && t.status === 'active');
  const m = await api<{ id: string }>(page, '/api/v1/matches', { competitionId: comp.id, seasonId: season.id, homeTeamId: h!.id, awayTeamId: a!.id, kickoffLocal: '2027-03-06 15:00', timezone: 'Australia/Brisbane', round: `E2E ${tag}` });
  const output = async () => (await api<{ id: string; theme: { profile: string } | null }[]>(page, `/api/v1/matches/${m.id}/overlays`))[0]!;
  const onScreen = async () => (await api<{ data: { theme: { themeKey: string } } }>(page, `/api/v1/overlays/${(await output()).id}/render-data`)).data.theme.themeKey;

  // the tournament: Liga, one of the built-in looks
  await page.goto(`/app/competitions/${comp.id}`);
  await page.getByRole('tab', { name: 'Graphics & production' }).click();
  await page.getByLabel('Tournament look').selectOption({ label: 'Liga' });
  await expect(page.getByText(/Every match uses Liga unless it has a look of its own/)).toBeVisible();
  await expect.poll(onScreen).toBe('liga');

  // the match: its own look, Premier
  await page.goto(`/app/matches/${m.id}`);
  const row = page.locator('li', { has: page.getByLabel('Look', { exact: true }) });
  await expect(row).toContainText('Look: Liga v');
  await expect(row).toContainText('The tournament’s look');
  await row.getByLabel('Look', { exact: true }).selectOption({ label: 'Premier' });
  await expect(row).toContainText('Look: Premier v');
  await expect(row).toContainText('This match’s own look');
  await expect.poll(onScreen).toBe('premier');

  // back to the tournament's look
  await row.getByLabel('Look', { exact: true }).selectOption({ label: 'Same as the tournament (Liga)' });
  await expect(row).toContainText('Look: Liga v');
  await expect.poll(onScreen).toBe('liga');
  await ctx.close();
});
