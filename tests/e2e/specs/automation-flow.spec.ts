// The football starter plan on a real output, in real time: animated background and match header before the
// match, both cleared when the players walk out, line-ups 15 s later (8 s each, once, only for a team with a
// line-up), scorebug and kick-off banner at each half, the half-time background cycling stats and the header
// with the restart countdown every 45 s, the scorebug back 7 s after the second-half walk-out, and 30 s after
// full time the final score on the header with "Thank you for watching". Captures of the OBS page are kept as
// evidence in docs/evidence/e2e/.
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { api, freshMatch, login } from './helpers';

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

test('football starter flow on a real output, with the real timings', async ({ browser }) => {
  test.setTimeout(300_000);
  const { page } = await login(browser);
  const matchId = await freshMatch(page);

  // the away side has no line-up: its board must not appear at all
  const detail = await api<{ lineup: { home: { playerId: string; starter: boolean; number: number | null; captain?: boolean; position?: string | null }[] } }>(page, `/api/v1/matches/${matchId}`);
  expect(detail.lineup.home.some((p) => p.starter)).toBe(true);
  const lu = await call(page, 'PUT', `/api/v1/matches/${matchId}/lineup`, { home: detail.lineup.home.map((p) => ({ playerId: p.playerId, starter: p.starter, number: p.number, captain: p.captain ?? false, position: p.position ?? null })), away: [] });
  expect(lu.status).toBe(200);

  // a published copy of the football starter plan on a fresh output
  const plan = await api<{ id: string }>(page, '/api/v1/game-plans', { name: `E2E flow ${matchId.slice(0, 4)}`, sport: 'football', fromStarter: true });
  const version = await api<{ id: string }>(page, `/api/v1/game-plans/${plan.id}/publish`, {});
  expect(version.id).toBeTruthy();
  const ov = await api<{ id: string }>(page, `/api/v1/matches/${matchId}/overlays`, { name: 'E2E flow' });
  expect((await call(page, 'PUT', `/api/v1/overlays/${ov.id}/game-plan`, { gamePlanVersionId: version.id })).status).toBe(200);

  const urls = await api<{ production: string }>(page, `/api/v1/overlays/${ov.id}/urls`);
  const obsCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const obs = await obsCtx.newPage();
  await obs.goto(urls.production);
  fs.mkdirSync('../../docs/evidence/e2e', { recursive: true });
  const capture = async (name: string) => {
    await obs.waitForTimeout(1200); // entrance settles
    await obs.screenshot({ path: `../../docs/evidence/e2e/flow-${name}.png` });
  };

  const st = async () => (await api<{ state: OvState }>(page, `/api/v1/overlays/${ov.id}`)).state;
  const on = (s: OvState, layer: string) => {
    const l = s.layers[layer];
    return l && !l.outAt ? l : null;
  };
  const waitFor = async (what: string, pred: (s: OvState) => boolean, timeout: number) => {
    await expect.poll(async () => pred(await st()), { message: what, timeout, intervals: [250] }).toBe(true);
  };
  const phase = async (to: string) => {
    const lease = await call<{ leaseVersion: number }>(page, 'POST', `/api/v1/matches/${matchId}/scorer-lease`, { action: 'acquire', deviceId: 'e2e-flow' });
    const state = await api<{ stateVersion: number }>(page, `/api/v1/matches/${matchId}/state`);
    const r = await call(page, 'POST', `/api/v1/matches/${matchId}/commands`, { commandId: crypto.randomUUID(), expectedStateVersion: state.stateVersion, scorerLeaseVersion: lease.body.leaseVersion, deviceId: 'e2e-flow', type: 'SET_PHASE', payload: { to } });
    expect(r.status, `phase ${to}`).toBe(200);
    return Date.now();
  };

  // pre-match: animated background, the match header with the kick-off countdown on top of it
  await phase('pre_match');
  await waitFor('background and header on air', (s) => on(s, 'background')?.templateKey === 'builtin:backdrop' && on(s, 'fullframe')?.templateKey === 'builtin:ident', 10_000);
  await expect(obs.locator('[data-graphic="backdrop"]')).toBeVisible();
  await capture('1-pre-match');

  // players entering: both go; 15 s later the home line-up for 8 s; "About to start" does not cut it short
  const t0 = await phase('players_entering');
  await waitFor('background and header cleared', (s) => !on(s, 'background') && !on(s, 'fullframe'), 5000);
  await obs.waitForTimeout(3000);
  await phase('about_to_start');
  await waitFor('home line-up on air', (s) => on(s, 'fullframe')?.templateKey === 'builtin:lineup', 20_000);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(14_000);
  expect(on(await st(), 'fullframe')?.variables.team).toBe('home');
  await capture('2-home-lineup');
  await waitFor('home line-up off after 8 s', (s) => !on(s, 'fullframe'), 12_000);
  // the away line-up was never entered: nothing replaces it
  const until = t0 + 27_000;
  while (Date.now() < until) {
    const ff = on(await st(), 'fullframe');
    expect(ff?.templateKey === 'builtin:lineup' && ff.variables.team === 'away', 'away line-up must not show').toBe(false);
    await obs.waitForTimeout(500);
  }

  // 1st half: scorebug and kick-off banner
  await phase('first_half');
  await waitFor('scorebug and kick-off banner', (s) => s.scorebugVisible && on(s, 'lower')?.templateKey === 'builtin:period_banner', 8000);

  // half time: background over everything, stats, then 45 s later the header with the restart countdown
  const t1 = await phase('half_time');
  await waitFor('half-time background and stats', (s) => on(s, 'background')?.templateKey === 'builtin:backdrop' && on(s, 'fullframe')?.templateKey === 'builtin:stats' && !s.scorebugVisible, 8000);
  await capture('3-half-time-stats');
  await waitFor('header with countdown after 45 s', (s) => on(s, 'fullframe')?.templateKey === 'builtin:ident', 55_000);
  expect(Date.now() - t1).toBeGreaterThanOrEqual(44_000);
  await expect(obs.locator('[data-graphic$="ident"]')).toContainText(/2ND HALF IN/i);
  await capture('4-half-time-header');

  // second-half walk-out: background and header fade, scorebug back 7 s later
  const t2 = await phase('second_half_entering');
  await waitFor('cleared for the walk-out', (s) => !on(s, 'background') && !on(s, 'fullframe'), 5000);
  await waitFor('scorebug back', (s) => s.scorebugVisible, 12_000);
  expect(Date.now() - t2).toBeGreaterThanOrEqual(6500);
  await phase('second_half_ready');
  await phase('second_half');
  await waitFor('second-half kick-off banner', (s) => s.scorebugVisible && on(s, 'lower')?.templateKey === 'builtin:period_banner', 8000);

  // full time: 30 s later, the final score on the header over the background with the thank-you
  const t3 = await phase('full_time');
  await waitFor('thank-you header', (s) => on(s, 'background')?.templateKey === 'builtin:backdrop' && on(s, 'fullframe')?.variables.message === 'Thank you for watching', 40_000);
  expect(Date.now() - t3).toBeGreaterThanOrEqual(29_000);
  expect((await st()).scorebugVisible).toBe(false);
  await expect(obs.locator('[data-graphic$="ident"]')).toContainText(/THANK YOU FOR WATCHING/i);
  await expect(obs.locator('[data-graphic$="ident"]')).toContainText(/FULL TIME/i);
  await capture('5-full-time');
  await obsCtx.close();
});
