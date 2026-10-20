import crypto from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const EMAIL = process.env.E2E_EMAIL ?? 'owner@studio.localhost';
export const PASSWORD = process.env.E2E_PASSWORD ?? '';

export async function login(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...opts });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.waitForLoadState('networkidle'); // hydrated: the submit is handled by the app, not the native form
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/app');
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

/** Kick off straight from the fixture's starting state. The phone's big Next button follows the full flow
 *  (pre-match → players entering → about to start → kick-off), so the direct jump sits under "More options". */
export async function startFirstHalf(page: Page) {
  await page.getByRole('region', { name: 'Match phase' }).getByRole('button', { name: 'More options' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '1st Half', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('region', { name: 'Clock controls' })).toBeVisible();
}

export const clockText = async (page: Page) => (await page.getByRole('region', { name: 'Score' }).locator('.text-3xl').textContent())!.trim();
export const toSeconds = (t: string) => {
  const [m, s] = t.split(':').map(Number);
  return m! * 60 + s!;
};
export const score = async (page: Page) => (await page.getByRole('region', { name: 'Score' }).locator('.text-5xl').allTextContents()).map(Number);
