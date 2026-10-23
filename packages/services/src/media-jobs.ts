// Media worker job processing (FFmpeg). Each job runs in its own temp dir with its own child process; cancel
// kills only that child. Outputs are written to attempt-specific keys and published once by compare-and-set.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { assetDerivatives, clips, creatives, exportJobs, highlightRequests, matchVideos, mediaAssets, recordingParts, recordings, recordingSegments, withTenant, type Db, type Tx } from '@bs/db';
import { ASPECTS, cropFor, type Aspect } from '@bs/domain';
import { keys, type Storage } from './storage';
import { enqueueOutbox } from './outbox';
import { recordUsage } from './usage';
import { probeMatchVideo, renderHighlights } from './highlights-render';

export interface MediaJobDeps {
  db: Db; // worker role
  storage: Storage;
  workerId?: string;
  ffmpeg?: string;
  ffprobe?: string;
  /** test hook: delay inside each ffmpeg run */
  slowMs?: number;
}

export class JobCancelled extends Error {}

export interface ProbeResult {
  format: string;
  durationMs: number | null;
  video?: { codec: string; width: number; height: number; fps: number; pixFmt?: string } | null;
  audio?: { codec: string; sampleRate: number; channels: number } | null;
}

function run(bin: string, args: string[], opts: { onSpawn?: (pid: number) => void; isCancelled?: () => Promise<boolean>; timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (p.pid) opts.onSpawn?.(p.pid);
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-20_000)));
    let cancelled = false;
    const poll = opts.isCancelled
      ? setInterval(async () => {
          if (await opts.isCancelled!().catch(() => false)) {
            cancelled = true;
            p.kill('SIGKILL'); // only this job's own child process
          }
        }, 500)
      : null;
    const to = setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs ?? 30 * 60_000);
    p.on('close', (code) => {
      if (poll) clearInterval(poll);
      clearTimeout(to);
      if (cancelled) return reject(new JobCancelled('cancelled'));
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${stderr.split('\n').filter(Boolean).slice(-3).join(' | ')}`));
    });
    p.on('error', reject);
  });
}

export async function probe(file: string, ffprobe = 'ffprobe'): Promise<ProbeResult> {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
  const j = JSON.parse(stdout) as { format: { format_name: string; duration?: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; pix_fmt?: string; sample_rate?: string; channels?: number }[] };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const fps = v?.r_frame_rate ? (([n, d]) => (Number(d) ? Number(n) / Number(d) : 0))(v.r_frame_rate.split('/')) : 0;
  return {
    format: j.format.format_name,
    durationMs: j.format.duration ? Math.round(Number(j.format.duration) * 1000) : null,
    video: v ? { codec: v.codec_name, width: v.width!, height: v.height!, fps: Math.round(fps * 100) / 100, pixFmt: v.pix_fmt } : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels ?? 0 } : null,
  };
}

/** Content sniffing: the declared MIME is never trusted. SVG/HTML/scripts are rejected outright. */
export function sniff(buf: Buffer): 'png' | 'jpeg' | 'webp' | 'mp4' | 'webm' | 'mp3' | 'wav' | 'unknown' {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WAVE') return 'wav';
  if (buf.subarray(4, 8).toString() === 'ftyp') return 'mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.subarray(0, 3).toString() === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return 'mp3';
  return 'unknown';
}

const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart'];

async function claim(d: MediaJobDeps, jobId: string) {
  const [j] = await d.db
    .update(exportJobs)
    .set({ state: 'RUNNING', attempts: sqlInc(), startedAt: new Date(), updatedAt: new Date(), workerPid: process.pid })
    .where(and(eq(exportJobs.id, jobId), eq(exportJobs.state, 'QUEUED'), eq(exportJobs.cancelRequested, false)))
    .returning();
  return j ?? null;
}
const sqlInc = () => sql`${exportJobs.attempts} + 1`;

/** Entry point for a media-queue job. Idempotent: only a QUEUED job is claimed. */
export async function processJob(d: MediaJobDeps, jobId: string) {
  const job = await claim(d, jobId);
  if (!job) return 'skipped';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `bs-job-${job.id.slice(0, 8)}-`));
  const isCancelled = async () => (await d.db.select({ c: exportJobs.cancelRequested }).from(exportJobs).where(eq(exportJobs.id, job.id)))[0]?.c ?? false;
  // a whole match is read for its preview, and a package seeks through it: those get two hours
  const timeoutMs = job.kind === 'match_video_probe' || job.kind === 'highlights' ? 120 * 60_000 : undefined;
  const ff = (args: string[]) => run(d.ffmpeg ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { isCancelled, timeoutMs, onSpawn: (pid) => void d.db.update(exportJobs).set({ workerPid: pid }).where(eq(exportJobs.id, job.id)) });
  const progress = (p: number) => d.db.update(exportJobs).set({ progress: p, updatedAt: new Date() }).where(eq(exportJobs.id, job.id));
  try {
    if (d.slowMs) await ff(['-f', 'lavfi', '-i', `anullsrc=d=${d.slowMs / 1000}`, '-f', 'null', '-']);
    let result: { key: string; bytes: number; probe: ProbeResult } | null = null;
    if (job.kind === 'asset_normalise') await normaliseAsset(d, job, tmp, ff);
    else if (job.kind === 'clip_extract') result = await extractClip(d, job, tmp, ff, progress);
    else if (job.kind === 'clip_export') result = await exportClipFile(d, job, tmp, ff, progress);
    else if (job.kind === 'compilation') result = await compile(d, job, tmp, ff, progress);
    else if (job.kind === 'match_video_probe') await probeMatchVideo(d, job, tmp, ff, (f) => probe(f, d.ffprobe), progress);
    else if (job.kind === 'highlights') {
      result = await publishExport(d, job, await renderHighlights(d, job, tmp, ff, (f) => probe(f, d.ffprobe), progress));
      // the graphics were only needed to make the file
      const overlayKey = (job.params as { overlayKey?: string }).overlayKey;
      if (overlayKey) await d.storage.delete(overlayKey).catch(() => undefined);
    } else throw new Error(`unknown job kind ${job.kind}`);
    // publish exactly once for this attempt
    const [done] = await d.db
      .update(exportJobs)
      .set({ state: 'COMPLETED', progress: 1, finishedAt: new Date(), outputKey: result?.key ?? null, outputBytes: result?.bytes ?? null, outputProbe: (result?.probe as never) ?? null, expiresAt: result && job.kind !== 'clip_extract' ? new Date(Date.now() + 30 * 86400_000) : null, updatedAt: new Date() })
      .where(and(eq(exportJobs.id, job.id), eq(exportJobs.state, 'RUNNING'), eq(exportJobs.attempts, job.attempts)))
      .returning();
    if (!done && result) await d.storage.delete(result.key).catch(() => undefined); // superseded attempt
    await notify(d, job, 'COMPLETED');
    return 'completed';
  } catch (e) {
    const cancelled = e instanceof JobCancelled;
    await d.db.update(exportJobs).set({ state: cancelled ? 'CANCELLED' : 'FAILED', error: cancelled ? null : (e as Error).message.slice(0, 1000), finishedAt: new Date(), updatedAt: new Date() }).where(and(eq(exportJobs.id, job.id), eq(exportJobs.state, 'RUNNING')));
    await onFailure(d, job, cancelled ? 'cancelled' : (e as Error).message);
    await notify(d, job, cancelled ? 'CANCELLED' : 'FAILED');
    return cancelled ? 'cancelled' : 'failed';
  } finally {
    const end = new Date();
    const start = job.startedAt ?? end;
    await recordUsage(d.db, { organisationId: job.organisationId, module: 'media_jobs', sessionRef: job.id, quantity: Math.round((end.getTime() - start.getTime()) / 1000), unit: 'job_seconds', start, end, dedupKey: `job:${job.id}:${job.attempts}`, details: { kind: job.kind } }).catch(() => undefined);
    fs.rmSync(tmp, { recursive: true, force: true }); // own temp dir only
  }
}

async function notify(d: MediaJobDeps, job: typeof exportJobs.$inferSelect, state: string) {
  await withTenant(d.db, { organisationId: job.organisationId }, (t) => enqueueOutbox(t, { organisationId: job.organisationId, topic: 'media.job.updated', aggregateType: 'export_job', aggregateId: job.id, payload: { jobId: job.id, kind: job.kind, sourceId: job.sourceId, state } }));
}

async function onFailure(d: MediaJobDeps, job: typeof exportJobs.$inferSelect, reason: string) {
  await withTenant(d.db, { organisationId: job.organisationId }, async (t) => {
    // an image already in use stays ready when its smaller copy cannot be made
    if (job.kind === 'asset_normalise') await t.update(mediaAssets).set({ state: 'FAILED', error: reason.slice(0, 500), updatedAt: new Date() }).where(and(eq(mediaAssets.id, job.sourceId), eq(mediaAssets.state, 'PROCESSING')));
    if (job.kind === 'match_video_probe') await t.update(matchVideos).set({ state: 'FAILED', error: reason.replace(/^Rejected: /, '').slice(0, 500), updatedAt: new Date() }).where(and(eq(matchVideos.id, job.sourceId), eq(matchVideos.state, 'PROCESSING')));
    if (job.kind === 'clip_extract') {
      await t.update(clips).set({ state: 'FAILED', updatedAt: new Date() }).where(eq(clips.id, job.sourceId));
      await t.update(highlightRequests).set({ state: 'FAILED', reason: reason.slice(0, 300), updatedAt: new Date() }).where(eq(highlightRequests.clipId, job.sourceId));
    }
  });
}

type FF = (args: string[]) => Promise<unknown>;

// ------------------------------------------------------------------ assets

async function normaliseAsset(d: MediaJobDeps, job: typeof exportJobs.$inferSelect, tmp: string, ff: FF) {
  const [a] = await d.db.select().from(mediaAssets).where(eq(mediaAssets.id, job.sourceId));
  if (!a) throw new Error('asset missing');
  const src = path.join(tmp, 'original');
  await d.storage.download(a.originalKey, src);
  const head = fs.readFileSync(src).subarray(0, 64);
  const kind = sniff(head);
  const text = head.toString('utf8').trimStart().toLowerCase();
  if (text.startsWith('<') || text.includes('<svg') || text.includes('<script')) throw new Error('Rejected: markup/script content is not an accepted media file');
  if (a.kind === 'font') {
    // Fonts are served as uploaded (no transcoding); only the container is checked.
    const tag = head.subarray(0, 4).toString('latin1');
    const fontMime = tag === 'wOF2' ? 'font/woff2' : tag === 'wOFF' ? 'font/woff' : tag === 'OTTO' ? 'font/otf' : tag === 'true' || head.readUInt32BE(0) === 0x00010000 ? 'font/ttf' : null;
    if (!fontMime) throw new Error('Rejected: file content is not a WOFF2, WOFF, TTF or OTF font');
    const ext = fontMime.split('/')[1]!;
    const key = keys.assetDerivative(a.organisationId, a.id, 'broadcast', ext);
    const bytes = await d.storage.putFile(key, src, fontMime);
    await withTenant(d.db, { organisationId: a.organisationId }, async (t) => {
      await t.delete(assetDerivatives).where(eq(assetDerivatives.assetId, a.id));
      await t.insert(assetDerivatives).values({ organisationId: a.organisationId, assetId: a.id, purpose: 'broadcast', objectKey: key, mime: fontMime, bytes, width: null, height: null, durationMs: null, checksum: crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex') });
      await t.update(mediaAssets).set({ state: 'READY', detectedMime: fontMime, width: null, height: null, durationMs: null, error: null, updatedAt: new Date() }).where(eq(mediaAssets.id, a.id));
    });
    return;
  }
  const imageKinds = ['png', 'jpeg', 'webp'];
  const videoKinds = ['mp4', 'webm'];
  const audioKinds = ['mp3', 'wav', 'mp4'];
  const expect = a.kind === 'image' || a.kind === 'logo' ? imageKinds : a.kind === 'video' ? videoKinds : audioKinds;
  if (!expect.includes(kind)) throw new Error(`Rejected: file content (${kind}) does not match an allowed ${a.kind} format`);
  const p = await probe(src, d.ffprobe);
  const org = a.organisationId;
  const derivs: (typeof assetDerivatives.$inferInsert)[] = [];
  const put = async (file: string, purpose: string, ext: string, mime: string) => {
    const pr = await probe(file, d.ffprobe);
    const key = keys.assetDerivative(org, a.id, purpose, ext);
    const bytes = await d.storage.putFile(key, file, mime);
    derivs.push({ organisationId: org, assetId: a.id, purpose, objectKey: key, mime, bytes, width: pr.video?.width ?? null, height: pr.video?.height ?? null, durationMs: pr.durationMs, checksum: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
    return pr;
  };
  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  let mime = 'image/png';
  if (expect === imageKinds) {
    if (!p.video || p.video.width > 8000 || p.video.height > 8000) throw new Error('Rejected: image dimensions missing or larger than 8000 px');
    const out = path.join(tmp, 'broadcast.png');
    await ff(['-i', src, '-vf', "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease", '-frames:v', '1', out]);
    const pr = await put(out, 'broadcast', 'png', 'image/png');
    width = pr.video?.width ?? null;
    height = pr.video?.height ?? null;
    const th = path.join(tmp, 'thumb.png');
    await ff(['-i', out, '-vf', 'scale=320:-2', '-frames:v', '1', th]);
    await put(th, 'thumbnail', 'png', 'image/png');
  } else if (expect === videoKinds) {
    if (!p.video) throw new Error('Rejected: no video stream');
    if ((p.durationMs ?? 0) > 15 * 60_000) throw new Error('Rejected: videos longer than 15 minutes are not accepted');
    const out = path.join(tmp, 'broadcast.mp4');
    const audio = p.audio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest'];
    await ff(['-i', src, ...audio, '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2", ...ENCODE, out]);
    const pr = await put(out, 'broadcast', 'mp4', 'video/mp4');
    width = pr.video?.width ?? null;
    height = pr.video?.height ?? null;
    durationMs = pr.durationMs;
    mime = 'video/mp4';
    const th = path.join(tmp, 'thumb.jpg');
    await ff(['-ss', '1', '-i', out, '-vf', 'scale=320:-2', '-frames:v', '1', th]);
    await put(th, 'thumbnail', 'jpg', 'image/jpeg');
  } else {
    if (!p.audio) throw new Error('Rejected: no audio stream');
    const out = path.join(tmp, 'broadcast.m4a');
    await ff(['-i', src, '-vn', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', out]);
    const pr = await put(out, 'broadcast', 'm4a', 'audio/mp4');
    durationMs = pr.durationMs;
    mime = 'audio/mp4';
  }
  await withTenant(d.db, { organisationId: org }, async (t) => {
    // an archived asset stays archived; its new copies are not attached
    const [cur] = await t.select({ state: mediaAssets.state }).from(mediaAssets).where(eq(mediaAssets.id, a.id));
    if (cur?.state === 'ARCHIVED') return;
    await t.delete(assetDerivatives).where(eq(assetDerivatives.assetId, a.id));
    await t.insert(assetDerivatives).values(derivs);
    await t.update(mediaAssets).set({ state: 'READY', detectedMime: mime, width, height, durationMs, error: null, updatedAt: new Date() }).where(eq(mediaAssets.id, a.id));
  });
}

// ------------------------------------------------------------------ clips

async function segmentInput(d: MediaJobDeps, t: Tx, partId: string, fromSeq: number, toSeq: number, tmp: string) {
  const segs = await t.select().from(recordingSegments).where(and(eq(recordingSegments.partId, partId), inArray(recordingSegments.seq, range(fromSeq, toSeq)))).orderBy(asc(recordingSegments.seq));
  if (segs.length !== toSeq - fromSeq + 1) throw new Error('Gap: a needed segment is missing from the index');
  const files: string[] = [];
  for (const s of segs) {
    const f = path.join(tmp, `s${s.seq}.ts`);
    await d.storage.download(s.objectKey, f).catch(() => {
      throw new Error(`Gap: segment ${s.seq} is missing from storage`);
    });
    files.push(f);
  }
  const list = path.join(tmp, 'segments.txt');
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
  return list;
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

async function finishClipFile(d: MediaJobDeps, t: Tx, clip: typeof clips.$inferSelect, out: string, tmp: string, ff: FF) {
  const p = await probe(out, d.ffprobe);
  if (!p.video || !p.audio || (p.durationMs ?? 0) < 500) throw new Error('Produced clip failed validation (missing stream or too short)');
  const key = keys.clip(clip.organisationId, clip.id);
  const bytes = await d.storage.putFile(key, out, 'video/mp4');
  const th = path.join(tmp, 'thumb.jpg');
  const marker = (clip.markers as { atMs?: number }[])[0]?.atMs ?? Math.min(1000, (p.durationMs ?? 1000) / 2);
  await ff(['-ss', String(Math.max(0, marker / 1000)), '-i', out, '-vf', 'scale=480:-2', '-frames:v', '1', th]);
  const tkey = keys.clipThumb(clip.organisationId, clip.id);
  await d.storage.putFile(tkey, th, 'image/jpeg');
  await t.update(clips).set({ objectKey: key, thumbnailKey: tkey, probe: p as never, bytes, state: clip.stale ? 'STALE' : 'READY', updatedAt: new Date() }).where(eq(clips.id, clip.id));
  await t.update(highlightRequests).set({ state: 'READY', updatedAt: new Date() }).where(and(eq(highlightRequests.clipId, clip.id), eq(highlightRequests.state, 'PROCESSING')));
  return { key, bytes, probe: p };
}

async function extractClip(d: MediaJobDeps, job: typeof exportJobs.$inferSelect, tmp: string, ff: FF, progress: (p: number) => Promise<unknown>) {
  return withTenant(d.db, { organisationId: job.organisationId }, async (t) => {
    const [clip] = await t.select().from(clips).where(eq(clips.id, job.sourceId));
    if (!clip) throw new Error('clip missing');
    const prm = job.params as { partId?: string; fromSeq?: number; toSeq?: number; startOffsetMs?: number; durationMs?: number; fromRecordingMp4?: boolean };
    const out = path.join(tmp, 'clip.mp4');
    if (prm.fromRecordingMp4) {
      const [r] = await t.select().from(recordings).where(eq(recordings.id, clip.recordingId!));
      const src = path.join(tmp, 'rec.mp4');
      await d.storage.download(r!.mp4Key!, src);
      await progress(0.3);
      await ff(['-ss', (clip.inMs / 1000).toFixed(3), '-i', src, '-t', ((clip.outMs - clip.inMs) / 1000).toFixed(3), ...ENCODE, out]);
    } else {
      const list = await segmentInput(d, t, prm.partId!, prm.fromSeq!, prm.toSeq!, tmp);
      await progress(0.3);
      // frame-accurate re-encode from the contiguous segment run (no splicing across gaps)
      await ff(['-f', 'concat', '-safe', '0', '-i', list, '-ss', (prm.startOffsetMs! / 1000).toFixed(3), '-t', (prm.durationMs! / 1000).toFixed(3), ...ENCODE, out]);
    }
    await progress(0.8);
    return finishClipFile(d, t, clip, out, tmp, ff);
  });
}

async function creativeStill(d: MediaJobDeps, t: Tx, creativeId: string, tmp: string, name: string) {
  const [c] = await t.select({ c: creatives, a: mediaAssets }).from(creatives).innerJoin(mediaAssets, eq(mediaAssets.id, creatives.assetId)).where(eq(creatives.id, creativeId));
  if (!c || c.c.approvalStatus !== 'approved') throw new Error('Intro/outro creative is no longer approved');
  const [der] = await t.select().from(assetDerivatives).where(and(eq(assetDerivatives.assetId, c.a.id), eq(assetDerivatives.purpose, 'broadcast')));
  const f = path.join(tmp, `${name}${path.extname(der!.objectKey)}`);
  await d.storage.download(der!.objectKey, f);
  return { file: f, video: der!.mime.startsWith('video/') };
}

/** Normalise one clip into the target aspect (crop + scale), optionally with intro/outro bumpers. */
async function renderVariant(d: MediaJobDeps, t: Tx, src: string, out: string, opts: { aspect: Aspect; focusX: number; trimInMs: number; trimOutMs: number; intro?: string | null; outro?: string | null }, tmp: string, ff: FF) {
  const p = await probe(src, d.ffprobe);
  const { w, h } = ASPECTS[opts.aspect];
  const c = cropFor(p.video!.width, p.video!.height, opts.aspect, opts.focusX);
  const main = path.join(tmp, `main-${crypto.randomUUID().slice(0, 6)}.mp4`);
  await ff(['-ss', (opts.trimInMs / 1000).toFixed(3), '-i', src, '-t', ((opts.trimOutMs - opts.trimInMs) / 1000).toFixed(3), '-vf', `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${w}:${h},setsar=1`, ...ENCODE, main]);
  const pieces: string[] = [];
  const bumper = async (id: string, name: string) => {
    const s = await creativeStill(d, t, id, tmp, name);
    const f = path.join(tmp, `${name}.mp4`);
    if (s.video) await ff(['-i', s.file, '-t', '6', '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`, ...ENCODE, f]);
    else await ff(['-loop', '1', '-i', s.file, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '3', '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`, ...ENCODE, '-shortest', f]);
    return f;
  };
  if (opts.intro) pieces.push(await bumper(opts.intro, 'intro'));
  pieces.push(main);
  if (opts.outro) pieces.push(await bumper(opts.outro, 'outro'));
  if (pieces.length === 1) {
    fs.renameSync(main, out);
    return;
  }
  const inputs = pieces.flatMap((x) => ['-i', x]);
  const filter = pieces.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${pieces.length}:v=1:a=1[v][a]`;
  await ff([...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '[a]', ...ENCODE, out]);
}

async function exportClipFile(d: MediaJobDeps, job: typeof exportJobs.$inferSelect, tmp: string, ff: FF, progress: (p: number) => Promise<unknown>) {
  return withTenant(d.db, { organisationId: job.organisationId }, async (t) => {
    const [clip] = await t.select().from(clips).where(eq(clips.id, job.sourceId));
    if (!clip?.objectKey) throw new Error('clip media missing');
    const prm = job.params as { aspect: Aspect; focusX: number; trimInMs: number; trimOutMs: number; introCreativeId?: string | null; outroCreativeId?: string | null };
    const src = path.join(tmp, 'src.mp4');
    await d.storage.download(clip.objectKey, src);
    await progress(0.2);
    const out = path.join(tmp, 'export.mp4');
    await renderVariant(d, t, src, out, { aspect: prm.aspect, focusX: prm.focusX, trimInMs: prm.trimInMs, trimOutMs: prm.trimOutMs, intro: prm.introCreativeId, outro: prm.outroCreativeId }, tmp, ff);
    await progress(0.9);
    return publishExport(d, job, out);
  });
}

async function compile(d: MediaJobDeps, job: typeof exportJobs.$inferSelect, tmp: string, ff: FF, progress: (p: number) => Promise<unknown>) {
  return withTenant(d.db, { organisationId: job.organisationId }, async (t) => {
    const prm = job.params as { clipIds: string[]; aspect: Aspect };
    const cs = await t.select().from(clips).where(inArray(clips.id, prm.clipIds));
    const ordered = prm.clipIds.map((id) => cs.find((c) => c.id === id)).filter((c): c is typeof clips.$inferSelect => !!c?.objectKey);
    if (ordered.length !== prm.clipIds.length) throw new Error('A clip in the compilation is missing its media');
    const parts: string[] = [];
    for (const [i, c] of ordered.entries()) {
      const src = path.join(tmp, `c${i}.mp4`);
      await d.storage.download(c.objectKey!, src);
      const out = path.join(tmp, `n${i}.mp4`);
      await renderVariant(d, t, src, out, { aspect: prm.aspect, focusX: 0.5, trimInMs: 0, trimOutMs: c.outMs - c.inMs }, tmp, ff);
      parts.push(out);
      await progress(((i + 1) / ordered.length) * 0.8);
    }
    const list = path.join(tmp, 'parts.txt');
    fs.writeFileSync(list, parts.map((f) => `file '${f}'`).join('\n'));
    const out = path.join(tmp, 'compilation.mp4');
    await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
    return publishExport(d, job, out);
  });
}

async function publishExport(d: MediaJobDeps, job: typeof exportJobs.$inferSelect, out: string) {
  const p = await probe(out, d.ffprobe);
  if (!p.video || !p.audio) throw new Error('Export failed validation: missing audio or video');
  // attempt-specific key: a cancelled/retried attempt can never overwrite or duplicate a completed object
  const key = keys.export(job.organisationId, `${job.id}-a${job.attempts}`);
  const bytes = await d.storage.putFile(key, out, 'video/mp4');
  return { key, bytes, probe: p };
}

/** Record recording file sizes/durations after finalisation (used by quotas and the library). */
export async function finaliseRecordingSizes(d: MediaJobDeps) {
  const rs = await d.db.select().from(recordings).where(and(inArray(recordings.state, ['READY', 'PARTIAL']), eq(recordings.bytes, 0)));
  for (const r of rs) {
    const parts = await d.db.select().from(recordingParts).where(eq(recordingParts.recordingId, r.id));
    let bytes = 0;
    for (const p of parts) if (p.mp4Key) bytes += (await d.storage.head(p.mp4Key))?.contentLength ?? 0;
    if (bytes) await d.db.update(recordings).set({ bytes, retainUntil: r.retainUntil ?? new Date(Date.now() + 90 * 86400_000), updatedAt: new Date() }).where(eq(recordings.id, r.id));
  }
}
