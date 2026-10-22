// Uploading images where they are used: an SVG team logo in the New team dialog and a GIF player photo, both
// converted in the browser and ready as soon as they arrive (no waiting for the media worker), shown in the tables
// and served as real images.
import { expect, test, type Page } from '@playwright/test';
import { api, login } from './helpers';

const EVIDENCE = '../../docs/evidence/e2e';
// a 1 × 1 GIF: a format the server never takes as is
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

type Asset = { id: string; state: string; detectedMime: string | null; width: number | null; height: number | null };
const asset = async (page: Page, id: string | null | undefined) => (await api<Asset[]>(page, '/api/v1/assets')).find((a) => a.id === id);
const loaded = (page: Page, alt: string) => page.getByAltText(alt).first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

// netball: specs that need a quick football fixture take the first active football teams, so this one adds none
test('uploads: an SVG team logo and a GIF player photo, converted in the browser and ready at once', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await login(browser);
  const tag = crypto.randomUUID().slice(0, 4);
  const name = `Upload Netball ${tag}`;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="#1F6FEB"/><circle cx="60" cy="60" r="30" fill="#FFD23F"/></svg>`);

  await page.goto('/app/assets');
  await page.getByRole('button', { name: 'New team' }).click();
  const dlg = page.getByRole('dialog', { name: 'New team' });
  await dlg.getByLabel('Full name').fill(name);
  await dlg.getByLabel('Abbreviation').fill('UPN');
  await dlg.getByLabel('Sport').selectOption('netball');
  await dlg.getByLabel('Upload team logo').setInputFiles({ name: 'crest.svg', mimeType: 'image/svg+xml', buffer: svg });
  await expect(dlg.getByAltText('Team logo preview')).toBeVisible();
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(dlg).toHaveCount(0);

  // a ready PNG at once, drawn large from the vector; the table shows it
  const team = (await api<{ id: string; name: string; logoAssetId: string | null }[]>(page, '/api/v1/teams')).find((t) => t.name === name)!;
  expect(team.logoAssetId).toBeTruthy();
  expect(await asset(page, team.logoAssetId)).toMatchObject({ state: 'READY', detectedMime: 'image/png', width: 1024, height: 1024 });
  await page.getByRole('row', { name: new RegExp(name) }).scrollIntoViewIfNeeded();
  await expect.poll(() => loaded(page, `${name} logo`)).toBe(true);
  await expect(page.getByAltText(`${name} logo`)).toBeVisible();

  // a player photo from a GIF, under Players → Photo & details
  await api(page, '/api/v1/players', { displayName: `Upload Player ${tag}` });
  await page.getByRole('tab', { name: 'Players' }).click();
  await page.getByLabel('Search players').fill(`Upload Player ${tag}`);
  const row = page.getByRole('row', { name: new RegExp(`Upload Player ${tag}`) });
  await row.getByRole('button', { name: 'Photo & details' }).click();
  const pd = page.getByRole('dialog', { name: `Upload Player ${tag}` });
  await pd.getByLabel('Upload photo').setInputFiles({ name: 'headshot.gif', mimeType: 'image/gif', buffer: GIF });
  await expect(page.getByText('Photo saved', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pd).toHaveCount(0);
  const player = (await api<{ id: string; displayName: string; photoAssetId: string | null }[]>(page, `/api/v1/players?search=${encodeURIComponent(`Upload Player ${tag}`)}`))[0]!;
  expect(await asset(page, player.photoAssetId)).toMatchObject({ state: 'READY', detectedMime: 'image/png', width: 1, height: 1 });
  await row.scrollIntoViewIfNeeded();
  await expect.poll(() => loaded(page, `Upload Player ${tag} photo`)).toBe(true);

  // the team dialog replaces the logo, and a file that is not an image says so
  await page.getByRole('tab', { name: 'Teams' }).click();
  await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Logo, colours & roster' }).click();
  const td = page.getByRole('dialog', { name });
  await td.getByLabel('Upload team logo').setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not really a picture') });
  await expect(td.getByRole('alert')).toContainText('cannot be opened as an image');
  await page.screenshot({ path: `${EVIDENCE}/uploads-team-logo.png` });
  await ctx.close();
});
