import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAdapter, type DisplayModel, type Sport } from '@bs/domain';
import { findTemplate } from '../catalog';
import { DEFAULT_THEMES, type RenderData, type ThemeConfig } from '../data';
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

function props(sport: Sport, templateKey: string, o: { display?: Partial<DisplayModel>; variables?: Record<string, unknown>; events?: Ev[]; teams?: typeof teams; projection?: Record<string, unknown>; layers?: GraphicProps['layers']; theme?: Partial<ThemeConfig> } = {}): GraphicProps {
  const a = getAdapter(sport);
  return {
    cue: { cueId: 'c1', templateKey, variables: o.variables ?? {} },
    t: findTemplate(templateKey)!,
    data: {
      theme: { ...DEFAULT_THEMES.derby, motion: 'none', ...o.theme },
      match: { sport, teams: o.teams ?? teams, rulesConfig: a.defaultConfig, projection: { ...a.initialProjection(a.defaultConfig), score: { home: 2, away: 1 }, ...o.projection }, competition: { name: 'Coastal League', shortName: null, logoUrl: null }, lineup: { home: [], away: [] }, events: o.events ?? [], statRows: [{ key: 'shots', label: 'Shots' }] },
      players, creatives: {}, assets: {},
    },
    display: { periodLabel: 'Half Time', periodShort: 'HT', clockText: '45:00', clockRunning: false, score: { home: 2, away: 1 }, alerts: [], ...o.display },
    now: 0,
    phase: 'hold',
    offsetMs: 5_000,
    memo: new Map(),
    measure: approxMeasure,
    creative: () => null,
    layers: o.layers,
  } as unknown as GraphicProps;
}
const draw = (graphic: string, p: GraphicProps) => renderToStaticMarkup(createElement(() => THEMES.derby[graphic]!(p) as never));
/** The markup of the event drawn in the scorebug. */
const eventPart = (html: string) => html.slice(html.indexOf('>', html.indexOf('data-scorebug-event')) + 1);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** A cue on air on the event or scoreboard layer, where it is in its own timeline. */
const onAir = (templateKey: string, variables: Record<string, unknown>, phase: 'in' | 'hold' | 'out', offsetMs: number) => ({ cue: { cueId: `on-${templateKey}`, templateKey, layer: 'event', variables, startedAt: 0, durationMs: 6000, source: 'automation' }, t: findTemplate(templateKey)!, phase, offsetMs }) as never;
const bugOn = onAir('builtin:scorebug', {}, 'hold', 60_000);
const yellow = { team: 'home', player: 'p3', minute: '33', cardType: 'yellow' };

describe('the Derby look', () => {
  it('a goal is the scorebug itself: the scoring team takes over the bar, the clock stays; the scorer follows', () => {
    const goal = { team: 'home', player: 'p1', minute: '28', eventType: 'goal' };
    const at = (phase: 'in' | 'hold' | 'out', offsetMs: number, motion: 'none' | 'full' = 'none') => draw('scorebug', props('football', 'builtin:scorebug', { display: { periodLabel: '1st Half', periodShort: '1H', clockText: '27:52' }, theme: { motion }, layers: { scoreboard: bugOn, event: onAir('builtin:goal', goal, phase, offsetMs) } }));
    const hold = at('hold', 2000);
    expect(text(eventPart(hold))).toMatch(/^ GOOOOAL! HARBOUR /);
    // under it the score, both teams and their crests are out of sight; the clock stays where it is
    const body = hold.slice(0, hold.indexOf('data-scorebug-event'));
    expect(body.match(/visibility:hidden/g)).toHaveLength(5);
    expect(body).toMatch(/grid-column:2;grid-row:2;(?![^"]*visibility)[^"]*"[^]*1H[^]*27:52/);
    // while it comes across the score shows through (the new score first), and again as it goes back
    expect(at('in', 300, 'full')).not.toContain('visibility:hidden');
    expect(at('out', 100, 'full')).not.toContain('visibility:hidden');
    // later on, the scorer in the bar
    expect(text(eventPart(at('hold', 4000)))).toMatch(/^ J\. VIDIC 28' /);
    // the event's own graphic draws nothing while the scorebug is up; other events (the added-time board) keep theirs
    expect(draw('goal', props('football', 'builtin:goal', { variables: goal, layers: { scoreboard: bugOn, event: onAir('builtin:goal', goal, 'hold', 2000) } }))).toBe('');
    expect(draw('scorebug', props('football', 'builtin:scorebug', { layers: { scoreboard: bugOn, event: onAir('builtin:added_time', {}, 'hold', 2000) } }))).not.toContain('data-scorebug-event');
    expect(draw('scorebug', props('football', 'builtin:scorebug', { layers: { scoreboard: bugOn } }))).not.toContain('data-scorebug-event');
  });

  it("a card or substitution keeps the team's block and runs across the rest of the scorebug, the player underneath", () => {
    const hold = draw('scorebug', props('football', 'builtin:scorebug', { layers: { scoreboard: bugOn, event: onAir('builtin:card', yellow, 'hold', 2000) } }));
    expect(text(eventPart(hold))).toMatch(/^ HAR YELLOW CARD HAR 6 N\. MAIERONI $/);
    const body = hold.slice(0, hold.indexOf('data-scorebug-event'));
    // the team's own block (letters and crest) stays; the score and the other team go under the card
    expect(body.slice(0, body.indexOf('>HAR</span></span>'))).not.toContain('visibility:hidden');
    expect(body.match(/visibility:hidden/g)).toHaveLength(3);
    const sub = text(eventPart(draw('scorebug', props('football', 'builtin:scorebug', { layers: { scoreboard: bugOn, event: onAir('builtin:substitution', { team: 'away', playerIn: 'p2', playerOut: null }, 'hold', 2000) } }))));
    expect(sub).toMatch(/^ WPG SUBSTITUTION WPG ▲ 4 S\. OKAFOR ▼ WESTPORT GLORY $/);
  });

  it('with the scorebug off, the event stands alone in its place at the top', () => {
    const html = draw('card', props('football', 'builtin:card', { variables: yellow, layers: {} }));
    expect(html).toMatch(/^<div style="top:[0-9.]+px;font-family:[^"]*;position:absolute;left:[0-9.]+px" data-graphic="card">/);
    expect(text(html)).toMatch(/HAR YELLOW CARD HAR 6 N\. MAIERONI/);
  });

  it('the clock says HALF TIME at the break (the walk-out too) and FULL TIME after the match', () => {
    const at = (phase: string, breakPhase: string | null = null) => text(draw('scorebug', props('football', 'builtin:scorebug', { display: { clockText: '45:00' }, projection: { phase, breakPhase } })));
    expect(at('half_time', 'half_time')).toContain('HALF TIME');
    expect(at('half_time', 'half_time')).not.toContain('45:00');
    expect(at('second_half_entering', 'half_time')).toContain('HALF TIME');
    expect(at('full_time')).toContain('FULL TIME');
    expect(at('first_half')).toContain('45:00');
  });

  it('the half-time board is the kick-off banner headed by the break, the competition under the score', () => {
    const board = text(draw('break_score', props('football', 'builtin:break_score')));
    expect(board).toMatch(/HALF TIME .*HARBOUR .*2 1 .*WESTPORT .*Coastal League/);
    // the flow's half-time banner (the kick-off banner headed by the phase) reads the same
    expect(text(draw('period_banner', props('football', 'builtin:period_banner', { variables: { heading: 'Half Time' } })))).toBe(board);
    expect(text(draw('period_banner', props('football', 'builtin:period_banner', { variables: { heading: 'KICK-OFF' }, display: { periodLabel: '1st Half' } })))).toMatch(/KICK-OFF .*1st Half/);
  });

  it("the statistics board lists each team's scorers: an own goal under the team it counted for, penalties marked", () => {
    const html = text(draw('stats', props('football', 'builtin:stats', { events: [ev('e1', 'goal', 'home', 'p1', "28'"), ev('e2', 'penalty_scored', 'home', 'p3', '41'), ev('e3', 'own_goal', 'home', 'p3', '60'), ev('e4', 'yellow_card', 'away', 'p2', '30', 'discipline')] })));
    expect(html).toMatch(/28' J\. VIDIC.*41' N\. MAIERONI \(PEN\).*60' N\. MAIERONI \(OG\)/);
    expect(html).not.toContain('OKAFOR'); // a card is not a scorer
    const rl = text(draw('stats', props('rugby_league', 'builtin:stats', { events: [ev('e1', 'try', 'home', 'p1', '12'), ev('e2', 'conversion', 'home', 'p1', '13')] })));
    expect(rl.match(/VIDIC/g)).toHaveLength(1);
    const bb = text(draw('stats', props('basketball', 'builtin:stats', { events: [ev('e1', 'score', 'home', 'p1', '2')] })));
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

  it('team names on their own colour: the second colour when it reads, white on mid-tone colours, ink on light ones', () => {
    const light = { ...teams, home: { ...teams.home, primaryColor: '#FFE14D', secondaryColor: '#FFFFFF' } };
    const board = draw('break_score', props('football', 'builtin:break_score', { teams: light }));
    expect(board).toMatch(/color:#15171C[^>]*>[^]*HARBOUR/); // ink on yellow
    expect(board).toMatch(/color:#F39A1E[^>]*>[^]*WESTPORT/); // orange on purple
    const bug = draw('scorebug', props('football', 'builtin:scorebug'));
    expect(bug).toMatch(/color:#FFFFFF[^>]*>[^]*HAR</); // white on orange
  });
});
