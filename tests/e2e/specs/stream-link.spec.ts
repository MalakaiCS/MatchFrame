// Back-to-back matches on one stream: a stream link made on the Live page is one OBS link for the day at a ground.
// It shows the match just finished (its thank-you, then the "Matches today" board in turn, from the full-time
// automation, because more matches are on today), a match put on by hand, and back to automatic. Futsal, so no
// football teams are added.
import { expect, test, type Page } from '@playwright/test';
import { api, login } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

/** A fixed-offset zone where it is about midday now, so the day has matches either side whenever this runs. */
const now = new Date();
const offset = 12 - now.getUTCHours();
const TZ = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

async function send(page: Page, matchId: string, type: string, payload: unknown) {
  return page.evaluate(
    async ([id, ty, pl]) => {
      const j = async (method: string, p: string, b?: unknown) => (await fetch(p, { method, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
      const lease = await j('POST', `/api/v1/matches/${id}/scorer-lease`, { action: 'acquire', deviceId: 'e2e-stream-link' });
      const st = await j('GET', `/api/v1/matches/${id}/state`);
      const r = await fetch(`/api/v1/matches/${id}/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'e2e-stream-link', type: ty, payload: pl }) });
      return r.status;
    },
    [matchId, type, payload] as const,
  );
}

test('stream link: one OBS link for the day, the matches today board after full time, a match put on by hand', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page } = await login(browser, { viewport: { width: 1440, height: 1000 } });
  const tag = crypto.randomUUID().slice(0, 4);
  const venue = await api<{ id: string; name: string }>(page, '/api/v1/venues', { name: `E2E Court ${tag}`, timezone: TZ });
  const comp = await api<{ id: string }>(page, '/api/v1/competitions', { name: `E2E Futsal Day ${tag}`, sport: 'futsal', defaultTimezone: TZ });
  const season = await api<{ id: string }>(page, `/api/v1/competitions/${comp.id}/seasons`, { name: '2026' });
  const teams: { id: string }[] = [];
  for (const n of ['Bay', 'Hill', 'Port', 'Cove', 'Glen', 'Reef']) teams.push(await api(page, '/api/v1/teams', { name: `${n} ${tag}`, shortName: n, abbreviation: n.toUpperCase().slice(0, 3), sport: 'futsal' }));
  const at = (time: string, h: number, a: number) => api<{ id: string }>(page, '/api/v1/matches', { competitionId: comp.id, seasonId: season.id, homeTeamId: teams[h]!.id, awayTeamId: teams[a]!.id, venueId: venue.id, kickoffLocal: `${today} ${time}`, timezone: TZ });
  const day = [await at('09:00', 0, 1), await at('13:30', 2, 3), await at('16:00', 4, 5)];

  // the morning match is played and finished (2–1); its full-time automation starts now
  for (const to of ['p1', 'half_time', 'p2']) expect(await send(page, day[0]!.id, 'SET_PHASE', { to }), to).toBe(200);
  for (const side of ['home', 'home', 'away']) expect(await send(page, day[0]!.id, 'ADD_FACT', { type: 'goal', side, occurredAt: Date.now(), payload: {} })).toBe(200);
  expect(await send(page, day[0]!.id, 'SET_PHASE', { to: 'full_time' })).toBe(200);

  // Live → New stream link, for this ground
  await page.goto('/app/live');
  await page.getByRole('button', { name: 'New stream link' }).click();
  const dlg = page.getByRole('dialog', { name: 'New stream link' });
  await dlg.getByLabel('Name').fill(`Court ${tag}`);
  await dlg.getByLabel('Ground').selectOption(venue.id);
  await dlg.getByRole('button', { name: 'Save' }).click();
  const shown = page.getByRole('dialog', { name: 'Your stream link' });
  const url = await shown.getByLabel('Stream link').inputValue();
  expect(url).toMatch(/\/channel\/sl_[A-Za-z0-9_-]+\?t=/);
  await shown.getByRole('button', { name: 'Done' }).click();

  // OBS: one browser source for the day
  const obsCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const obs = await obsCtx.newPage();
  await obs.goto(url);
  const link = obs.locator('[data-stream-link]');
  await expect(link).toHaveAttribute('data-on-match', day[0]!.id, { timeout: 20_000 });

  const card = page.locator(`[data-stream-link-card="Court ${tag}"]`);
  await expect(card).toContainText('OBS has it open', { timeout: 20_000 });
  await expect(card).toContainText('just finished');
  const rows = card.getByRole('list', { name: `Today on Court ${tag}` }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('FT · 2–1');
  await expect(rows.nth(0)).toContainText('on now');

  // after the thank-you (30 s after the whistle, then 30 s on air), the matches today board takes its turn
  const board = obs.locator('[data-today-board]');
  await expect(board).toBeVisible({ timeout: 90_000 });
  await expect(board.locator('[data-today-row]')).toHaveCount(3);
  await expect(board.locator('[data-current="true"]')).toHaveCount(1);
  await expect(board).toContainText('2');
  await obs.screenshot({ path: `${EVIDENCE}/stream-link-matches-today.png` });

  // a match put on by hand, then back to automatic
  await rows.nth(1).getByRole('button', { name: 'Put on now' }).click();
  await expect(link).toHaveAttribute('data-on-match', day[1]!.id, { timeout: 20_000 });
  await expect(card).toContainText('put on by hand');
  await card.getByRole('button', { name: 'Back to automatic' }).click();
  await expect(link).toHaveAttribute('data-on-match', day[0]!.id, { timeout: 20_000 });

  // the next match's checklist knows OBS has the stream link open
  await page.goto(`/app/matches/${day[2]!.id}`);
  await expect(page.getByText(`OBS has the stream link “Court ${tag}” open`)).toBeVisible({ timeout: 20_000 });

  await obsCtx.close();
  await ctx.close();
});
