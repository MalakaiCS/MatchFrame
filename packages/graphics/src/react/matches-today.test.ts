import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAdapter } from '@bs/domain';
import { findTemplate } from '../catalog';
import { DEFAULT_THEMES, THEME_KEYS, type RenderToday, type RenderTodayRow, type ThemeConfig } from '../data';
import { approxMeasure } from '../fit';
import { THEMES } from './index';
import { todayRowsShown } from './shared-graphics';
import type { GraphicProps } from './stage';

const team = (id: string, name: string, abbreviation: string) => ({ id, name, shortName: name.split(' ')[0]!, abbreviation, primaryColor: '#1F6FEB', logoUrl: null });
const row = (id: string, at: string, status: string, o: Partial<RenderTodayRow> = {}): RenderTodayRow => ({
  id, round: '4', scheduledAt: at, status, live: status === 'live', home: team(`${id}h`, `Home ${id}`, 'HOM'), away: team(`${id}a`, `Away ${id}`, 'AWY'),
  score: null, scoreDetail: null, competition: 'CPL', phaseLabel: null, current: false, ...o,
});
// Brisbane is UTC+10 with no daylight saving: 00:00Z is 10:00 am there
const DAY: RenderToday = {
  title: 'TODAY AT BAYSIDE OVAL',
  rows: [
    row('r1', '2026-10-25T00:00:00Z', 'completed', { score: { home: 2, away: 1 } }),
    row('r2', '2026-10-25T02:00:00Z', 'live', { score: { home: 0, away: 3 }, phaseLabel: '2nd Half', current: true }),
    row('r3', '2026-10-25T05:00:00Z', 'scheduled'),
    row('r4', '2026-10-25T07:00:00Z', 'postponed'),
  ],
};

function props(key: ThemeConfig['themeKey'], today: RenderToday | null, variables: Record<string, unknown> = {}): GraphicProps {
  const a = getAdapter('football');
  return {
    cue: { cueId: 'c1', templateKey: 'builtin:matches_today', variables },
    t: findTemplate('builtin:matches_today')!,
    data: {
      theme: DEFAULT_THEMES[key],
      match: { id: 'r2', sport: 'football', timezone: 'Australia/Brisbane', teams: { home: team('h', 'Harbour City', 'HAR'), away: team('a', 'Bayside United', 'BAY') }, rulesConfig: a.defaultConfig, projection: a.initialProjection(a.defaultConfig), competition: { name: 'Coastal League', shortName: 'CPL', logoUrl: null }, lineup: { home: [], away: [] }, events: [] },
      players: {}, creatives: {}, assets: {}, today,
    },
    display: { periodLabel: '2nd Half', periodShort: '2H', clockText: '52:08', clockRunning: true, score: { home: 0, away: 3 }, alerts: [] },
    now: 0,
    phase: 'hold',
    offsetMs: 5_000,
    memo: new Map(),
    measure: approxMeasure,
    creative: () => null,
  } as unknown as GraphicProps;
}
const draw = (key: ThemeConfig['themeKey'], p: GraphicProps) => renderToStaticMarkup(createElement(() => THEMES[key]!.matches_today!(p) as never));

describe('the "Matches today" board', () => {
  it('is in the catalogue as a full-frame board for every sport', () => {
    const t = findTemplate('builtin:matches_today')!;
    expect(t).toMatchObject({ name: 'Matches today', layer: 'fullframe', requiredData: [] });
    expect(t.sports.length).toBeGreaterThanOrEqual(7);
  });

  it('in every look: a result with FT, a live match with its phase and score, a kick-off time, a postponed match, and this match highlighted', () => {
    for (const key of THEME_KEYS) {
      const html = draw(key, props(key, DAY));
      expect(html, key).toContain('TODAY AT BAYSIDE OVAL');
      expect(html, key).toMatch(/data-today-row="completed"[^]*>FT<[^]*Home r1[^]*2 – 1[^]*Away r1/);
      expect(html, key).toMatch(/data-today-row="live" data-current="true" style="[^"]*background:#[0-9A-Fa-f]{6}22[^]*LIVE[^]*2nd Half[^]*0 – 3/);
      expect(html, key).toMatch(/data-today-row="scheduled"[^]*3:00 pm[^]*>v<[^]*CPL[^]*Round 4/);
      expect(html, key).toMatch(/data-today-row="postponed"[^]*POSTPONED/);
      expect(html, key).not.toContain('No other matches today');
    }
  });

  it('a title set on the graphic wins, and with no other matches it says so', () => {
    for (const key of THEME_KEYS) {
      expect(draw(key, props(key, DAY, { title: 'Results so far' })), key).toContain('RESULTS SO FAR');
      const alone = draw(key, props(key, { title: 'TODAY AT BAYSIDE OVAL', rows: [DAY.rows[1]!] }));
      expect(alone, key).toMatch(/data-current="true"[^]*No other matches today/);
      const none = draw(key, props(key, null));
      expect(none, key).toContain('MATCHES TODAY');
      expect(none, key).toContain('No other matches today');
    }
  });

  it('with more than eight matches it keeps the ones around now, in kick-off order', () => {
    const at = (h: number) => `2026-10-25T${String(h).padStart(2, '0')}:00:00Z`;
    const many = [
      ...Array.from({ length: 6 }, (_, i) => row(`done${i}`, at(i), 'completed', { score: { home: 1, away: 0 } })),
      row('live', at(6), 'live', { score: { home: 0, away: 0 } }),
      ...Array.from({ length: 6 }, (_, i) => row(`next${i}`, at(7 + i), 'scheduled')),
    ];
    expect(todayRowsShown(many).map((r) => r.id)).toEqual(['done2', 'done3', 'done4', 'done5', 'live', 'next0', 'next1', 'next2']);
    // before anything starts: the first fixtures; after everything: the last results; this match always stays
    const upcoming = Array.from({ length: 10 }, (_, i) => row(`m${i}`, at(i), 'scheduled', { current: i === 9 }));
    expect(todayRowsShown(upcoming).map((r) => r.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm9']);
    const done = Array.from({ length: 10 }, (_, i) => row(`m${i}`, at(i), 'completed', { score: { home: 0, away: 0 } }));
    expect(todayRowsShown(done).map((r) => r.id)).toEqual(['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    expect(todayRowsShown(DAY.rows)).toHaveLength(4);
  });
});

describe('the intermission screen', () => {
  // between matches: r1 finished, r2 live elsewhere at the ground, r3 is next (this output's match)
  const NEXT: RenderToday = { title: DAY.title, rows: DAY.rows.map((r) => ({ ...r, current: r.id === 'r3' })) };
  const im = (key: ThemeConfig['themeKey'], today: RenderToday | null, now: number, variables: Record<string, unknown> = {}) => {
    const p = props(key, today, variables);
    return { ...p, cue: { ...p.cue, templateKey: 'builtin:intermission' }, t: findTemplate('builtin:intermission')!, now } as GraphicProps;
  };
  const drawIm = (key: ThemeConfig['themeKey'], p: GraphicProps) => renderToStaticMarkup(createElement(() => THEMES[key]!.intermission!(p) as never));

  it('is in the catalogue as a full-frame screen with no set time on air', () => {
    expect(findTemplate('builtin:intermission')).toMatchObject({ name: 'Intermission', layer: 'fullframe', holdMs: null, requiredData: [] });
  });

  it('in every look: the next match with its kick-off time and the countdown, then today with the next match highlighted', () => {
    const now = Date.parse('2026-10-25T04:47:30Z'); // 12:30 before a 3:00 pm kick-off
    for (const key of THEME_KEYS) {
      const html = drawIm(key, im(key, NEXT, now, { message: 'Back for the next match soon' }));
      expect(html, key).toMatch(/data-intermission="true"[^]*data-next-match="r3"[^]*Home r3[^]*NEXT MATCH[^]*3:00 pm[^]*KICK-OFF IN[^]*12:30[^]*CPL · Round 4[^]*Away r3/);
      expect(html, key).toContain('Back for the next match soon');
      expect(html, key).toMatch(/data-today-row="completed"[^]*2 – 1[^]*data-today-row="live"[^]*0 – 3[^]*data-today-row="scheduled" data-current="true"/);
      expect(html, key).toContain('TODAY AT BAYSIDE OVAL');
    }
  });

  it("put on from another match's output: the day's next kick-off; once it has passed the countdown goes; with nothing to come, no panel", () => {
    for (const key of THEME_KEYS) {
      // drawn with the finished r1's output: the next is still r3
      const fromR1 = drawIm(key, im(key, { title: DAY.title, rows: DAY.rows.map((r) => ({ ...r, current: r.id === 'r1' })) }, Date.parse('2026-10-25T05:01:00Z')));
      expect(fromR1, key).toContain('data-next-match="r3"');
      expect(fromR1, key).not.toContain('data-countdown');
      const done = drawIm(key, im(key, { title: DAY.title, rows: [DAY.rows[0]!, { ...DAY.rows[1]!, current: false }, DAY.rows[3]!] }, 0));
      expect(done, key).not.toContain('data-next-match');
      expect(done, key).toMatch(/data-intermission="true"[^]*data-today-row="completed"/);
    }
  });
});
