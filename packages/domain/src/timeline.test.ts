import { describe, expect, it } from 'vitest';
import { captureTime, cropFor, mapWindow, parseHlsPlaylist, type MediaSegment } from './timeline';

const T0 = Date.parse('2026-10-19T18:36:02.183Z');
const segs = (n: number, skip: number[] = [], disc: number[] = []): MediaSegment[] => {
  const out: MediaSegment[] = [];
  let off = 0;
  for (let i = 0; i < n; i++) {
    if (skip.includes(i)) continue;
    out.push({ seq: i, startAt: T0 + i * 2000, durationMs: 2000, mediaOffsetMs: off, discontinuity: disc.includes(i) });
    off += 2000;
  }
  return out;
};

describe('timeline mapping (A42)', () => {
  it('parses PDT playlists', () => {
    const p = parseHlsPlaylist(`#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PROGRAM-DATE-TIME:2026-10-19T18:36:02.183Z\n#EXTINF:2.000,\nseg_00000.ts\n#EXT-X-PROGRAM-DATE-TIME:2026-10-19T18:36:04.183Z\n#EXTINF:2.000,\nseg_00001.ts\n#EXT-X-DISCONTINUITY\n#EXT-X-PROGRAM-DATE-TIME:2026-10-19T18:36:30.000Z\n#EXTINF:2.000,\nseg_00002.ts\n#EXT-X-ENDLIST`);
    expect(p.segments.map((s) => [s.seq, s.startAt - T0, s.mediaOffsetMs, !!s.discontinuity])).toEqual([[0, 0, 0, false], [1, 2000, 2000, false], [2, Date.parse('2026-10-19T18:36:30.000Z') - T0, 4000, true]]);
    expect(p.ended).toBe(true);
  });

  it('maps by capture time with encoder delay and calibration, not match minute', () => {
    const occurredAt = T0 + 20_000;
    const at = captureTime(occurredAt, 1500, 300); // event appears 1.8 s later in the media
    const r = mapWindow(segs(30), at, 10_000, 6_000);
    expect(r).toMatchObject({ ok: true, shortened: false, durationMs: 16_000 });
    if (r.ok) expect(segs(30).find((s) => s.seq === r.fromSeq)!.startAt + r.startOffsetMs).toBe(at - 10_000);
  });

  it('fails explicitly when the event falls in a gap, shortens when the gap is in the pre-roll', () => {
    const at = T0 + 21_000;
    expect(mapWindow(segs(30, [10]), at, 10_000, 6_000)).toMatchObject({ ok: false, reason: 'GAP' });
    const r = mapWindow(segs(30, [7]), at, 10_000, 6_000);
    expect(r).toMatchObject({ ok: true, shortened: true });
    if (r.ok) expect(r.fromSeq).toBe(8);
    expect(mapWindow(segs(30, [], [9]), at, 10_000, 6_000)).toMatchObject({ ok: true, shortened: true, fromSeq: 9 });
  });

  it('waits for post-roll while live; distinguishes before/after recording', () => {
    expect(mapWindow(segs(10), T0 + 19_000, 5000, 6000, { live: true })).toMatchObject({ ok: false, reason: 'NOT_YET_AVAILABLE' });
    expect(mapWindow(segs(10), T0 - 5000, 5000, 6000)).toMatchObject({ ok: false, reason: 'BEFORE_RECORDING' });
    expect(mapWindow(segs(10), T0 + 60_000, 5000, 6000)).toMatchObject({ ok: false, reason: 'AFTER_RECORDING' });
    expect(mapWindow(segs(10).map((s) => (s.seq === 5 ? { ...s, objectExists: false } : s)), T0 + 11_000, 4000, 4000)).toMatchObject({ ok: false, reason: 'GAP' });
  });

  it('crops for vertical and square exports', () => {
    expect(cropFor(1280, 720, '9:16', 0.5)).toEqual({ w: 406, h: 720, x: 438, y: 0 });
    expect(cropFor(1280, 720, '1:1', 0)).toEqual({ w: 720, h: 720, x: 0, y: 0 });
    expect(cropFor(1280, 720, '16:9')).toEqual({ w: 1280, h: 720, x: 0, y: 0 });
  });
});
