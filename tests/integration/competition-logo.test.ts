// A competition's logo against real PostgreSQL: only the organisation's own images can be the logo, graphics data
// carries it, and open outputs of the competition's upcoming matches reload when it changes.
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { mediaAssets, outboxEvents, overlays, withTenant } from '@bs/db';
import { catalog, createStorage, library, matchesSvc, overlaysSvc } from '@bs/services';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
const storage = createStorage(deps.config);
afterAll(async () => deps.close());

describe('competition logo', () => {
  it("attaches one of the organisation's images to a competition; graphics show it and open outputs reload", async () => {
    const A = await makeOrg(deps, 'Logo A');
    const B = await makeOrg(deps, 'Logo B');
    const upload = async (ctx: typeof A.ctx, name: string, kind: 'logo' | 'image' | 'video', mime: string) => {
      const u = await library.createUpload({ ...ctx, storage }, { name, kind, mime, bytes: 1000 });
      // the media worker checks and converts uploads; here the image is marked ready directly
      await deps.adminDb.update(mediaAssets).set({ state: 'READY' }).where(eq(mediaAssets.id, u.assetId));
      return u.assetId;
    };
    const logo = await upload(A.ctx, 'harbour-cup.png', 'logo', 'image/png');
    const video = await upload(A.ctx, 'promo.mp4', 'video', 'video/mp4');
    const foreign = await upload(B.ctx, 'other.png', 'logo', 'image/png');

    const comp = await catalog.createCompetition(A.ctx, { name: 'Harbour Cup', sport: 'football', defaultTimezone: 'Australia/Sydney' });
    const season = await catalog.createSeason(A.ctx, comp.id, { name: '2026' });
    const home = await catalog.createTeam(A.ctx, { name: 'Harbour City', shortName: 'Harbour', abbreviation: 'HAR', sport: 'football' });
    const away = await catalog.createTeam(A.ctx, { name: 'Bayside United', shortName: 'Bayside', abbreviation: 'BAY', sport: 'football' });
    const m = await matchesSvc.createMatch(A.ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2026-11-07 19:00', timezone: 'Australia/Sydney' });
    const [out] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, m.id)));
    const snapshot = async () => {
      const urls = await overlaysSvc.overlayUrls(A.ctx, out!.id);
      const scope = await overlaysSvc.resolveRendererToken(deps.db, deps.config, new URL(urls.production!).searchParams.get('t')!);
      return overlaysSvc.rendererSnapshot(deps.db, deps.config, scope!);
    };
    expect((await snapshot()).data.match.competition.logoUrl).toBeNull();

    // only images and logos of this organisation
    await expect(catalog.updateCompetition(A.ctx, comp.id, { logoAssetId: video })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(catalog.updateCompetition(A.ctx, comp.id, { logoAssetId: foreign })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(catalog.createCompetition(A.ctx, { name: 'Borrowed logo', sport: 'football', defaultTimezone: 'Australia/Sydney', logoAssetId: foreign })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const reloads = () => withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, out!.id), eq(outboxEvents.topic, 'overlay.state.updated'))).orderBy(desc(outboxEvents.position)));
    const before = (await reloads()).length;
    expect(await catalog.updateCompetition(A.ctx, comp.id, { logoAssetId: logo })).toMatchObject({ logoAssetId: logo });
    const after = await reloads();
    expect(after.length).toBe(before + 1);
    expect(after[0]!.payload).toMatchObject({ themeChanged: true });

    // the output's data carries a signed URL for the logo; the theme badge and title bars use it
    const snap = await snapshot();
    expect(snap.data.match.competition.logoUrl).toMatch(new RegExp(`/assets/${logo}`));
    expect(snap.data.assets[logo]).toBe(snap.data.match.competition.logoUrl);
    expect((await catalog.listCompetitions(A.ctx)).find((c) => c.id === comp.id)?.logoAssetId).toBe(logo);

    // saving other settings does not reload outputs; removing the logo does
    await catalog.updateCompetition(A.ctx, comp.id, { shortName: 'Harbour' });
    expect((await reloads()).length).toBe(before + 1);
    await catalog.updateCompetition(A.ctx, comp.id, { logoAssetId: null });
    expect((await reloads()).length).toBe(before + 2);
    expect((await snapshot()).data.match.competition.logoUrl).toBeNull();
  });

  it("receives an upload's file through the API (same origin as the app) and checks it against the upload", async () => {
    const A = await makeOrg(deps, 'Upload A');
    const B = await makeOrg(deps, 'Upload B');
    const ctx = { ...A.ctx, storage };
    const body = Buffer.from('not an image: checked when the upload completes');
    const u = await library.createUpload(ctx, { name: 'cup.png', kind: 'logo', mime: 'image/png', bytes: body.length });
    const send = (c: typeof ctx, type: string, b: Buffer) => library.receiveUpload(c, u.assetId, Readable.from(b), type, b.length);
    await expect(send(ctx, 'image/jpeg', body)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    await expect(send(ctx, 'image/png', Buffer.concat([body, body]))).rejects.toMatchObject({ code: 'UPLOAD_SIZE_MISMATCH' });
    await expect(send({ ...B.ctx, storage }, 'image/png', body)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await send(ctx, 'image/png', body)).toEqual({ ok: true });
    // the bytes are not an image: refused when the upload completes, and the asset says why
    await expect(library.completeUpload(ctx, u.assetId)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    const [a] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(mediaAssets).where(eq(mediaAssets.id, u.assetId)));
    expect(a).toMatchObject({ state: 'FAILED', error: 'Rejected: the file is not a PNG, JPEG or WebP image' });
    await expect(send(ctx, 'image/png', body)).rejects.toMatchObject({ code: 'UPLOAD_CLOSED' });
  });
});
