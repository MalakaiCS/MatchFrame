// The highlights generator against real PostgreSQL, MinIO and FFmpeg: a match video uploaded in parts, read by the
// media worker (length, preview), synced to the kick-off, a package checked against the plan the graphics were drawn
// for, the graphics received, and the file made: the clip, the slowed replay, the end board and the graphics on top.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, exportJobs, withTenant } from '@bs/db';
import { getAdapter, planHighlights, type StoredFact } from '@bs/domain';
import { catalog, createStorage, highlightsSvc, library, matchesSvc, mediaJobs, scoring, type Ctx } from '@bs/services';
import { OVERLAY_MAGIC, PACKAGE } from '../../packages/services/src/highlights-render';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
const worker = createDb(deps.config.DATABASE_WORKER_URL, { max: 4 });
const storage = createStorage(deps.config);
const MiB = 1024 ** 2;
let A: Awaited<ReturnType<typeof makeOrg>>;
let B: Awaited<ReturnType<typeof makeOrg>>;
let ctx: Ctx;
let ctxB: Ctx;
let matchId: string;
let dir: string;
let videoFile: string;
let videoId: string;

async function command(type: string, payload: Record<string, unknown>) {
  const lease = await scoring.scorerLease(ctx, matchId, { action: 'acquire', deviceId: 'dev-hl' });
  const st = await scoring.getMatchState(ctx, matchId);
  return scoring.handleMatchCommand(ctx, matchId, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'dev-hl', type, payload });
}
const png = (colour: string) => {
  const f = path.join(dir, `${colour.replace(/\W/g, '')}.png`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=${PACKAGE.width}x${PACKAGE.height},format=rgba`, '-frames:v', '1', f]);
  return fs.readFileSync(f);
};

beforeAll(async () => {
  await storage.ensureBucket();
  A = await makeOrg(deps, 'Highlights A');
  B = await makeOrg(deps, 'Highlights B');
  ctx = { ...A.ctx, storage };
  ctxB = { ...B.ctx, storage };
  const comp = await catalog.createCompetition(ctx, { name: 'Highlights League', sport: 'football', defaultTimezone: 'Australia/Brisbane' });
  const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
  const h = await catalog.createTeam(ctx, { name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', sport: 'football' });
  const a = await catalog.createTeam(ctx, { name: 'Ridgeback United', shortName: 'Ridge', abbreviation: 'RBU', sport: 'football' });
  matchId = (await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-11-07 15:00', timezone: 'Australia/Brisbane' })).id;
  // the match: kick-off, a home goal half a second later, then full time
  await command('SET_PHASE', { to: 'first_half' });
  await command('ADD_FACT', { type: 'goal', side: 'home', occurredAt: Date.now() + 500, payload: {} });
  for (const to of ['half_time', 'second_half', 'full_time']) await command('SET_PHASE', { to });
  // its "video": 20 s of test picture and a tone, at a rate that makes three 5 MB parts
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-hl-db-'));
  videoFile = path.join(dir, 'match.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=20', '-f', 'lavfi', '-i', 'sine=f=440:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '5M', '-maxrate', '5M', '-bufsize', '1M', '-x264-params', 'nal-hrd=cbr', '-c:a', 'aac', '-shortest', videoFile]);
}, 120_000);
afterAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await worker.pool.end();
  await deps.close();
});

describe('a match video', () => {
  it('goes up in parts in any order, is checked part by part, and is read by the media worker', async () => {
    const bytes = fs.statSync(videoFile).size;
    expect(bytes).toBeGreaterThan(10 * MiB);
    await expect(highlightsSvc.createMatchVideo(ctx, matchId, { name: 'match.avi', mime: 'video/x-msvideo', bytes })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    const v = await highlightsSvc.createMatchVideo(ctx, matchId, { name: 'Match recording.mkv', mime: '', bytes }, { partSize: 5 * MiB });
    // a file without a type from the browser is known by its name
    expect(v).toMatchObject({ state: 'UPLOADING', mime: 'video/x-matroska', parts: 3, missingParts: [1, 2, 3] });
    videoId = v.id;
    const buf = fs.readFileSync(videoFile);
    const part = (n: number) => buf.subarray((n - 1) * 5 * MiB, Math.min(bytes, n * 5 * MiB));
    await expect(highlightsSvc.uploadMatchVideoPart(ctx, videoId, 1, Readable.from(part(1).subarray(10)), part(1).length - 10)).rejects.toMatchObject({ code: 'UPLOAD_SIZE_MISMATCH' });
    await highlightsSvc.uploadMatchVideoPart(ctx, videoId, 2, Readable.from(part(2)), part(2).length);
    await expect(highlightsSvc.completeMatchVideo(ctx, videoId)).rejects.toMatchObject({ code: 'UPLOAD_INCOMPLETE' });
    expect((await highlightsSvc.listMatchVideos(ctx, matchId))[0]!.missingParts).toEqual([1, 3]);
    await highlightsSvc.uploadMatchVideoPart(ctx, videoId, 3, Readable.from(part(3)), part(3).length);
    const r = await highlightsSvc.uploadMatchVideoPart(ctx, videoId, 1, Readable.from(part(1)), part(1).length);
    expect(r).toMatchObject({ received: 3, parts: 3 });
    expect((await highlightsSvc.completeMatchVideo(ctx, videoId)).state).toBe('PROCESSING');
    const [job] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(exportJobs).where(and(eq(exportJobs.sourceId, videoId), eq(exportJobs.kind, 'match_video_probe'))));
    expect(await mediaJobs.processJob({ db: worker.db, storage }, job!.id)).toBe('completed');
    const [ready] = await highlightsSvc.listMatchVideos(ctx, matchId);
    expect(ready).toMatchObject({ state: 'READY', width: 1280, height: 720, fps: 25, previewUrl: `/api/v1/match-videos/${videoId}/preview` });
    expect(ready!.durationMs).toBeGreaterThan(19_500);
    // the whole file arrived as sent
    const back = path.join(dir, 'back.mkv');
    await storage.download(`org/${A.org.id}/match-videos/${videoId}/original`, back);
    expect(crypto.createHash('sha256').update(fs.readFileSync(back)).digest('hex')).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
    const preview = await highlightsSvc.matchVideoMedia(ctx, videoId, 'preview');
    expect((await storage.head(preview.key))?.contentLength).toBeGreaterThan(1000);
  }, 180_000);

  it('another organisation sees none of it', async () => {
    await expect(highlightsSvc.listMatchVideos(ctxB, matchId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(highlightsSvc.setMatchVideoSync(ctxB, videoId, { anchors: { first_half: 0 } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(highlightsSvc.matchVideoMedia(ctxB, videoId, 'preview')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is synced to the kick-off of a period of play', async () => {
    await expect(highlightsSvc.setMatchVideoSync(ctx, videoId, { anchors: { half_time: 1000 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(highlightsSvc.setMatchVideoSync(ctx, videoId, { anchors: { first_half: 60_000 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const v = await highlightsSvc.setMatchVideoSync(ctx, videoId, { anchors: { first_half: 12_000 } });
    expect(v.sync).toEqual({ first_half: 12_000 });
  });
});

describe('a highlights package', () => {
  const options = { targetMs: 4 * 60_000, intro: false, fullTime: false };
  let planKey: string;
  let durationMs: number;
  let stingerAt: number[];

  it('is planned the same way here as in the browser, and refused when the plan changed', async () => {
    const src = await highlightsSvc.highlightsSource(ctx, matchId);
    expect(src.facts.some((f) => f.type === 'goal')).toBe(true);
    const a = getAdapter('football');
    const video = src.videos[0]!;
    const plan = planHighlights({ adapter: a, cfg: src.rulesConfig as never, facts: src.facts as StoredFact[], video: { durationMs: video.durationMs!, anchors: video.sync }, options: highlightsSvc.toPlanOptions(highlightsSvc.highlightOptionsSchema.parse(options)) });
    expect(plan.segments.map((s) => s.kind)).toEqual(['clip', 'replay', 'end_card']);
    planKey = plan.key;
    durationMs = plan.durationMs;
    stingerAt = plan.cues.filter((c) => c.templateKey === 'builtin:replay').map((c) => c.fromMs);
    await expect(highlightsSvc.createHighlights(ctx, matchId, { videoId, planKey: 'other', options })).rejects.toMatchObject({ code: 'PLAN_CHANGED' });
    await expect(highlightsSvc.createHighlights(ctxB, matchId, { videoId, planKey, options })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('takes the graphics once, and the media worker makes the file', async () => {
    const r = await highlightsSvc.createHighlights(ctx, matchId, { videoId, planKey, options, title: 'Harbour v Ridge highlights' });
    expect(r.durationMs).toBe(durationMs);
    const [clear, red, blue] = [png('0x00000000'), png('red'), png('blue')];
    const header = Buffer.from(JSON.stringify({ v: 1, ...PACKAGE, planKey, tracks: { main: { durationMs, frames: [{ atMs: 0, bytes: clear.length }, { atMs: 3000, bytes: red.length }, { atMs: 5000, bytes: clear.length }] }, stinger: { durationMs: 2000, frames: [{ atMs: 0, bytes: blue.length }], at: stingerAt } } }));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(header.length);
    const file = Buffer.concat([Buffer.from(OVERLAY_MAGIC), len, header, clear, red, clear, blue]);
    expect(await highlightsSvc.receiveHighlightGraphics(ctx, r.jobId, Readable.from(file), file.length)).toMatchObject({ state: 'QUEUED' });
    await expect(highlightsSvc.receiveHighlightGraphics(ctx, r.jobId, Readable.from(file), file.length)).rejects.toMatchObject({ code: 'UPLOAD_CLOSED' });
    expect(await mediaJobs.processJob({ db: worker.db, storage }, r.jobId)).toBe('completed');
    const [pkg] = await highlightsSvc.listHighlights(ctx, matchId);
    expect(pkg).toMatchObject({ id: r.jobId, state: 'COMPLETED', title: 'Harbour v Ridge highlights', downloadUrl: `/api/v1/exports/${r.jobId}/download` });
    const media = await library.mediaFor(ctx, 'export', r.jobId);
    const out = path.join(dir, 'out.mp4');
    await storage.download(media.key, out);
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', out]).toString()) as { format: { duration: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number; duration?: string }[] };
    expect(Math.abs(Number(info.format.duration) * 1000 - durationMs)).toBeLessThan(150);
    expect(Math.abs(Number(info.streams.find((s) => s.codec_type === 'video')?.duration) * 1000 - durationMs)).toBeLessThan(150);
    expect(info.streams.find((s) => s.codec_type === 'video')).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080 });
    expect(info.streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe('aac');
    const pixel = (t: number) => [...execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'crop=2:2:100:100,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3)];
    expect(pixel(4)[0]).toBeGreaterThan(200); // the red graphic
    expect(pixel(stingerAt[0]! / 1000 + 0.5)[2]).toBeGreaterThan(200); // the replay transition
    // the graphics were only kept to make the file
    expect(await storage.head(`org/${A.org.id}/exports/${r.jobId}-overlay.bin`)).toBeNull();
  }, 240_000);

  it('a package left waiting for its graphics can be cancelled; the video can be deleted', async () => {
    const r = await highlightsSvc.createHighlights(ctx, matchId, { videoId, planKey, options });
    expect(await library.cancelJob(ctx, r.jobId)).toMatchObject({ cancelRequested: true });
    const [j] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(exportJobs).where(eq(exportJobs.id, r.jobId)));
    expect(j!.state).toBe('CANCELLED');
    expect(await highlightsSvc.deleteMatchVideo(ctx, videoId)).toEqual({ deleted: true });
    expect(await highlightsSvc.listMatchVideos(ctx, matchId)).toEqual([]);
    expect(await storage.head(`org/${A.org.id}/match-videos/${videoId}/original`)).toBeNull();
  });
});
