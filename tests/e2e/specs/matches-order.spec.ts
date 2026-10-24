// The Matches page lists newest first unless the person chose otherwise: an order saved automatically before newest
// first was the default is ignored, and an order picked on purpose is remembered.
import { expect, test } from '@playwright/test';
import { api, login } from './helpers';

test('matches: newest first by default; a chosen order is kept', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  // filters saved by the page before, with the old default order nobody chose
  const prefs = await api<{ prefs: { matchFilters?: Record<string, unknown> } }>(page, '/api/v1/me/preferences');
  await page.evaluate(async (matchFilters) => {
    await fetch('/api/v1/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ matchFilters }) });
  }, { ...(prefs.prefs.matchFilters ?? {}), sort: 'scheduledAt', sortChosen: undefined, competitionId: '', from: '', to: '', status: '', sport: '' });

  const listed = (p: typeof page) => p.waitForRequest((r) => /\/api\/v1\/matches\?/.test(r.url()) && r.url().includes('page=1'));
  let req = listed(page);
  await page.goto('/app/matches');
  expect(new URL((await req).url()).searchParams.get('sort')).toBe('-scheduledAt');
  await expect(page.getByLabel('Order')).toHaveValue('-scheduledAt');
  await expect(page.getByLabel('Order').locator('option').first()).toHaveText('Newest first');

  // chosen on purpose: kept after a reload
  req = listed(page);
  await page.getByLabel('Order').selectOption('scheduledAt');
  expect(new URL((await req).url()).searchParams.get('sort')).toBe('scheduledAt');
  await expect.poll(async () => (await api<{ prefs: { matchFilters?: { sortChosen?: boolean } } }>(page, '/api/v1/me/preferences')).prefs.matchFilters?.sortChosen).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Order')).toHaveValue('scheduledAt');
  // back to newest first for the account's other tests
  await page.getByLabel('Order').selectOption('-scheduledAt');
  await ctx.close();
});
