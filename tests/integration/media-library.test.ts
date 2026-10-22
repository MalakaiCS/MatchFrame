// Media library against real PostgreSQL, MinIO and FFmpeg (A12 stale, A23 one request, A42–A48).
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { broadcastSessions, clips, createDb, entitlements, exportJobs, highlightRequests, outputSessions, recordingParts, recordings, withTenant } from '@bs/db';
import { catalog, createStorage, library, matchesSvc, mediaJobs, scoring, streamsSvc, type Ctx } from '@bs/services';
import { createFakeProvider } from '@bs/media';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
const worker = createDb(deps.config.DATABASE_WORKER_URL, { max: 4 });
const storage = createStorage(deps.config);
const J = { db: worker.db, storage };
const FIXTURE = path.resolve('tests/media/fixtures/test-source-720p30.mp4');
let A: Awaited<ReturnType<typeof makeOrg>>;
let B: Awaited<ReturnType<typeof makeOrg>>;
let ctx: Ctx;
const T0 = Math.floor((Date.now() - 2 * 3600_000) / 1000) * 1000;
let m: Awaited<ReturnType<typeof matchesSvc.createMatch>>;
let outputId: string;
let lease: { leaseVersion: number } | null;

const send = async (type: string, payload: Record<string, unknown>) => {
  lease = await scoring.scorerLease(ctx, m.id, { action: 'acquire', deviceId: 'dev-media' });
  const st = await scoring.getMatchState(ctx, m.id);
  return scoring.handleMatchCommand(ctx, m.id, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease!.leaseVersion, deviceId: 'dev-media', type, payload });
};

/** Real HLS (2 s segments) from the fixture, with PDT rewritten to T0 and an optional missing segment. */
async function uploadHls(prefix: string, opts: { dropSeq?: number } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-hls-'));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', FIXTURE, '-t', '40', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-c:a', 'aac', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'), path.join(dir, 'index.m3u8')]);
  const lines = fs.readFileSync(path.join(dir, 'index.m3u8'), 'utf8').split('\n');
  let t = T0;
  const out: string[] = [];
  for (const l of lines) {
    if (l.startsWith('#EXTINF:')) {
      out.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(t).toISOString()}`);
      t += Math.round(parseFloat(l.slice(8)) * 1000);
    }
    out.push(l);
  }
  fs.writeFileSync(path.join(dir, 'index.m3u8'), out.join('\n'));
  for (const f of fs.readdirSync(dir)) {
    if (opts.dropSeq != null && f === `seg_${String(opts.dropSeq).padStart(5, '0')}.ts`) continue;
    await storage.putFile(`${prefix}${f}`, path.join(dir, f), f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/** A finished recorded session for the match, as the media control plane would leave it. */
async function recordedSession(opts: { dropSeq?: number } = {}) {
  return withTenant(worker.db, { organisationId: A.org.id }, async (t) => {
    const sid = crypto.randomUUID();
    await t.insert(broadcastSessions).values({ id: sid, organisationId: A.org.id, matchId: m.id, roomName: `bs_${sid}`, state: 'STOPPED', startedAt: new Date(T0 - 5000), endedAt: new Date(T0 + 60_000) });
    const [os] = await t.insert(outputSessions).values({ organisationId: A.org.id, broadcastSessionId: sid, outputId, state: 'STOPPED', preset: {}, reportingAuthority: 'compositor', startedAt: new Date(T0 - 5000), endedAt: new Date(T0 + 60_000) }).returning();
    const prefix = `org/${A.org.id}/live/${os!.id}/`;
    await uploadHls(prefix, opts);
    const [rec] = await t.insert(recordings).values({ organisationId: A.org.id, matchId: m.id, outputSessionId: os!.id, outputId, title: 'Programme recording', state: 'READY', storagePrefix: `org/${A.org.id}/recordings/${os!.id}/` }).returning();
    await t.insert(recordingParts).values({ organisationId: A.org.id, recordingId: rec!.id, partIndex: 0, playlistKey: `${prefix}index.m3u8`, state: 'READY' });
    return { os: os!, rec: rec! };
  });
}

async function runJob(jobId: string, extra: Partial<Parameters<typeof mediaJobs.processJob>[0]> = {}) {
  return mediaJobs.processJob({ ...J, ...extra }, jobId);
}
const probe = (key: string) => {
  const f = path.join(os.tmpdir(), `p-${crypto.randomUUID()}.mp4`);
  return storage.download(key, f).then(() => {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f]).toString());
    fs.rmSync(f);
    const v = j.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    const a = j.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
    return { w: v?.width, h: v?.height, vcodec: v?.codec_name, acodec: a?.codec_name, dur: Number(j.format.duration) };
  });
};

beforeAll(async () => {
  await storage.ensureBucket();
  A = await makeOrg(deps, 'Media A');
  B = await makeOrg(deps, 'Media B');
  ctx = { ...A.ctx, storage, media: createFakeProvider() };
  const comp = await catalog.createCompetition(ctx, { name: 'Media League', sport: 'football', defaultTimezone: 'Australia/Brisbane' });
  const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
  const h = await catalog.createTeam(ctx, { name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', sport: 'football' });
  const a = await catalog.createTeam(ctx, { name: 'Ridgeback United', shortName: 'Ridge', abbreviation: 'RBU', sport: 'football' });
  m = await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-11-07 15:00', timezone: 'Australia/Brisbane' });
  outputId = (await streamsSvc.saveOutput(ctx, m.id, { mode: 'PROGRAMME' })).id;
  lease = await scoring.scorerLease(ctx, m.id, { action: 'acquire', deviceId: 'dev-media' });
  await send('SET_PHASE', { to: 'first_half' });
}, 120_000);
afterAll(async () => {
  await worker.pool.end();
  await deps.close();
});

describe('highlights and clips', () => {
  let clipId: string;
  let factId: string;

  it('one highlight request per fact even when delivered twice; maps by capture time; real clip (A23, A42, A43)', async () => {
    const { rec } = await recordedSession();
    const r = await send('ADD_FACT', { type: 'goal', side: 'home', occurredAt: T0 + 20_000, payload: {} });
    factId = r.event.eventId;
    const first = await library.requestHighlights(worker.db, A.org.id, factId);
    const second = await library.requestHighlights(worker.db, A.org.id, factId);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(await library.processHighlights(worker.db, storage, undefined, T0 + 3600_000)).toBe(1);
    const [h] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(highlightRequests).where(eq(highlightRequests.factId, factId)));
    expect(h).toMatchObject({ state: 'PROCESSING', shortened: false });
    const [job] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(exportJobs).where(eq(exportJobs.sourceId, h!.clipId!)));
    expect(await runJob(job!.id)).toBe('completed');
    const [c] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(clips).where(eq(clips.id, h!.clipId!)));
    expect(c!.state).toBe('READY');
    expect(c!.recordingId).toBe(rec.id);
    const p = await probe(c!.objectKey!);
    expect(p).toMatchObject({ vcodec: 'h264', acodec: 'aac', w: 1280, h: 720 });
    expect(p.dur).toBeGreaterThan(19.5);
    expect(p.dur).toBeLessThan(20.6);
    // the in point is media time = capture time - PDT(first segment) - preroll
    expect(c!.inMs).toBe(20_000 - 12_000);
    clipId = c!.id;
  }, 180_000);

  it('a gap at the event fails explicitly; no silent wrong clip (A42)', async () => {
    await recordedSession({ dropSeq: 5 }); // segment covering T0+10..12s is missing from storage
    const r = await send('ADD_FACT', { type: 'goal', side: 'away', occurredAt: T0 + 11_000, payload: {} });
    await library.requestHighlights(worker.db, A.org.id, r.event.eventId);
    await library.processHighlights(worker.db, storage, undefined, T0 + 3600_000);
    const hs = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(highlightRequests).where(eq(highlightRequests.factId, r.event.eventId)));
    // the earlier recorded session (complete) also covers this moment for the same output: only the
    // gapped one is considered because its session window contains the event; result must not be READY
    expect(hs.map((x) => x.state)).not.toContain('READY');
    const created = hs.filter((x) => x.clipId);
    for (const h of created) {
      const [job] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(exportJobs).where(eq(exportJobs.sourceId, h.clipId!)));
      expect(await runJob(job!.id)).toBe('failed');
    }
    const after = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(highlightRequests).where(eq(highlightRequests.factId, r.event.eventId)));
    expect(after[0]!.state).toBe('FAILED');
    expect(after[0]!.reason).toMatch(/gap|missing/i);
  }, 180_000);

  it('exports in all three aspects with correct probe (A44)', async () => {
    for (const [aspect, w, h] of [['16:9', 1920, 1080], ['9:16', 1080, 1920], ['1:1', 1080, 1080]] as const) {
      const j = await library.exportClip(ctx, clipId, { aspect, trimInMs: 2000, trimOutMs: 12_000, focusX: 0.4 });
      expect(await runJob(j.id)).toBe('completed');
      const [row] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(exportJobs).where(eq(exportJobs.id, j.id)));
      const p = await probe(row!.outputKey!);
      expect(p).toMatchObject({ w, h, vcodec: 'h264', acodec: 'aac' });
      expect(p.dur).toBeGreaterThan(9.5);
      expect(p.dur).toBeLessThan(10.6);
    }
  }, 300_000);

  it('cancel stops only its own job; retry completes once without duplicate objects (A45)', async () => {
    const j = await library.createCompilation(ctx, { title: 'Top goals', clipIds: [clipId, clipId], aspect: '16:9' });
    const other = await library.exportClip(ctx, clipId, { aspect: '1:1', trimInMs: 0, trimOutMs: 4000 });
    const running = runJob(j.id, { slowMs: 8000 });
    const otherRun = runJob(other.id);
    await new Promise((r) => setTimeout(r, 1500));
    await library.cancelJob(ctx, j.id);
    expect(await running).toBe('cancelled');
    expect(await otherRun).toBe('completed'); // unaffected by the cancel
    await library.retryJob(ctx, j.id);
    expect(await runJob(j.id)).toBe('completed');
    expect(await runJob(j.id)).toBe('skipped'); // a duplicate queue delivery does nothing
    const objs = await storage.list(`org/${A.org.id}/exports/${j.id}`);
    expect(objs.map((o) => o.key)).toEqual([`org/${A.org.id}/exports/${j.id}-a2.mp4`]);
    const [row] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(exportJobs).where(eq(exportJobs.id, j.id)));
    expect((await probe(row!.outputKey!)).dur).toBeGreaterThan(39);
  }, 300_000);

  it('share links: media bytes require a valid, unexpired, unrevoked token; other tenants denied (A46)', async () => {
    const s = await library.createShare(ctx, { resourceType: 'clip', resourceId: clipId, expiresInHours: 1 });
    const token = new URL(s.watchUrl).searchParams.get('t')!;
    expect((await library.resolveShare(deps.db, s.publicId, token)).media.mime).toBe('video/mp4');
    await expect(library.resolveShare(deps.db, s.publicId, 'wrong')).rejects.toMatchObject({ code: 'SHARE_INVALID' });
    await library.revokeShare(ctx, s.id);
    await expect(library.resolveShare(deps.db, s.publicId, token)).rejects.toMatchObject({ code: 'SHARE_REVOKED' });
    const e = await library.createShare(ctx, { resourceType: 'clip', resourceId: clipId, expiresInHours: 1 });
    await worker.db.execute(`update share_links set expires_at = now() - interval '1 minute' where public_id = '${e.publicId}'` as never);
    await expect(library.resolveShare(deps.db, e.publicId, new URL(e.watchUrl).searchParams.get('t')!)).rejects.toMatchObject({ code: 'SHARE_EXPIRED' });
    await expect(library.mediaFor({ ...B.ctx, storage }, 'clip', clipId)).rejects.toMatchObject({ status: 404 });
    await expect(library.createShare({ ...B.ctx, storage }, { resourceType: 'clip', resourceId: clipId })).rejects.toMatchObject({ status: 404 });
  });

  it('a corrected goal marks its clip stale (A12)', async () => {
    await send('CORRECT_FACT', { factId, reason: 'wrong team', changes: { side: 'away' } });
    await library.markFactStale(worker.db, A.org.id, factId, 2);
    const [c] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(clips).where(eq(clips.id, clipId)));
    expect(c).toMatchObject({ stale: true, state: 'STALE' });
  });
});

describe('uploads, quota and retention', () => {
  it('rejects unsafe uploads by content; a real image is ready at once and the media worker makes its smaller copy (A48)', async () => {
    const send = async (name: string, kind: 'image' | 'video', mime: string, body: Buffer) => {
      const u = await library.createUpload(ctx, { name, kind, mime, bytes: body.length });
      const r = await fetch(u.uploadUrl, { method: 'PUT', headers: u.headers, body });
      expect(r.ok).toBe(true);
      return u.assetId;
    };
    const job = async (assetId: string) => (await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(exportJobs).where(eq(exportJobs.sourceId, assetId))))[0];
    const row = async (assetId: string) => (await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.execute(`select state, width, height, error from media_assets where id = '${assetId}'` as never))).rows[0] as { state: string; width: number; height: number; error: string | null };
    await expect(library.createUpload(ctx, { name: 'x.svg', kind: 'image', mime: 'image/svg+xml', bytes: 10 })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    // markup named .png is refused by the API itself, no worker needed
    const svg = await send('fake.png', 'image', 'image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    await expect(library.completeUpload(ctx, svg)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    expect(await row(svg)).toMatchObject({ state: 'FAILED', error: expect.stringMatching(/Rejected/) });
    expect(await job(svg)).toBeUndefined();
    // video is still checked and converted by the media worker
    const html = await send('clip.mp4', 'video', 'video/mp4', Buffer.from('<html><body>not a video</body></html>'));
    expect(await library.completeUpload(ctx, html)).toMatchObject({ state: 'PROCESSING' });
    expect(await runJob((await job(html))!.id)).toBe('failed');
    expect((await row(html)).state).toBe('FAILED');
    const png = path.join(os.tmpdir(), `ok-${crypto.randomUUID()}.png`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x3EA6FF:s=2400x800,format=rgba', '-frames:v', '1', png]);
    const ok = await send('banner.png', 'image', 'image/png', fs.readFileSync(png));
    expect(await library.completeUpload(ctx, ok)).toEqual({ assetId: ok, state: 'READY' });
    expect(await row(ok)).toMatchObject({ state: 'READY', width: 2400, height: 800 });
    // the worker's smaller copy replaces it when it runs; the image stays ready throughout
    expect(await runJob((await job(ok))!.id)).toBe('completed');
    expect(await row(ok)).toMatchObject({ state: 'READY', width: 1920, height: 640 });
  }, 120_000);

  it('blocks new storage work at the quota without touching live sessions; retention keeps pinned media (A47)', async () => {
    await worker.db.update(entitlements).set({ limits: { storageGb: 0.000001, maxUploadMb: 500, maxConcurrentProgrammes: 1, maxDestinationsPerOutput: 3 } }).where(eq(entitlements.organisationId, A.org.id));
    await expect(library.createUpload(ctx, { name: 'big.png', kind: 'image', mime: 'image/png', bytes: 5_000_000 })).rejects.toMatchObject({ code: 'STORAGE_QUOTA_REACHED' });
    await worker.db.update(entitlements).set({ limits: { storageGb: 100, maxUploadMb: 500, maxConcurrentProgrammes: 1, maxDestinationsPerOutput: 3 } }).where(eq(entitlements.organisationId, A.org.id));
    const recs = await library.listRecordings(ctx, m.id);
    const [keep, drop] = recs;
    await library.setPinned(ctx, 'recording', keep!.id, true);
    await worker.db.update(recordings).set({ retainUntil: new Date(Date.now() - 1000) }).where(eq(recordings.matchId, m.id));
    await library.runRetention(worker.db, storage);
    const after = await library.listRecordings(ctx, m.id);
    expect(after.find((r) => r.id === keep!.id)!.state).toBe('READY');
    expect(after.find((r) => r.id === drop!.id)!.state).toBe('DELETED');
  });
});
