import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv, planFixtureImport, toCsv, type ImportContext } from './csv';
import { resolveLocalTime } from './time';

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  sport: 'football',
  competitions: [{ id: 'c1', name: 'Coastal Premier League', shortName: 'CPL', sport: 'football' }, { id: 'c2', name: 'Hoops League', sport: 'basketball' }],
  seasons: [{ id: 's1', competitionId: 'c1', name: '2026' }],
  teams: [
    { id: 't1', name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF' },
    { id: 't2', name: 'Ridgeback United', abbreviation: 'RBU' },
  ],
  venues: [{ id: 'v1', name: 'Bayside Oval' }],
  existingFixtures: [],
  mode: 'skip_duplicates',
  ...over,
});
const H = 'external_id,competition,season,round,home_team,away_team,venue,kickoff_local,timezone\n';

describe('csv parsing', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\r\n')).toEqual([['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
  });
  it('neutralises formula prefixes in exported cells (A34)', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('normal')).toBe('normal');
    const out = toCsv(['name'], [['-2+3'], ['a,b']]);
    expect(parseCsv(out)).toEqual([['name'], ["'-2+3"], ['a,b']]);
  });
});

describe('fixture import dry-run (A04)', () => {
  it('reports row/field errors and commits nothing invalid', () => {
    const csv =
      H +
      'R1,Coastal Premier League,2026,1,Harbour City FC,Ridgeback United,Bayside Oval,2026-11-07 15:00,Australia/Brisbane\n' +
      'R2,Coastal Premier League,2026,1,Harbour City FC,Harbour City FC,,2026-11-07 15:00,Australia/Brisbane\n' +
      'R3,Coastal Premier League,2026,1,Unknown FC,RBU,,2026-11-07 15:00,Mars/Base\n' +
      'R1,Hoops League,2026,1,HCF,RBU,,2026-13-07 15:00,Australia/Brisbane\n';
    const plan = planFixtureImport(csv, ctx());
    expect(plan.valid).toBe(false);
    const codes = plan.errors.map((e) => `${e.row}:${e.field}:${e.code}`);
    expect(codes).toContain('3:away_team:SAME_TEAM');
    expect(codes).toContain('4:home_team:UNKNOWN_TEAM');
    expect(codes).toContain('4:timezone:INVALID_TIMEZONE');
    expect(codes).toContain('5:external_id:DUPLICATE_IN_FILE');
    expect(codes).toContain('5:competition:UNSUPPORTED_SPORT');
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]!.scheduledAt).toBe('2026-11-07T05:00:00.000Z');
  });

  it('skips duplicates on repeat import and never overwrites live/completed fixtures', () => {
    const csv = H + 'R1,CPL,2026,1,HCF,RBU,,2026-11-07 15:00,Australia/Brisbane\nR2,CPL,2026,2,RBU,HCF,,2026-11-14 15:00,Australia/Brisbane\n';
    const existing = [{ id: 'm1', externalId: 'R1', status: 'future' as const }, { id: 'm2', externalId: 'R2', status: 'completed' as const }];
    const skip = planFixtureImport(csv, ctx({ existingFixtures: existing }));
    expect(skip.rows.map((r) => r.action)).toEqual(['skip', 'skip']);
    const upd = planFixtureImport(csv, ctx({ existingFixtures: existing, mode: 'update_matched_future' }));
    expect(upd.rows.map((r) => r.action)).toEqual(['update', 'skip']);
    expect(upd.rows[1]!.skipReason).toMatch(/never overwritten/);
  });

  it('creates missing teams only when explicitly enabled, and honours mappings', () => {
    const csv = H + 'R9,CPL,2026,1,Newtown Rovers,The Ridgebacks,,2026-11-07 15:00,Australia/Sydney\n';
    expect(planFixtureImport(csv, ctx()).valid).toBe(false);
    const p = planFixtureImport(csv, ctx({ createMissingTeams: true, teamMappings: { 'the ridgebacks': 't2' } }));
    expect(p.valid).toBe(true);
    expect(p.summary.teamsToCreate).toEqual(['Newtown Rovers']);
    expect(p.rows[0]!.awayTeam).toEqual({ id: 't2' });
  });

  it('rejects missing columns', () => {
    expect(planFixtureImport('external_id,home_team\nx,y\n', ctx()).errors[0]!.code).toBe('MISSING_COLUMN');
  });
});

describe('timezone resolution', () => {
  it('resolves Brisbane (no DST)', () => {
    const r = resolveLocalTime('2026-07-01 19:30', 'Australia/Brisbane');
    expect(r.ok && r.utc.toISOString()).toBe('2026-07-01T09:30:00.000Z');
  });
  it('rejects DST gaps and overlaps instead of guessing', () => {
    expect(resolveLocalTime('2026-10-04 02:30', 'Australia/Sydney')).toMatchObject({ ok: false, code: 'NONEXISTENT_LOCAL_TIME' });
    expect(resolveLocalTime('2026-04-05 02:30', 'Australia/Sydney')).toMatchObject({ ok: false, code: 'AMBIGUOUS_LOCAL_TIME' });
    expect(resolveLocalTime('2026-02-30 10:00', 'UTC')).toMatchObject({ ok: false });
  });
});
