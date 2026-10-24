// Production desk against a real OBS-like browser source: preview isolation (A18), output survives the
// control room closing (A20), transparent output with no chrome (A36), URL rotation revokes (A17).
import { expect, test } from '@playwright/test';
import { api, freshMatch, login } from './helpers';

test('preview, take to air, refresh, transparency and rotation (A17, A18, A20, A36)', async ({ browser }) => {
  const { page } = await login(browser);
  const matchId = await freshMatch(page);
  const ov = await api<{ id: string }>(page, `/api/v1/matches/${matchId}/overlays`, { name: 'E2E graphics' });
  const urls = await api<{ production: string }>(page, `/api/v1/overlays/${ov.id}/urls`);
  const obsCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const obs = await obsCtx.newPage();
  await obs.goto(urls.production);
  await obs.waitForTimeout(2000);

  await page.goto(`/app/matches/${matchId}/control/${ov.id}`);
  await page.waitForSelector('[data-template="builtin:scorebug"]', { timeout: 30_000 });
  await page.click('[data-template="builtin:scorebug"]');
  await page.getByRole('button', { name: /To air/ }).click();
  await obs.waitForSelector('[data-graphic="scorebug"]', { timeout: 15_000 });

  // A18: editing a lower third in preview does not reach the programme
  await page.click('[data-template="builtin:lower_third"]');
  await page.fill('#var-heading', 'Coach Ana Silva');
  await page.waitForTimeout(1500);
  expect(await obs.locator('[data-graphic="lower_third"]').count()).toBe(0);
  await page.getByRole('button', { name: /To air/ }).click();
  await expect(obs.locator('[data-graphic="lower_third"]')).toContainText('Coach Ana Silva', { timeout: 15_000 });

  // A20: closing the control room does not clear the output; reopening shows the acknowledged state
  await page.close();
  await obs.waitForTimeout(1500);
  expect(await obs.locator('[data-graphic="scorebug"]').count()).toBe(1);
  const page2 = await (await login(browser)).page;
  const d = await api<{ state: { revision: number; layers: Record<string, unknown> }; displayedRevision: number }>(page2, `/api/v1/overlays/${ov.id}`);
  expect(Object.keys(d.state.layers).sort()).toEqual(['lower', 'scoreboard']);
  expect(d.displayedRevision).toBe(d.state.revision);

  // A36: transparent background, no scrollbars or app chrome in the browser source
  const png = await obs.screenshot({ omitBackground: true });
  const bg = await obs.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, scrollW: document.documentElement.scrollWidth, w: innerWidth, links: document.querySelectorAll('a,nav,header').length }));
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(bg.body);
  expect(bg.scrollW).toBeLessThanOrEqual(bg.w);
  expect(bg.links).toBe(0);
  // corner pixel (outside graphics) is fully transparent in the captured PNG (RGBA, alpha byte 0)
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const file = '../../docs/evidence/e2e/obs-output.png';
  fs.mkdirSync('../../docs/evidence/e2e', { recursive: true });
  fs.writeFileSync(file, png);
  const px = (x: number, y: number) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=rgba`, '-f', 'rawvideo', '-']);
  expect(px(1900, 1060)[3]).toBe(0); // empty area: fully transparent
  expect(px(120, 70)[3]).toBe(255); // scorebug area: opaque graphic

  // A17: rotating the production URL revokes the old capability
  await api(page2, `/api/v1/overlays/${ov.id}/rotate`, { purpose: 'production' });
  const old = await obs.evaluate(async (u) => (await fetch(`/api/v1/public/overlay/${new URL(u).pathname.split('/').pop()}/snapshot`, { headers: { 'x-overlay-token': new URL(u).searchParams.get('t')! } })).status, urls.production);
  expect(old).toBe(401);
  await obsCtx.close();
});
