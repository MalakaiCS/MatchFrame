import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const EMAIL = process.env.E2E_EMAIL ?? 'owner@studio.localhost';
export const PASSWORD = process.env.E2E_PASSWORD ?? '';

// One real sign-in per run: the session cookies are kept in a file and reused by every later context, so the
// auth rate limit (three password sign-ins per ten seconds in production mode) is never the reason a spec fails.
const STATE = path.join(os.tmpdir(), `bs-e2e-state-${crypto.createHash('md5').update(`${process.env.E2E_BASE_URL ?? ''}|${EMAIL}`).digest('hex')}.json`);

export async function login(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const fresh = fs.existsSync(STATE) && Date.now() - fs.statSync(STATE).mtimeMs < 20 * 60_000;
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...(fresh ? { storageState: STATE } : {}), ...opts });
  const page = await ctx.newPage();
  if (fresh) {
    await page.goto('/app');
    try {
      await page.waitForURL('**/app', { timeout: 15_000 });
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15_000 });
      return { ctx, page };
    } catch {
      // the saved session is no longer valid: sign in again below
    }
  }
  await page.goto('/login?method=password');
  await page.waitForLoadState('networkidle'); // hydrated: the submit is handled by the app, not the native form
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/app');
  await ctx.storageState({ path: STATE });
  return { ctx, page };
}

export async function api<T>(page: Page, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ([p, b]) => {
      const r = await fetch(p as string, { method: b ? 'POST' : 'GET', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
      return r.json();
    },
    [path, body ?? null] as const,
  ) as Promise<T>;
}

/** A fresh football fixture so each spec starts from a known scheduled state. */
export async function freshMatch(page: Page): Promise<string> {
  const comps = await api<{ id: string; sport: string; currentSeason: { id: string } | null }[]>(page, '/api/v1/competitions');
  const comp = comps.find((c) => c.sport === 'football' && c.currentSeason)!;
  const teams = await api<{ id: string; sport: string; status: string }[]>(page, '/api/v1/teams');
  const [h, a] = teams.filter((t) => t.sport === 'football' && t.status === 'active');
  const kick = new Date(Date.now() + 3600_000);
  const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(kick).replace(',', '');
  const m = await api<{ id: string }>(page, '/api/v1/matches', { competitionId: comp.id, seasonId: comp.currentSeason!.id, homeTeamId: h!.id, awayTeamId: a!.id, kickoffLocal: local, timezone: 'Australia/Brisbane', round: `E2E ${crypto.randomUUID().slice(0, 4)}` });
  expect(m.id).toBeTruthy();
  return m.id;
}

/** Kick off from the fixture's starting state: skip the walk-out steps on the pregame sheet, then start the half. */
export async function startFirstHalf(page: Page) {
  const steps = page.getByRole('region', { name: 'Match phase' });
  for (const s of ['Pre-match', 'Players entering', 'About to start']) await steps.getByRole('button', { name: `Skip ${s}` }).click();
  await steps.getByRole('button', { name: /^Start / }).click();
  await expect(page.getByRole('region', { name: 'Clock controls' })).toBeVisible();
}

/** End the period from the header's button, choosing the next step in the sheet that opens. */
export async function endPeriod(page: Page, next: string) {
  await page.getByRole('navigation', { name: 'Match controls' }).getByRole('button', { name: /^End / }).click();
  await page.getByRole('dialog').getByRole('button', { name: next, exact: true }).click();
  await expect(page.getByRole('region', { name: 'Score' })).toContainText(next);
}

/** In a break: skip the steps still to do and start the next period. */
export async function startNextPeriod(page: Page, label: string) {
  const steps = page.getByRole('region', { name: 'Match phase' });
  const todo = steps.locator('button[aria-label^="Skip "]:enabled');
  while (await todo.count()) await todo.first().click();
  await steps.getByRole('button', { name: `Start ${label}` }).click();
  await expect(page.getByRole('region', { name: 'Score' })).toContainText(label);
}

export const clockText = async (page: Page) => (await page.locator('[data-clock]').first().textContent())!.trim();
export const toSeconds = (t: string) => {
  const [m, s] = t.split(':').map(Number);
  return m! * 60 + s!;
};
export const score = async (page: Page) => (await page.locator('[data-score-side]').allTextContents()).map(Number);

/** One team's half of a row on the scorer sheet; its name reads like "Shot on target, Harbour: 2". */
export const sheetCell = (page: Page, side: 'home' | 'away', event: string) => page.locator(`[data-side="${side}"][data-event="${event}"]`);
/** The count a half of a row shows, from its name. */
export const cellCount = async (page: Page, side: 'home' | 'away', event: string) => (await sheetCell(page, side, event).getAttribute('aria-label'))!.split(': ').pop()!;
