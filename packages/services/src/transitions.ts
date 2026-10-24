// Transparent WebM for an OBS or vMix stinger: the browser draws a transition frame by frame (PNG with alpha, one
// after another in one body) and FFmpeg encodes them as VP9 with an alpha channel, the format both accept for a
// stinger. Encoding happens while the request waits (a stinger is a second or two); a few at a time per process.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { assertCan } from './authz';
import { AppError, invalid } from './errors';
import type { Ctx } from './context';

export const TRANSITION_FPS = [24, 25, 30, 50, 60] as const;
export const TRANSITION_SIZES = ['1920x1080', '1280x720'] as const;
/** WebM (VP9 with alpha) for OBS and vMix; MOV (ProRes 4444 with alpha) for editing programs */
export const TRANSITION_FORMATS = ['webm', 'mov'] as const;
export type TransitionFormat = (typeof TRANSITION_FORMATS)[number];
const CONTENT_TYPE: Record<TransitionFormat, string> = { webm: 'video/webm', mov: 'video/quicktime' };
/** 15 s at 60 fps: a stinger is about 2 s, a title for an edit up to about 11 */
const MAX_FRAMES = 900;
const MAX_BYTES = 600 * 1024 * 1024;
const MAX_AT_ONCE = 2;
const TIMEOUT_MS = 180_000;
let running = 0;

export const encodeQuery = z.object({
  fps: z.coerce.number().refine((n) => (TRANSITION_FPS as readonly number[]).includes(n), `Frame rate must be one of ${TRANSITION_FPS.join(', ')}`),
  size: z.enum(TRANSITION_SIZES),
  name: z.string().trim().max(120).optional(),
  format: z.enum(TRANSITION_FORMATS).default('webm'),
});

/** A file name for the download: letters, digits and dashes. */
export function transitionFileName(name: string | undefined, format: TransitionFormat = 'webm'): string {
  const base = (name ?? 'replay-transition').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').toLowerCase().slice(0, 80);
  return `${base || 'replay-transition'}.${format}`;
}

/** FFmpeg's encoding arguments for each format, both keeping the alpha channel. */
const ENCODE: Record<TransitionFormat, string[]> = {
  // near-lossless for flat colours, gradients and hard slanted edges (CRF 16, a slower preset); a 2 s stinger is
  // still only a few MB
  webm: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '16', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1'],
  // ProRes 4444 with a 16-bit alpha plane: what Premiere, Final Cut and DaVinci Resolve take with its transparency
  mov: ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0'],
};

/**
 * Encode PNG frames (concatenated, in order) to a video with alpha at `fps`, scaled to the size asked for: a VP9
 * WebM, or a ProRes 4444 MOV. Returns the file's bytes. `ffmpeg` can be pointed elsewhere for tests.
 */
export async function encodeTransition(ctx: Ctx, body: Readable, length: number, input: z.input<typeof encodeQuery>, opts: { ffmpeg?: string } = {}): Promise<{ file: Buffer; fileName: string; contentType: string; frames: number }> {
  assertCan(ctx.actor, 'theme.use');
  const q = encodeQuery.parse(input);
  if (!Number.isInteger(length) || length <= 0) throw new AppError('LENGTH_REQUIRED', 411, 'Send the frames with their size (Content-Length)');
  if (length > MAX_BYTES) throw invalid(`The frames are larger than ${MAX_BYTES / 1024 / 1024} MB`, undefined, 'TOO_LARGE');
  if (running >= MAX_AT_ONCE) throw new AppError('ENCODER_BUSY', 429, 'Another transition is being encoded. Try again in a few seconds.');
  running++;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-transition-'));
  try {
    const [w, h] = q.size.split('x').map(Number) as [number, number];
    const out = path.join(dir, `out.${q.format}`);
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(q.fps), '-c:v', 'png', '-i', 'pipe:0',
      '-frames:v', String(MAX_FRAMES),
      '-vf', `scale=${w}:${h}:flags=lanczos,format=${q.format === 'mov' ? 'yuva444p10le' : 'yuva420p'}`,
      ...ENCODE[q.format],
      '-an', out,
    ];
    await new Promise<void>((resolve, reject) => {
      const p = spawn(opts.ffmpeg ?? 'ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      const timer = setTimeout(() => p.kill('SIGKILL'), TIMEOUT_MS);
      p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
      p.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(e.code === 'ENOENT' ? new AppError('ENCODER_UNAVAILABLE', 503, 'Video encoding is not available on this server (FFmpeg is missing)') : e);
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(invalid(`The frames could not be encoded${err ? `: ${err.trim().split('\n').pop()}` : ''}`, undefined, 'ENCODE_FAILED'));
      });
      p.stdin.on('error', () => undefined); // ffmpeg exiting early surfaces through 'close'
      body.on('error', () => p.kill('SIGKILL'));
      body.pipe(p.stdin);
    });
    const file = await fs.readFile(out);
    const frames = await countFrames(out, opts.ffmpeg);
    return { file, fileName: transitionFileName(q.name, q.format), contentType: CONTENT_TYPE[q.format], frames };
  } finally {
    running--;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Frames in the encoded file (ffprobe beside ffmpeg); null when ffprobe is not there. */
async function countFrames(file: string, ffmpeg?: string): Promise<number> {
  const bin = ffmpeg ? path.join(path.dirname(ffmpeg), 'ffprobe') : 'ffprobe';
  return new Promise((resolve) => {
    const p = spawn(bin, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.on('error', () => resolve(0));
    p.on('close', () => resolve(Number(out.trim()) || 0));
  });
}
