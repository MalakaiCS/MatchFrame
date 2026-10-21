// The OBS link tab: the output format can be changed and changed back (the picker shows the saved format).
import { expect, test } from '@playwright/test';
import { api, freshMatch, login } from './helpers';

test('output format: venue screen, then back to broadcast 16:9', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  const matchId = await freshMatch(page);
  await page.goto(`/app/matches/${matchId}`);
  await page.getByRole('tab', { name: 'OBS link' }).click();
  const picker = page.getByLabel('Output format').first();
  await expect(picker).toHaveValue('16:9');
  const saved = async () => (await api<{ format: string }[]>(page, `/api/v1/matches/${matchId}/overlays`))[0]!.format;
  for (const format of ['venue', '9:16', '16:9'] as const) {
    await picker.selectOption(format);
    await expect.poll(saved, { message: `saved as ${format}` }).toBe(format);
    await expect(picker).toHaveValue(format);
    await expect(picker).toBeEnabled();
  }
  await ctx.close();
});
