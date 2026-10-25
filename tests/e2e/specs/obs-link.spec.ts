// The OBS link tab: the output format can be changed and changed back (the picker shows the saved format).
import { expect, test } from '@playwright/test';
import { api, freshMatch, login } from './helpers';

test('output format: venue screen, then back to broadcast 16:9', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  const matchId = await freshMatch(page);
  await page.goto(`/app/matches/${matchId}`);
  await page.getByRole('tab', { name: 'Graphics' }).click();
  const picker = page.getByLabel('Output format').first();
  await expect(picker).toHaveValue('16:9');
  const saved = async () => (await api<{ format: string }[]>(page, `/api/v1/matches/${matchId}/overlays`))[0]!.format;
  for (const format of ['venue', '9:16', '16:9'] as const) {
    await picker.selectOption(format);
    await expect.poll(saved, { message: `saved as ${format}` }).toBe(format);
    await expect(picker).toHaveValue(format);
    await expect(picker).toBeEnabled();
  }
  await ctx.close();
});

test('an output with no automation: "Use the starter flow" puts the pre-match graphics on air', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  const matchId = await freshMatch(page);
  const [ov] = await api<{ id: string }[]>(page, `/api/v1/matches/${matchId}/overlays`);
  const send = (method: string, path: string, body: unknown) =>
    page.evaluate(async ([m, p, b]) => (await fetch(p as string, { method: m as string, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, [method, path, body] as const);
  const onAir = async () => {
    const s = (await api<{ state: { layers: Record<string, { templateKey: string; outAt: number | null } | undefined> } }>(page, `/api/v1/overlays/${ov!.id}`)).state;
    return [s.layers.background, s.layers.fullframe].map((l) => (l && !l.outAt ? l.templateKey : '-')).join(',');
  };
  // like a match from before outputs got a plan by default: no plan and nothing on air
  await expect.poll(onAir, { timeout: 20_000 }).toBe('builtin:backdrop,builtin:ident');
  expect(await send('PUT', `/api/v1/overlays/${ov!.id}/game-plan`, { gamePlanVersionId: null })).toBe(200);
  for (const layer of ['background', 'fullframe']) expect(await send('POST', `/api/v1/overlays/${ov!.id}/commands`, { commandId: crypto.randomUUID(), command: { type: 'CLEAR_LAYER', layer } })).toBe(200);
  await expect.poll(onAir).toBe('-,-');
  // the organisation's newest published plan is what the button uses
  const plan = await api<{ id: string }>(page, '/api/v1/game-plans', { name: `E2E starter ${matchId.slice(0, 4)}`, sport: 'football', fromStarter: true });
  await api(page, `/api/v1/game-plans/${plan.id}/publish`, {});
  await page.goto(`/app/matches/${matchId}`);
  await page.getByRole('tab', { name: 'Graphics' }).click();
  await expect(page.getByText('No automation on this output')).toBeVisible();
  await page.getByRole('button', { name: 'Use the starter flow' }).click();
  await expect(page.getByText('No automation on this output')).toHaveCount(0);
  await expect.poll(onAir, { timeout: 20_000 }).toBe('builtin:backdrop,builtin:ident');
  await ctx.close();
});

test('a match on an older version of its plan offers the newer one', async ({ browser }) => {
  const { ctx, page } = await login(browser);
  const matchId = await freshMatch(page);
  const [ov] = await api<{ id: string }[]>(page, `/api/v1/matches/${matchId}/overlays`);
  const plan = await api<{ id: string }>(page, '/api/v1/game-plans', { name: `E2E versions ${matchId.slice(0, 4)}`, sport: 'football', fromStarter: true });
  const v1 = await api<{ id: string }>(page, `/api/v1/game-plans/${plan.id}/publish`, {});
  const put = await page.evaluate(async ([p, b]) => (await fetch(p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, [`/api/v1/overlays/${ov!.id}/game-plan`, { gamePlanVersionId: v1.id }] as const);
  expect(put).toBe(200);
  const v2 = await api<{ id: string; version: number }>(page, `/api/v1/game-plans/${plan.id}/publish`, {});
  await page.goto(`/app/matches/${matchId}`);
  await expect(page.getByText('Version 2 of this plan is published; this match still runs the older one.')).toBeVisible();
  await page.getByRole('button', { name: 'Use v2' }).click();
  const pinned = async () => (await api<{ gamePlanVersionId: string | null }[]>(page, `/api/v1/matches/${matchId}/overlays`))[0]!.gamePlanVersionId;
  await expect.poll(pinned).toBe(v2.id);
  await expect(page.getByRole('button', { name: 'Use v2' })).toHaveCount(0);
  await ctx.close();
});
