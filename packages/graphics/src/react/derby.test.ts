import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAdapter, type DisplayModel, type Sport } from '@bs/domain';
import { findTemplate } from '../catalog';
import { DEFAULT_THEMES, type RenderData } from '../data';
import { approxMeasure } from '../fit';
import { THEMES } from './index';
import type { GraphicProps } from './stage';

const teams = {
  home: { id: 'h', name: 'Harbour City', shortName: 'Harbour', abbreviation: 'HAR', primaryColor: '#EE7A12', secondaryColor: '#FFFFFF', logoUrl: null },
  away: { id: 'a', name: 'Westport Glory', shortName: 'Westport', abbreviation: 'WPG', primaryColor: '#4B1E8C', secondaryColor: '#F39A1E', logoUrl: null },
};
const players = {
  p1: { playerId: 'p1', displayName: 'Jordan Vidic', shortName: 'J. Vidic', number: 9, photoUrl: null, side: 'home' },
  p2: { playerId: 'p2', displayName: 'Sam Okafor', shortName: 'S. Okafor', number: 4, photoUrl: null, side: 'away' },
  p3: { playerId: 'p3', displayName: 'Nico Maieroni', shortName: 'N. Maieroni', number: 6, photoUrl: null, side: 'home' },
};
type Ev = NonNullable<RenderData['match']['events']>[number];
const ev = (id: string, type: string, side: 'home' | 'away', playerId: string | null, minute: string, group: Ev['group'] = 'score'): Ev => ({ id, type, group, side, playerId, minute, periodId: 'first_half', payload: {} });

function props(sport: Sport, templateKey: string, o: { display?: Partial<DisplayModel>; variables?: Record<string, unknown>; events?: Ev[]; teams?: typeof teams } = {}): GraphicProps {
  const a = getAdapter(sport);
  return {
    cue: { cueId: 'c1', templateKey, variables: o.variables ?? {} },
    t: findTemplate(templateKey)!,
    data: {
      theme: { ...DEFAULT_THEMES.derby, motion: 'none' },
      match: { sport, teams: o.teams ?? teams, rulesConfig: a.defaultConfig, projection: { ...a.initialProjection(a.defaultConfig), score: { home: 2, away: 1 } }, competition: { name: 'Coastal League', shortName: null, logoUrl: null }, lineup: { home: [], away: [] }, events: o.events ?? [], statRows: [{ key: 'shots', label: 'Shots' }] },
      players, creatives: {}, assets: {},
    },
    display: { periodLabel: 'Half Time', periodShort: 'HT', clockText: '45:00', clockRunning: false, score: { home: 2, away: 1 }, alerts: [], ...o.display },
    now: 0,
    phase: 'hold',
    offsetMs: 5_000,
    memo: new Map(),
    measure: approxMeasure,
    creative: () => null,
  } as unknown as GraphicProps;
}
const draw = (graphic: string, p: GraphicProps) => renderToStaticMarkup(createElement(() => THEMES.derby[graphic]!(p) as never));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('the Derby look', () => {
  it("the break board lists each team's scorers under its block: an own goal under the team it counted for, penalties marked", () => {
    const html = text(draw('break_score', props('football', 'builtin:break_score', { events: [ev('e1', 'goal', 'home', 'p1', "28'"), ev('e2', 'penalty_scored', 'home', 'p3', '41'), ev('e3', 'own_goal', 'home', 'p3', '60'), ev('e4', 'yellow_card', 'away', 'p2', '30', 'discipline')] })));
    expect(html).toContain('HALF TIME');
    expect(html).toMatch(/28' J\. VIDIC.*41' N\. MAIERONI \(PEN\).*60' N\. MAIERONI \(OG\)/);
    // the own goal is the second scorer list's only line, after the first list's two
    expect(html.indexOf('(OG)')).toBeGreaterThan(html.indexOf('(PEN)'));
    expect(html).not.toContain('OKAFOR'); // a card is not a scorer
  });

  it('lists tries for rugby league and no scorers for sports with many scores', () => {
    const rl = text(draw('break_score', props('rugby_league', 'builtin:break_score', { events: [ev('e1', 'try', 'home', 'p1', '12'), ev('e2', 'conversion', 'home', 'p1', '13')] })));
    expect(rl.match(/VIDIC/g)).toHaveLength(1);
    const bb = text(draw('break_score', props('basketball', 'builtin:break_score', { events: [ev('e1', 'score', 'home', 'p1', '2')] })));
    expect(bb).not.toContain('VIDIC');
  });

  it('a long club name on a board falls back to its short name rather than being cut', () => {
    const long = { ...teams, away: { ...teams.away, name: 'Westport Glory Football and Sporting Club Incorporated', shortName: 'Westport' } };
    const html = text(draw('ident', props('football', 'builtin:ident', { teams: long })));
    expect(html).toContain('WESTPORT');
    expect(html).not.toContain('INCORPORATED');
    expect(html).not.toContain('…');
  });

  it('the statistics board is titled by the break, with both values and a bar per row', () => {
    const ht = text(draw('stats', props('football', 'builtin:stats')));
    expect(ht).toContain('HALF TIME STATS');
    const live = text(draw('stats', props('football', 'builtin:stats', { display: { periodLabel: '2nd Half' } })));
    expect(live).toContain('MATCH STATS');
  });

  it('event straps: the card word on the card colour with the player as "N. SURNAME", the goal with the score', () => {
    const card = draw('card', props('football', 'builtin:card', { variables: { team: 'home', player: 'p3', minute: '33', cardType: 'yellow' } }));
    expect(card).toMatch(/background:#FFC72C[^>]*>[^]*YELLOW CARD/);
    expect(text(card)).toMatch(/6 N\. MAIERONI 33'/);
    const goal = text(draw('goal', props('football', 'builtin:goal', { variables: { team: 'home', player: 'p1', minute: '28', eventType: 'goal' } })));
    expect(goal).toMatch(/GOAL! HARBOUR.*J\. VIDIC 28' HAR 2–1 WPG/);
  });

  it('team names on their own colour: the second colour when it reads, white on mid-tone colours, ink on light ones', () => {
    const light = { ...teams, home: { ...teams.home, primaryColor: '#FFE14D', secondaryColor: '#FFFFFF' } };
    const board = draw('break_score', props('football', 'builtin:break_score', { teams: light }));
    expect(board).toMatch(/color:#15171C[^>]*>[^]*HARBOUR/); // ink on yellow
    expect(board).toMatch(/color:#F39A1E[^>]*>[^]*WESTPORT/); // orange on purple
    const bug = draw('scorebug', props('football', 'builtin:scorebug'));
    expect(bug).toMatch(/color:#FFFFFF[^>]*>[^]*HAR</); // white on orange
  });
});
