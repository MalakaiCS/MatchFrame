// Site staff console: the e2e account is an Owner through PLATFORM_OWNER_EMAILS. A new account signs up (its
// verification email read from Mailpit) and creates an organisation; staff find it, suspend it (its member sees the
// suspended screen) and reactivate it, disable and enable the account (it cannot sign in meanwhile), and add it to
// the staff team as Support (it then sees the console without the Admin pages).
import { expect, test } from '@playwright/test';
import { api, login } from './helpers';

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

test('staff console: find an organisation, suspend and reactivate it, disable an account, add Support staff', async ({ browser, request }) => {
  const { page } = await login(browser);
  const me = await api<{ staff: { role: string } | null }>(page, '/api/v1/me');
  test.skip(me.staff?.role !== 'owner', 'the e2e account is not a site Owner (set PLATFORM_OWNER_EMAILS to it on the server)');
  page.on('dialog', (d) => void d.accept());

  // a new account and its organisation
  const tag = crypto.randomUUID().slice(0, 6);
  const email = `e2e-staff-${tag}@studio.localhost`;
  const password = `pat-${crypto.randomUUID()}`;
  const club = `E2E Staff Club ${tag}`;
  const pat = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pp = await pat.newPage();
  await pp.goto('/login');
  const signUp = await pp.evaluate(async (b) => (await fetch('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, { email, password, name: 'Pat Example', callbackURL: '/verify-email?ok=1' });
  expect(signUp).toBe(200);
  let link = '';
  await expect.poll(async () => {
    const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const found = (await r.json()) as { messages: { ID: string }[] };
    if (!found.messages?.length) return '';
    const msg = (await (await request.get(`${MAILPIT}/api/v1/message/${found.messages[0]!.ID}`)).json()) as { Text: string };
    link = /https?:\/\/\S*verify-email\S*/.exec(msg.Text)?.[0] ?? '';
    return link;
  }, { timeout: 20_000 }).toMatch(/verify-email/);
  await pp.goto(new URL(link).pathname + new URL(link).search);
  await expect.poll(async () => (await api<{ user?: { emailVerified: boolean } }>(pp, '/api/v1/me')).user?.emailVerified).toBe(true);
  await api(pp, '/api/v1/organisations', { name: club, timezone: 'Australia/Brisbane' });

  // staff find it by the owner's email and open it
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible();
  await page.getByLabel('Search organisations').fill(email);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: club }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(club);
  await expect(page.getByText(email).first()).toBeVisible();

  // suspend: the member sees the suspended screen
  await page.getByRole('button', { name: 'Suspend' }).click();
  const dialog = page.getByRole('dialog', { name: `Suspend ${club}` });
  await expect(dialog.getByRole('button', { name: 'Suspend organisation' })).toBeDisabled();
  await dialog.getByLabel('Reason').fill('E2E: unpaid invoices');
  await dialog.getByRole('button', { name: 'Suspend organisation' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('suspended');
  await expect(page.getByText('E2E: unpaid invoices').first()).toBeVisible();
  await page.screenshot({ path: '../../docs/evidence/e2e/staff-organisation.png' });
  await pp.goto('/app');
  await expect(pp.getByRole('heading', { name: `${club} is suspended` })).toBeVisible();
  await pp.screenshot({ path: '../../docs/evidence/e2e/organisation-suspended.png' });
  expect((await pp.evaluate(async () => (await fetch('/api/v1/competitions')).status))).toBe(403);

  // reactivate: back to normal
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await page.getByRole('dialog', { name: `Reactivate ${club}` }).getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('active');
  await pp.reload();
  await expect(pp.getByRole('heading', { name: `${club} is suspended` })).toHaveCount(0);
  expect((await pp.evaluate(async () => (await fetch('/api/v1/competitions')).status))).toBe(200);

  // disable the account: signed out at once, sign-in refused with the reason; then enable it
  await page.goto('/staff/users');
  await page.getByLabel('Search accounts').fill(email);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Pat Example' }).click();
  await page.getByRole('button', { name: 'Disable account' }).click();
  const dd = page.getByRole('dialog', { name: 'Disable Pat Example' });
  await dd.getByLabel('Reason').fill('E2E: abusive messages');
  await dd.getByRole('button', { name: 'Disable account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('disabled');
  await pp.goto('/app');
  await pp.waitForURL('**/login**');
  await pp.waitForLoadState('networkidle');
  await pp.getByRole('tab', { name: 'Password' }).click();
  await pp.fill('#email', email);
  await pp.fill('#password', password);
  await pp.click('button[type=submit]');
  await expect(pp.getByText('This account has been disabled', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Enable account' }).click();
  await page.getByRole('dialog', { name: 'Enable Pat Example' }).getByRole('button', { name: 'Enable' }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText('disabled');
  await pp.click('button[type=submit]');
  await pp.waitForURL('**/app');

  // add to the staff team as Support: the console without the Moderator and Admin pages
  await page.goto('/staff/team');
  await page.getByLabel('Email of their account').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption('support');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('row', { name: /Pat Example/ })).toBeVisible();
  await page.screenshot({ path: '../../docs/evidence/e2e/staff-team.png' });
  await pp.goto('/staff');
  await expect(pp.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible();
  const nav = pp.getByRole('navigation', { name: 'Staff', exact: true });
  await expect(nav.getByRole('link', { name: 'Accounts' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Public links' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Staff log' })).toHaveCount(0);
  // remove again
  await page.getByRole('button', { name: 'Remove Pat Example from staff' }).click();
  await expect(page.getByRole('row', { name: /Pat Example/ })).toHaveCount(0);
  await pp.reload();
  await expect(pp.getByRole('heading', { name: 'Staff only' })).toBeVisible();

  // the staff log has it all
  await page.goto('/staff/activity');
  await expect(page.getByRole('cell', { name: 'Suspended an organisation' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'E2E: abusive messages' }).first()).toBeVisible();
  await pat.close();
});
