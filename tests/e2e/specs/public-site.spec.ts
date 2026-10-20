// The public website, signed out: MatchFrame branding, every header and footer link reaching a real page, the
// mobile menu, the interactive graphics sample, FAQ and documentation search, and the contact form end to end
// (when CONTACT_EMAIL is set the message is checked in Mailpit; otherwise the form must say it is not connected).
import { expect, test } from '@playwright/test';

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

test('public pages: MatchFrame branding, one heading each, and every header and footer link works', async ({ page, request }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/MatchFrame/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Give every game a broadcast worth watching.');
  const hrefs = new Set<string>();
  for (const link of await page.locator('header a[href^="/"], footer a[href^="/"]').all()) hrefs.add((await link.getAttribute('href'))!.split('#')[0]!);
  // menus render their links when opened
  for (const menu of ['Product', 'Sports', 'Resources']) {
    await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('button', { name: menu }).click();
    for (const link of await page.locator('header a[href^="/"]').all()) hrefs.add((await link.getAttribute('href'))!.split('#')[0]!);
  }
  expect(hrefs.size).toBeGreaterThanOrEqual(15);
  for (const href of hrefs) {
    const r = await request.get(href);
    expect(r.status(), href).toBe(200);
  }
  for (const href of [...hrefs].filter((h) => !/^\/(login|register|status)$/.test(h))) {
    await page.goto(href);
    await expect(page.getByRole('heading', { level: 1 }), href).toHaveCount(1);
    await expect(page.getByText('Broadcast Studio')).toHaveCount(0);
  }
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/Disallow: \//);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/docs/getting-started/first-match');
  expect(sitemap).not.toContain('/app');
});

test('mobile menu and the interactive graphics sample', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // the real renderer: a goal raises the sample score and puts the goal graphic on air
  await expect(page.locator('[data-layer="scoreboard"]')).toBeVisible();
  await page.getByRole('button', { name: 'Goal Harbour' }).click();
  await expect(page.locator('[data-layer="event"]')).toBeVisible();
  await expect(page.locator('[data-layer="scoreboard"]')).toContainText('3');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('navigation', { name: 'Main (mobile)' }).getByRole('link', { name: 'FAQ' }).click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Questions and answers');
  await ctx.close();
});

test('FAQ search and deep links; documentation search', async ({ page }) => {
  await page.goto('/faq');
  await page.getByRole('searchbox', { name: 'Search the questions' }).fill('OBS');
  await expect(page.getByText(/of \d+ questions match/)).toBeVisible();
  await expect(page.locator('details#obs')).toHaveAttribute('open', '');
  await expect(page.locator('details#sponsor-reports')).toHaveCount(0);
  await page.goto('/'); // arrive fresh, as from a shared link (a same-page hash jump keeps the search)
  await page.goto('/faq#offline');
  await expect(page.locator('details#offline')).toHaveAttribute('open', '');
  await expect(page.locator('details#offline')).toContainText('Scoring keeps working offline');

  await page.goto('/docs');
  await page.getByRole('searchbox', { name: 'Search the documentation' }).fill('browser source');
  await page.locator('[aria-live="polite"]').getByRole('link', { name: /Connect your graphics to OBS/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connect your graphics to OBS');
  await expect(page.getByText('Shutdown source when not visible').first()).toBeVisible();
  await expect(page.getByText(/Checked against the product on/)).toBeVisible();
});

test('contact form: sends to the configured inbox, or says it is not connected', async ({ page, request }) => {
  const status = (await (await request.get('/api/v1/public/contact')).json()) as { enabled: boolean };
  await page.goto('/contact');
  if (!status.enabled) {
    await expect(page.getByText('The contact form is not connected yet')).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Please tell us your name' })).toBeVisible();
  const marker = `e2e-${Date.now()}`;
  await page.getByLabel('Your name').fill('Ana Silva');
  await page.getByLabel('Email to reply to').fill('ana@club.example');
  await page.getByLabel('What is it about?').selectOption('setup');
  await page.getByLabel('Message', { exact: true }).fill(`How do we add the graphics to OBS? ${marker}`);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Message sent')).toBeVisible();
  // the message really arrived, with the sender as reply-to
  await expect.poll(async () => {
    const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(marker)}`);
    return r.ok() ? ((await r.json()) as { messages_count: number }).messages_count : -1;
  }, { timeout: 15_000 }).toBe(1);
  const found = (await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(marker)}`)).json()) as { messages: { ID: string; Subject: string }[] };
  expect(found.messages[0]!.Subject).toBe('[MatchFrame contact] Setup help from Ana Silva');
  const msg = (await (await request.get(`${MAILPIT}/api/v1/message/${found.messages[0]!.ID}`)).json()) as { ReplyTo: { Address: string }[] };
  expect(msg.ReplyTo[0]!.Address).toBe('ana@club.example');
});
