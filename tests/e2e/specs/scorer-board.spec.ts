// The scorer phone: an event pad with a tile per team for each event, grouped into sections (the home team's on the
// left, the away team's on the right, each with its count); possession is timed by the match clock, goals ask who
// scored afterwards and cards ask first. Before the match the screen lists the walk-out steps (each can be skipped,
// and the half can start without them); the bar at the bottom ends the period. A level league match offers extra
// time and penalties at the end of regulation. The match list has a search, three tabs and the matches by day.
import { expect, test } from '@playwright/test';
import { api, cellCount, endPeriod, freshMatch, login, score, sheetCell, startFirstHalf, startNextPeriod } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

test('the scorer pad: pregame steps, a tile per team with counts, timed possession, goals and cards', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await login(browser, { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const id = await freshMatch(page);
  await page.goto(`/score/${id}`);
  // before the match: the details, and the steps to kick-off; the half can start at any time, and the steps not
  // marked are passed over (a skip sends nothing, so the match goes straight from the fixture to the half)
  const steps = page.getByRole('region', { name: 'Match phase' });
  await expect(page.getByText('Match details')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Score' })).toContainText('Pregame');
  const start = steps.getByRole('button', { name: 'Start 1st Half' });
  await expect(start).toBeEnabled();
  await expect(steps).toContainText('Steps not marked are skipped when you start 1st half.');
  await page.screenshot({ path: `${EVIDENCE}/scorer-pregame.png`, fullPage: true });
  await start.click();
  await expect(page.getByRole('region', { name: 'Clock controls' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Match controls' }).getByRole('button', { name: 'End 1st Half' })).toBeVisible();
  await expect.poll(async () => (await api<{ phase: string }>(page, `/api/v1/matches/${id}/state`)).phase).toBe('first_half');
  const phases = (await api<{ category: string; payload: { to?: string } }[]>(page, `/api/v1/matches/${id}/facts`)).filter((f) => f.category === 'phase').map((f) => f.payload.to);
  expect(phases).toContain('first_half');
  expect(phases.filter((p) => p === 'pre_match' || p === 'players_entering' || p === 'about_to_start'), 'no walk-out step was recorded on the way to the half').toEqual([]);

  // the football sections and their tiles, top to bottom, the same events for both teams
  const pad = page.getByRole('region', { name: 'Teams' });
  await expect(pad.getByRole('group')).toHaveCount(6);
  for (const [i, name] of ['Score', 'Possession', 'Attack', 'Defence', 'Discipline', 'Team'].entries()) await expect(pad.getByRole('group').nth(i)).toHaveAccessibleName(name);
  const order = async (side: 'home' | 'away') => page.locator(`[data-side="${side}"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-event')));
  const homeOrder = await order('home');
  expect(homeOrder).toEqual(['goal', 'own_goal', 'penalty_scored', 'penalty_missed', 'possession_change', 'shot_on_target', 'shot_off_target', 'corner', 'offside', 'save', 'foul', 'yellow_card', 'red_card', 'substitution']);
  expect(await order('away')).toEqual(homeOrder);

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
  // both buttons read from the same moment: the shares move with the running clock
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
  // the bar's undo takes back the last action at once while the floating undo is still up
  await tap('away', 'corner', 1);
  await page.getByRole('navigation', { name: 'Match controls' }).getByRole('button', { name: 'Undo the last action' }).click();
  await expect.poll(() => cellCount(page, 'away', 'corner')).toBe('0');
  // undo while the action is still on its way to the server: it is undone as soon as it lands, not lost
  await page.route('**/commands', async (r) => {
    await new Promise((x) => setTimeout(x, 1500));
    await r.continue();
  });
  const onItsWay = page.waitForRequest((r) => r.url().endsWith('/commands') && r.method() === 'POST');
  await sheetCell(page, 'away', 'corner').click();
  await onItsWay;
  await page.getByRole('navigation', { name: 'Match controls' }).getByRole('button', { name: 'Undo the last action' }).click();
  await expect.poll(() => cellCount(page, 'away', 'corner'), { timeout: 15_000 }).toBe('0');
  await page.unroute('**/commands');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  // the whole pad in one picture: a viewport as tall as the page, so the bar fixed to the bottom is drawn there
  await page.setViewportSize({ width: 430, height: await page.evaluate(() => document.documentElement.scrollHeight) });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${EVIDENCE}/scorer-two-sides.png` });
  await page.setViewportSize({ width: 430, height: 932 });
  const st = await api<{ projection: { stats: Record<'home' | 'away', Record<string, number>> } }>(page, `/api/v1/matches/${id}/state`);
  expect(st.projection.stats.home).toMatchObject({ shots_on_target: 2, fouls: 1, corners: 1, goals: 1 });
  expect(st.projection.stats.away).toMatchObject({ shots_off_target: 1, offsides: 1, yellow_cards: 1 });
  expect(st.projection.stats.away.corners ?? 0).toBe(0); // both corners undone, the second while it was being sent
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
  // extra time, then penalties are the next steps; the shoot-out has scored and missed for each team
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

test('the match list: a search, three tabs, the matches by day, the options menu', async ({ browser }) => {
  const { ctx, page } = await login(browser, { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const id = await freshMatch(page);
  const { round, teams, competition } = await api<{ round: string; teams: Record<'home' | 'away', { name: string }>; competition: { name: string } }>(page, `/api/v1/matches/${id}`);
  const m = { round, home: teams.home, away: teams.away };
  await page.goto('/score');
  await expect(page.getByRole('heading', { name: 'Scoring' })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Matches' });
  await expect(tabs.getByRole('tab')).toHaveText([/^Now & next/, /^Not played/, /^Results/]);
  await expect(tabs.getByRole('tab', { name: /^Now & next/ })).toHaveAttribute('aria-selected', 'true');
  // the search narrows the list to the new match (its round is unique)
  await page.getByLabel('Search matches').fill(m.round);
  const ticker = page.getByRole('link', { name: `${m.home.name} v ${m.away.name}` });
  await expect(ticker).toHaveCount(1);
  for (const text of [m.home.name, m.away.name, competition.name, m.round]) await expect(ticker).toContainText(text);
  // it kicks off in an hour: listed under its day with its kick-off time, no score yet
  await expect(page.getByRole('tabpanel').getByRole('region')).toHaveCount(1);
  await expect(page.getByRole('tabpanel').getByRole('region')).toHaveAccessibleName(/^(Today|Tomorrow)$/);
  await expect(ticker).toContainText(/\d{1,2}:\d{2}/);
  await page.screenshot({ path: `${EVIDENCE}/scorer-list.png` });
  // the ⋮ menu, the competition picker, the other tabs, and the ticker opens the scorer
  await page.getByRole('button', { name: `Options for ${m.home.name} v ${m.away.name}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Line-ups' })).toBeVisible();
  await page.keyboard.press('Escape');
  // the competition picker keeps it; the search for a team that is not playing finds nothing
  await page.getByLabel('Competition').selectOption({ label: competition.name });
  await expect(ticker).toHaveCount(1);
  await page.getByLabel('Search matches').fill('no such team zz');
  await expect(page.getByText('No matches fit the search.')).toBeVisible();
  await page.getByLabel('Search matches').fill(m.round);
  await tabs.getByRole('tab', { name: /^Results/ }).click();
  await expect(page.getByRole('tabpanel', { name: 'Results' })).toBeVisible();
  await tabs.getByRole('tab', { name: /^Now & next/ }).click();
  await page.locator(`main a[href="/score/${id}"]`).click();
  await page.waitForURL(`**/score/${id}`);
  await expect(page.getByRole('region', { name: 'Match phase' })).toBeVisible();
  await ctx.close();
});
