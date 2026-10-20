// The screens added for the sixty-feature pass: scorer line-ups and preferences, producer board, run sheet,
// activity feed, public match centre and feed, commentator view, control-room export and run sheet, competition
// tables, automation conditions and approvals, settings tabs, and the status page.
import { expect, test } from '@playwright/test';
import { api, freshMatch, login } from './helpers';

test('scorer enters line-ups from the phone and finds the preferences sheet', async ({ browser }) => {
  const { page } = await login(browser, { viewport: { width: 420, height: 860 }, isMobile: true, hasTouch: true });
  const matchId = await freshMatch(page);
  await page.goto(`/score/${matchId}/lineup`);
  await expect(page.getByRole('heading', { name: 'Line-ups' })).toBeVisible();
  // a fixture starts with the roster as its line-up; take two players out of the squad and save
  const summary = page.getByText(/^\d+ starters · \d+ bench/);
  await expect(summary).toBeVisible();
  const count = async () => (await summary.textContent())!.match(/(\d+) starters · (\d+) bench/)!.slice(1, 3).map(Number) as [number, number];
  const [s0, b0] = await count();
  const outs = page.getByRole('button', { name: 'Out', exact: true });
  await outs.nth(0).click();
  await outs.nth(1).click();
  const [s1, b1] = await count();
  expect(s1 + b1).toBe(s0 + b0 - 2);
  await page.getByRole('button', { name: 'Save line-ups' }).click();
  await expect(page.getByText(/Line-up saved/)).toBeVisible();
  await page.waitForURL(`**/score/${matchId}`);
  const d = await api<{ lineup: { home: { starter: boolean }[] } }>(page, `/api/v1/matches/${matchId}`);
  expect(d.lineup.home.length).toBe(s0 + b0 - 2);

  await page.getByRole('button', { name: 'Scoring preferences' }).click();
  await expect(page.getByText('Low data mode')).toBeVisible();
  await expect(page.getByText('Sunlight mode (high contrast)')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Line-ups', exact: true })).toBeVisible();
});

test('run sheet, activity, match information and the public match centre with its feed', async ({ browser, baseURL }) => {
  const { page } = await login(browser);
  const matchId = await freshMatch(page);
  await page.goto(`/app/matches/${matchId}?tab=runsheet`);
  await page.getByLabel('When').fill('KO-10');
  await page.getByLabel('What happens').fill('Opening ident and line-ups');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Opening ident and line-ups/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /Opening ident and line-ups/ }).click();
  await expect(page.getByRole('checkbox', { name: /Opening ident and line-ups/ })).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByRole('list', { name: 'Activity' })).toBeVisible();

  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.getByRole('button', { name: 'Add official' }).click();
  await page.getByLabel('Name', { exact: true }).first().fill('Dana Reyes');
  await page.getByLabel('Attendance').fill('1250');
  await page.getByRole('button', { name: 'Save match information' }).click();
  await expect(page.getByText('Match information saved')).toBeVisible();
  const saved = await api<{ officials: { name: string }[]; attendance: number }>(page, `/api/v1/matches/${matchId}`);
  expect(saved.officials[0]?.name).toBe('Dana Reyes');
  expect(saved.attendance).toBe(1250);

  await page.getByRole('button', { name: 'Create the match centre link' }).click();
  const link = page.getByLabel('Match centre link');
  await expect(link).toHaveValue(/\/m\//);
  const url = await link.inputValue();
  const token = url.split('/m/')[1]!;

  // a fan, signed out, sees the match; the JSON feed answers without cookies
  const fan = await browser.newContext();
  const fanPage = await fan.newPage();
  await fanPage.goto(url);
  const detail = await api<{ teams: { home: { name: string }; away: { name: string } } }>(page, `/api/v1/matches/${matchId}`);
  await expect(fanPage.getByText(detail.teams.home.name).first()).toBeVisible();
  await expect(fanPage.getByText('Dana Reyes')).toBeVisible();
  await fanPage.getByRole('button', { name: 'Line-ups' }).click();
  await expect(fanPage.getByText(detail.teams.away.name).first()).toBeVisible();
  const feed = await fan.request.get(`${baseURL}/api/v1/public/match/${token}/feed.json`);
  expect(feed.ok()).toBeTruthy();
  const body = (await feed.json()) as { teams: { home: { name: string } }; attendance: number };
  expect(body.teams.home.name).toBe(detail.teams.home.name);
  expect(body.attendance).toBe(1250);
  await fan.close();

  await page.goto(`/app/matches/${matchId}/commentary`);
  await expect(page.getByText('Commentator view · read only')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Key events' })).toBeVisible();
});

test('control room: export dialog, run sheet tab and presence without a second operator', async ({ browser }) => {
  const { page } = await login(browser);
  const matchId = await freshMatch(page);
  const ov = await api<{ id: string }>(page, `/api/v1/matches/${matchId}/overlays`, { name: 'E2E features' });
  await page.goto(`/app/matches/${matchId}/control/${ov.id}`);
  await page.waitForSelector('[data-template="builtin:scorebug"]', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByRole('dialog', { name: 'Export for social' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PNG' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Run sheet' }).click();
  await page.getByLabel('What happens').fill('HT sponsor read');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('HT sponsor read')).toBeVisible();
  expect(await page.getByText(/Also here/).count()).toBe(0);
});

test('producer board, competition tables, round creation and the status page', async ({ browser }) => {
  const { page } = await login(browser);
  await freshMatch(page);
  await page.goto('/app/board');
  await expect(page.getByRole('heading', { name: 'Producer board' })).toBeVisible();
  await expect(page.getByText(/\d+ live$/)).toBeVisible();

  const comps = await api<{ id: string; sport: string; currentSeason: { id: string } | null }[]>(page, '/api/v1/competitions');
  const comp = comps.find((c) => c.sport === 'football' && c.currentSeason)!;
  await page.goto(`/app/competitions/${comp.id}`);
  await expect(page.getByRole('heading', { name: 'Seasons' })).toBeVisible(); // hydrated and loaded before the tabs are used
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(page.locator('th', { hasText: /^Pts$/ })).toBeVisible(); // the table lays out with CSS, so header cells carry no columnheader role
  await page.getByRole('tab', { name: 'Results & fixtures' }).click();
  await expect(page.getByText(/Round|Unrounded|No fixtures in this season yet|E2E/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.getByLabel('Sort players by')).toBeVisible();
  await page.getByRole('tab', { name: /^Fixtures/ }).click();
  await page.getByRole('button', { name: 'Create a round' }).click();
  await expect(page.getByRole('dialog', { name: 'Create a round' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('heading', { name: 'Table rules' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a demo match' })).toBeVisible();

  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();
  await expect(page.getByText('All systems working')).toBeVisible();
});

test('automation editor: conditions and approval per playlist', async ({ browser }) => {
  const { page } = await login(browser);
  await page.goto('/app/automation');
  await expect(page.getByText('Only when').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add condition' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Only run when…' })).toBeVisible();
  await expect(page.getByText('Reads as: the score gap is at least 3.')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('the score gap is at least 3').first()).toBeVisible();
  const approval = page.getByRole('checkbox', { name: /Ask the producer before sending/ }).first();
  await approval.check();
  await expect(approval).toBeChecked();
  // undo both so the shared demo plan is left as it was
  await approval.uncheck();
  await page.getByRole('button', { name: 'Remove condition' }).first().click();
  await expect(page.getByText('the score gap is at least 3')).toHaveCount(0);
});

test('settings: plan, branding, integrations, notifications, security and backups tabs', async ({ browser }) => {
  const { page } = await login(browser);
  await page.goto('/app/settings?tab=plan');
  await expect(page.getByText(/Current plan:/)).toBeVisible();
  await page.getByRole('tab', { name: 'Branding' }).click();
  await expect(page.getByRole('heading', { name: 'Custom domain' })).toBeVisible();
  await page.getByRole('tab', { name: 'Integrations' }).click();
  await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible();
  await page.getByRole('button', { name: 'Add webhook' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a webhook' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Notifications' }).click();
  await expect(page.getByRole('heading', { name: 'What gets sent' })).toBeVisible();
  await page.getByRole('tab', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { name: /Two-step sign-in/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where you are signed in' })).toBeVisible();
  await expect(page.getByText('this session')).toBeVisible();
  if (await page.getByRole('tab', { name: 'Backups' }).count()) {
    await page.getByRole('tab', { name: 'Backups' }).click();
    await expect(page.getByRole('heading', { name: 'Database backups' })).toBeVisible();
  }
});
