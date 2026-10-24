// Product images for the public website (apps/web/public/site), from a running installation:
//  - stills of the real renderer in the Derby look, from the public showcase (fictional teams), and close-ups of the
//    scorebug and the goal inside it, and the homepage hero's first frame;
//  - the app with a fresh fixture between the account's own (fictional) teams: the match page, the control room
//    and the scorer on a phone, after kick-off and one goal. Every OBS link on screen is masked before capture.
// Usage, with the stack running:  BASE_URL=http://localhost:3000 CAPTURE_EMAIL=… CAPTURE_PASSWORD=… pnpm capture:site
// Use an account whose teams and players are fictional, never a customer's.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = path.resolve(process.env.OUT_DIR ?? new URL('../../apps/web/public/site', import.meta.url).pathname);
const EMAIL = process.env.CAPTURE_EMAIL;
const PASSWORD = process.env.CAPTURE_PASSWORD;
const only = (process.env.ONLY ?? 'stills,app').split(',');
fs.mkdirSync(OUT, { recursive: true });
const jpg = (name) => ({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 80 });
const HIDE_CHIPS = '[data-sample-chip]{display:none!important}';

async function stills(browser) {
  // measure the showcase preview, then capture at a scale that makes it 1600 px wide
  const probe = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await probe.goto(`${BASE}/showcase`);
  await probe.waitForSelector('[data-layer]');
  const w = (await probe.locator('.aspect-video').first().boundingBox()).width;
  await probe.close();
  for (const [scale, kind] of [[1600 / w, 'full'], [1300 / (w * 0.42), 'detail']]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: scale, reducedMotion: 'no-preference' });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/showcase`);
    await p.waitForSelector('[data-layer]');
    await p.addStyleTag({ content: HIDE_CHIPS });
    const preview = p.locator('.aspect-video').first();
    const show = async (sport, graphic, category, wait) => {
      await p.getByRole('combobox', { name: 'Sport' }).selectOption(sport);
      await p.getByRole('combobox', { name: 'Look' }).selectOption('derby');
      await p.getByRole('tab', { name: new RegExp(`^${category}`) }).click();
      await p.locator('#graphic-list').getByText(graphic, { exact: true }).click();
      await p.waitForTimeout(wait);
    };
    if (kind === 'full') {
      for (const [name, sport, graphic, category, wait] of [
        ['graphic-scorebug', 'football', 'Scorebug', 'Scorebug', 2200],
        ['graphic-goal', 'football', 'Goal / score event', 'Events', 2600],
        ['graphic-lineup', 'football', 'Team lineup', 'Teams', 2600],
        ['graphic-stats', 'football', 'Match statistics', 'Stats', 2600],
        ['graphic-sponsor', 'football', 'Lower third', 'People', 2200],
        ['graphic-basketball', 'basketball', 'Scorebug', 'Scorebug', 2200],
        ['graphic-futsal', 'futsal', 'Scorebug', 'Scorebug', 2200],
      ]) {
        await show(sport, graphic, category, wait);
        await preview.screenshot(jpg(name));
        console.log('still', name);
      }
    } else {
      for (const [name, graphic, category, wait] of [['detail-scorebug', 'Scorebug', 'Scorebug', 2200], ['detail-goal', 'Goal / score event', 'Events', 2600]]) {
        await show('football', graphic, category, wait);
        const b = await preview.boundingBox();
        await p.screenshot({ ...jpg(name), clip: { x: b.x, y: b.y, width: b.width * 0.42, height: b.height * 0.42 } });
        console.log('detail', name);
      }
    }
    await ctx.close();
  }
  // the homepage hero's first frame (no sample sequence yet), shown until the renderer loads
  const probe2 = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await probe2.goto(BASE);
  await probe2.waitForSelector('[data-layer]');
  const hw = (await probe2.locator('.aspect-video').first().boundingBox()).width;
  await probe2.close();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1600 / hw, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(BASE);
  await p.waitForSelector('[data-layer="scoreboard"]');
  await p.addStyleTag({ content: HIDE_CHIPS });
  await p.waitForTimeout(1500);
  await p.locator('.aspect-video').first().screenshot(jpg('hero-poster'));
  console.log('still hero-poster');
  await ctx.close();
}

/**
 * Before any capture: every OBS / overlay link on the page (inputs and text) is replaced, so no capability token
 * reaches an image, and the signed-in person's name reads as a fictional one.
 */
const maskLinks = (page, person) =>
  page.evaluate((who) => {
    const masked = 'https://matchframe.tv/overlay/••••••••';
    for (const el of document.querySelectorAll('input, textarea')) if (/\/overlay\/|token=|\/m\//.test(el.value)) el.value = masked;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let t = n.textContent ?? '';
      if (/https?:\/\/\S*(\/overlay\/|token=|\/m\/)/.test(t)) t = t.replace(/https?:\/\/\S+/g, masked);
      if (who && t.includes(who)) t = t.split(who).join('Sam Patel');
      n.textContent = t;
    }
  }, person);

async function app(browser) {
  if (!EMAIL || !PASSWORD) throw new Error('Set CAPTURE_EMAIL and CAPTURE_PASSWORD (an account with fictional teams)');
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => localStorage.setItem('mf-theme', 'dark'));
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login?method=password`);
  await p.waitForLoadState('networkidle');
  await p.fill('#email', EMAIL);
  await p.fill('#password', PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForURL('**/app**');
  const call = (method, url, body) => p.evaluate(async ([m, u, b]) => {
    const r = await fetch(u, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return r.json();
  }, [method, url, body ?? null]);
  // a fresh fixture: the first two active football teams, round 12, kick-off in a few minutes
  const comps = await call('GET', '/api/v1/competitions');
  const comp = comps.find((c) => c.sport === 'football' && c.currentSeason);
  const teams = (await call('GET', '/api/v1/teams')).filter((t) => t.sport === 'football' && t.status === 'active');
  const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + 5 * 60_000)).replace(',', '');
  const match = await call('POST', '/api/v1/matches', { competitionId: comp.id, seasonId: comp.currentSeason.id, homeTeamId: teams[0].id, awayTeamId: teams[1].id, kickoffLocal: local, timezone: 'Australia/Brisbane', round: '12' });
  await call('PUT', `/api/v1/matches/${match.id}/look`, { themeKey: 'derby' });
  // the football starter flow, published under a plain name, on the match's output
  const plan = await call('POST', '/api/v1/game-plans', { name: 'Football matchday', sport: 'football', fromStarter: true });
  const version = await call('POST', `/api/v1/game-plans/${plan.id}/publish`, {});
  const me = await call('GET', '/api/v1/me');
  const detail = await call('GET', `/api/v1/matches/${match.id}`);
  const ovList = await call('GET', `/api/v1/matches/${match.id}/overlays`);
  const firstOv = (Array.isArray(ovList) ? ovList : ovList.items)[0];
  await call('PUT', `/api/v1/overlays/${firstOv.id}/game-plan`, { gamePlanVersionId: version.id });
  const command = async (type, payload) => {
    const lease = await call('POST', `/api/v1/matches/${match.id}/scorer-lease`, { action: 'acquire', deviceId: 'site-capture' });
    const state = await call('GET', `/api/v1/matches/${match.id}/state`);
    await call('POST', `/api/v1/matches/${match.id}/commands`, { commandId: crypto.randomUUID(), expectedStateVersion: state.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'site-capture', type, payload });
  };
  await command('SET_PHASE', { to: 'first_half' });
  const scorer = detail.lineup?.home?.find((x) => x.starter);
  await command('ADD_FACT', { type: 'goal', side: 'home', playerId: scorer?.playerId ?? null, payload: {}, occurredAt: Date.now() });
  await p.waitForTimeout(8000); // the goal graphic has come and gone

  await p.goto(`${BASE}/app/matches/${match.id}`);
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(1500);
  await maskLinks(p, me.user.name);
  await p.screenshot(jpg('product-prepare'));
  console.log('app product-prepare');

  const overlays = await call('GET', `/api/v1/matches/${match.id}/overlays`);
  const ov = (Array.isArray(overlays) ? overlays : overlays.items)[0];
  await p.goto(`${BASE}/app/matches/${match.id}/control/${ov.id}`);
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(2500);
  await maskLinks(p, me.user.name);
  await p.screenshot(jpg('product-control'));
  console.log('app product-control');

  const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const s = await phone.newPage();
  await s.goto(`${BASE}/score/${match.id}`);
  await s.waitForLoadState('networkidle');
  await s.waitForTimeout(2000);
  await maskLinks(s, me.user.name);
  await s.screenshot(jpg('product-scorer'));
  console.log('app product-scorer');
  await phone.close();
  await ctx.close();
}

const browser = await chromium.launch();
try {
  if (only.includes('stills')) await stills(browser);
  if (only.includes('app')) await app(browser);
} finally {
  await browser.close();
}
