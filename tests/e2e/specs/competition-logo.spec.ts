// A tournament's logo: uploaded on the competition page, shown beside its name in the app, and carried in the
// graphics data of its matches' outputs (theme badge, full-screen title bars).
import zlib from 'node:zlib';
import { expect, test } from '@playwright/test';
import { api, login } from './helpers';

/** A small PNG: a gold disc on a transparent background. */
function png(size = 96): Buffer {
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    t.copy(out, 4);
    out.writeUInt32BE(crc(t), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows: number[] = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) {
      const inside = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size * 0.42) ** 2;
      rows.push(...(inside ? [232, 178, 40, 255] : [0, 0, 0, 0]));
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// hockey: specs that need a quick football fixture take the first active football teams, so this one adds none
test('competition logo: upload on the competition, shown in the app and in the graphics data', async ({ browser }) => {
  const { page } = await login(browser);
  const tag = crypto.randomUUID().slice(0, 4);
  const comp = await api<{ id: string }>(page, '/api/v1/competitions', { name: `E2E Logo Cup ${tag}`, sport: 'hockey', defaultTimezone: 'Australia/Sydney' });
  const season = await api<{ id: string }>(page, `/api/v1/competitions/${comp.id}/seasons`, { name: '2026' });
  const home = await api<{ id: string }>(page, '/api/v1/teams', { name: `Logo Home ${tag}`, shortName: 'Home', abbreviation: 'HOM', sport: 'hockey' });
  const away = await api<{ id: string }>(page, '/api/v1/teams', { name: `Logo Away ${tag}`, shortName: 'Away', abbreviation: 'AWY', sport: 'hockey' });
  const m = await api<{ id: string }>(page, '/api/v1/matches', { competitionId: comp.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2027-04-03 19:00', timezone: 'Australia/Sydney' });
  const [out] = await api<{ id: string }[]>(page, `/api/v1/matches/${m.id}/overlays`);
  const logoUrl = async () => (await api<{ data: { match: { competition: { logoUrl: string | null } } } }>(page, `/api/v1/overlays/${out!.id}/render-data`)).data.match.competition.logoUrl;
  expect(await logoUrl()).toBeNull();

  await page.goto(`/app/competitions/${comp.id}`);
  await page.getByLabel('Upload competition logo').setInputFiles({ name: `logo-${tag}.png`, mimeType: 'image/png', buffer: png() });
  await expect(page.getByText('Logo saved', { exact: false })).toBeVisible();
  // ready as soon as the upload completes, then on the graphics
  await expect.poll(logoUrl, { timeout: 30_000 }).toMatch(/\/api\/v1\/public\/assets\//);
  await page.reload();
  const header = page.getByRole('heading', { level: 1 });
  await expect(header.locator('img')).toBeVisible();
  await expect(page.getByAltText('Competition logo preview')).toBeVisible();
  await page.screenshot({ path: '../../docs/evidence/e2e/competition-logo.png' });

  // the competitions list shows it too
  await page.goto('/app/competitions');
  await expect(page.getByRole('link', { name: new RegExp(`E2E Logo Cup ${tag}`) }).locator('img')).toBeVisible();

  // removed: gone from the graphics
  await page.goto(`/app/competitions/${comp.id}`);
  await page.getByRole('button', { name: /Change logo/ }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.getByText('Logo removed')).toBeVisible();
  await expect.poll(logoUrl).toBeNull();
});
