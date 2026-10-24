// Fixture import beyond CSV files: an iCalendar export (most association platforms offer one) and a spreadsheet
// published as CSV (Google Sheets "Publish to web", or any https CSV). Both become the standard CSV, so the
// existing dry run / commit flow with its mappings and duplicate handling applies unchanged.
import dns from 'node:dns/promises';
import { z } from 'zod';
import { FIXTURE_COLUMNS, toCsv } from '@bs/domain';
import { invalid } from './errors';
import { isPrivateAddress } from './streams';

export const icalOptions = z.object({
  competition: z.string().trim().min(1).max(80),
  season: z.string().trim().min(1).max(40),
  timezone: z.string().min(1).max(60),
  /** "Home v Away" is the common summary; a custom separator covers "Home vs Away" or "Home - Away" */
  separator: z.string().max(10).default(' v '),
});

function unfold(ics: string) {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}
function icsDate(v: string, tz: string): { local: string; timezone: string } | null {
  // 20261107T150000Z | 20261107T150000 | 20261107 (all-day)
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h = '12', mi = '00', , zulu] = m;
  if (zulu) {
    const utc = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi));
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(utc).replace(',', '');
    return { local, timezone: tz };
  }
  return { local: `${y}-${mo}-${d} ${h}:${mi}`, timezone: tz };
}

/** VEVENTs → fixture CSV rows. The UID becomes the external id so re-imports update rather than duplicate. */
export function icalToFixtureCsv(ics: string, opts: z.input<typeof icalOptions>): { csv: string; rows: number; skipped: { summary: string; reason: string }[] } {
  const o = icalOptions.parse(opts);
  const text = unfold(ics);
  const events = text.split('BEGIN:VEVENT').slice(1).map((b) => b.split('END:VEVENT')[0]!);
  const rows: string[][] = [];
  const skipped: { summary: string; reason: string }[] = [];
  for (const ev of events) {
    const prop = (name: string) => {
      const m = new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, 'mi').exec(ev);
      return m ? m[1]!.trim().split('\\,').join(',').split('\\;').join(';').split('\\n').join(' ') : '';
    };
    const tzidMatch = /^DTSTART;TZID=([^:]+):/mi.exec(ev);
    const summary = prop('SUMMARY');
    const sep = o.separator;
    const idx = summary.toLowerCase().indexOf(sep.toLowerCase());
    if (idx < 0) {
      skipped.push({ summary: summary || '(no summary)', reason: `no "${sep.trim()}" between the team names` });
      continue;
    }
    const home = summary.slice(0, idx).trim();
    const away = summary.slice(idx + sep.length).trim().replace(/\s*\(.*\)$/, '');
    const when = icsDate(prop('DTSTART'), tzidMatch?.[1] ?? o.timezone);
    if (!when || !home || !away) {
      skipped.push({ summary: summary || '(no summary)', reason: 'missing start time or team' });
      continue;
    }
    const uid = prop('UID') || `${home}-${away}-${when.local}`;
    const round = (/round\s*(\d+)/i.exec(prop('DESCRIPTION') + ' ' + summary)?.[1] ?? '').trim();
    rows.push([uid.slice(0, 100), o.competition, o.season, round ? `Round ${round}` : '', home, away, prop('LOCATION'), when.local, when.timezone]);
  }
  return { csv: toCsv([...FIXTURE_COLUMNS], rows), rows: rows.length, skipped };
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Google Sheets share links become CSV export links; anything else must already serve CSV over https. */
export function csvUrlFor(raw: string): string {
  const u = new URL(raw);
  const g = /^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(u.pathname);
  if (u.hostname === 'docs.google.com' && g) {
    const gid = u.hash.match(/gid=(\d+)/)?.[1] ?? u.searchParams.get('gid') ?? '0';
    return `https://docs.google.com/spreadsheets/d/${g[1]}/export?format=csv&gid=${gid}`;
  }
  return u.toString();
}

export async function fetchCsvFromUrl(raw: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let url: URL;
  try {
    url = new URL(csvUrlFor(raw));
  } catch {
    throw invalid('Enter a full https link to the sheet', [{ field: 'url', message: 'Not a URL' }]);
  }
  if (url.protocol !== 'https:') throw invalid('Only https links are fetched', [{ field: 'url', message: 'https required' }]);
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw invalid('That host cannot be fetched from here', [{ field: 'url', message: 'Unresolvable or private host' }]);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetchImpl(url, { signal: ac.signal, redirect: 'follow', headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5' } });
    if (!res.ok) throw invalid(`The sheet could not be fetched (HTTP ${res.status}). For Google Sheets use File → Share → Publish to web, or make the sheet viewable by anyone with the link.`, [{ field: 'url', message: `HTTP ${res.status}` }]);
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_BYTES) throw invalid('The sheet is larger than 2 MB', [{ field: 'url', message: 'Too large' }]);
    if (/^\s*</.test(text)) throw invalid('The link returned a web page, not CSV. Publish the sheet to the web as CSV and use that link.', [{ field: 'url', message: 'Not CSV' }]);
    return text;
  } finally {
    clearTimeout(timer);
  }
}
