import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAdapter } from '@bs/domain';
import { findTemplate } from '../catalog';
import { DEFAULT_THEMES, THEME_KEYS, type ThemeConfig } from '../data';
import { approxMeasure } from '../fit';
import { THEMES } from './index';
import type { GraphicProps } from './stage';

const teams = {
  home: { id: 'h', name: 'Harbour City', shortName: 'Harbour', abbreviation: 'HAR', primaryColor: '#1F6FEB', secondaryColor: '#FFFFFF', logoUrl: null },
  away: { id: 'a', name: 'Bayside United', shortName: 'Bayside', abbreviation: 'BAY', primaryColor: '#E5484D', secondaryColor: '#FFFFFF', logoUrl: null },
};
function props(key: ThemeConfig['themeKey'], variables: Record<string, unknown>, match: Record<string, unknown> = {}): GraphicProps {
  const a = getAdapter('football');
  return {
    cue: { cueId: 'c1', templateKey: 'builtin:highlights_intro', variables },
    t: findTemplate('builtin:highlights_intro')!,
    data: {
      theme: DEFAULT_THEMES[key],
      match: { sport: 'football', teams, rulesConfig: a.defaultConfig, projection: a.initialProjection(a.defaultConfig), competition: { name: 'Coastal League', shortName: 'CPL', logoUrl: null }, round: 'Round 12', venue: 'Bayside Oval', scheduledAt: '2026-10-24T05:00:00Z', timezone: 'Australia/Brisbane', lineup: { home: [], away: [] }, events: [], ...match },
      players: {}, creatives: {}, assets: {},
    },
    display: { periodLabel: '', periodShort: '', clockText: '', clockRunning: false, score: { home: 0, away: 0 }, alerts: [] },
    now: 0, phase: 'hold', offsetMs: 5_000, memo: new Map(), measure: approxMeasure, creative: () => null,
  } as unknown as GraphicProps;
}
const draw = (key: ThemeConfig['themeKey'], p: GraphicProps) => renderToStaticMarkup(createElement(() => THEMES[key]!.highlights_intro!(p) as never));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the highlights title panel', () => {
  it('in every look: the title, both teams, the round, the ground, and the date with the kick-off time', () => {
    for (const key of THEME_KEYS) {
      const t = text(draw(key, props(key, { title: 'MATCH HIGHLIGHTS' })));
      for (const s of ['MATCH', 'HIGHLIGHTS', 'HARBOUR', 'BAYSIDE', 'ROUND 12', 'BAYSIDE OVAL', 'SATURDAY 24 OCTOBER 2026 · 3:00 PM']) expect(t, `${key}: ${s}`).toContain(s);
    }
  });

  it('a longer title puts its first words on a small line above the last two: Extended Match Highlights', () => {
    const html = draw('broadcast', props('broadcast', { title: 'Extended Match Highlights' }));
    expect(html).toMatch(/data-title-kicker[^>]*>.*EXTENDED.*<\/span>/);
    expect(text(html)).toMatch(/EXTENDED MATCH HIGHLIGHTS/);
    expect(draw('broadcast', props('broadcast', { title: 'MATCH HIGHLIGHTS' }))).not.toContain('data-title-kicker');
  });

  it('leaves out what the match does not have: no ground, no round', () => {
    const t = text(draw('broadcast', props('broadcast', {}, { venue: null, round: null })));
    expect(t).not.toContain('OVAL');
    expect(t).toContain('SATURDAY 24 OCTOBER 2026 · 3:00 PM');
  });
});
