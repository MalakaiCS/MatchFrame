import { describe, expect, it } from 'vitest';
import { emptyState, reduceOverlay, pruneExpired, type OverlayCommand, type OverlayPublicState } from './state';
import { fitLabel } from './fit';
import { validateScene, emptyScene } from './scene';
import { resolveBinding } from './bindings';
import { DEFAULT_THEMES, type RenderData } from './data';
import { LAYER_Z } from './catalog';
import { footballAdapter } from '@bs/domain';

let n = 0;
const op = (s: OverlayPublicState, cmd: OverlayCommand, now = 1000, source: 'operator' | 'automation' = 'operator') => reduceOverlay(s, cmd, { now, source, cueId: `c${++n}` });

describe('overlay reducer', () => {
  it('takes in, updates and takes out with revisions', () => {
    let s = emptyState();
    s = op(s, { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'Coach Ana Silva', subtitle: 'Harbour City FC' } }).state;
    expect(s.revision).toBe(1);
    expect(s.layers.lower?.variables.heading).toBe('Coach Ana Silva');
    s = op(s, { type: 'UPDATE', layer: 'lower', variables: { subtitle: 'Head coach' } }).state;
    expect(s.layers.lower?.variables).toMatchObject({ heading: 'Coach Ana Silva', subtitle: 'Head coach' });
    s = op(s, { type: 'TAKE_OUT', layer: 'lower' }, 5000).state;
    expect(s.layers.lower?.outAt).toBe(5000);
    expect(pruneExpired(s, 6000).state.layers.lower).toBeUndefined();
    expect(s.revision).toBe(3);
  });

  it('validates variables and strips markup from plain text', () => {
    const s = emptyState();
    expect(() => op(s, { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: {} })).toThrow(/Heading is required/);
    expect(() => op(s, { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'x'.repeat(49) } })).toThrow(/48 characters/);
    const r = op(s, { type: 'TAKE_IN', templateKey: 'builtin:ticker', variables: { text: '<img src=x onerror=alert(1)> Final score' } });
    expect(r.state.layers.ticker?.variables.text).not.toMatch(/[<>]/);
  });

  it('full-frame graphics exclude small formats; small takes are refused under full-frame unless forced', () => {
    let s = op(emptyState(), { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'A' } }).state;
    const ff = op(s, { type: 'TAKE_IN', templateKey: 'builtin:stats', variables: {} });
    expect(ff.removed.map((c) => c.layer)).toContain('lower');
    s = ff.state;
    expect(() => op(s, { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'B' } })).toThrow(/LAYER|on air/);
    expect(op(s, { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'B' }, force: true }).state.layers.lower).toBeTruthy();
  });

  it('emergency clear removes everything including the scorebug and inhibits automation until resume (A27)', () => {
    let s = op(emptyState(), { type: 'SHOW_SCOREBUG' }).state;
    s = op(s, { type: 'TAKE_IN', templateKey: 'builtin:ticker', variables: { text: 'hello' } }).state;
    const c = op(s, { type: 'CLEAR_OUTPUT' });
    expect(c.cancelAutomation).toBe(true);
    s = c.state;
    expect(s).toMatchObject({ inhibited: true, scorebugVisible: false, layers: {} });
    expect(() => op(s, { type: 'SHOW_SCOREBUG' }, 2000, 'automation')).toThrow(/Emergency clear/);
    expect(() => op(s, { type: 'TAKE_IN', templateKey: 'builtin:goal', variables: { team: 'home' } }, 2000, 'automation')).toThrow(/Emergency clear/);
    expect(() => op(s, { type: 'RESUME' }, 2000, 'automation')).toThrow();
    s = op(s, { type: 'RESUME' }).state;
    expect(s.inhibited).toBe(false);
    expect(op(s, { type: 'SHOW_SCOREBUG' }, 3000, 'automation').state.scorebugVisible).toBe(true);
  });

  it('manual mode pauses automatic takes; returning to auto clears transient manual layers without replay (A26)', () => {
    const s = op(emptyState(), { type: 'SET_MODE', mode: 'manual' });
    expect(s.cancelAutomation).toBe(true);
    expect(() => op(s.state, { type: 'TAKE_IN', templateKey: 'builtin:goal', variables: { team: 'home' } }, 2000, 'automation')).toThrow(/Manual/);
    let st = op(s.state, { type: 'TAKE_IN', templateKey: 'builtin:goal', variables: { team: 'home' } }).state; // operator, 7 s hold
    st = op(st, { type: 'SHOW_SCOREBUG' }).state;
    const back = op(st, { type: 'SET_MODE', mode: 'auto' });
    expect(back.state.layers.event).toBeUndefined(); // transient manual graphic cleared
    expect(back.state.layers.scoreboard).toBeTruthy(); // scorebug stays
    expect(back.cancelAutomation).toBe(false);
  });

  it('automation cannot displace or remove an operator graphic', () => {
    const s = op(emptyState(), { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'Operator' } }).state;
    expect(() => op(s, { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'Auto' } }, 2000, 'automation')).toThrow(/operator/);
    expect(() => op(s, { type: 'TAKE_OUT', layer: 'lower' }, 2000, 'automation')).toThrow(/operator/);
  });

  it('expires timed cues after hold + exit', () => {
    const s = op(emptyState(), { type: 'TAKE_IN', templateKey: 'builtin:goal', variables: { team: 'away' } }, 0).state; // 7000 hold, 250 exit
    expect(pruneExpired(s, 7000).state.layers.event).toBeTruthy();
    expect(pruneExpired(s, 7300).state.layers.event).toBeUndefined();
  });
});

describe('long names (A21)', () => {
  it('uses short label, then shrinks, then truncates, never exceeding width', () => {
    expect(fitLabel({ full: 'Harbour City FC', maxWidth: 600, fontPx: 40, minFontPx: 24 }).step).toBe('full');
    const s = fitLabel({ full: 'Saltmarsh Rovers Football & Sporting Club', short: 'Saltmarsh', maxWidth: 300, fontPx: 40, minFontPx: 24 });
    expect(s).toMatchObject({ text: 'Saltmarsh', step: 'short' });
    const shrink = fitLabel({ full: 'Fitzgerald-Montgomery', maxWidth: 400, fontPx: 40, minFontPx: 20 });
    expect(shrink.step).toBe('shrink');
    expect(shrink.fontPx).toBeLessThan(40);
    const t = fitLabel({ full: 'Wolfeschlegelsteinhausenbergerdorff Ángel', maxWidth: 200, fontPx: 40, minFontPx: 24 });
    expect(t.step).toBe('truncate');
    expect(t.text.endsWith('…')).toBe(true);
    expect(t.fontPx).toBe(24);
  });
  it('keeps accented characters intact', () => {
    expect(fitLabel({ full: 'Léa Ångström Ó Briain', maxWidth: 900, fontPx: 40, minFontPx: 24 }).text).toBe('Léa Ångström Ó Briain');
  });
});

describe('designer scenes and bindings (A48 template code)', () => {
  it('accepts the starter scene and rejects unknown bindings and code-like values', () => {
    expect(validateScene(emptyScene()).ok).toBe(true);
    const bad = emptyScene();
    (bad.elements[1] as { text: unknown }).text = { binding: 'process.env.SECRET' };
    const r = validateScene(bad);
    expect(r.ok).toBe(false);
    const html = { ...emptyScene(), elements: [{ id: 'x', name: 'x', type: 'html', x: 0, y: 0, w: 10, h: 10, html: '<script>alert(1)</script>' }] };
    expect(validateScene(html).ok).toBe(false);
    const css = { ...emptyScene(), elements: [{ id: 'r', name: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'url(https://evil.example/x.png)' }] };
    expect(validateScene(css).ok).toBe(false);
    const fmt = emptyScene();
    (fmt.elements[1] as { text: unknown }).text = { binding: 'match.score.home', transforms: [{ type: 'format', template: '{value}{constructor}' }] };
    expect(validateScene(fmt).ok).toBe(false);
  });

  it('resolves bindings with transforms and fallbacks', () => {
    const cfg = footballAdapter.defaultConfig;
    const data = {
      match: {
        id: 'm', sport: 'football', rulesConfig: cfg, competition: { name: 'CPL', shortName: null, logoUrl: null }, venue: null, scheduledAt: '', timezone: 'UTC',
        teams: { home: { id: 'h', name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', primaryColor: '#000000', secondaryColor: '#ffffff', logoUrl: null }, away: { id: 'a', name: 'Ridgeback', shortName: 'Ridge', abbreviation: 'RBU', primaryColor: '#000000', secondaryColor: '#ffffff', logoUrl: null } },
        lineup: { home: [], away: [] }, projection: { ...footballAdapter.initialProjection(cfg), score: { home: 2, away: 1 } }, clocks: footballAdapter.initialClocks(cfg), stateVersion: 1, statRows: [],
      },
      players: {}, assets: {}, creatives: {}, theme: DEFAULT_THEMES.broadcast, customTemplates: [],
    } as unknown as RenderData;
    expect(resolveBinding({ binding: 'match.homeTeam.shortName', transforms: [{ type: 'uppercase' }] }, { data, variables: {}, now: 0 })).toBe('HARBOUR');
    expect(resolveBinding({ binding: 'match.score.home', transforms: [{ type: 'format', template: '{value} goals' }] }, { data, variables: {}, now: 0 })).toBe('2 goals');
    expect(resolveBinding({ binding: 'variables.heading', fallback: 'HOME' }, { data, variables: {}, now: 0 })).toBe('HOME');
  });
});

describe('pre-match, break and full-time layering', () => {
  it('the animated background and match header sit above every in-play graphic, and only the stinger goes over them', () => {
    let s = emptyState();
    s = op(s, { type: 'SHOW_SCOREBUG' }).state;
    s = op(s, { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'Coach Ana Silva' } }).state;
    s = op(s, { type: 'TAKE_IN', templateKey: 'builtin:backdrop', variables: {} }, 2000, 'automation').state;
    expect(s.layers.background?.templateKey).toBe('builtin:backdrop');
    expect(s.layers.lower).toBeUndefined(); // small graphics clear under the background
    expect(s.scorebugVisible).toBe(true); // the scorebug is taken off by its own cue, and draws below the background meanwhile
    s = op(s, { type: 'TAKE_IN', templateKey: 'builtin:ident', variables: { showCountdown: true } }, 2600, 'automation').state;
    expect(s.layers.background?.outAt ?? null).toBeNull(); // the header sits on the background, it does not replace it
    s = op(s, { type: 'TAKE_IN', templateKey: 'builtin:stinger', variables: {} }, 3000).state;
    expect(s.layers.fullframe?.templateKey).toBe('builtin:ident'); // the stinger plays over the header without taking it off
    expect(s.layers.fullframe?.outAt ?? null).toBeNull();
    // the holding slate shares the background layer but, unlike the animated background, takes any board off
    s = op(s, { type: 'TAKE_IN', templateKey: 'builtin:slate', variables: { message: 'interval' } }, 4000).state;
    expect(s.layers.background?.templateKey).toBe('builtin:slate');
    expect(s.layers.fullframe).toBeUndefined();
    const order = (['scoreboard', 'event', 'lower', 'ticker', 'sponsor', 'background', 'fullframe', 'transition'] as const).map((l) => LAYER_Z[l]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
