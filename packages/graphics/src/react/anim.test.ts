import { describe, expect, it } from 'vitest';
import { animStyle, changeStyle, type AnimMemo, type GraphicProps } from './stage';

const props = (over: Partial<GraphicProps>, memo?: AnimMemo): GraphicProps =>
  ({ cue: { cueId: 'c1' }, t: { entranceMs: 300, exitMs: 250 }, data: { theme: { motion: 'full' } }, phase: 'in', offsetMs: 0, now: 0, memo, ...over }) as unknown as GraphicProps;

describe('entrance and exit animation styles', () => {
  it('keeps the CSS delay fixed from the first render so re-renders do not advance the animation', () => {
    const memo: AnimMemo = new Map();
    const a = animStyle(props({ offsetMs: 50 }, memo), 'slide-left');
    expect(a).toMatchObject({ animationName: 'bs-slide-left-in', animationDuration: '300ms', animationDelay: '-50ms' });
    const b = animStyle(props({ offsetMs: 170 }, memo), 'slide-left');
    expect(b.animationDelay).toBe('-50ms');
    expect(animStyle(props({ offsetMs: 300, phase: 'hold' }, memo), 'slide-left')).toEqual({});
  });
  it('staggers parts after the graphic and lets them run past its entrance, but every part exits within the exit time', () => {
    const memo: AnimMemo = new Map();
    const part = animStyle(props({ offsetMs: 0 }, memo), 'rise', 200, 400);
    expect(part).toMatchObject({ animationDelay: '200ms', animationDuration: '400ms' });
    expect(animStyle(props({ offsetMs: 450, phase: 'hold' }, memo), 'rise', 200, 400).animationName).toBe('bs-rise-in');
    expect(animStyle(props({ offsetMs: 600, phase: 'hold' }, memo), 'rise', 200, 400)).toEqual({});
    const out = animStyle(props({ offsetMs: 40, phase: 'out' }, memo), 'rise', 200, 400);
    expect(out).toMatchObject({ animationName: 'bs-rise-out', animationDuration: '250ms', animationDelay: '-40ms' });
  });
  it('does nothing when the theme turns motion off, and resumes mid-way without a memo (static thumbnails)', () => {
    expect(animStyle(props({ data: { theme: { motion: 'none' } } as never }), 'zoom')).toEqual({});
    expect(animStyle(props({ offsetMs: 120 }), 'zoom').animationDelay).toBe('-120ms');
  });
});

describe('value-change emphasis', () => {
  it('plays only when a live value changes, alternating keyframes so back-to-back changes restart', () => {
    const memo: AnimMemo = new Map();
    const at = (now: number, score: number) => changeStyle(props({ phase: 'hold', offsetMs: now, now }, memo), 'score', score);
    expect(at(0, 1)).toEqual({ display: 'inline-block' }); // first render registers the value
    expect(at(500, 1)).toEqual({ display: 'inline-block' }); // unchanged
    const first = at(1000, 2);
    expect(first).toMatchObject({ animationName: 'bs-pop-a', animationDelay: '0ms' });
    expect(at(1200, 2).animationDelay).toBe('0ms'); // same delay while it plays
    expect(at(1800, 2)).toEqual({ display: 'inline-block' }); // finished (700 ms)
    expect(at(2000, 3).animationName).toBe('bs-pop-b');
  });
  it('is inert without a renderer memo', () => {
    expect(changeStyle(props({}), 'x', 1)).toEqual({ display: 'inline-block' });
  });
});
