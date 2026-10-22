// Scorer PWA in a real browser: clock continuity across refresh (A13), offline intent survives a refresh
// and applies once (A14), producer takeover while the first device is offline (A15).
import { expect, test } from '@playwright/test';
import { api, clockText, freshMatch, login, score, startFirstHalf, teamColumn, toSeconds } from './helpers';

test('running clock is anchor-derived and survives a refresh (A13)', async ({ browser }) => {
  const { page } = await login(browser);
  const id = await freshMatch(page);
  await page.goto(`/score/${id}`);
  await startFirstHalf(page);
  const clockBtn = page.getByRole('region', { name: 'Clock controls' }).getByRole('button', { name: /(Start|Resume|Pause) clock/ });
  await page.waitForTimeout(1500); // phase change may auto-start the clock server-side
  if (/Start|Resume/.test((await clockBtn.textContent()) ?? '')) await clockBtn.click();
  await expect(clockBtn).toHaveText(/Pause clock/, { timeout: 10_000 });
  await page.waitForTimeout(4000);
  const before = toSeconds(await clockText(page));
  const t0 = Date.now();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Score' })).toBeVisible();
  await page.waitForTimeout(1500);
  const after = toSeconds(await clockText(page));
  const elapsed = (Date.now() - t0) / 1000;
  expect(before).toBeGreaterThanOrEqual(3);
  expect(Math.abs(after - (before + elapsed))).toBeLessThanOrEqual(1.5); // bounded disagreement after reload
  // server view agrees with the client
  const st = await api<{ clocks: { main: { running: boolean } } }>(page, `/api/v1/matches/${id}/state`);
  expect(st.clocks.main.running).toBe(true);
});

test('offline goal survives a refresh and applies exactly once after reconnect (A14)', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  const id = await freshMatch(page);
  await page.goto(`/score/${id}`);
  await startFirstHalf(page);
  await page.waitForTimeout(1500); // service worker has cached the shell
  await ctx.setOffline(true);
  await expect(page.getByText('Offline', { exact: true })).toBeVisible({ timeout: 15_000 });
  await teamColumn(page, 'home').getByRole('button', { name: 'Goal', exact: true }).click();
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.getByText('1 pending')).toBeVisible();
  await page.reload(); // offline refresh: shell from the service worker, intent from IndexedDB
  await expect(page.getByText('1 pending')).toBeVisible({ timeout: 15_000 });
  await ctx.setOffline(false);
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 30_000 });
  expect(await score(page)).toEqual([1, 0]);
  await page.reload();
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  expect(await score(page)).toEqual([1, 0]); // once, not twice
  const facts = await api<{ type: string; voided: boolean }[]>(page, `/api/v1/matches/${id}/facts`);
  expect(facts.filter((f) => f.type === 'goal' && !f.voided)).toHaveLength(1);
});

test('producer takes over while the scorer is offline; stale offline actions need review (A15)', async ({ browser }) => {
  const a = await login(browser);
  const id = await freshMatch(a.page);
  await a.page.goto(`/score/${id}`);
  await startFirstHalf(a.page);
  await a.page.waitForTimeout(1500);
  await a.ctx.setOffline(true);
  await expect(a.page.getByText('Offline', { exact: true })).toBeVisible({ timeout: 15_000 });
  await teamColumn(a.page, 'home').getByRole('button', { name: 'Goal', exact: true }).click();
  await a.page.getByRole('button', { name: 'Later' }).click();
  await expect(a.page.getByText('1 pending')).toBeVisible();
  // producer on another device takes control and records the authoritative goal for the away side
  const b = await login(browser);
  await b.page.goto(`/score/${id}`);
  await b.page.waitForTimeout(2000);
  const take = b.page.getByRole('button', { name: 'Take over scoring' });
  if (await take.count()) await take.click(); // a different user must ask; the same producer on a new device takes over
  await expect(teamColumn(b.page, 'away').getByRole('button', { name: 'Goal', exact: true })).toBeEnabled({ timeout: 15_000 });
  await teamColumn(b.page, 'away').getByRole('button', { name: 'Goal', exact: true }).click();
  await b.page.getByRole('button', { name: 'Later' }).click();
  await expect(b.page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  // the old device reconnects: its intent was based on an old version and must not apply silently
  await a.ctx.setOffline(false);
  await expect(a.page.getByRole('region', { name: 'Needs review' })).toBeVisible({ timeout: 30_000 });
  const st = await api<{ projection: { score: { home: number; away: number } } }>(b.page, `/api/v1/matches/${id}/state`);
  expect(st.projection.score).toEqual({ home: 0, away: 1 });
  await expect(a.page.getByRole('alert').filter({ hasText: /took over|control/i })).toBeVisible(); // told, in words, that it no longer scores
});
