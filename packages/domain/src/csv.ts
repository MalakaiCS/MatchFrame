// Fixture CSV parsing, validation (dry-run) and safe CSV export helpers.
import { resolveLocalTime } from './time';

export const FIXTURE_COLUMNS = ['external_id', 'competition', 'season', 'round', 'home_team', 'away_team', 'venue', 'kickoff_local', 'timezone'] as const;

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, trailing newline. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Neutralise spreadsheet formula prefixes in untrusted cells, then quote. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export interface ImportContext {
  sport: string;
  competitions: { id: string; name: string; shortName?: string | null; sport: string }[];
  seasons: { id: string; competitionId: string; name: string }[];
  teams: { id: string; name: string; shortName?: string | null; abbreviation?: string | null }[];
  venues: { id: string; name: string }[];
  /** explicit user mappings: CSV value (case-insensitive) -> entity id */
  teamMappings?: Record<string, string>;
  venueMappings?: Record<string, string>;
  createMissingTeams?: boolean;
  existingFixtures: { id: string; externalId: string; status: 'future' | 'live' | 'completed' }[];
  mode: 'skip_duplicates' | 'update_matched_future';
}

export interface ImportRowError {
  row: number; // 1-based data row number as shown in a spreadsheet (header = row 1)
  field: string;
  code: string;
  message: string;
}

export interface PlannedFixture {
  row: number;
  externalId: string;
  competitionId: string;
  seasonId: string;
  round: string;
  homeTeam: { id: string } | { create: string };
  awayTeam: { id: string } | { create: string };
  venueId: string | null;
  scheduledAt: string; // ISO UTC
  timezone: string;
  kickoffLocal: string;
  action: 'create' | 'update' | 'skip';
  existingId?: string;
  skipReason?: string;
}

export interface ImportPlan {
  valid: boolean;
  rows: PlannedFixture[];
  errors: ImportRowError[];
  summary: { create: number; update: number; skip: number; error: number; teamsToCreate: string[] };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function planFixtureImport(csvText: string, ctx: ImportContext): ImportPlan {
  const errors: ImportRowError[] = [];
  const rows = parseCsv(csvText);
  const out: PlannedFixture[] = [];
  const teamsToCreate = new Set<string>();
  if (rows.length === 0) {
    return { valid: false, rows: [], errors: [{ row: 1, field: 'file', code: 'EMPTY', message: 'The file has no rows' }], summary: { create: 0, update: 0, skip: 0, error: 1, teamsToCreate: [] } };
  }
  const header = rows[0]!.map((h) => norm(h).replace(/ /g, '_'));
  const missing = FIXTURE_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    return {
      valid: false,
      rows: [],
      errors: missing.map((c) => ({ row: 1, field: c, code: 'MISSING_COLUMN', message: `Missing column "${c}"` })),
      summary: { create: 0, update: 0, skip: 0, error: missing.length, teamsToCreate: [] },
    };
  }
  const idx = Object.fromEntries(FIXTURE_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof FIXTURE_COLUMNS)[number], number>;
  const seenExternal = new Map<string, number>();

  const findTeam = (raw: string): { id: string } | { create: string } | null => {
    const key = norm(raw);
    const mapped = ctx.teamMappings?.[key];
    if (mapped) return { id: mapped };
    const t = ctx.teams.find((x) => norm(x.name) === key || (x.shortName && norm(x.shortName) === key) || (x.abbreviation && norm(x.abbreviation) === key));
    if (t) return { id: t.id };
    if (ctx.createMissingTeams && raw.trim()) return { create: raw.trim() };
    return null;
  };

  rows.slice(1).forEach((cells, i) => {
    const rowNo = i + 2;
    const get = (c: (typeof FIXTURE_COLUMNS)[number]) => (cells[idx[c]] ?? '').trim();
    const rowErrors: ImportRowError[] = [];
    const e = (field: string, code: string, message: string) => rowErrors.push({ row: rowNo, field, code, message });

    const externalId = get('external_id');
    if (!externalId) e('external_id', 'REQUIRED', 'external_id is required');
    else if (externalId.length > 100) e('external_id', 'TOO_LONG', 'external_id must be 100 characters or fewer');
    else if (seenExternal.has(externalId)) e('external_id', 'DUPLICATE_IN_FILE', `Duplicate external_id (also on row ${seenExternal.get(externalId)})`);
    else seenExternal.set(externalId, rowNo);

    const comp = ctx.competitions.find((c) => norm(c.name) === norm(get('competition')) || (c.shortName && norm(c.shortName) === norm(get('competition'))));
    if (!comp) e('competition', 'UNKNOWN_COMPETITION', `Unknown competition "${get('competition')}"`);
    else if (comp.sport !== ctx.sport) e('competition', 'UNSUPPORTED_SPORT', `Competition "${comp.name}" is ${comp.sport}, not ${ctx.sport}`);
    const season = comp ? ctx.seasons.find((s) => s.competitionId === comp.id && norm(s.name) === norm(get('season'))) : undefined;
    if (comp && !season) e('season', 'UNKNOWN_SEASON', `Unknown season "${get('season')}" for ${comp.name}`);

    const home = findTeam(get('home_team'));
    const away = findTeam(get('away_team'));
    if (!home) e('home_team', 'UNKNOWN_TEAM', `Unknown team "${get('home_team')}" — map it to an existing team or enable "create missing teams"`);
    if (!away) e('away_team', 'UNKNOWN_TEAM', `Unknown team "${get('away_team')}" — map it to an existing team or enable "create missing teams"`);
    const same =
      home && away && (('id' in home && 'id' in away && home.id === away.id) || ('create' in home && 'create' in away && norm(home.create) === norm(away.create)));
    if (same) e('away_team', 'SAME_TEAM', 'Home and away team must differ');

    let venueId: string | null = null;
    if (get('venue')) {
      const v = ctx.venueMappings?.[norm(get('venue'))] ?? ctx.venues.find((x) => norm(x.name) === norm(get('venue')))?.id;
      if (!v) e('venue', 'UNKNOWN_VENUE', `Unknown venue "${get('venue')}"`);
      else venueId = v;
    }

    const res = resolveLocalTime(get('kickoff_local'), get('timezone'));
    if (!res.ok) e(res.code === 'INVALID_TIMEZONE' ? 'timezone' : 'kickoff_local', res.code, res.message);

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    if (home && 'create' in home) teamsToCreate.add(home.create);
    if (away && 'create' in away) teamsToCreate.add(away.create);
    const existing = ctx.existingFixtures.find((f) => f.externalId === externalId);
    let action: PlannedFixture['action'] = 'create';
    let skipReason: string | undefined;
    if (existing) {
      if (existing.status !== 'future') {
        action = 'skip';
        skipReason = `Fixture ${externalId} is ${existing.status}; live and completed matches are never overwritten`;
      } else if (ctx.mode === 'update_matched_future') action = 'update';
      else {
        action = 'skip';
        skipReason = 'Already imported (skip duplicates mode)';
      }
    }
    out.push({
      row: rowNo,
      externalId,
      competitionId: comp!.id,
      seasonId: season!.id,
      round: get('round'),
      homeTeam: home!,
      awayTeam: away!,
      venueId,
      scheduledAt: (res as { utc: Date }).utc.toISOString(),
      timezone: get('timezone'),
      kickoffLocal: get('kickoff_local'),
      action,
      existingId: existing?.id,
      skipReason,
    });
  });
  const count = (a: PlannedFixture['action']) => out.filter((r) => r.action === a).length;
  return {
    valid: errors.length === 0 && out.length > 0,
    rows: out,
    errors,
    summary: { create: count('create'), update: count('update'), skip: count('skip'), error: new Set(errors.map((x) => x.row)).size, teamsToCreate: [...teamsToCreate] },
  };
}

export function fixtureTemplateCsv(): string {
  return toCsv([...FIXTURE_COLUMNS], [['R1-001', 'Coastal Premier League', '2026', 'Round 1', 'Harbour City FC', 'Ridgeback United', 'Bayside Oval', '2026-11-07 15:00', 'Australia/Brisbane']]);
}

export function importErrorsCsv(errors: ImportRowError[]): string {
  return toCsv(['row', 'field', 'code', 'message'], errors.map((e) => [e.row, e.field, e.code, e.message]));
}
