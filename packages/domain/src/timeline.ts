// Media timeline mapping (spec §14.1). Three separate clocks: match clock, UTC occurrence/acceptance, and
// the recording's own media timeline. A clip is placed by UTC capture time, never by "67th minute".
//
//   captureAt = occurredAt + sourceDelayMs + calibrationMs
//   media position = captureAt - PDT(segment containing captureAt) + segment.mediaOffset

export interface MediaSegment {
  seq: number;
  startAt: number; // UTC ms (HLS EXT-X-PROGRAM-DATE-TIME)
  durationMs: number;
  mediaOffsetMs: number; // offset of this segment inside its part
  discontinuity?: boolean;
  objectExists?: boolean;
}

export interface PlaylistParse {
  segments: (MediaSegment & { uri: string })[];
  ended: boolean;
}

/** Parse an HLS media playlist with program-date-time tags. */
export function parseHlsPlaylist(text: string): PlaylistParse {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const segments: PlaylistParse['segments'] = [];
  let seq = 0;
  let pdt: number | null = null;
  let dur = 0;
  let disc = false;
  let offset = 0;
  for (const l of lines) {
    if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = Number(l.split(':')[1]);
    else if (l.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) pdt = Date.parse(l.slice('#EXT-X-PROGRAM-DATE-TIME:'.length));
    else if (l.startsWith('#EXTINF:')) dur = Math.round(parseFloat(l.slice(8)) * 1000);
    else if (l === '#EXT-X-DISCONTINUITY') disc = true;
    else if (l && !l.startsWith('#')) {
      const prev = segments[segments.length - 1];
      const startAt = pdt ?? (prev ? prev.startAt + prev.durationMs : NaN);
      segments.push({ seq, uri: l, startAt, durationMs: dur, mediaOffsetMs: offset, discontinuity: disc });
      offset += dur;
      seq++;
      pdt = null;
      disc = false;
    }
  }
  return { segments, ended: lines.includes('#EXT-X-ENDLIST') };
}

export type MappingResult =
  | { ok: true; fromSeq: number; toSeq: number; startOffsetMs: number; durationMs: number; shortened: boolean; segments: MediaSegment[] }
  | { ok: false; reason: 'NOT_YET_AVAILABLE' | 'BEFORE_RECORDING' | 'AFTER_RECORDING' | 'GAP' | 'NEEDS_ALIGNMENT'; detail: string };

/** Tolerance for wall-clock jitter between consecutive PDTs before we call it a gap. */
const GAP_TOLERANCE_MS = 400;

/**
 * Map a [captureAt - preroll, captureAt + postroll] window onto recorded segments. A missing segment or
 * discontinuity at the event itself fails with GAP; one inside pre/post-roll shortens the clip to the
 * contiguous run containing the event (never silently splicing across a gap).
 */
export function mapWindow(segments: MediaSegment[], captureAt: number, prerollMs: number, postrollMs: number, opts: { live?: boolean; minDurationMs?: number } = {}): MappingResult {
  const segs = [...segments].filter((s) => Number.isFinite(s.startAt)).sort((a, b) => a.seq - b.seq);
  if (!segs.length) return { ok: false, reason: opts.live ? 'NOT_YET_AVAILABLE' : 'NEEDS_ALIGNMENT', detail: 'No recorded segments with timing information' };
  const from = captureAt - prerollMs;
  const to = captureAt + postrollMs;
  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  const lastEnd = last.startAt + last.durationMs;
  if (captureAt < first.startAt) return { ok: false, reason: 'BEFORE_RECORDING', detail: 'The event happened before the recording started' };
  if (to > lastEnd) {
    if (opts.live) return { ok: false, reason: 'NOT_YET_AVAILABLE', detail: 'Waiting for post-roll media' };
    if (captureAt > lastEnd) return { ok: false, reason: 'AFTER_RECORDING', detail: 'The event happened after the recording ended' };
  }
  const idx = segs.findIndex((s) => captureAt >= s.startAt && captureAt < s.startAt + s.durationMs);
  if (idx < 0) return { ok: false, reason: 'GAP', detail: 'The recording has a gap at the moment of the event' };
  const usable = (s: MediaSegment) => s.objectExists !== false;
  if (!usable(segs[idx]!)) return { ok: false, reason: 'GAP', detail: 'The segment containing the event is missing from storage' };
  // grow a contiguous run around the event
  let a = idx;
  while (a > 0) {
    const p = segs[a - 1]!;
    const c = segs[a]!;
    if (c.discontinuity || !usable(p) || p.seq !== c.seq - 1 || Math.abs(p.startAt + p.durationMs - c.startAt) > GAP_TOLERANCE_MS) break;
    if (p.startAt + p.durationMs <= from) break;
    a--;
  }
  let b = idx;
  while (b < segs.length - 1) {
    const c = segs[b]!;
    const n = segs[b + 1]!;
    if (n.discontinuity || !usable(n) || n.seq !== c.seq + 1 || Math.abs(c.startAt + c.durationMs - n.startAt) > GAP_TOLERANCE_MS) break;
    if (n.startAt >= to) break;
    b++;
  }
  const runStart = segs[a]!.startAt;
  const runEnd = segs[b]!.startAt + segs[b]!.durationMs;
  const clipFrom = Math.max(from, runStart);
  const clipTo = Math.min(to, runEnd);
  const durationMs = clipTo - clipFrom;
  if (durationMs < (opts.minDurationMs ?? 2000)) return { ok: false, reason: 'GAP', detail: 'Too little contiguous media around the event' };
  return { ok: true, fromSeq: segs[a]!.seq, toSeq: segs[b]!.seq, startOffsetMs: clipFrom - runStart, durationMs, shortened: clipFrom > from || clipTo < to, segments: segs.slice(a, b + 1) };
}

export const captureTime = (occurredAt: number, sourceDelayMs: number, calibrationMs: number) => occurredAt + sourceDelayMs + calibrationMs;

/** Per-event-type highlight windows (recipe v1). */
export const HIGHLIGHT_RECIPE = {
  version: 'v1',
  events: {
    goal: { preroll: 12_000, postroll: 8_000, label: 'Goal' },
    own_goal: { preroll: 12_000, postroll: 8_000, label: 'Own goal' },
    penalty_scored: { preroll: 10_000, postroll: 8_000, label: 'Penalty' },
    red_card: { preroll: 10_000, postroll: 6_000, label: 'Red card' },
    score: { preroll: 8_000, postroll: 5_000, label: 'Basket' },
  } as Record<string, { preroll: number; postroll: number; label: string }>,
};

export type Aspect = '16:9' | '9:16' | '1:1';
export const ASPECTS: Record<Aspect, { w: number; h: number }> = { '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 } };

/** Crop rectangle in source pixels for an aspect, positioned by focusX (0..1). */
export function cropFor(srcW: number, srcH: number, aspect: Aspect, focusX = 0.5) {
  const target = ASPECTS[aspect].w / ASPECTS[aspect].h;
  const src = srcW / srcH;
  if (Math.abs(target - src) < 0.01) return { w: srcW, h: srcH, x: 0, y: 0 };
  if (target < src) {
    const w = Math.round((srcH * target) / 2) * 2;
    const x = Math.round(Math.max(0, Math.min(srcW - w, focusX * srcW - w / 2)) / 2) * 2;
    return { w, h: srcH, x, y: 0 };
  }
  const h = Math.round(srcW / target / 2) * 2;
  return { w: srcW, h, x: 0, y: Math.round((srcH - h) / 4) * 2 };
}
