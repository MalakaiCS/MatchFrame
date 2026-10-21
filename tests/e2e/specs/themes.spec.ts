import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('theme page previews every graphic and plays entrance and exit', async ({ browser }) => {
  const { page } = await login(browser);
  await page.goto('/app/themes');
  await page.getByText('View graphics and animations').first().click();
  await expect(page).toHaveURL(/\/app\/themes\/[a-z]+$/);

  const stage = page.getByTestId('theme-preview-stage');
  const cards = page.locator('button[aria-pressed]');
  await expect(cards).toHaveCount(28); // football: every built-in except the basketball score update and timeout
  await page.getByLabel('Sport').selectOption('basketball');
  await expect(cards).toHaveCount(27); // basketball: no goal, card or shoot-out graphics
  await page.getByLabel('Sport').selectOption('football');

  await page.getByRole('switch').first().click(); // loop off: real timing, stays on until taken out
  await page.getByRole('button', { name: /Lower third/ }).click();
  const graphic = stage.locator('[data-graphic="lower_third"]');
  await expect(graphic).toBeVisible();
  await expect(graphic).toContainText('Sam Patel');
  await page.getByRole('button', { name: 'Take out' }).click();
  await expect(graphic).toHaveCount(0);
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await expect(graphic).toBeVisible();

  // picking a graphic far down the list brings the preview back into view
  await page.getByRole('button', { name: /Ticker/ }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /Ticker/ }).click();
  await expect(stage).toBeInViewport();
  await expect(stage.locator('[data-graphic="ticker"]')).toBeVisible();

  await page.goto('/app/themes/not-a-theme');
  await expect(page.getByText('Theme not found')).toBeVisible();
});
