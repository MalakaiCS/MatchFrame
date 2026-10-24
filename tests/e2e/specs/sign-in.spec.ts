// Signing up and in without a password, in a real browser against the running stack and its mail catcher:
// a plan chosen on the pricing page travels to sign-up; an email code creates the account (with the name given);
// onboarding makes the organisation; the dashboard offers the chosen plan and Settings opens on it; signing out and
// back in with a fresh email code works; the login page offers a passkey and keeps the password tab.
import { expect, test, type APIRequestContext } from '@playwright/test';

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

/** The newest sign-in code mailed to an address (the subject starts with it), never one already used: the whole
 * sign-up, onboarding and sign-out can take under the two seconds allowed for clock differences. */
async function codeFor(request: APIRequestContext, email: string, after: number, used: string[] = []) {
  let code = '';
  await expect.poll(async () => {
    const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    if (!r.ok()) return '';
    const found = (await r.json()) as { messages: { Subject: string; Created: string }[] };
    const m = found.messages.find((x) => /^\d{6} is your MatchFrame code$/.test(x.Subject) && new Date(x.Created).getTime() >= after - 2000 && !used.includes(x.Subject.slice(0, 6)));
    code = m ? m.Subject.slice(0, 6) : '';
    return code;
  }, { timeout: 20_000 }).toMatch(/^\d{6}$/);
  return code;
}

test('a plan from pricing, sign-up with an email code, onboarding, the plan offered again, and back in with a code', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const email = `e2e-code-${Date.now().toString(36)}@studio.localhost`;

  await page.goto('/pricing');
  await page.getByRole('radio', { name: /Yearly/ }).click();
  await page.getByRole('link', { name: 'Get started with Club' }).click();
  await expect(page).toHaveURL(/\/register\?plan=club&billing=yearly/);
  await expect(page.getByText('You chose Club, billed yearly')).toBeVisible();

  await page.getByLabel('Your name').fill('Riley Code');
  await page.getByLabel('Email').fill(email);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  const first = await codeFor(request, email, t0);
  await page.getByLabel('6-digit code').fill(first);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.waitForURL('**/onboarding');

  await page.getByLabel('Organisation name').fill(`E2E Code Club ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page.getByRole('heading', { name: /Set up: Competition/ })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.waitForURL('**/app');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back, Riley');
  await expect(page.getByText(/You chose Club, billed yearly/)).toBeVisible();
  await page.getByRole('link', { name: 'Review the plan' }).click();
  await expect(page.getByRole('tab', { name: 'Plan & billing' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('your choice')).toBeVisible();

  // the account menu offers Appearance; sign out, then back in with a new code
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Appearance' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
  await expect(page.getByRole('tab', { name: 'Password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
  await page.getByRole('tab', { name: 'Email code' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('6-digit code').fill(await codeFor(request, email, t1, [first]));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/app');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back, Riley');
  // the method used is offered first next time
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
  await expect(page.getByRole('tab', { name: 'Email code' })).toHaveAttribute('aria-selected', 'true');
  await ctx.close();
});
