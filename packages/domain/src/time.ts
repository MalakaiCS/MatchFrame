// Timezone helpers built on Intl only (isomorphic). All instants are stored in UTC.

export function isValidTimeZone(tz: string): boolean {
  if (!tz || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) || tz === 'Local') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsAt(utcMs: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(utcMs))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset (ms) of tz from UTC at the given instant. */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const p = partsAt(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export type LocalResolution =
  | { ok: true; utc: Date }
  | { ok: false; code: 'INVALID_FORMAT' | 'INVALID_TIMEZONE' | 'NONEXISTENT_LOCAL_TIME' | 'AMBIGUOUS_LOCAL_TIME'; message: string };

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Resolve a wall-clock local time in an IANA zone to a UTC instant. Rejects DST gaps and overlaps so imports
 * never guess.
 */
export function resolveLocalTime(local: string, tz: string): LocalResolution {
  if (!isValidTimeZone(tz)) return { ok: false, code: 'INVALID_TIMEZONE', message: `Unknown IANA timezone "${tz}"` };
  const m = LOCAL_RE.exec(local.trim());
  if (!m) return { ok: false, code: 'INVALID_FORMAT', message: 'Use YYYY-MM-DD HH:MM local time' };
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as number[];
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31 || h! > 23 || mi! > 59 || s! > 59) {
    return { ok: false, code: 'INVALID_FORMAT', message: 'Date or time is out of range' };
  }
  const naive = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
  const check = new Date(naive);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo! - 1) return { ok: false, code: 'INVALID_FORMAT', message: 'Date does not exist' };
  // Candidate instants using offsets found a day either side.
  const offsets = new Set([tzOffsetMs(naive - 86_400_000, tz), tzOffsetMs(naive, tz), tzOffsetMs(naive + 86_400_000, tz)]);
  const matches = [...offsets]
    .map((off) => naive - off)
    .filter((utc) => {
      const p = partsAt(utc, tz);
      return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi && p.second === s;
    });
  const unique = [...new Set(matches)];
  if (unique.length === 0) return { ok: false, code: 'NONEXISTENT_LOCAL_TIME', message: `${local} does not exist in ${tz} (daylight-saving gap)` };
  if (unique.length > 1) return { ok: false, code: 'AMBIGUOUS_LOCAL_TIME', message: `${local} occurs twice in ${tz} (daylight-saving overlap)` };
  return { ok: true, utc: new Date(unique[0]!) };
}

export function formatInZone(d: Date | number, tz: string, locale = 'en-AU', opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short', ...opts }).format(new Date(d));
}

/** Midnight at the start of a calendar day in an IANA zone (the first instant of that day, also across DST). */
function zonedMidnight(y: number, m: number, d: number, tz: string): number {
  const naive = Date.UTC(y, m - 1, d);
  const guess = naive - tzOffsetMs(naive, tz);
  return naive - tzOffsetMs(guess, tz);
}

/** The local calendar day containing `at` in `tz`, as [from, to) instants: "today" for a ground in its own zone. */
export function localDayBounds(at: Date | number, tz: string): { from: Date; to: Date } {
  const p = partsAt(new Date(at).getTime(), tz);
  return { from: new Date(zonedMidnight(p.year, p.month, p.day, tz)), to: new Date(zonedMidnight(p.year, p.month, p.day + 1, tz)) };
}
