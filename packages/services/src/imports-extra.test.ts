import { describe, expect, it } from 'vitest';
import { csvUrlFor, icalToFixtureCsv } from './imports-extra';

const ICS = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc-1\r\nSUMMARY:Harbour City FC v Saltmarsh Rovers\r\nDTSTART:20261107T050000Z\r\nLOCATION:Bayside Oval\r\nDESCRIPTION:Round 3\\, kick-off 3pm\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:abc-2\r\nSUMMARY:Training\r\nDTSTART:20261108T050000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:abc-3\r\nSUMMARY:Bayside United v Northgate Athletic (Cup)\r\nDTSTART;TZID=Australia/Brisbane:20261114T150000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe('fixture import from iCal and sheets', () => {
  it('turns VEVENTs into fixture CSV rows in the competition timezone', () => {
    const r = icalToFixtureCsv(ICS, { competition: 'Coastal Premier League', season: '2026', timezone: 'Australia/Brisbane' });
    expect(r.rows).toBe(2);
    expect(r.skipped).toEqual([{ summary: 'Training', reason: 'no "v" between the team names' }]);
    const lines = r.csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('external_id,competition,season,round,home_team,away_team,venue,kickoff_local,timezone');
    expect(lines[1]).toBe('abc-1,Coastal Premier League,2026,Round 3,Harbour City FC,Saltmarsh Rovers,Bayside Oval,2026-11-07 15:00,Australia/Brisbane');
    expect(lines[2]).toContain('Bayside United,Northgate Athletic,,2026-11-14 15:00,Australia/Brisbane');
  });
  it('rewrites Google Sheets links to CSV exports', () => {
    expect(csvUrlFor('https://docs.google.com/spreadsheets/d/1AbC_dEf/edit#gid=42')).toBe('https://docs.google.com/spreadsheets/d/1AbC_dEf/export?format=csv&gid=42');
    expect(csvUrlFor('https://example.org/fixtures.csv')).toBe('https://example.org/fixtures.csv');
  });
});
