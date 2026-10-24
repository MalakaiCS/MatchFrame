// Uploads without working object storage, against real PostgreSQL: the store is unreachable, so the image is kept
// in the database; it is ready as soon as the upload completes (no media worker), previews and graphics read it,
// another organisation cannot, and a team's new logo reaches its upcoming match's graphics.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { exportJobs, matches, mediaBlobs, mediaAssets, outboxEvents, overlays, withTenant } from '@bs/db';
import { catalog, createStorage, library, matchesSvc, overlaysSvc, type Ctx } from '@bs/services';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
// nothing listens on this port: every object-store call fails
const storage = createStorage({ ...deps.config, S3_ENDPOINT: 'http://127.0.0.1:9' }, { db: deps.db });
afterAll(async () => deps.close());

function png(colour: string, size: string) {
  const f = path.join(os.tmpdir(), `bs-up-${crypto.randomUUID()}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=${size},format=rgba`, '-frames:v', '1', f]);
  return fs.readFileSync(f);
}

async function upload(ctx: Ctx, name: string, body: Buffer, kind: 'logo' | 'image' = 'logo') {
  const u = await library.createUpload(ctx, { name, kind, mime: 'image/png', bytes: body.length });
  await library.receiveUpload(ctx, u.assetId, Readable.from(body), 'image/png', body.length);
  return { assetId: u.assetId, done: await library.completeUpload(ctx, u.assetId) };
}

describe('uploads without object storage', () => {
  it('keeps the image in the database, ready at once, readable by its organisation only', async () => {
    const A = await makeOrg(deps, 'Uploads A');
    const B = await makeOrg(deps, 'Uploads B');
    const ctx: Ctx = { ...A.ctx, storage };
    const body = png('0x1F6FEB', '640x480');
    const { assetId, done } = await upload(ctx, 'harbour.png', body);
    expect(done).toEqual({ assetId, state: 'READY' });
    const [a] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)));
    expect(a).toMatchObject({ state: 'READY', detectedMime: 'image/png', width: 640, height: 480, bytes: body.length });
    // in the database, under the asset's object key
    const [blob] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(mediaBlobs).where(eq(mediaBlobs.key, a!.originalKey)));
    expect(blob).toMatchObject({ organisationId: A.org.id, contentType: 'image/png', bytes: body.length });
    expect(Buffer.compare(Buffer.from(blob!.data), body)).toBe(0);
    // reads go through the same storage: preview (what the app and the graphics fetch)
    const prev = await library.assetPreview(ctx, assetId, 'broadcast');
    const got = await storage.get(prev.key);
    const chunks: Buffer[] = [];
    for await (const c of got.body) chunks.push(c as Buffer);
    expect(Buffer.compare(Buffer.concat(chunks), body)).toBe(0);
    expect(await storage.head(a!.originalKey)).toEqual({ contentLength: body.length, contentType: 'image/png' });
    // the media worker's smaller copy is queued, but nothing waits for it
    const [j] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(exportJobs).where(eq(exportJobs.sourceId, assetId)));
    expect(j).toMatchObject({ kind: 'asset_normalise', state: 'QUEUED', params: { optimise: true } });
    // row-level security: another organisation's tenant context sees nothing
    expect(await withTenant(deps.db, { organisationId: B.org.id }, (t) => t.select().from(mediaBlobs).where(eq(mediaBlobs.key, a!.originalKey)))).toEqual([]);
    await expect(library.assetPreview({ ...B.ctx, storage }, assetId, 'broadcast')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // markup is refused at completion, and the reason is kept
    const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const u = await library.createUpload(ctx, { name: 'fake.png', kind: 'logo', mime: 'image/png', bytes: fake.length });
    await library.receiveUpload(ctx, u.assetId, Readable.from(fake), 'image/png', fake.length);
    await expect(library.completeUpload(ctx, u.assetId)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA', message: 'the file is not a PNG, JPEG or WebP image' });
    // listing and deleting work on kept files too
    expect((await storage.list(`org/${A.org.id}/assets/${assetId}/`)).map((o) => o.key)).toEqual([a!.originalKey]);
    await storage.delete(a!.originalKey);
    expect(await storage.head(a!.originalKey)).toBeNull();
  }, 60_000);

  it("a team's new logo, a player's new photo and a club logo: only the organisation's images, shown on the upcoming match", async () => {
    const A = await makeOrg(deps, 'Logos A');
    const B = await makeOrg(deps, 'Logos B');
    const ctx: Ctx = { ...A.ctx, storage };
    const comp = await catalog.createCompetition(ctx, { name: 'Harbour League', sport: 'football', defaultTimezone: 'Australia/Sydney' });
    const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
    const home = await catalog.createTeam(ctx, { name: 'Harbour City', shortName: 'Harbour', abbreviation: 'HAR', sport: 'football', primaryColor: '#7A1F2B', secondaryColor: '#F4D35E' });
    const away = await catalog.createTeam(ctx, { name: 'Bayside United', shortName: 'Bayside', abbreviation: 'BAY', sport: 'football' });
    const player = await catalog.createPlayer(ctx, { displayName: 'Sam Lee' });
    await catalog.addToRoster(ctx, { playerId: player.id, teamId: home.id, seasonId: season.id, number: 9 });
    const m = await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2026-11-07 15:00', timezone: 'Australia/Sydney' });
    const [out] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, m.id)));
    const snapshot = async () => {
      const urls = await overlaysSvc.overlayUrls(ctx, out!.id);
      const scope = await overlaysSvc.resolveRendererToken(deps.db, deps.config, new URL(urls.production!).searchParams.get('t')!);
      return overlaysSvc.rendererSnapshot(deps.db, deps.config, scope!);
    };
    expect((await snapshot()).data.match.teams.home.logoUrl).toBeNull();

    const logo = (await upload(ctx, 'harbour.png', png('0x1F6FEB', '400x400'))).assetId;
    const photo = (await upload(ctx, 'sam.png', png('0xE5484D', '300x400'), 'image')).assetId;
    const foreign = (await upload({ ...B.ctx, storage }, 'theirs.png', png('0x000000', '64x64'))).assetId;
    await expect(catalog.updateTeam(ctx, home.id, { logoAssetId: foreign })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(catalog.updatePlayer(ctx, player.id, { photoAssetId: foreign })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(catalog.createClub(ctx, { name: 'Borrowed', logoAssetId: foreign })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await catalog.createClub(ctx, { name: 'Harbour City SC', logoAssetId: logo })).toMatchObject({ logoAssetId: logo });

    const reloads = async () => (await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, out!.id), eq(outboxEvents.topic, 'overlay.state.updated'))))).length;
    const before = await reloads();
    // a new logo leaves the team's colours as they were (the update's defaults are not filled in)
    expect(await catalog.updateTeam(ctx, home.id, { logoAssetId: logo })).toMatchObject({ logoAssetId: logo, primaryColor: '#7A1F2B', secondaryColor: '#F4D35E' });
    await catalog.updatePlayer(ctx, player.id, { photoAssetId: photo });
    expect(await reloads()).toBe(before + 2);
    const snap = await snapshot();
    expect(snap.data.match.teams.home.logoUrl).toMatch(new RegExp(`/assets/${logo}`));
    expect(snap.data.match.lineup.home.find((p) => p.playerId === player.id)?.photoAssetId).toBe(photo);
    expect(snap.data.assets[photo]).toMatch(new RegExp(`/assets/${photo}`));
    // a finished match keeps the logo it was played with
    await deps.adminDb.update(matches).set({ status: 'completed' }).where(eq(matches.id, m.id));
    await catalog.updateTeam(ctx, home.id, { logoAssetId: null });
    expect((await snapshot()).data.match.teams.home.logoUrl).toMatch(new RegExp(`/assets/${logo}`));
  }, 60_000);
});
