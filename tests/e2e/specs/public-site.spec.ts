// The public website, signed out: MatchFrame branding, every header and footer link reaching a real page, the
// light/dark switch, the mobile menu, the homepage's broadcast preview, FAQ and documentation search, pricing with
// the plan carried to sign-up, and the contact form end to end (stored with a reference, emailed to the team inbox
// and checked in Mailpit, and listed for staff in the console; or, with nobody to read it, saying it is not connected).
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

test('public pages: MatchFrame branding, one heading each, and every header and footer link works', async ({ page, request }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/MatchFrame/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Professional sports graphics. Built for your matchday.');
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
  // the graphics video is MatchFrame's own recording, served from the site
  await page.goto('/showcase');
  const video = page.locator('video[src="/media/matchframe-looks.mp4"]');
  await expect(video).toHaveAttribute('poster', '/media/matchframe-looks.jpg');
  for (const [file, type] of [['/media/matchframe-looks.mp4', 'video/mp4'], ['/media/matchframe-looks.jpg', 'image/jpeg']]) {
    const r = await request.get(file);
    expect(r.status(), file).toBe(200);
    expect(r.headers()['content-type'], file).toContain(type);
  }
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/Disallow: \//);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/docs/getting-started/first-match');
  expect(sitemap).not.toContain('/app');
});

test('light and dark mode: the switch changes the page and is remembered', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('banner').getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(bg);
  await page.getByRole('contentinfo').getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('mobile menu and the broadcast preview', async ({ browser }) => {
  // reduced motion: no sample sequence, so the score only moves when the visitor presses a button
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const path of ['/', '/pricing', '/showcase', '/contact', '/features', '/login', '/register']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }
  await page.goto('/');
  // the real renderer: a goal raises the sample score and puts the goal graphic on air; Reset puts it back
  await expect(page.locator('[data-layer="scoreboard"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play sample' })).toBeVisible();
  await page.getByRole('button', { name: 'Goal Harbour' }).click();
  await expect(page.locator('[data-layer="event"]')).toBeVisible();
  await expect(page.locator('[data-layer="scoreboard"]')).toContainText('3');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('[data-layer="scoreboard"]')).toContainText('2');
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

test('contact form: stored with a reference, emailed to the team inbox, listed for staff; or not connected', async ({ page, request, browser }) => {
  const status = (await (await request.get('/api/v1/public/contact')).json()) as { enabled: boolean; email: boolean };
  await page.goto('/contact?topic=sales&plan=league');
  if (!status.enabled) {
    await expect(page.getByText('The contact form is not connected yet')).toBeVisible();
    return;
  }
  // a link from pricing chooses the topic and plan
  await expect(page.getByLabel('What is it about?')).toHaveValue('sales');
  await expect(page.getByLabel('Plan you are interested in (optional)')).toHaveValue('league');
  await page.getByLabel('What is it about?').selectOption('setup');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Check the highlighted fields' })).toBeVisible();
  await expect(page.getByText('Please tell us your name')).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeFocused();
  // matchday problems are pointed at the troubleshooting guides first
  await page.getByLabel('What is it about?').selectOption('support');
  await expect(page.getByRole('link', { name: 'missing graphics' })).toBeVisible();
  const marker = `e2e-${Date.now()}`;
  await page.getByLabel('Your name').fill('Ana Silva');
  await page.getByLabel('Email to reply to').fill('ana@club.example');
  await page.getByLabel('What is it about?').selectOption('setup');
  await page.getByLabel('Message', { exact: true }).fill(`How do we add the graphics to OBS? ${marker}`);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Message received')).toBeVisible();
  const reference = (await page.getByRole('status').filter({ hasText: 'reference' }).locator('strong').first().textContent())!;
  expect(reference).toMatch(/^MF-[2-9A-HJ-NP-Z]{6}$/);
  if (status.email) {
    // the message really arrived, with the sender as reply-to
    await expect.poll(async () => {
      const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(marker)}`);
      return r.ok() ? ((await r.json()) as { messages_count: number }).messages_count : -1;
    }, { timeout: 15_000 }).toBe(1);
    const found = (await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(marker)}`)).json()) as { messages: { ID: string; Subject: string }[] };
    expect(found.messages[0]!.Subject).toBe(`[MatchFrame contact] Product or setup question from Ana Silva (${reference})`);
    const msg = (await (await request.get(`${MAILPIT}/api/v1/message/${found.messages[0]!.ID}`)).json()) as { ReplyTo: { Address: string }[] };
    expect(msg.ReplyTo[0]!.Address).toBe('ana@club.example');
  }
  // site staff read it in the console (the test account is an Owner when PLATFORM_OWNER_EMAILS names it)
  const { ctx, page: staff } = await login(browser);
  const me = await (await staff.request.get('/api/v1/staff/me')).json().catch(() => null);
  if (me?.can?.['enquiries.read']) {
    await staff.goto('/staff/enquiries');
    await staff.getByRole('button', { name: new RegExp(`Ana Silva.*${reference}`) }).click();
    await expect(staff.getByText(marker)).toBeVisible();
    await staff.getByRole('button', { name: 'Mark replied' }).click();
    await staff.getByRole('tab', { name: /^Replied/ }).click();
    await expect(staff.getByRole('button', { name: new RegExp(`replied.*Ana Silva.*${reference}`) })).toBeVisible();
  }
  await ctx.close();
});

test('pricing: the published plans, monthly and yearly, the comparison and the optional services', async ({ page }) => {
  await page.goto('/pricing');
  const card = (name: string) => page.locator('article', { has: page.getByRole('heading', { name, exact: true }) });
  await expect(card('Starter')).toContainText(/\$29\s*\/month/);
  await expect(card('Club')).toContainText('Recommended for clubs');
  await expect(page.getByText('Most popular')).toHaveCount(0);
  await expect(card('Studio')).toContainText(/\$199\s*\/month/);
  await expect(card('League / Enterprise')).toContainText(/From\s*\$499\s*\/month/);
  await expect(card('League / Enterprise').getByRole('link', { name: 'Contact sales for a quote' })).toHaveAttribute('href', '/contact?topic=sales&plan=league');
  await page.getByRole('radio', { name: /Yearly/ }).click();
  // the yearly charge first, the monthly equivalent second and labelled as billed annually
  await expect(card('Starter')).toContainText(/\$290\s*\/year/);
  await expect(card('Starter')).toContainText('$24.17 a month, billed annually');
  await expect(card('Club')).toContainText(/\$790\s*\/year/);
  await expect(card('Studio')).toContainText(/\$1,990\s*\/year/);
  await expect(card('Club').getByRole('link', { name: 'Get started with Club' })).toHaveAttribute('href', '/register?plan=club&billing=yearly');
  await expect(page.getByRole('region', { name: 'Plan comparison' }).getByRole('row', { name: /Event-triggered automation/ })).toContainText('Not included');
  const services = page.getByRole('region', { name: 'Optional services' });
  await expect(services.getByRole('row', { name: /Cloud video production/ })).toContainText('Coming soon');
  await expect(services.getByRole('row', { name: /Guided onboarding/ })).toContainText('$149 once');
});
