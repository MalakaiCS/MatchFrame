// The media worker's part of match highlights: read a match video (its length and a small preview for the browser),
// and make a package: the clips cut from the video, the replays slowed down, joined with cross-fades (a cut under
// the replay transition), and the graphics the browser drew laid on top.
//
// The graphics arrive as one file: "MFOV", a 4-byte header length, a JSON header, then the frames (PNG with alpha)
// one after another. Each track lists its frames by the time they appear (a frame stays up until the next one), so
// only the frames where something changes are drawn and sent. "main" runs the length of the package; "stinger" is
// the replay transition, drawn once and laid over the picture at each of its times.
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { exportJobs, matchVideos, withTenant } from '@bs/db';
import type { HighlightOptions, HighlightPlan } from '@bs/domain';
import type { MediaJobDeps, ProbeResult } from './media-jobs';
import { planFor } from './highlights';
import { keys } from './storage';

export const OVERLAY_MAGIC = 'MFOV';
export const PACKAGE = { width: 1920, height: 1080, fps: 25 };

export interface OverlayTrack {
  durationMs: number;
  frames: { atMs: number; bytes: number }[];
  /** stinger: the package times it starts at */
  at?: number[];
}
export interface OverlayHeader {
  v: 1;
  width: number;
  height: number;
  fps: number;
  planKey: string;
  tracks: { main: OverlayTrack; stinger?: OverlayTrack };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The header and frames of a graphics file, checked: every frame a PNG, in time order, the sizes adding up. */
export function parseOverlay(buf: Buffer): { header: OverlayHeader; main: Buffer[]; stinger: Buffer[] } {
  if (buf.length < 8 || buf.subarray(0, 4).toString('latin1') !== OVERLAY_MAGIC) throw new Error('The graphics file is not one the browser made');
  const len = buf.readUInt32BE(4);
  if (len <= 0 || 8 + len > buf.length) throw new Error('The graphics file is cut short');
  let header: OverlayHeader;
  try {
    header = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')) as OverlayHeader;
  } catch {
    throw new Error('The graphics file header cannot be read');
  }
  if (header.v !== 1 || header.width !== PACKAGE.width || header.height !== PACKAGE.height || header.fps !== PACKAGE.fps || !header.tracks?.main) throw new Error('The graphics were drawn for another size or frame rate');
  let at = 8 + len;
  const take = (t: OverlayTrack | undefined): Buffer[] => {
    if (!t) return [];
    if (!Array.isArray(t.frames) || !t.frames.length || t.frames.length > 20_000) throw new Error('A graphics track has no frames, or too many');
    let last = -1;
    return t.frames.map((f) => {
      if (!(f.atMs >= 0) || f.atMs <= last || f.atMs > t.durationMs || !(f.bytes > 0)) throw new Error('The graphics frames are out of order');
      last = f.atMs;
      const b = buf.subarray(at, at + f.bytes);
      if (b.length !== f.bytes || !b.subarray(0, 8).equals(PNG_SIG)) throw new Error('A graphics frame is not a PNG');
      at += f.bytes;
      return b;
    });
  };
  const main = take(header.tracks.main);
  const stinger = take(header.tracks.stinger);
  if (at !== buf.length) throw new Error('The graphics file has bytes left over');
  return { header, main, stinger };
}

/** A track's frames as files and an FFmpeg concat list holding each until the next. */
export function writeTrack(dir: string, name: string, track: OverlayTrack, frames: Buffer[]): string {
  const lines = ['ffconcat version 1.0'];
  frames.forEach((b, i) => {
    const file = path.join(dir, `${name}-${String(i).padStart(5, '0')}.png`);
    fs.writeFileSync(file, b);
    const until = i + 1 < track.frames.length ? track.frames[i + 1]!.atMs : track.durationMs;
    lines.push(`file '${file}'`, `duration ${((until - track.frames[i]!.atMs) / 1000).toFixed(3)}`);
  });
  // the last file again, so its duration is kept
  lines.push(`file '${path.join(dir, `${name}-${String(frames.length - 1).padStart(5, '0')}.png`)}'`);
  const list = path.join(dir, `${name}.txt`);
  fs.writeFileSync(list, lines.join('\n') + '\n');
  return list;
}

const sec = (ms: number) => (ms / 1000).toFixed(3);

/**
 * A clip read over the network waits, connected, while the clips before it are made; the storage closes a
 * connection left idle, and without these FFmpeg takes the cut-off read as the end of the clip (its picture stops).
 */
const RECONNECT = ['-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '30'];
/**
 * Seconds of picture past each part's end. A join starts on the first frame at or after its time, so the part
 * before it can run out of frames inside the join, and xfade then ends the whole picture there; the join drops
 * what is left over, and the last part's spare is cut by the package's length.
 */
const SPARE = 0.2;

/**
 * FFmpeg arguments for a package: one input per clip (seeking into the source), black and silence for the end
 * board, the graphics tracks, then scale, slow down, join and lay the graphics over.
 */
export function composeArgs(plan: Pick<HighlightPlan, 'segments' | 'durationMs'>, o: { src: string; hasAudio: boolean; main: string; stinger?: { list: string; at: number[] } | null; out: string }): string[] {
  const { width: W, height: H, fps } = PACKAGE;
  const args: string[] = [];
  const filters: string[] = [];
  let input = 0;
  const vs: string[] = [];
  const as: string[] = [];
  const remote = /^https?:/.test(o.src);
  for (const [i, s] of plan.segments.entries()) {
    const len = (s.outToMs - s.outFromMs) / 1000;
    if (s.kind === 'end_card') {
      args.push('-f', 'lavfi', '-t', (len + SPARE).toFixed(3), '-i', `color=c=black:s=${W}x${H}:r=${fps}`);
      filters.push(`[${input}:v]format=yuv420p,setsar=1,settb=AVTB[v${i}]`);
      input++;
      args.push('-f', 'lavfi', '-t', len.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
      filters.push(`[${input}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
      input++;
    } else {
      args.push(...(remote ? RECONNECT : []), '-ss', sec(s.videoFromMs), '-t', sec(s.videoToMs - s.videoFromMs), '-i', o.src);
      const v = input++;
      filters.push(`[${v}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,setpts=(PTS-STARTPTS)/${s.speed},fps=${fps},tpad=stop_mode=clone:stop_duration=${SPARE},trim=duration=${(len + SPARE).toFixed(3)},format=yuv420p,settb=AVTB[v${i}]`);
      if (o.hasAudio) filters.push(`[${v}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS${s.speed !== 1 ? `,atempo=${s.speed}` : ''},apad,atrim=duration=${len.toFixed(3)}[a${i}]`);
      else {
        args.push('-f', 'lavfi', '-t', len.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
        filters.push(`[${input}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
        input++;
      }
    }
    vs.push(`v${i}`);
    as.push(`a${i}`);
  }
  // joined one after another: each cross-fades in over its join (a one-frame fade is a cut)
  let v = vs[0]!;
  let a = as[0]!;
  for (let i = 1; i < plan.segments.length; i++) {
    const s = plan.segments[i]!;
    const d = Math.max(s.joinMs, 40) / 1000;
    filters.push(`[${v}][${vs[i]}]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${sec(s.outFromMs)}[vx${i}]`);
    filters.push(`[${a}][${as[i]}]acrossfade=d=${d.toFixed(3)}:c1=tri:c2=tri[ax${i}]`);
    v = `vx${i}`;
    a = `ax${i}`;
  }
  // the graphics over the picture
  args.push('-f', 'concat', '-safe', '0', '-i', o.main);
  filters.push(`[${input}:v]fps=${fps},format=rgba[gm]`, `[${v}][gm]overlay=0:0:eof_action=pass:format=auto[g0]`);
  input++;
  v = 'g0';
  if (o.stinger?.at.length) {
    args.push('-f', 'concat', '-safe', '0', '-i', o.stinger.list);
    const n = o.stinger.at.length;
    filters.push(`[${input}:v]fps=${fps},format=rgba${n > 1 ? `,split=${n}${o.stinger.at.map((_, k) => `[st${k}]`).join('')}` : '[st0]'}`);
    o.stinger.at.forEach((t, k) => {
      filters.push(`[st${k}]setpts=PTS-STARTPTS+${sec(t)}/TB[sd${k}]`, `[${v}][sd${k}]overlay=0:0:eof_action=pass:format=auto[g${k + 1}]`);
      v = `g${k + 1}`;
    });
    input++;
  }
  filters.push(`[${v}]format=yuv420p[vout]`);
  return [
    ...args,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-map', `[${a}]`,
    '-t', sec(plan.durationMs),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart',
    o.out,
  ];
}

type FF = (args: string[]) => Promise<unknown>;
type Job = typeof exportJobs.$inferSelect;

/** Where FFmpeg reads the video: in place through a short-lived URL, or a downloaded copy when there is none. */
async function sourceOf(d: MediaJobDeps, key: string, tmp: string, probe: (f: string) => Promise<ProbeResult>): Promise<{ src: string; info: ProbeResult }> {
  try {
    const url = await d.storage.presignGet(key, 6 * 3600);
    return { src: url, info: await probe(url) };
  } catch {
    const f = path.join(tmp, 'source');
    await d.storage.download(key, f);
    return { src: f, info: await probe(f) };
  }
}

/** A match video's length, size and frame rate, a small preview (360p) and a thumbnail. */
export async function probeMatchVideo(d: MediaJobDeps, job: Job, tmp: string, ff: FF, probe: (f: string) => Promise<ProbeResult>, progress: (p: number) => Promise<unknown>) {
  const [v] = await d.db.select().from(matchVideos).where(eq(matchVideos.id, job.sourceId));
  if (!v) throw new Error('match video missing');
  const { src, info } = await sourceOf(d, v.objectKey, tmp, probe);
  if (!info.video) throw new Error('Rejected: the file has no video');
  if (!info.durationMs || info.durationMs < 10_000) throw new Error('Rejected: the video is shorter than 10 seconds or its length cannot be read');
  await progress(0.1);
  const preview = path.join(tmp, 'preview.mp4');
  const audio = info.audio ? ['-c:a', 'aac', '-b:a', '64k', '-ac', '2', '-ar', '44100'] : ['-an'];
  await ff([...(/^https?:/.test(src) ? RECONNECT : []), '-i', src, '-vf', 'scale=-2:360,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-g', '50', '-r', '25', ...audio, '-movflags', '+faststart', preview]);
  await progress(0.85);
  const thumb = path.join(tmp, 'thumb.jpg');
  await ff(['-ss', sec(Math.min(info.durationMs / 10, 600_000)), '-i', preview, '-frames:v', '1', '-vf', 'scale=480:-2', thumb]);
  const pk = keys.matchVideoProxy(v.organisationId, v.id);
  const tk = keys.matchVideoThumb(v.organisationId, v.id);
  await d.storage.putFile(pk, preview, 'video/mp4');
  await d.storage.putFile(tk, thumb, 'image/jpeg');
  await withTenant(d.db, { organisationId: v.organisationId }, (t) =>
    t.update(matchVideos).set({ state: 'READY', error: null, durationMs: info.durationMs, width: info.video!.width, height: info.video!.height, fps: info.video!.fps, proxyKey: pk, thumbnailKey: tk, updatedAt: new Date() }).where(eq(matchVideos.id, v.id)),
  );
}

/** A package: the plan worked out again (it must be the one the graphics were drawn for), then FFmpeg. */
export async function renderHighlights(d: MediaJobDeps, job: Job, tmp: string, ff: FF, probe: (f: string) => Promise<ProbeResult>, progress: (p: number) => Promise<unknown>): Promise<string> {
  const prm = job.params as { videoId: string; options: HighlightOptions; planKey: string; overlayKey?: string };
  if (!prm.overlayKey) throw new Error('The graphics for this package never arrived');
  const plan = await withTenant(d.db, { organisationId: job.organisationId }, async (t) => {
    const [v] = await t.select().from(matchVideos).where(and(eq(matchVideos.id, prm.videoId), eq(matchVideos.organisationId, job.organisationId)));
    if (!v || v.state !== 'READY') throw new Error('The match video is no longer there');
    return { plan: await planFor(t, job.organisationId, job.sourceId, v, prm.options), key: v.objectKey };
  });
  if (plan.plan.key !== prm.planKey) throw new Error('The match or the video changed after the graphics were drawn: make the package again');
  const ov = path.join(tmp, 'graphics.bin');
  await d.storage.download(prm.overlayKey, ov);
  const g = parseOverlay(fs.readFileSync(ov));
  fs.rmSync(ov, { force: true });
  if (g.header.planKey !== prm.planKey) throw new Error('The graphics were drawn for another package');
  if (Math.abs(g.header.tracks.main.durationMs - plan.plan.durationMs) > 50) throw new Error('The graphics do not run the length of the package');
  const frames = path.join(tmp, 'frames');
  fs.mkdirSync(frames);
  const main = writeTrack(frames, 'main', g.header.tracks.main, g.main);
  const st = g.header.tracks.stinger;
  const stinger = st && g.stinger.length && st.at?.length ? { list: writeTrack(frames, 'stinger', st, g.stinger), at: st.at.filter((t) => t >= 0 && t < plan.plan.durationMs) } : null;
  await progress(0.15);
  const { src, info } = await sourceOf(d, plan.key, tmp, probe);
  await progress(0.2);
  const out = path.join(tmp, 'highlights.mp4');
  await ff(composeArgs(plan.plan, { src, hasAudio: !!info.audio, main, stinger, out }));
  // the picture must run the whole package: a clip cut short by a read that failed is not a package
  const made = await probe(out);
  if ((made.video?.durationMs ?? 0) < plan.plan.durationMs - 500) throw new Error('The match video could not be read to the end of the package: make it again');
  await progress(0.95);
  return out;
}
