import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAdapter, type DisplayModel, type MatchProjection, type Sport } from '@bs/domain';
import { findTemplate } from '../catalog';
import { DEFAULT_THEMES, THEME_KEYS, type ThemeConfig } from '../data';
import { approxMeasure } from '../fit';
import { THEMES } from './index';
import type { GraphicProps } from './stage';

const teams = {
  home: { id: 'h', name: 'Harbour City', shortName: 'Harbour', abbreviation: 'HAR', primaryColor: '#1F6FEB', secondaryColor: '#FFFFFF', logoUrl: null },
  away: { id: 'a', name: 'Bayside United', shortName: 'Bayside', abbreviation: 'BAY', primaryColor: '#E5484D', secondaryColor: '#FFFFFF', logoUrl: null },
};
const baseDisplay: DisplayModel = { periodLabel: '2nd Half', periodShort: '2H', clockText: '52:08', clockRunning: true, score: { home: 2, away: 1 }, alerts: [] };

function props(key: ThemeConfig['themeKey'], sport: Sport, templateKey: string, o: { display?: Partial<DisplayModel>; projection?: Partial<MatchProjection>; variables?: Record<string, unknown>; theme?: Partial<ThemeConfig> } = {}): GraphicProps {
  const a = getAdapter(sport);
  return {
    cue: { cueId: 'c1', templateKey, variables: o.variables ?? {} },
    t: findTemplate(templateKey)!,
    data: {
      theme: { ...DEFAULT_THEMES[key], ...o.theme },
      match: { sport, teams, rulesConfig: a.defaultConfig, projection: { ...a.initialProjection(a.defaultConfig), ...o.projection }, competition: { name: 'Coastal League', shortName: null, logoUrl: null }, lineup: { home: [], away: [] }, events: [] },
      players: {}, creatives: {}, assets: {},
    },
    display: { ...baseDisplay, ...o.display },
    now: 0,
    phase: 'hold',
    offsetMs: 5_000,
    memo: new Map(),
    measure: approxMeasure,
    creative: () => null,
  } as unknown as GraphicProps;
}
const draw = (key: ThemeConfig['themeKey'], graphic: string, p: GraphicProps) => renderToStaticMarkup(createElement(() => THEMES[key]![graphic]!(p) as never));

describe('the tabs under the scorebug', () => {
  it('in every look: the added time, a sin bin and a send-off with their countdowns, and nothing when there are none', () => {
    for (const key of THEME_KEYS) {
      const plain = draw(key, 'scorebug', props(key, 'football', 'builtin:scorebug'));
      expect(plain, key).not.toContain('data-scorebug-tabs');
      const added = draw(key, 'scorebug', props(key, 'football', 'builtin:scorebug', { display: { addedMinutes: 4 } }));
      expect(added, key).toMatch(/data-tab="added"[^]*ADDED[^]*\+4/);
      const sinBin = draw(key, 'scorebug', props(key, 'rugby_league', 'builtin:scorebug', { display: { timers: [{ side: 'away', kind: 'sin_bin', count: 1, remainingMs: 382_000, remainingText: '6:22' }] } }));
      expect(sinBin, key).toMatch(/data-tab="sin_bin" data-side="away"[^]*BAY[^]*SIN BIN[^]*6:22/);
      const two = draw(key, 'scorebug', props(key, 'rugby_league', 'builtin:scorebug', { display: { timers: [{ side: 'home', kind: 'sin_bin', count: 2, remainingMs: 61_000, remainingText: '1:01' }] } }));
      expect(two, key).toContain('2× SIN BIN');
      const futsal = draw(key, 'scorebug', props(key, 'futsal', 'builtin:scorebug', { display: { timers: [{ side: 'home', kind: 'send_off', count: 1, remainingMs: 71_000, remainingText: '1:11' }] } }));
      expect(futsal, key).toMatch(/data-tab="send_off"[^]*SENT OFF[^]*1:11/);
    }
  });

  it('sit under the scorebug on its side: left, right or centred', () => {
    const at = (position: 'left' | 'right' | 'centre') => draw('broadcast', 'scorebug', props('broadcast', 'football', 'builtin:scorebug', { display: { addedMinutes: 2 }, theme: { scorebug: { ...DEFAULT_THEMES.broadcast.scorebug, position } } }));
    expect(at('left')).toMatch(/data-scorebug-tabs="true" style="position:absolute;top:calc\(100% \+ 8px\);left:0/);
    expect(at('right')).toMatch(/data-scorebug-tabs="true" style="position:absolute;top:calc\(100% \+ 8px\);right:0/);
    expect(at('centre')).toMatch(/data-scorebug-tabs="true" style="position:absolute;top:calc\(100% \+ 8px\);left:50%;transform:translateX\(-50%\)/);
  });
});

describe("the fourth official's board", () => {
  it('in every look: the minutes the scorer entered, or the ones set on the graphic', () => {
    for (const key of THEME_KEYS) {
      const fromScorer = draw(key, 'added_time', props(key, 'football', 'builtin:added_time', { projection: { stoppageMinutes: 4 } }));
      expect(fromScorer, key).toMatch(/ADDED TIME[^]*data-added-minutes="4"[^]*\+4[^]*4 minutes/);
      expect(draw(key, 'added_time', props(key, 'football', 'builtin:added_time', { projection: { stoppageMinutes: 4 }, variables: { minutes: 1 } })), key).toMatch(/\+1[^]*1 minute</);
    }
  });
});

describe('the video review graphic', () => {
  it('in every look: the team and "TRY?" while it is checked, then TRY in green or NO TRY in red', () => {
    for (const key of THEME_KEYS) {
      const at = (outcome: 'awarded' | 'denied' | null, subject = 'try') => draw(key, 'review', props(key, 'rugby_league', 'builtin:review', { projection: { review: { subject, side: 'away', outcome, sequence: 3 } }, variables: { outcome: 'auto' } }));
      const pending = at(null);
      expect(pending, key).toMatch(/data-review-state="pending"[^]*VIDEO REVIEW[^]*Bayside[^]*Checking[^]*TRY\?/);
      expect(at('awarded'), key).toMatch(/data-review-state="awarded"[^]*background:#2FBF71[^]*>TRY</);
      expect(at('denied'), key).toMatch(/data-review-state="denied"[^]*background:#E5484D[^]*>NO TRY</);
      expect(at('denied', 'captains_challenge'), key).toMatch(/CAPTAIN&#x27;S CHALLENGE[^]*UNSUCCESSFUL/);
    }
  });

  it('shows what the operator set by hand over the scorer; following the scorer with no review, nothing', () => {
    const live = { subject: 'try', side: 'away' as const, outcome: null, sequence: 3 };
    expect(draw('premier', 'review', props('premier', 'rugby_league', 'builtin:review', { projection: { review: live }, variables: { outcome: 'awarded', team: 'home' } }))).toMatch(/data-review-state="awarded"[^]*Harbour[^]*>TRY</);
    expect(draw('premier', 'review', props('premier', 'rugby_league', 'builtin:review', { variables: { outcome: 'pending' } }))).toMatch(/data-review-state="pending"[^]*Harbour[^]*TRY\?/);
    expect(draw('premier', 'review', props('premier', 'rugby_league', 'builtin:review', { variables: { outcome: 'auto' } }))).toBe('');
  });
});
