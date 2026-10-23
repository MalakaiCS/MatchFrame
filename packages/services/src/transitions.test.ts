import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Ctx } from './context';
import { encodePng } from './png';
import { encodeTransition, transitionFileName } from './transitions';

const hasFfmpeg = (() => {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { stdio: 'pipe' }).toString().includes('libvpx-vp9');
  } catch {
    return false;
  }
})();
const ctx = (role = 'producer') => ({ actor: { kind: 'user', userId: 'u', organisationId: 'o', role, grants: [] } }) as unknown as Ctx;

/** Mean alpha (0..255) of frame `n` of a WebM, decoded with libvpx (the decoder that reads the alpha channel). */
function alphaOf(file: string, n: number): number {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', file, '-vf', `select=eq(n\\,${n}),alphaextract,scale=64:36`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
  return raw.reduce((a, b) => a + b, 0) / raw.length;
}

describe('transition encoding', () => {
  it('names the download safely', () => {
    expect(transitionFileName('Replay — Harbour v Bayside (Premier)')).toBe('replay-harbour-v-bayside-premier.webm');
    expect(transitionFileName('../../etc')).toBe('etc.webm');
    expect(transitionFileName(undefined)).toBe('replay-transition.webm');
    expect(transitionFileName('Match Highlights', 'mov')).toBe('match-highlights.mov');
  });

  it('refuses what it should not encode', async () => {
    const one = Readable.from(Buffer.from('x'));
    await expect(encodeTransition(ctx('viewer'), one, 1, { fps: 30, size: '1920x1080' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(encodeTransition(ctx(), one, 1, { fps: 29, size: '1920x1080' })).rejects.toThrow(/Frame rate/);
    await expect(encodeTransition(ctx(), one, 1, { fps: 30, size: '800x600' as never })).rejects.toThrow();
    await expect(encodeTransition(ctx(), one, 0, { fps: 30, size: '1920x1080' })).rejects.toMatchObject({ code: 'LENGTH_REQUIRED' });
    await expect(encodeTransition(ctx(), one, 1, { fps: 30, size: '1920x1080', format: 'avi' as never })).rejects.toThrow();
  });

  it.skipIf(!hasFfmpeg)('encodes PNG frames to a ProRes 4444 MOV with alpha for editing programs: clear, covered, clear', async () => {
    const frames = Array.from({ length: 15 }, (_, i) => encodePng(1280, 720, () => (i >= 5 && i < 10 ? [233, 0, 82, 255] : [0, 0, 0, 0])));
    const body = Buffer.concat(frames);
    const r = await encodeTransition(ctx(), Readable.from(body), body.length, { fps: 25, size: '1280x720', name: 'Match Highlights title', format: 'mov' });
    expect([r.fileName, r.contentType, r.frames]).toEqual(['match-highlights-title.mov', 'video/quicktime', 15]);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bs-tr-test-')), r.fileName);
    fs.writeFileSync(file, r.file);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString()) as { streams: { codec_name: string; profile: string; pix_fmt: string; width: number; height: number; r_frame_rate: string }[]; format: { format_name: string } };
    expect(probe.format.format_name).toContain('mov');
    expect(probe.streams[0]).toMatchObject({ codec_name: 'prores', profile: '4444', pix_fmt: 'yuva444p12le', width: 1280, height: 720, r_frame_rate: '25/1' });
    const alpha = (n: number) => {
      const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n}),alphaextract,scale=64:36`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
      return raw.reduce((a, b) => a + b, 0) / raw.length;
    };
    expect(alpha(0)).toBeLessThan(2);
    expect(alpha(7)).toBeGreaterThan(253);
    expect(alpha(14)).toBeLessThan(2);
  }, 60_000);

  it.skipIf(!hasFfmpeg)('encodes PNG frames to VP9 WebM with alpha: clear, covered, clear', async () => {
    // 15 frames of 1280x720: transparent, then fully covered in the middle, then transparent again
    const frames = Array.from({ length: 15 }, (_, i) => encodePng(1280, 720, () => (i >= 5 && i < 10 ? [233, 0, 82, 255] : [0, 0, 0, 0])));
    const body = Buffer.concat(frames);
    const r = await encodeTransition(ctx(), Readable.from(body), body.length, { fps: 30, size: '1280x720', name: 'Replay test' });
    expect(r.fileName).toBe('replay-test.webm');
    expect(r.frames).toBe(15);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bs-tr-test-')), r.fileName);
    fs.writeFileSync(file, r.file);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString()) as { streams: { codec_name: string; width: number; height: number; r_frame_rate: string; tags?: Record<string, string> }[]; format: { format_name: string } };
    expect(probe.format.format_name).toContain('webm');
    expect(probe.streams[0]).toMatchObject({ codec_name: 'vp9', width: 1280, height: 720, r_frame_rate: '30/1' });
    expect(Object.entries(probe.streams[0]!.tags ?? {}).find(([k]) => k.toLowerCase() === 'alpha_mode')?.[1]).toBe('1');
    expect(alphaOf(file, 0)).toBeLessThan(2);
    expect(alphaOf(file, 7)).toBeGreaterThan(253);
    expect(alphaOf(file, 14)).toBeLessThan(2);
  }, 60_000);
});
