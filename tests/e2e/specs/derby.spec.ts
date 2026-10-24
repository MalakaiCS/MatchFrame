// The Derby look on a real output with the football starter flow: a yellow card and a goal come up through the
// scorebug (over the score, the player and the clock underneath) and the scorebug comes back after them; at half time
// the half-time banner (the kick-off banner headed HALF TIME) is up for 10 s with HALF TIME on the scorebug's clock,
// then the break scene (the animated background and the match header); after the match the clock reads FULL TIME.
// Captures of the OBS page are kept as evidence in docs/evidence/e2e/.
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { api, freshMatch, login } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';
type Layer = { templateKey: string; variables: Record<string, unknown>; outAt: number | null };
type OvState = { scorebugVisible: boolean; layers: Partial<Record<string, Layer>> };

async function call<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p as string, { method: m as string, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, path, body ?? null] as const,
  ) as Promise<{ status: number; body: T }>;
}

test('Derby: events through the scorebug, the half-time banner then the break scene, HALF TIME and FULL TIME on the clock', async ({ browser }) => {
  test.setTimeout(240_000);
  const { page } = await login(browser);
  const matchId = await freshMatch(page);
  const detail = await api<{ lineup: { home: { playerId: string; starter: boolean; displayName: string }[] } }>(page, `/api/v1/matches/${matchId}`);
  const scorer = detail.lineup.home.find((p) => p.starter)!;

  // a published copy of the football starter flow on a fresh output of this match
  const plan = await api<{ id: string }>(page, '/api/v1/game-plans', { name: `E2E derby ${matchId.slice(0, 4)}`, sport: 'football', fromStarter: true });
  const version = await api<{ id: string }>(page, `/api/v1/game-plans/${plan.id}/publish`, {});
  const ov = await api<{ id: string }>(page, `/api/v1/matches/${matchId}/overlays`, { name: 'E2E derby' });
  expect((await call(page, 'PUT', `/api/v1/overlays/${ov.id}/game-plan`, { gamePlanVersionId: version.id })).status).toBe(200);
  // the match's look is Derby, and so is this output's
  const look = await call<{ themeProfileId: string }>(page, 'PUT', `/api/v1/matches/${matchId}/look`, { themeKey: 'derby' });
  expect(look.status).toBe(200);
  expect((await call(page, 'PUT', `/api/v1/overlays/${ov.id}/theme-profile`, { themeProfileId: look.body.themeProfileId })).status).toBe(200);
  expect((await api<{ data: { theme: { themeKey: string } } }>(page, `/api/v1/overlays/${ov.id}/render-data`)).data.theme.themeKey).toBe('derby');

  const urls = await api<{ production: string }>(page, `/api/v1/overlays/${ov.id}/urls`);
  const obsCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const obs = await obsCtx.newPage();
  await obs.goto(urls.production);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const capture = async (name: string, clip?: { x: number; y: number; width: number; height: number }) => {
    await obs.waitForTimeout(1200); // the entrance settles
    await obs.screenshot({ path: `${EVIDENCE}/derby-${name}.png`, clip });
  };
  const topLeft = { x: 0, y: 0, width: 960, height: 300 };

  const st = async () => (await api<{ state: OvState }>(page, `/api/v1/overlays/${ov.id}`)).state;
  const on = (s: OvState, layer: string) => {
    const l = s.layers[layer];
    return l && !l.outAt ? l : null;
  };
  const waitFor = async (what: string, pred: (s: OvState) => boolean, timeout: number) => {
    await expect.poll(async () => pred(await st()), { message: what, timeout, intervals: [250] }).toBe(true);
  };
  const command = async (type: string, payload: Record<string, unknown>) => {
    const lease = await call<{ leaseVersion: number }>(page, 'POST', `/api/v1/matches/${matchId}/scorer-lease`, { action: 'acquire', deviceId: 'e2e-derby' });
    const state = await api<{ stateVersion: number }>(page, `/api/v1/matches/${matchId}/state`);
    const r = await call(page, 'POST', `/api/v1/matches/${matchId}/commands`, { commandId: crypto.randomUUID(), expectedStateVersion: state.stateVersion, scorerLeaseVersion: lease.body.leaseVersion, deviceId: 'e2e-derby', type, payload });
    expect(r.status, type).toBe(200);
    return Date.now();
  };
  const phase = (to: string) => command('SET_PHASE', { to });
  const bug = obs.locator('[data-graphic="scorebug"]');
  const surname = scorer.displayName.trim().split(/\s+/).pop()!.toUpperCase();

  // kick-off: the scorebug and the kick-off banner
  await phase('first_half');
  await waitFor('scorebug up', (s) => s.scorebugVisible, 15_000);
  await expect(bug).toBeVisible({ timeout: 15_000 });
  await waitFor('kick-off banner gone', (s) => !on(s, 'lower'), 15_000);

  // a yellow card: through the scorebug, the player and the clock underneath; the score out of sight meanwhile
  await command('ADD_FACT', { type: 'yellow_card', side: 'home', playerId: scorer.playerId, payload: {}, occurredAt: Date.now() });
  await waitFor('card on air', (s) => on(s, 'event')?.templateKey === 'builtin:card', 10_000);
  const card = bug.locator('[data-scorebug-event="card"]');
  await expect(card).toContainText('YELLOW CARD');
  await expect(card).toContainText(surname);
  await expect(obs.locator('[data-graphic="card"]')).toHaveCount(0); // no strap of its own
  await capture('card-through-scorebug', topLeft);
  // after it, the scorebug's score is back
  await expect(card).toHaveCount(0, { timeout: 15_000 });
  await expect(bug).toContainText(/0\s*0/);

  // a goal: the same way, with the new score
  await command('ADD_FACT', { type: 'goal', side: 'home', playerId: scorer.playerId, payload: {}, occurredAt: Date.now() });
  const goal = bug.locator('[data-scorebug-event="goal"]');
  await expect(goal).toContainText('GOAL!', { timeout: 10_000 });
  await expect(goal).toContainText(/1–0/);
  await capture('goal-through-scorebug', topLeft);
  await expect(goal).toHaveCount(0, { timeout: 15_000 });

  // half time: the half-time banner with HALF TIME on the scorebug's clock, then 10 s later the break scene
  const t1 = await phase('half_time');
  await waitFor('half-time banner', (s) => on(s, 'lower')?.templateKey === 'builtin:period_banner' && s.scorebugVisible, 5000);
  await expect(obs.locator('[data-graphic="period_banner"]')).toContainText('HALF TIME');
  await expect(bug.locator('[data-clock-word]')).toHaveText('HALF TIME');
  await capture('half-time-banner');
  await waitFor('break scene after 10 s', (s) => on(s, 'background')?.templateKey === 'builtin:backdrop' && on(s, 'fullframe')?.templateKey === 'builtin:ident' && !s.scorebugVisible, 15_000);
  expect(Date.now() - t1).toBeGreaterThanOrEqual(9500);
  await capture('half-time-scene');

  // full time: FULL TIME on the scorebug's clock (the scorebug stays for 30 s)
  await phase('second_half_entering');
  await phase('second_half');
  await waitFor('scorebug back', (s) => s.scorebugVisible, 20_000);
  await phase('full_time');
  await expect(bug.locator('[data-clock-word]')).toHaveText('FULL TIME', { timeout: 10_000 });
  await capture('full-time-scorebug', topLeft);
  await obsCtx.close();
});
