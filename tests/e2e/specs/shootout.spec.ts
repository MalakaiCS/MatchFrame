// The penalty shoot-out on the OBS page and the scorer phone: a marker per kick (scored, missed, still to take, the
// next one ringed), where it stands (kick N of 5, a kick that must be scored), the winner as soon as one team cannot
// be caught, and no more kicks after that.
import { expect, test, type Page } from '@playwright/test';
import { api, freshMatch, login } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

async function call(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p as string, { method: m as string, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, path, body ?? null] as const,
  ) as Promise<{ status: number; body: { error?: { code?: string; message?: string } } | null }>;
}

test('penalty shoot-out: kicks, the next kick, a must-score kick and the winner on air', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await login(browser);
  const id = await freshMatch(page);
  const send = async (type: string, payload: unknown) => {
    const lease = await call(page, 'POST', `/api/v1/matches/${id}/scorer-lease`, { action: 'acquire', deviceId: 'e2e-shootout' });
    const st = await api<{ stateVersion: number }>(page, `/api/v1/matches/${id}/state`);
    return call(page, 'POST', `/api/v1/matches/${id}/commands`, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: (lease.body as { leaseVersion: number }).leaseVersion, deviceId: 'e2e-shootout', type, payload });
  };
  // level after extra time: on to the shoot-out
  for (const to of ['first_half', 'half_time', 'second_half', 'extra_time_break', 'et_first_half', 'et_half_time', 'et_second_half', 'shootout']) expect((await send('SET_PHASE', { to })).status, to).toBe(200);
  const kick = async (side: 'home' | 'away', scored: boolean) => (await send('ADD_FACT', { type: 'shootout_kick', side, payload: { scored }, occurredAt: Date.now() })).status;

  const d = await api<{ teams: Record<'home' | 'away', { shortName: string }> }>(page, `/api/v1/matches/${id}`);
  const [H, A] = [d.teams.home.shortName, d.teams.away.shortName];
  const [ov] = await api<{ id: string }[]>(page, `/api/v1/matches/${id}/overlays`);
  const urls = await api<{ production: string }>(page, `/api/v1/overlays/${ov!.id}/urls`);
  const obsCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const obs = await obsCtx.newPage();
  await obs.goto(urls.production);
  expect((await call(page, 'POST', `/api/v1/overlays/${ov!.id}/commands`, { commandId: crypto.randomUUID(), command: { type: 'TAKE_IN', templateKey: 'builtin:shootout', force: true } })).status).toBe(200);
  const g = obs.locator('[data-graphic="shootout"]');
  await expect(g).toBeVisible({ timeout: 20_000 });
  const marks = async () => g.locator('[data-kick]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kick')));
  const line = g.locator('[data-shootout-line]');
  await expect(line).toHaveText(/Best of 5, then sudden death/i);

  // four kicks: home scored, away scored, home missed, away scored; home kicks next
  for (const [s, ok] of [['home', true], ['away', true], ['home', false], ['away', true]] as const) expect(await kick(s, ok)).toBe(200);
  await expect(line).toHaveText(new RegExp(`Kick 3 of 5 · ${H} to kick`, 'i'));
  await expect.poll(marks).toEqual(['scored', 'missed', 'next', 'pending', 'pending', 'scored', 'scored', 'pending', 'pending', 'pending']);
  await obs.screenshot({ path: `${EVIDENCE}/shootout-kick-3.png` });

  // four kicks later home have 3 of 4 and away 4 of 4: home's fifth must be scored
  for (const [s, ok] of [['home', true], ['away', true], ['home', true], ['away', true]] as const) expect(await kick(s, ok)).toBe(200);
  await expect(line).toHaveText(new RegExp(`${H} must score to stay in`, 'i'));
  await expect(g).toContainText('3:4');
  await obs.screenshot({ path: `${EVIDENCE}/shootout-must-score.png` });

  // the miss decides it: away win 4–3, and no fifth away kick is taken
  expect(await kick('home', false)).toBe(200);
  await expect(line).toHaveText(new RegExp(`${A} win 4–3 on penalties`, 'i'));
  await expect(g).toHaveAttribute('data-shootout-state', 'decided');
  await obs.screenshot({ path: `${EVIDENCE}/shootout-decided.png` });
  const refused = await send('ADD_FACT', { type: 'shootout_kick', side: 'away', payload: { scored: true }, occurredAt: Date.now() });
  expect(refused.status).toBe(422);
  expect(refused.body?.error?.code).toBe('SHOOTOUT_DECIDED');

  // the scorer phone says the same and takes no more kicks
  const phone = await (await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() })).newPage();
  await phone.goto(`/score/${id}`);
  const sheet = phone.getByRole('region', { name: 'Shootout' });
  await expect(sheet.locator('[data-shootout-line]')).toHaveText(new RegExp(`${A} win 4–3 on penalties`, 'i'));
  await expect(sheet.locator('[data-side="away"][data-event="shootout_scored"]')).toBeDisabled();
  await expect(phone.getByRole('navigation', { name: 'Match controls' }).getByRole('button', { name: 'End shoot-out' })).toBeVisible();
  await phone.screenshot({ path: `${EVIDENCE}/scorer-shootout-decided.png` });
  await obsCtx.close();
  await ctx.close();
});
