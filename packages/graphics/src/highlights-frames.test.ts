import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getAdapter, highlightOptionsDefaults, planHighlights, type StoredFact } from '@bs/domain';
import { DEFAULT_THEMES, type RenderData } from './data';
import { FRAME_MS, ORIGIN, highlightFrames, stingerFrame, stingerMs } from './highlights-frames';
import { Renderer, THEMES } from './react';

const MIN = 60_000;
const T0 = 1_800_000_000_000;
let seq = 0;
const fact = (o: Partial<StoredFact> & { type: string; at: number }): StoredFact => {
  seq += 1;
  const { at, ...rest } = o;
  return { id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, sequence: seq, category: 'event', side: null, playerId: null, payload: {}, periodId: 'first_half', clockMs: null, revision: 1, occurredAt: at, ...rest } as StoredFact;
};
const phase = (from: string, to: string, at: number, clockMs: number) => fact({ type: 'phase', category: 'phase', payload: { from, to }, periodId: from, at, clockMs });

function setup() {
  seq = 0;
  const facts = [
    phase('pre_match', 'first_half', T0, 0),
    fact({ type: 'goal', side: 'home', at: T0 + 10 * MIN, clockMs: 10 * MIN }),
    phase('first_half', 'half_time', T0 + 46 * MIN, 46 * MIN),
    phase('half_time', 'second_half', T0 + 60 * MIN, 45 * MIN),
    phase('second_half', 'full_time', T0 + 107 * MIN, 92 * MIN),
  ];
  const a = getAdapter('football');
  const plan = planHighlights({ adapter: a, cfg: a.defaultConfig, facts, video: { durationMs: 112 * MIN, anchors: { first_half: 2 * MIN } }, options: { ...highlightOptionsDefaults } });
  const teams = {
    home: { id: 'h', name: 'Harbour City', shortName: 'Harbour', abbreviation: 'HAR', primaryColor: '#1F6FEB', secondaryColor: '#FFFFFF', logoUrl: null },
    away: { id: 'a', name: 'Bayside United', shortName: 'Bayside', abbreviation: 'BAY', primaryColor: '#E5484D', secondaryColor: '#FFFFFF', logoUrl: null },
  };
  const data = { theme: DEFAULT_THEMES.broadcast, match: { sport: 'football', teams, rulesConfig: a.defaultConfig, projection: a.initialProjection(a.defaultConfig), clocks: a.initialClocks(a.defaultConfig), competition: { name: 'Coastal League', shortName: null, logoUrl: null }, lineup: { home: [], away: [] }, events: [] }, players: {}, creatives: {}, assets: {} } as unknown as RenderData;
  return { plan, frame: highlightFrames({ plan, facts, overrides: {}, data }), data };
}

describe('the graphics of a highlights package, frame by frame', () => {
  it('the title panel first, then the scorebug with the score and clock the picture shows', () => {
    const { plan, frame } = setup();
    expect(Object.keys(frame(0).state.layers)).toEqual(['fullframe']);
    const clip = plan.segments[0]!;
    const atGoal = clip.outFromMs + 20_000; // the goal was recorded 20 s into the clip
    const before = frame(atGoal - 1_000);
    expect(before.state.layers.scoreboard?.templateKey).toBe('builtin:scorebug');
    expect(before.data.match.projection.score).toEqual({ home: 0, away: 0 });
    // the clock reads the match time of the picture: 9:59 a second before the goal at 10:00
    expect(before.data.match.clocks.main!.baseMs).toBe(10 * MIN - 1_000);
    expect(frame(atGoal + 1_000).data.match.projection.score).toEqual({ home: 1, away: 0 });
    // in the replay the picture is from before the goal, but the match is as it stands after it: the strap reads the
    // new score, and the scorebug is off
    const replay = plan.segments[1]!;
    const inReplay = frame(replay.outFromMs + 2_000);
    expect(inReplay.data.match.projection.score).toEqual({ home: 1, away: 0 });
    expect(inReplay.state.layers.scoreboard).toBeUndefined();
    expect(inReplay.state.layers.event?.templateKey).toBe('builtin:goal');
    expect(frame(replay.outToMs + 1_500).state.layers.scoreboard?.templateKey).toBe('builtin:scorebug');
  });

  it('a graphic comes in, holds and goes out at its time: a renderer sees no out time before then', () => {
    const { plan, frame } = setup();
    const bug = plan.cues.find((c) => c.id === 'scorebug')!;
    expect(frame(bug.fromMs + 3_000).state.layers.scoreboard).toMatchObject({ cueId: 'scorebug', outAt: null });
    expect(frame(bug.toMs! + FRAME_MS).state.layers.scoreboard).toMatchObject({ cueId: 'scorebug', outAt: ORIGIN + bug.toMs! });
  });

  it('drawn, a held scorebug shows its red card tab: nothing clips it', () => {
    seq = 0;
    const facts = [
      phase('pre_match', 'first_half', T0, 0),
      fact({ type: 'red_card', side: 'away', at: T0 + 10 * MIN, clockMs: 10 * MIN }),
      phase('first_half', 'full_time', T0 + 46 * MIN, 46 * MIN),
    ];
    const a = getAdapter('football');
    const plan = planHighlights({ adapter: a, cfg: a.defaultConfig, facts, video: { durationMs: 50 * MIN, anchors: { first_half: 2 * MIN } }, options: { ...highlightOptionsDefaults } });
    const { data } = setup();
    const frame = highlightFrames({ plan, facts, overrides: {}, data: { ...data, theme: { ...data.theme, motion: 'full' } } });
    const clip = plan.segments[0]!;
    const ms = clip.outToMs - 1_000;
    const f = frame(ms);
    const html = renderToStaticMarkup(createElement(Renderer, { still: true, state: f.state, data: f.data, themes: THEMES, serverNow: () => ORIGIN + ms }));
    expect(html).toContain('data-red-cards="away" data-count="1"');
    const box = /<div style="([^"]*)" data-graphic="scorebug"/.exec(html)![1]!;
    expect(box).not.toContain('clip-path');
  });

  it('frames change only when something on them can: a clock tick, a graphic coming in or going out', () => {
    const { plan, frame } = setup();
    const clip = plan.segments[0]!;
    const t = clip.outFromMs + 12_000;
    expect(frame(t).key).toBe(frame(t + FRAME_MS).key);
    expect(frame(t).key).not.toBe(frame(t + 1_000).key);
    let keys = 0;
    let last = '';
    let total = 0;
    for (let ms = 0; ms < plan.durationMs; ms += FRAME_MS) {
      total++;
      const k = frame(ms).key;
      if (k !== last) keys++;
      last = k;
    }
    expect(keys).toBeLessThan(total / 3);
  });

  it('the end board: the background and the match header, the scorebug gone; the replay transition on its own', () => {
    const { plan, frame, data } = setup();
    const end = plan.segments.at(-1)!;
    const f = frame(end.outFromMs + 2_000);
    expect(Object.keys(f.state.layers).sort()).toEqual(['background', 'fullframe']);
    expect(f.state.scorebugVisible).toBe(false);
    expect(f.data.match.projection.score).toEqual({ home: 1, away: 0 });
    expect(stingerMs()).toBe(2_000);
    expect(stingerFrame(data, 1_000).state.layers.transition?.templateKey).toBe('builtin:replay');
  });
});
