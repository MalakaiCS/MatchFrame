// The Matches page lists newest first unless the person chose otherwise (a click on Kick-off): an order saved
// automatically before newest first was the default is ignored, and an order picked on purpose is remembered.
// Quick ranges (Today, This week…) stand in for the date boxes.
import { expect, test } from '@playwright/test';
import { api, login } from './helpers';

test('matches: newest first by default; a chosen order is kept', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  // filters saved by the page before, with the old default order nobody chose
  const prefs = await api<{ prefs: { matchFilters?: Record<string, unknown> } }>(page, '/api/v1/me/preferences');
  await page.evaluate(async (matchFilters) => {
    await fetch('/api/v1/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ matchFilters }) });
  }, { ...(prefs.prefs.matchFilters ?? {}), sort: 'scheduledAt', sortChosen: undefined, range: 'all', competitionId: '', from: '', to: '', status: '', sport: '', view: 'table' });

  const listed = (p: typeof page) => p.waitForRequest((r) => /\/api\/v1\/matches\?/.test(r.url()) && r.url().includes('page=1'));
  const kickoff = page.locator('th', { hasText: 'Kick-off' });
  let req = listed(page);
  await page.goto('/app/matches');
  expect(new URL((await req).url()).searchParams.get('sort')).toBe('-scheduledAt');
  await expect(kickoff).toHaveAttribute('aria-sort', 'descending');

  // chosen on purpose (a click on Kick-off): kept after a reload
  req = listed(page);
  await kickoff.getByRole('button').click();
  expect(new URL((await req).url()).searchParams.get('sort')).toBe('scheduledAt');
  await expect.poll(async () => (await api<{ prefs: { matchFilters?: { sortChosen?: boolean } } }>(page, '/api/v1/me/preferences')).prefs.matchFilters?.sortChosen).toBe(true);
  await page.reload();
  await expect(kickoff).toHaveAttribute('aria-sort', 'ascending');

  // quick ranges in place of date boxes: Today asks for today only; Dates… brings the boxes back
  req = listed(page);
  await page.getByRole('group', { name: 'When' }).getByRole('button', { name: 'Today' }).click();
  const today = new URL((await req).url()).searchParams;
  expect(new Date(today.get('to')!).getTime() - new Date(today.get('from')!).getTime()).toBe(24 * 3600_000);
  await expect(page.getByLabel('From')).toHaveCount(0);
  await page.getByRole('group', { name: 'When' }).getByRole('button', { name: 'Dates…' }).click();
  await expect(page.getByLabel('From')).toBeVisible();
  await page.getByRole('group', { name: 'When' }).getByRole('button', { name: 'All' }).click();

  // back to newest first for the account's other tests
  await kickoff.getByRole('button').click();
  await expect(kickoff).toHaveAttribute('aria-sort', 'descending');
  await ctx.close();
});
