import { describe, expect, it } from 'vitest';
import { getAdapter, type StoredFact } from './engine';
import { HIGHLIGHT_TIMING as T, highlightOptionsDefaults, pictureAt, planHighlights, segmentAt, videoAt, periodStarts, type HighlightOptions } from './highlights';
import type { Sport } from './types';

const MIN = 60_000;
const T0 = 1_800_000_000_000; // kick-off, server ms
let seq = 0;
const fact = (o: Partial<StoredFact> & { type: string; at: number }): StoredFact => {
  seq += 1;
  const { at, ...rest } = o;
  return { id: `f${seq}`, sequence: seq, category: 'event', side: null, playerId: null, payload: {}, periodId: 'first_half', clockMs: null, revision: 1, occurredAt: at, ...rest } as StoredFact;
};
const phase = (from: string, to: string, at: number, clockMs: number | null = null) => fact({ type: 'phase', category: 'phase', payload: { from, to }, periodId: from, at, clockMs });

/** A football match: kick-off at T0, a home goal at 10', chances, an away red card at 30', the second half from T0 + 60 min. */
function footballLog() {
  seq = 0;
  return [
    phase('pre_match', 'first_half', T0, 0),
    fact({ type: 'goal', side: 'home', playerId: 'p9', at: T0 + 10 * MIN, clockMs: 10 * MIN }),
    fact({ type: 'shot_on_target', side: 'away', at: T0 + 20 * MIN, clockMs: 20 * MIN }),
    fact({ type: 'save', side: 'home', at: T0 + 25 * MIN, clockMs: 25 * MIN }),
    fact({ type: 'red_card', side: 'away', playerId: 'p4', at: T0 + 30 * MIN, clockMs: 30 * MIN }),
    fact({ type: 'corner', side: 'home', at: T0 + 33 * MIN, clockMs: 33 * MIN }),
    fact({ type: 'possession_change', side: 'home', at: T0 + 34 * MIN, clockMs: 34 * MIN }),
    phase('first_half', 'half_time', T0 + 46 * MIN, 46 * MIN),
    phase('half_time', 'second_half', T0 + 60 * MIN, 45 * MIN),
    fact({ type: 'goal', side: 'away', periodId: 'second_half', at: T0 + 75 * MIN, clockMs: 60 * MIN }),
    phase('second_half', 'full_time', T0 + 107 * MIN, 92 * MIN),
  ];
}
const plan = (facts: StoredFact[], o: Partial<HighlightOptions> = {}, anchors: Record<string, number> = { first_half: 2 * MIN }, sport: Sport = 'football') => {
  const a = getAdapter(sport);
  return planHighlights({ adapter: a, cfg: a.defaultConfig, facts, video: { durationMs: 112 * MIN, anchors }, options: { ...highlightOptionsDefaults, ...o } });
};

describe('highlights: where the match is in the video', () => {
  it('one kick-off mark places the whole recording; a mark per half when it was stopped at half time', () => {
    const facts = footballLog();
    const a = getAdapter('football');
    const starts = periodStarts(a, a.defaultConfig, facts);
    expect(starts.map((s) => s.periodId)).toEqual(['first_half', 'second_half']);
    expect(videoAt(starts, { durationMs: 112 * MIN, anchors: { first_half: 2 * MIN } }, T0 + 75 * MIN)).toBe(77 * MIN);
    // a second recording file for the second half: its own kick-off mark
    expect(videoAt(starts, { durationMs: 112 * MIN, anchors: { first_half: 2 * MIN, second_half: 50 * MIN } }, T0 + 75 * MIN)).toBe(65 * MIN);
    // before the video starts, or past its end: not in it
    expect(videoAt(starts, { durationMs: 112 * MIN, anchors: { first_half: 2 * MIN } }, T0 - 3 * MIN)).toBeNull();
    expect(videoAt(starts, { durationMs: 20 * MIN, anchors: { first_half: 2 * MIN } }, T0 + 30 * MIN)).toBeNull();
  });
});

describe('highlights: the package', () => {
  it('goals and the red card always, chances to the length, in match order; corners and possession not', () => {
    const p = plan(footballLog());
    const inIt = p.moments.filter((m) => m.included).map((m) => m.type);
    expect(inIt).toEqual(['goal', 'shot_on_target', 'save', 'red_card', 'goal']);
    expect(p.moments.find((m) => m.type === 'corner')).toMatchObject({ included: false, reason: 'Not chosen' });
    expect(p.moments.some((m) => m.type === 'possession_change')).toBe(false);
    expect(p.moments[0]).toMatchObject({ videoMs: 12 * MIN, minute: 11, side: 'home', replay: true });
  });

  it('each goal: its clip, then a slow-motion replay cut in under the replay transition with the goal strap on it', () => {
    const p = plan(footballLog());
    expect(p.segments.map((s) => s.kind)).toEqual(['clip', 'replay', 'clip', 'clip', 'clip', 'clip', 'replay', 'full_time', 'end_card']);
    const [clip, replay] = p.segments;
    expect(clip).toMatchObject({ videoFromMs: 12 * MIN - 20_000, videoToMs: 12 * MIN + 8_000, speed: 1, join: 'none', outFromMs: 0 });
    expect(replay).toMatchObject({ videoFromMs: 12 * MIN - T.replayFrom, videoToMs: 12 * MIN - T.replayTo, speed: 0.75, join: 'cut' });
    expect(replay!.outToMs - replay!.outFromMs).toBe(Math.round(7_000 / 0.75));
    const stinger = p.cues.find((c) => c.templateKey === 'builtin:replay')!;
    expect(stinger.fromMs).toBe(replay!.outFromMs - T.stingerCutMs);
    const strap = p.cues.find((c) => c.id === `strap-${replay!.factIds[0]}`)!;
    expect(strap).toMatchObject({ templateKey: 'builtin:goal', variables: { team: 'home', player: 'p9', eventType: 'goal', minute: '11' } });
    expect(strap.fromMs).toBeGreaterThan(replay!.outFromMs);
    expect(strap.toMs).toBeLessThan(replay!.outToMs);
  });

  it('the red card strap with its clip, the final score at the whistle, the end board, the title panel and the scorebug', () => {
    const p = plan(footballLog());
    const red = p.cues.find((c) => c.templateKey === 'builtin:card')!;
    expect(red.variables).toMatchObject({ team: 'away', player: 'p4', cardType: 'red' });
    const ft = p.segments.find((s) => s.kind === 'full_time')!;
    expect(ft).toMatchObject({ videoFromMs: 109 * MIN - T.fullTimeLead, videoToMs: 109 * MIN + T.fullTimeAfter, atFrom: T0 + 107 * MIN - T.fullTimeLead });
    expect(p.cues.find((c) => c.id === 'full-time')).toMatchObject({ templateKey: 'builtin:break_score', variables: { label: 'FULL TIME' }, toMs: ft.outToMs - 100 });
    const end = p.segments.at(-1)!;
    expect(end).toMatchObject({ kind: 'end_card', join: 'crossfade', joinMs: 500, outToMs: p.durationMs });
    expect(p.cues.filter((c) => c.fromMs >= end.outFromMs).map((c) => c.templateKey)).toEqual(['builtin:backdrop', 'builtin:ident']);
    expect(p.cues.find((c) => c.id === 'intro')).toMatchObject({ templateKey: 'builtin:highlights_intro', fromMs: 0, toMs: T.introMs });
    // the scorebug: on over the clips, off for each replay (out behind its transition) and under the full-time board
    const bugs = p.cues.filter((c) => c.templateKey === 'builtin:scorebug');
    const replays = p.segments.filter((s) => s.kind === 'replay');
    expect(bugs[0]).toMatchObject({ id: 'scorebug', fromMs: T.introMs - 200, toMs: replays[0]!.outFromMs - 300, variables: { showSponsor: false } });
    expect(bugs.map((c) => [c.fromMs, c.toMs])).toEqual([
      [T.introMs - 200, replays[0]!.outFromMs - 300],
      [replays[0]!.outToMs + 200, replays[1]!.outFromMs - 300],
      [replays[1]!.outToMs + 200, ft.outToMs - T.fullTimeBoardMs],
    ]);
    const stinger = p.cues.find((c) => c.templateKey === 'builtin:replay')!;
    // it goes out while the transition covers the picture
    expect(bugs[0]!.toMs!).toBeGreaterThan(stinger.fromMs);
    expect(bugs[0]!.toMs!).toBeLessThan(stinger.fromMs + stinger.holdMs!);
  });

  it('segments follow one another, overlapping by their join; the picture and its clock at any point', () => {
    const p = plan(footballLog());
    for (let i = 1; i < p.segments.length; i++) expect(p.segments[i]!.outFromMs).toBe(Math.round(Math.max(0, p.segments[i - 1]!.outToMs - p.segments[i]!.joinMs)));
    const replay = p.segments[1]!;
    // 4 s into the slowed replay shows 3 s of match time
    expect(pictureAt(replay, replay.outFromMs + 4_000)).toBe(T0 + 10 * MIN - T.replayFrom + 3_000);
    expect(segmentAt(p, replay.outFromMs + 1_000)?.id).toBe(replay.id);
    expect(segmentAt(p, 0)?.id).toBe('clip-1');
    // the second-half goal's clip: its clock reference is the goal's own reading
    const late = p.segments.find((s) => s.kind === 'clip' && s.videoFromMs > 70 * MIN)!;
    expect(late.clock).toEqual({ periodId: 'second_half', clockMs: 60 * MIN, at: T0 + 75 * MIN });
  });

  it('a short package: the goals and red card stay, the chances go first', () => {
    const p = plan(footballLog(), { targetMs: 60_000 });
    expect(p.moments.filter((m) => m.included).map((m) => m.type)).toEqual(['goal', 'red_card', 'goal']);
    expect(p.moments.find((m) => m.type === 'save')).toMatchObject({ included: false, reason: 'Over the package length' });
  });

  it('the operator leaves moments out, adds one, and moves one; the plan key changes with them', () => {
    const facts = footballLog();
    const base = plan(facts);
    const corner = facts.find((f) => f.type === 'corner')!;
    const goal = facts.find((f) => f.type === 'goal')!;
    const red = facts.find((f) => f.type === 'red_card')!;
    const p = plan(facts, { overrides: { [corner.id]: { include: true }, [red.id]: { include: false }, [goal.id]: { shiftMs: -6_000 } } });
    expect(p.moments.find((m) => m.factId === corner.id)?.included).toBe(true);
    expect(p.moments.find((m) => m.factId === red.id)).toMatchObject({ included: false, reason: 'Left out' });
    const clip = p.segments[0]!;
    expect(clip.videoFromMs).toBe(12 * MIN - 6_000 - 20_000);
    // the picture still shows the match at its real time: the clip starts 26 s before the recorded goal
    expect(clip.atFrom).toBe(T0 + 10 * MIN - 26_000);
    expect(clip.clock).toEqual({ periodId: 'first_half', clockMs: 10 * MIN, at: T0 + 10 * MIN });
    expect(p.key).not.toBe(base.key);
    expect(plan(facts).key).toBe(base.key);
  });

  it('moments close together are one clip; options turn off the replays, transition, title, scorebug and end board', () => {
    const facts = footballLog();
    facts.splice(2, 0, fact({ type: 'shot_on_target', side: 'home', at: T0 + 10 * MIN + 15_000, clockMs: 10 * MIN + 15_000 }));
    const p = plan(facts, { replays: false, stinger: false, intro: false, scorebug: false, endCard: false });
    expect(p.segments[0]!.factIds).toHaveLength(2);
    expect(p.segments.some((s) => s.kind === 'replay' || s.kind === 'end_card')).toBe(false);
    expect(p.cues.map((c) => c.templateKey)).not.toContain('builtin:highlights_intro');
    expect(p.cues.map((c) => c.templateKey)).not.toContain('builtin:scorebug');
    // without replays the goal strap goes over the celebration
    expect(p.cues.filter((c) => c.templateKey === 'builtin:goal')).toHaveLength(2);
  });

  it('a moment before the video starts is listed with the reason; sports that score dozens of times are not offered', () => {
    const p = plan(footballLog(), {}, { first_half: 2 * MIN }, 'football');
    expect(p.moments.every((m) => m.reason !== 'Not in the video (check the kick-off times)')).toBe(true);
    const late = plan(footballLog(), {}, { first_half: -15 * MIN });
    expect(late.moments.find((m) => m.minute === 11)).toMatchObject({ included: false, reason: 'Not in the video (check the kick-off times)' });
    seq = 0;
    const netball = [phase('pre_match', 'q1', T0, 0), fact({ type: 'goal', side: 'home', periodId: 'q1', at: T0 + MIN, clockMs: MIN })];
    expect(plan(netball, {}, { q1: 0 }, 'netball').moments).toEqual([]);
  });
});
