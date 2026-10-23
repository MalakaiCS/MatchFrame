// The scorer phone as one sheet of mirrored rows: the home team's half of each row on the left, the away team's on
// the right, each with its count; possession is timed by the match clock, goals ask who scored afterwards and cards
// ask first. Before the match the sheet lists the walk-out steps (each can be skipped); the header's button ends the
// period. A level league match offers extra time and penalties at the end of regulation.
import { expect, test } from '@playwright/test';
import { api, cellCount, endPeriod, freshMatch, login, score, sheetCell, startFirstHalf, startNextPeriod } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

test('the scorer sheet: pregame steps, mirrored rows with counts, timed possession, goals and cards', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await login(browser, { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const id = await freshMatch(page);
  await page.goto(`/score/${id}`);
  // before the match: the details, and the steps to kick-off; the half starts once each is done or skipped
  const steps = page.getByRole('region', { name: 'Match phase' });
  await expect(page.getByText('Match details')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Score' })).toContainText('Pregame');
  await expect(steps.getByRole('button', { name: 'Start 1st Half' })).toBeDisabled();
  await page.screenshot({ path: `${EVIDENCE}/scorer-pregame.png`, fullPage: true });
  await startFirstHalf(page);
  await expect(page.getByRole('navigation', { name: 'Match controls' }).getByRole('button', { name: 'End 1st Half' })).toBeVisible();

  // the football rows, top to bottom, the same events on both halves
  const order = async (side: 'home' | 'away') => page.locator(`[data-side="${side}"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-event')));
  const homeOrder = await order('home');
  expect(homeOrder).toEqual(['goal', 'possession_change', 'shot_off_target', 'shot_on_target', 'save', 'corner', 'foul', 'penalty_scored', 'penalty_missed', 'yellow_card', 'red_card', 'offside', 'substitution', 'own_goal']);
  expect([...(await order('away'))].sort()).toEqual([...homeOrder].sort());

  // one tap each, no questions asked; the count changes on that team's half only
  const tap = async (side: 'home' | 'away', ev: string, expectCount: number) => {
    await sheetCell(page, side, ev).click();
    await expect.poll(() => cellCount(page, side, ev)).toBe(String(expectCount));
  };
  await tap('home', 'shot_on_target', 1);
  await tap('home', 'shot_on_target', 2);
  await tap('away', 'shot_off_target', 1);
  await tap('home', 'foul', 1);
  await tap('away', 'offside', 1);
  await tap('home', 'corner', 1);
  expect(await cellCount(page, 'away', 'shot_on_target')).toBe('0');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // possession: the match clock between taps counts for the team with the ball
  await sheetCell(page, 'home', 'possession_change').click();
  await expect(sheetCell(page, 'home', 'possession_change')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(4000);
  await sheetCell(page, 'away', 'possession_change').click();
  await expect(sheetCell(page, 'away', 'possession_change')).toHaveAttribute('aria-pressed', 'true');
  await expect(sheetCell(page, 'home', 'possession_change')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1500);
  // both halves read from the same moment: the shares move with the running clock
  const [h, a] = await page.evaluate(() => (['home', 'away'] as const).map((s) => Number(/(\d+)%/.exec(document.querySelector(`[data-side="${s}"][data-event="possession_change"]`)?.getAttribute('aria-label') ?? '')?.[1] ?? NaN)));
  expect(h + a).toBe(100);
  expect(h).toBeGreaterThan(a);
  await expect.poll(async () => (await api<{ projection: { stats: { home: Record<string, number> } } }>(page, `/api/v1/matches/${id}/state`)).projection.stats.home.possession_pct ?? 0).toBeGreaterThan(50);

  // a goal goes out at once; who scored follows (the line-up is on the phone)
  await sheetCell(page, 'home', 'goal').click();
  const who = page.getByRole('dialog', { name: /Goal recorded/ });
  await expect(who).toBeVisible();
  await who.getByRole('button').filter({ hasText: /\S/ }).first().click();
  await page.getByRole('dialog', { name: 'Assist?' }).getByRole('button', { name: 'No assist' }).click();
  await page.getByRole('dialog', { name: 'What kind of goal?' }).getByRole('button', { name: 'Skip' }).click();
  await expect.poll(() => score(page)).toEqual([1, 0]);
  await expect.poll(() => cellCount(page, 'home', 'goal')).toBe('1');
  // a card asks for the player first
  await sheetCell(page, 'away', 'yellow_card').click();
  await page.getByRole('dialog', { name: /Yellow card: which player/ }).getByRole('button', { name: 'Skip player' }).click();
  await expect.poll(() => cellCount(page, 'away', 'yellow_card')).toBe('1');
  // the header's undo takes back the last action at once while its undo button is still up
  await tap('away', 'corner', 1);
  await page.getByRole('navigation', { name: 'Match controls' }).getByRole('button', { name: 'Undo the last action' }).click();
  await expect.poll(() => cellCount(page, 'away', 'corner')).toBe('0');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${EVIDENCE}/scorer-two-sides.png`, fullPage: true });
  const st = await api<{ projection: { stats: Record<'home' | 'away', Record<string, number>> } }>(page, `/api/v1/matches/${id}/state`);
  expect(st.projection.stats.home).toMatchObject({ shots_on_target: 2, fouls: 1, corners: 1, goals: 1 });
  expect(st.projection.stats.away).toMatchObject({ shots_off_target: 1, offsides: 1, yellow_cards: 1 });
  expect(st.projection.stats.away.corners ?? 0).toBe(0); // the undone corner
  await ctx.close();
});

test('a level league match offers extra time and penalties; finals rules make them the next step', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await login(browser, { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  // a league competition (draws stand) with the organisation's existing football teams
  const tag = crypto.randomUUID().slice(0, 4);
  const comp = await api<{ id: string }>(page, '/api/v1/competitions', { name: `E2E league ${tag}`, sport: 'football', defaultTimezone: 'Australia/Brisbane', rulesPreset: 'league' });
  const season = await api<{ id: string }>(page, `/api/v1/competitions/${comp.id}/seasons`, { name: '2026' });
  const teams = (await api<{ id: string; sport: string; status: string }[]>(page, '/api/v1/teams')).filter((t) => t.sport === 'football' && t.status === 'active');
  const m = await api<{ id: string }>(page, '/api/v1/matches', { competitionId: comp.id, seasonId: season.id, homeTeamId: teams[0]!.id, awayTeamId: teams[1]!.id, kickoffLocal: '2027-05-01 15:00', timezone: 'Australia/Brisbane', round: '1' });
  await page.goto(`/score/${m.id}`);
  await startFirstHalf(page);
  await endPeriod(page, 'Half Time');
  // half time: the walk-out steps for the 2nd half, then its start
  await startNextPeriod(page, '2nd Half');
  // level at 0–0 with the league's rules: full time is next, and the scorer is asked whether it needs a winner
  const end = page.getByRole('navigation', { name: 'Match controls' }).getByRole('button', { name: 'End 2nd Half' });
  const offer = page.getByRole('status').filter({ hasText: "Level. This match's rules let a draw stand." });
  await expect(offer).toBeVisible();
  await end.click();
  const sheet = page.getByRole('dialog', { name: 'End 2nd Half?' });
  await expect(sheet.locator('[data-next]')).toHaveText('Full Time');
  await expect(sheet.getByRole('button', { name: 'Play extra time and penalties instead' })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/scorer-knockout-offer.png` });
  await page.keyboard.press('Escape');
  await offer.getByRole('button', { name: 'Play extra time and penalties' }).click();
  await expect(offer).toHaveCount(0, { timeout: 15_000 });
  await end.click();
  await expect(sheet.locator('[data-next]')).toHaveText('Before Extra Time');
  await page.keyboard.press('Escape');
  const d = await api<{ rules: { knockout: { on: boolean } }; rulesConfig: { extraTime: { enabled: boolean } } }>(page, `/api/v1/matches/${m.id}`);
  expect(d).toMatchObject({ rules: { knockout: { on: true } }, rulesConfig: { extraTime: { enabled: true } } });
  // extra time, then penalties are the next steps; the shoot-out has rows for scored and missed
  await endPeriod(page, 'Before Extra Time');
  await startNextPeriod(page, 'Extra Time 1st');
  await endPeriod(page, 'Extra Time Break');
  await startNextPeriod(page, 'Extra Time 2nd');
  await page.getByRole('navigation', { name: 'Match controls' }).getByRole('button', { name: 'End Extra Time 2nd' }).click();
  await expect(page.getByRole('dialog').locator('[data-next]')).toHaveText('Penalty Shootout');
  await page.getByRole('dialog').locator('[data-next]').click();
  await expect(page.getByRole('region', { name: 'Score' })).toContainText('Penalty Shootout');
  const shootout = page.getByRole('region', { name: 'Shootout' });
  await shootout.locator('[data-side="home"][data-event="shootout_scored"]').click();
  await shootout.locator('[data-side="away"][data-event="shootout_missed"]').click();
  await expect(page.getByRole('region', { name: 'Score' })).toContainText('Pens 1–0');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${EVIDENCE}/scorer-shootout.png` });
  await ctx.close();
});

test('the match list: three tabs, a card per match, filters and the compact list', async ({ browser }) => {
  const { ctx, page } = await login(browser, { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const id = await freshMatch(page);
  const { round, teams } = await api<{ round: string; teams: Record<'home' | 'away', { name: string }> }>(page, `/api/v1/matches/${id}`);
  const m = { round, home: teams.home, away: teams.away };
  await page.goto('/score');
  await expect(page.getByText('Welcome back')).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Matches' });
  await expect(tabs.getByRole('tab')).toHaveText([/^Live & upcoming/, /^Not started/, /^Completed/]);
  await expect(tabs.getByRole('tab', { name: /^Live & upcoming/ })).toHaveAttribute('aria-selected', 'true');
  // the filter sheet narrows the list to the new match (its round is unique)
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('Team, round or venue').fill(m.round);
  await page.getByRole('dialog').getByRole('button', { name: 'Show 1 match' }).click();
  const card = page.getByRole('link', { name: `${m.home.name} v ${m.away.name}` });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('vs');
  await expect(card).toContainText('Not started');
  await page.screenshot({ path: `${EVIDENCE}/scorer-list.png` });
  // the ⋮ menu, the compact list (kept on the phone), and the card opens the scorer
  await page.getByRole('button', { name: `Options for ${m.home.name} v ${m.away.name}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Line-ups' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await tabs.getByRole('tab', { name: /^Completed/ }).click();
  await expect(page.getByRole('tabpanel', { name: 'Completed' })).toBeVisible();
  await tabs.getByRole('tab', { name: /^Live & upcoming/ }).click();
  await page.locator(`main a[href="/score/${id}"]`).click();
  await page.waitForURL(`**/score/${id}`);
  await expect(page.getByRole('region', { name: 'Match phase' })).toBeVisible();
  await ctx.close();
});
