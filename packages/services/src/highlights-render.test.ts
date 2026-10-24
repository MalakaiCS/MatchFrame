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

const seg = (s: Partial<HighlightSegment>) => ({ id: s.kind!, factIds: [], atFrom: 0, clock: null, ...s }) as HighlightSegment;

describe('composing a package with FFmpeg', () => {
  it('reads a video over the network with reconnects: a clip waiting its turn is not cut short when storage drops it', () => {
    const segments = [
      seg({ kind: 'clip', videoFromMs: 5000, videoToMs: 9000, speed: 1, outFromMs: 0, outToMs: 4000, join: 'none', joinMs: 0 }),
      seg({ kind: 'full_time', videoFromMs: 12000, videoToMs: 15000, speed: 1, outFromMs: 3700, outToMs: 6700, join: 'crossfade', joinMs: 300 }),
    ];
    const inputs = (src: string) => {
      const a = composeArgs({ segments, durationMs: 6700 }, { src, hasAudio: true, main: 'main.txt', out: 'out.mp4' });
      return a.flatMap((x, i) => (x === '-i' && a[i + 1] === src ? [a.slice(Math.max(0, i - 10), i)] : []));
    };
    const remote = inputs('https://storage.example/match.mp4?X-Amz-Signature=x');
    expect(remote).toHaveLength(2);
    for (const before of remote) expect(before).toEqual(expect.arrayContaining(['-reconnect', '1', '-reconnect_on_network_error', '1']));
    for (const before of inputs('/tmp/match.mp4')) expect(before).not.toContain('-reconnect');
  });

  it('keeps the picture going when a join falls between two frames of the clip before it', () => {
    // the clip ends 4.170 s in and the cut starts at 4.130: its last frame (4.16) is inside the cut
    const segments = [
      seg({ kind: 'clip', videoFromMs: 2000, videoToMs: 6170, speed: 1, outFromMs: 0, outToMs: 4170, join: 'none', joinMs: 0 }),
      seg({ kind: 'replay', videoFromMs: 3000, videoToMs: 6000, speed: 0.75, outFromMs: 4130, outToMs: 8130, join: 'cut', joinMs: 40 }),
      seg({ kind: 'full_time', videoFromMs: 16000, videoToMs: 20000, speed: 1, outFromMs: 7830, outToMs: 11830, join: 'crossfade', joinMs: 300 }),
      seg({ kind: 'end_card', videoFromMs: 0, videoToMs: 0, speed: 1, outFromMs: 11330, outToMs: 13330, join: 'crossfade', joinMs: 500 }),
    ];
    const durationMs = 13330;
    const main = writeTrack(dir, 'gap', { durationMs, frames: [{ atMs: 0, bytes: 0 }] }, [clear]);
    const out = path.join(dir, 'gap.mp4');
    ff(composeArgs({ segments, durationMs }, { src: path.join(dir, 'match.mp4'), hasAudio: true, main, out }));
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-select_streams', 'v', '-of', 'json', out]).toString()) as { streams: { duration: string }[] };
    expect(Math.abs(Number(info.streams[0]!.duration) - durationMs / 1000)).toBeLessThan(0.1);
  }, 120_000);

  it('clips, a slowed replay cut in, the end board, the graphics over them and the transition at its time', () => {
    // a 4 s clip, a cross-fade into a replay of 2 s of match at 0.5 (4 s), a cut, then a 2 s end board
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
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', out]).toString()) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }[] };
    expect(Math.abs(Number(info.format.duration) - durationMs / 1000)).toBeLessThan(0.15);
    const v = info.streams.find((s) => s.codec_type === 'video')!;
    // the picture itself runs the length (the sound alone would hold the file's length up)
    expect(Math.abs(Number(v.duration) - durationMs / 1000)).toBeLessThan(0.15);
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
