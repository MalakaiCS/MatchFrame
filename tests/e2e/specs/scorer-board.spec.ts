// The scorer phone in two team columns: every statistic is one tap on its team's side with the count beside it,
// possession is timed by the match clock, goals ask who scored afterwards and cards ask first. A level league
// match offers extra time and penalties at the end of regulation.
import { expect, test, type Page } from '@playwright/test';
import { api, freshMatch, login, score, startFirstHalf, teamColumn } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';

async function confirmPhase(page: Page, label: string) {
  const next = page.getByRole('region', { name: 'Match phase' }).getByRole('button', { name: `Next: ${label}` });
  if (await next.count()) await next.click();
  else {
    await page.getByRole('region', { name: 'Match phase' }).getByRole('button', { name: 'More options' }).click();
    await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('region', { name: 'Match phase' })).toContainText(`Now: ${label}`);
}

test('two team columns: statistics with counts, timed possession, goals and cards', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await login(browser, { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const id = await freshMatch(page);
  await page.goto(`/score/${id}`);
  await startFirstHalf(page);
  const home = teamColumn(page, 'home');
  const away = teamColumn(page, 'away');
  await expect(home).toBeVisible();
  await expect(away).toBeVisible();
  // the football column: goal, possession, then the statistics in the order asked for
  const labels = (await home.getByRole('button').allTextContents()).map((t) => t.replace(/[\d%–]+$/, '').trim());
  expect(labels.slice(0, 10)).toEqual(['Goal', 'Possession', 'Shots on target', 'Shots off target', 'Fouls', 'Yellow cards', 'Red cards', 'Offsides', 'Corners', 'Saves']);

  // one tap each, no questions asked; the count updates on that team's side only
  const tap = async (col: typeof home, name: string, expectCount: number) => {
    await col.getByRole('button', { name: new RegExp(`^${name},`) }).click();
    await expect(col.getByRole('button', { name: new RegExp(`^${name},`) })).toHaveAccessibleName(`${name}, ${expectCount}`);
  };
  await tap(home, 'Shots on target', 1);
  await tap(home, 'Shots on target', 2);
  await tap(away, 'Shots off target', 1);
  await tap(home, 'Fouls', 1);
  await tap(away, 'Offsides', 1);
  await tap(home, 'Corners', 1);
  await expect(away.getByRole('button', { name: /^Shots on target,/ })).toHaveAccessibleName('Shots on target, 0');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // possession: the match clock between taps counts for the team with the ball
  await home.getByRole('button', { name: /^Possession,/ }).click();
  await expect(home.getByRole('button', { name: /^Possession,/ })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(4000);
  await away.getByRole('button', { name: /^Possession,/ }).click();
  await expect(away.getByRole('button', { name: /^Possession,/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(home.getByRole('button', { name: /^Possession,/ })).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1500);
  const pct = async (col: typeof home) => Number(/(\d+)%/.exec((await col.getByRole('button', { name: /^Possession,/ }).getAttribute('aria-label')) ?? '')?.[1] ?? NaN);
  const [h, a] = [await pct(home), await pct(away)];
  expect(h + a).toBe(100);
  expect(h).toBeGreaterThan(a);
  await expect.poll(async () => (await api<{ projection: { stats: { home: Record<string, number> } } }>(page, `/api/v1/matches/${id}/state`)).projection.stats.home.possession_pct ?? 0).toBeGreaterThan(50);

  // a goal goes out at once; who scored follows (the line-up is on the phone)
  await home.getByRole('button', { name: 'Goal', exact: true }).click();
  const who = page.getByRole('dialog', { name: /Goal recorded/ });
  await expect(who).toBeVisible();
  await who.getByRole('button').filter({ hasText: /\S/ }).first().click();
  await page.getByRole('dialog', { name: 'Assist?' }).getByRole('button', { name: 'No assist' }).click();
  await page.getByRole('dialog', { name: 'What kind of goal?' }).getByRole('button', { name: 'Skip' }).click();
  await expect.poll(() => score(page)).toEqual([1, 0]);
  // a card asks for the player first
  await away.getByRole('button', { name: /^Yellow cards,/ }).click();
  await page.getByRole('dialog', { name: /Yellow card: which player/ }).getByRole('button', { name: 'Skip player' }).click();
  await expect(away.getByRole('button', { name: /^Yellow cards,/ })).toHaveAccessibleName('Yellow cards, 1');
  // the rarer events sit under More
  await away.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog', { name: /^More for / }).getByRole('button', { name: 'Penalty scored' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${EVIDENCE}/scorer-two-sides.png`, fullPage: true });
  const st = await api<{ projection: { stats: Record<'home' | 'away', Record<string, number>> } }>(page, `/api/v1/matches/${id}/state`);
  expect(st.projection.stats.home).toMatchObject({ shots_on_target: 2, fouls: 1, corners: 1, goals: 1 });
  expect(st.projection.stats.away).toMatchObject({ shots_off_target: 1, offsides: 1, yellow_cards: 1 });
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
  await confirmPhase(page, 'Half Time');
  await confirmPhase(page, '2nd Half');
  // level at 0–0 with the league's rules: full time is next, and the scorer is asked whether it needs a winner
  const phase = page.getByRole('region', { name: 'Match phase' });
  await expect(phase.getByRole('button', { name: 'Next: Full Time' })).toBeVisible();
  await expect(phase).toContainText("Level. This match's rules let a draw stand.");
  await page.screenshot({ path: `${EVIDENCE}/scorer-knockout-offer.png` });
  await phase.getByRole('button', { name: 'Play extra time and penalties' }).click();
  await expect(phase.getByRole('button', { name: 'Next: Before Extra Time' })).toBeVisible({ timeout: 15_000 });
  await expect(phase).not.toContainText("Level. This match's rules let a draw stand.");
  const d = await api<{ rules: { knockout: { on: boolean } }; rulesConfig: { extraTime: { enabled: boolean } } }>(page, `/api/v1/matches/${m.id}`);
  expect(d).toMatchObject({ rules: { knockout: { on: true } }, rulesConfig: { extraTime: { enabled: true } } });
  // extra time, then penalties are the next steps; the shoot-out has its own two columns
  await confirmPhase(page, 'Before Extra Time');
  for (const p of ['Extra Time 1st', 'Extra Time Break', 'Extra Time 2nd']) await confirmPhase(page, p);
  await expect(phase.getByRole('button', { name: 'Next: Penalty Shootout' })).toBeVisible();
  await confirmPhase(page, 'Penalty Shootout');
  const shootout = page.getByRole('region', { name: 'Shootout' });
  await shootout.getByRole('region', { name: /, home$/ }).getByRole('button', { name: 'Scored' }).click();
  await shootout.getByRole('region', { name: /, away$/ }).getByRole('button', { name: 'Missed' }).click();
  await expect(page.getByRole('region', { name: 'Score' })).toContainText('Pens 1–0');
  await ctx.close();
});
