import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { REPLAY_TRANSITION, findTemplate } from '../catalog';
import { DEFAULT_THEMES, type ThemeConfig } from '../data';
import { approxMeasure } from '../fit';
import { ReplayTransition } from './replay';
import { partAnim, type AnimMemo, type GraphicProps } from './stage';

const replay = findTemplate('builtin:replay')!;
const teams = {
  home: { id: 'h', name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HAR', primaryColor: '#1F6FEB', secondaryColor: '#FFFFFF', logoUrl: null },
  away: { id: 'a', name: 'Bayside United', shortName: 'Bayside', abbreviation: 'BAY', primaryColor: '#E5484D', secondaryColor: '#FFFFFF', logoUrl: null },
};
const props = (theme: ThemeConfig, over: { phase?: 'in' | 'hold' | 'out'; offsetMs?: number; variables?: Record<string, unknown> } = {}, memo: AnimMemo = new Map()): GraphicProps =>
  ({
    cue: { cueId: 'r1', templateKey: 'builtin:replay', variables: over.variables ?? {} },
    t: replay,
    data: { theme, match: { teams, competition: { name: 'Coastal League', shortName: null, logoUrl: null } } },
    phase: over.phase ?? 'in',
    offsetMs: over.offsetMs ?? 0,
    now: 0,
    memo,
    measure: approxMeasure,
  }) as unknown as GraphicProps;
const html = (p: GraphicProps) => renderToStaticMarkup(createElement(() => ReplayTransition(p) as never));
const lower = (p: GraphicProps) => html(p).toLowerCase();

describe('replay transition', () => {
  it('is a full-frame transition whose timeline matches the exported stinger', () => {
    expect(replay).toMatchObject({ layer: 'transition', bounds: { x: 0, y: 0, w: 1, h: 1 } });
    // the cue goes out at holdMs (from the start), and is gone after the exit
    expect(replay.holdMs! + replay.exitMs).toBe(REPLAY_TRANSITION.totalMs);
    expect(REPLAY_TRANSITION.coveredFromMs).toBe(replay.entranceMs);
    expect(REPLAY_TRANSITION.transitionPointMs).toBeGreaterThan(REPLAY_TRANSITION.coveredFromMs);
    expect(REPLAY_TRANSITION.transitionPointMs).toBeLessThan(Math.min(REPLAY_TRANSITION.coveredUntilMs, replay.holdMs!));
  });

  it('draws in every look, plain (the look\'s colours and REPLAY) and with the teams (crests, names, their colours)', () => {
    for (const theme of Object.values(DEFAULT_THEMES)) {
      const plain = html(props(theme, { phase: 'hold', offsetMs: 800 }));
      expect(plain, theme.themeKey).toContain('REPLAY');
      expect(plain).not.toContain('Harbour');
      expect(plain.toLowerCase()).toContain(theme.secondary.toLowerCase());
      const both = lower(props(theme, { phase: 'hold', offsetMs: 800, variables: { teams: true } }));
      expect(both).toContain('harbour');
      expect(both).toContain('bayside');
      expect(both).toContain('#1f6feb');
      expect(both).toContain('#e5484d');
      // own words
      expect(html(props(theme, { phase: 'hold', offsetMs: 800, variables: { text: 'Instant replay' } }))).toContain('Instant replay');
    }
  });

  it('every band is in place by the end of the entrance and gone by the end of the exit', () => {
    const theme = DEFAULT_THEMES.premier;
    const delays = (p: GraphicProps) => [...html(p).matchAll(/animation-name:bs-sweep-(?:in|out);animation-duration:(\d+)ms;animation-delay:(-?\d+)ms/g)].map((m) => Number(m[2]) + Number(m[1]));
    const inEnds = delays(props(theme, { phase: 'in', offsetMs: 0 }));
    expect(inEnds.length).toBe(5);
    expect(Math.max(...inEnds)).toBeLessThanOrEqual(replay.entranceMs);
    const outEnds = delays(props(theme, { phase: 'out', offsetMs: 0 }));
    expect(outEnds.length).toBe(5);
    expect(Math.max(...outEnds)).toBeLessThanOrEqual(replay.exitMs);
    expect(Math.min(...outEnds.map((e, i) => e - [460, 460, 460, 460, 460][i]!))).toBeGreaterThanOrEqual(60); // nothing moves for the first 60 ms of the exit
    // at the transition point (hold), the bands rest in place: no animation at all
    expect(delays(props(theme, { phase: 'hold', offsetMs: REPLAY_TRANSITION.transitionPointMs }))).toEqual([]);
  });
});

describe('part animations', () => {
  const p = (over: Partial<GraphicProps>, memo?: AnimMemo) => ({ cue: { cueId: 'c' }, t: { entranceMs: 600, exitMs: 500 }, data: { theme: { motion: 'full' } }, phase: 'in', offsetMs: 0, memo, ...over }) as unknown as GraphicProps;
  it('stagger the exit too, keep their delay fixed from the first render, and rest once in', () => {
    const memo: AnimMemo = new Map();
    expect(partAnim(p({ offsetMs: 100 }, memo), 'sweep', 40, 400)).toMatchObject({ animationName: 'bs-sweep-in', animationDuration: '400ms', animationDelay: '-60ms' });
    expect(partAnim(p({ offsetMs: 300 }, memo), 'sweep', 40, 400).animationDelay).toBe('-60ms');
    expect(partAnim(p({ offsetMs: 440, phase: 'hold' }, memo), 'sweep', 40, 400)).toEqual({});
    const out = partAnim(p({ phase: 'out', offsetMs: 0 }, memo), 'sweep', 40, 400, 90, 300);
    expect(out).toMatchObject({ animationName: 'bs-sweep-out', animationDuration: '300ms', animationDelay: '90ms' });
    // out stays applied after it ends (the part stays gone)
    expect(partAnim(p({ phase: 'out', offsetMs: 480 }), 'sweep', 40, 400, 90, 300).animationName).toBe('bs-sweep-out');
    expect(partAnim(p({ data: { theme: { motion: 'none' } } as never }), 'sweep', 0, 400)).toEqual({});
  });
});
