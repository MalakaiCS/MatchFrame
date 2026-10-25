import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAdapter } from '@bs/domain';
import { DEFAULT_THEMES, type RenderData, type ThemeConfig } from '../data';
import { approxMeasure } from '../fit';
import { MatchThumbnail, THUMBNAIL_KINDS, type ThumbnailOptions } from './thumbnail';

const team = (o: Partial<RenderData['match']['teams']['home']>) => ({ id: 'h', name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', primaryColor: '#123A8C', secondaryColor: '#FFFFFF', logoUrl: '/crest-h.png', ...o });
function data(o: { theme?: Partial<ThemeConfig>; home?: object; away?: object; competition?: object; score?: [number, number]; round?: string | null } = {}): RenderData {
  const a = getAdapter('football');
  const projection = { ...a.initialProjection(a.defaultConfig), score: { home: o.score?.[0] ?? 0, away: o.score?.[1] ?? 0 } };
  return {
    theme: { ...DEFAULT_THEMES.broadcast, ...o.theme },
    match: { sport: 'football', teams: { home: team({ ...o.home }), away: team({ id: 'a', name: 'Northgate Wanderers', shortName: 'Northgate', abbreviation: 'NGW', primaryColor: '#5BC8F0', logoUrl: '/crest-a.png', ...o.away }) }, rulesConfig: a.defaultConfig, projection, clocks: a.initialClocks(a.defaultConfig), competition: { name: 'Coastal Premier League', shortName: 'CPL', logoUrl: '/cpl.png', ...o.competition }, round: o.round === undefined ? 'Round 12' : o.round, venue: null, scheduledAt: '2026-10-24T05:00:00Z', timezone: 'Australia/Brisbane', lineup: { home: [], away: [] }, events: [] },
    players: {}, creatives: {}, assets: {},
  } as unknown as RenderData;
}
const draw = (d: RenderData, o: ThumbnailOptions) => renderToStaticMarkup(createElement(MatchThumbnail, { data: d, measure: approxMeasure, ...o }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('match thumbnails', () => {
  it('a tag for each kind of video, the competition, round and date, both crests and names, no score', () => {
    for (const k of THUMBNAIL_KINDS) {
      const html = draw(data(), { kind: k.kind });
      expect(html).toContain(`data-thumbnail="${k.kind}"`);
      expect(text(html), k.kind).toContain(k.kind === 'extended' ? 'EXTENDED HIGHLIGHTS' : k.label);
      expect(text(html)).toContain('ROUND 12 · SAT, 24 OCT');
      expect(text(html)).toMatch(/Coastal Premier( League)?/);
      expect(text(html)).toContain('HARBOUR');
      expect(text(html)).toContain('NORTHGATE');
      for (const src of ['/cpl.png', '/crest-h.png', '/crest-a.png']) expect(html).toContain(`src="${src}"`);
      expect(html).not.toContain('data-thumbnail-score');
    }
  });

  it('the score between the crests only when asked; the team names can be left off', () => {
    const d = data({ score: [3, 1] });
    expect(draw(d, { kind: 'highlights', showScore: true })).toMatch(/data-thumbnail-score[^>]*>3–1</);
    expect(text(draw(d, { kind: 'highlights' }))).toContain('VS');
    expect(text(draw(d, { kind: 'highlights', names: false }))).not.toContain('HARBOUR');
  });

  it('the club’s own words, the look’s wording, and a label too long for one line on two', () => {
    expect(text(draw(data(), { kind: 'custom', label: 'Grand Final' }))).toContain('GRAND FINAL');
    expect(text(draw(data({ theme: { wording: { 'LIVE STREAM': 'EN DIRECT' } } }), { kind: 'live' }))).toContain('EN DIRECT');
    const ext = draw(data(), { kind: 'extended' });
    expect(ext).toMatch(/>EXTENDED<\/span>/);
    expect(ext).toMatch(/HIGHLIGHTS<\/span>/);
  });

  it('a long name shrinks or falls back to the short one; no competition logo leaves its space to the name', () => {
    const html = draw(data({ home: { shortName: null, name: 'The Very Long Named Harbour City Football And Sports Club' }, competition: { logoUrl: null } }), { kind: 'live' });
    expect(text(html)).toContain('HCF');
    expect(html).not.toContain('src="/cpl.png"');
    // a missing crest draws the team's letters in its place
    expect(text(draw(data({ away: { logoUrl: null } }), { kind: 'live' }))).toContain('NGW');
  });

  it('teams in the same colour are told apart, as on air', () => {
    const html = draw(data({ home: { primaryColor: '#1F6FEB' }, away: { primaryColor: '#1F6FEB' } }), { kind: 'live' });
    const colours = [...html.matchAll(/data-thumbnail-team="(home|away)" style="[^"]*?(#[0-9A-Fa-f]{6})"/g)].map((m) => m[2]!.toLowerCase());
    expect(colours).toHaveLength(2);
    expect(colours[0]).not.toBe(colours[1]);
  });
});
