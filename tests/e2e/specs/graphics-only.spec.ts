import { expect, test } from '@playwright/test';
import { api, freshMatch, login } from './helpers';

// Graphics-only deployment (STREAMING_ENABLED=false): streaming UI is hidden and the stream API is absent.
// Run with E2E_GRAPHICS_ONLY=1 against such a deployment (e.g. scripts/start-hosted.mjs).
test.skip(!process.env.E2E_GRAPHICS_ONLY, 'needs a STREAMING_ENABLED=false deployment');

test('graphics-only hides streaming and keeps overlays working', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  const me = await api<{ features?: { streaming: boolean } }>(page, '/api/v1/me');
  expect(me.features?.streaming).toBe(false);
  await expect(page.getByRole('link', { name: 'Matches' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Streams' })).toHaveCount(0);
  await expect(page.getByText('Stream health')).toHaveCount(0);
  expect(await page.evaluate(async () => (await fetch('/api/v1/streams')).status)).toBe(404);

  const matchId = await freshMatch(page);
  await page.goto(`/app/matches/${matchId}`);
  await expect(page.getByRole('tab', { name: 'OBS link' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Streams' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Recordings/ })).toHaveCount(0);

  await page.goto('/app/streams');
  await expect(page.getByText('Streaming is turned off on this deployment')).toBeVisible();
  await ctx.close();
});
