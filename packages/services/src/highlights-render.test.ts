import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HighlightSegment } from '@bs/domain';
import { composeArgs, OVERLAY_MAGIC, PACKAGE, parseOverlay, writeTrack, type OverlayHeader } from './highlights-render';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
let dir = '';
let red: Buffer;
let clear: Buffer;
let blue: Buffer;
const png = (name: string, colour: string) => {
  const f = path.join(dir, `${name}.png`);
  ff(['-f', 'lavfi', '-i', `color=c=${colour}:s=${PACKAGE.width}x${PACKAGE.height},format=rgba`, '-frames:v', '1', f]);
  return fs.readFileSync(f);
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-hl-test-'));
  red = png('red', 'red');
  blue = png('blue', 'blue');
  clear = png('clear', '0x00000000');
  // a "match": 20 s of test picture with a tone
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=20', '-f', 'lavfi', '-i', 'sine=f=440:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path.join(dir, 'match.mp4')]);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A graphics file as the browser sends it. */
function overlayFile(header: Omit<OverlayHeader, 'v' | 'width' | 'height' | 'fps'>, frames: Buffer[]) {
  const h = Buffer.from(JSON.stringify({ v: 1, ...PACKAGE, ...header }));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(h.length);
  return Buffer.concat([Buffer.from(OVERLAY_MAGIC), len, h, ...frames]);
}

describe('the graphics file from the browser', () => {
  it('reads the tracks and frames, and refuses one that is not right', () => {
    const file = overlayFile({ planKey: 'k1', tracks: { main: { durationMs: 4000, frames: [{ atMs: 0, bytes: clear.length }, { atMs: 1000, bytes: red.length }] }, stinger: { durationMs: 2000, frames: [{ atMs: 0, bytes: blue.length }], at: [1500] } } }, [clear, red, blue]);
    const g = parseOverlay(file);
    expect(g.header.planKey).toBe('k1');
    expect(g.main.map((b) => b.length)).toEqual([clear.length, red.length]);
    expect(g.stinger).toHaveLength(1);
    expect(() => parseOverlay(Buffer.from('nope'))).toThrow(/not one the browser made/);
    expect(() => parseOverlay(overlayFile({ planKey: 'k', tracks: { main: { durationMs: 4000, frames: [{ atMs: 1000, bytes: red.length }, { atMs: 500, bytes: red.length }] } } }, [red, red]))).toThrow(/out of order/);
    expect(() => parseOverlay(overlayFile({ planKey: 'k', tracks: { main: { durationMs: 4000, frames: [{ atMs: 0, bytes: 4 }] } } }, [Buffer.from('abcd')]))).toThrow(/not a PNG/);
    expect(() => parseOverlay(Buffer.concat([file, Buffer.from('x')]))).toThrow(/left over/);
    const wrong = Buffer.from(JSON.stringify({ v: 1, width: 1280, height: 720, fps: 25, planKey: 'k', tracks: { main: { durationMs: 1, frames: [] } } }));
    const l = Buffer.alloc(4);
    l.writeUInt32BE(wrong.length);
    expect(() => parseOverlay(Buffer.concat([Buffer.from(OVERLAY_MAGIC), l, wrong]))).toThrow(/another size/);
  });
});

describe('composing a package with FFmpeg', () => {
  it('clips, a slowed replay cut in, the end board, the graphics over them and the transition at its time', () => {
    // a 4 s clip, a cross-fade into a replay of 2 s of match at 0.5 (4 s), a cut, then a 2 s end board
    const seg = (s: Partial<HighlightSegment>) => ({ id: s.kind!, factIds: [], atFrom: 0, clock: null, ...s }) as HighlightSegment;
    const segments = [
      seg({ kind: 'clip', videoFromMs: 5000, videoToMs: 9000, speed: 1, outFromMs: 0, outToMs: 4000, join: 'none', joinMs: 0 }),
      seg({ kind: 'replay', videoFromMs: 6000, videoToMs: 8000, speed: 0.5, outFromMs: 3700, outToMs: 7700, join: 'crossfade', joinMs: 300 }),
      seg({ kind: 'end_card', videoFromMs: 0, videoToMs: 0, speed: 1, outFromMs: 7660, outToMs: 9660, join: 'cut', joinMs: 40 }),
    ];
    const durationMs = 9660;
    const main = writeTrack(dir, 'main', { durationMs, frames: [{ atMs: 0, bytes: 0 }, { atMs: 2000, bytes: 0 }, { atMs: 3000, bytes: 0 }] }, [clear, red, clear]);
    const stinger = writeTrack(dir, 'stinger', { durationMs: 1000, frames: [{ atMs: 0, bytes: 0 }] }, [blue]);
    const out = path.join(dir, 'out.mp4');
    ff(composeArgs({ segments, durationMs }, { src: path.join(dir, 'match.mp4'), hasAudio: true, main, stinger: { list: stinger, at: [5000] }, out }));
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', out]).toString()) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[] };
    expect(Math.abs(Number(info.format.duration) - durationMs / 1000)).toBeLessThan(0.15);
    const v = info.streams.find((s) => s.codec_type === 'video')!;
    expect([v.width, v.height, v.r_frame_rate]).toEqual([1920, 1080, '25/1']);
    expect(info.streams.some((s) => s.codec_type === 'audio')).toBe(true);
    // one pixel of the picture at a time: red while the graphic is up, blue under the transition, black on the end board
    const pixel = (t: number) => {
      const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'crop=2:2:100:100,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      return [...raw.subarray(0, 3)];
    };
    const [r1, g1, b1] = pixel(2.5);
    expect(r1).toBeGreaterThan(200);
    expect(g1! + b1!).toBeLessThan(80);
    const [r2, , b2] = pixel(5.5);
    expect(b2).toBeGreaterThan(200);
    expect(r2).toBeLessThan(60);
    expect(pixel(9.2).every((c) => c < 30)).toBe(true);
    // the test picture shows through where no graphic is
    expect(pixel(1.0).some((c) => c > 40)).toBe(true);
  }, 120_000);
});
