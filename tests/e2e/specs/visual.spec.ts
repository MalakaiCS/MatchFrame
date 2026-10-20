// Visual regression: every built-in graphic in every look, rendered by the real engine on the theme page with
// its sample data, compared pixel-for-pixel (2% tolerance) with the committed baselines in __screenshots__/.
// Animations are disabled through the reduced-motion preference so each capture is the settled graphic.
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const LOOKS = ['broadcast', 'minimal', 'club', 'premier', 'liga', 'major', 'southern', 'continental', 'primetime', 'meister'] as const;
const OTHER_SPORTS = ['basketball', 'netball', 'rugby_league', 'afl', 'hockey'] as const;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function openLook(page: Page, look: string, sport: string, format = '16:9') {
  await page.goto(`/app/themes/${look}`);
  // the sticky app header (organisation name, clock) would otherwise overlap the stage in captures lower on the page
  await page.addStyleTag({ content: 'header, nav[aria-label="Main (compact)"] { visibility: hidden !important; }' });
  await page.getByLabel('Sport').selectOption(sport);
  await page.getByLabel('Format').selectOption(format);
  const loop = page.getByRole('switch').first();
  if ((await loop.getAttribute('aria-checked')) === 'true') await loop.click(); // loop off: graphics stay up
  await expect(page.getByTestId('theme-preview-stage')).toBeVisible();
}

async function snapAll(page: Page, prefix: string, limit?: number) {
  const stage = page.getByTestId('theme-preview-stage');
  const cards = page.locator('button[aria-pressed]');
  const n = Math.min(await cards.count(), limit ?? 99);
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const name = (await card.locator('span.text-sm.font-medium').first().textContent())!.trim();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForTimeout(700); // reduced motion: the entrance is instant; data and fonts settle
    await expect(stage).toHaveScreenshot(`${prefix}-${slug(name)}.png`, { maxDiffPixelRatio: 0.02, animations: 'disabled' });
  }
}

for (const look of LOOKS) {
  test(`${look} look: every football graphic`, async ({ browser }) => {
    const { page } = await login(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await openLook(page, look, 'football');
    await snapAll(page, `${look}-football`);
  });
}

for (const look of ['broadcast', 'premier'] as const) {
  test(`${look} look: vertical (9:16) and venue formats`, async ({ browser }) => {
    const { page } = await login(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await openLook(page, look, 'football', '9:16');
    await snapAll(page, `${look}-football-9x16`, 6);
    await openLook(page, look, 'football', 'venue');
    await snapAll(page, `${look}-football-venue`, 4);
  });
}

for (const sport of OTHER_SPORTS) {
  test(`broadcast look: ${sport} sport-specific graphics`, async ({ browser }) => {
    const { page } = await login(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await openLook(page, 'broadcast', sport);
    await snapAll(page, `broadcast-${sport}`, 6);
  });
}
