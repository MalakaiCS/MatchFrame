import { describe, expect, it } from 'vitest';
import { easing, parseKeyframes, sampleKeyframes } from './motion';
import { KEYFRAMES, type AnimKind } from './stage';

const table = parseKeyframes(KEYFRAMES);
const LINEAR = 'linear';

describe('keyframes sampled for a still frame', () => {
  it('reads every entrance and exit the graphics use from the live keyframes', () => {
    const kinds: AnimKind[] = ['fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'scale', 'wipe', 'wipe-up', 'grow-x', 'grow-y', 'rise', 'drop', 'flip', 'zoom', 'shine', 'sweep'];
    for (const k of kinds) for (const dir of ['in', 'out']) expect(table.get(`bs-${k}-${dir}`)?.length, `bs-${k}-${dir}`).toBeGreaterThanOrEqual(2);
    expect(table.get('bs-zoom-out')).toEqual([
      { at: 0, decl: { opacity: '1', transform: 'none', 'clip-path': 'inset(0 0 0 0)' } },
      { at: 1, decl: { opacity: '0', transform: 'scale(.4)' } },
    ]);
    expect(table.get('bs-shine-in')!.map((s) => s.at)).toEqual([0, 0.2, 1]);
  });

  it('interpolates opacity, transforms and clips between the keyframes, as CSS does', () => {
    expect(sampleKeyframes(table, 'bs-zoom-out', 0.5, LINEAR)).toEqual({ opacity: '0.5', transform: 'scale(0.7)' });
    expect(sampleKeyframes(table, 'bs-slide-left-in', 0.25, LINEAR)).toEqual({ opacity: '0.25', transform: 'translateX(-45px)' });
    // the clip is only on the last keyframe: it switches half way, like any value that cannot be blended
    expect(sampleKeyframes(table, 'bs-slide-left-in', 0.75, LINEAR)).toMatchObject({ clipPath: 'inset(0 0 0 0)' });
    expect(sampleKeyframes(table, 'bs-wipe-in', 0.5, LINEAR)).toEqual({ clipPath: 'inset(0% 50% 0% 0%)' });
    expect(sampleKeyframes(table, 'bs-sweep-out', 0.25, LINEAR)).toEqual({ transform: 'translateX(725px)' });
    // three keyframes, opacity on all of them and the transform only on the first and last
    expect(sampleKeyframes(table, 'bs-shine-in', 0.1, LINEAR)).toEqual({ opacity: '0.5', transform: 'translateX(-67%) skewX(-18deg)' });
    expect(sampleKeyframes(table, 'bs-drop-in', 0.5, LINEAR)).toMatchObject({ opacity: '0.5', transform: 'translateY(-12px) scale(1.075)' });
  });

  it('holds the first keyframe before the start and the last after the end, never coming round again', () => {
    expect(sampleKeyframes(table, 'bs-zoom-in', -0.5, LINEAR)).toEqual({ opacity: '0', transform: 'scale(.4)' });
    for (const x of [1, 1.06, 1.5, 2, 3.64]) expect(sampleKeyframes(table, 'bs-zoom-out', x, 'cubic-bezier(.55,0,.8,.2)'), String(x)).toEqual({ opacity: '0', transform: 'scale(.4)' });
    expect(sampleKeyframes(table, 'bs-sweep-out', 2, LINEAR)).toEqual({ transform: 'translateX(2900px)' });
    expect(sampleKeyframes(table, 'bs-nothing', 0.5, LINEAR)).toEqual({});
  });

  it('eases each interval with the timing function, overshoot included', () => {
    expect(easing('linear')(0.3)).toBeCloseTo(0.3, 6);
    expect(easing('ease-out')(0.5)).toBeCloseTo(0.6846, 3);
    expect(easing('cubic-bezier(.42,0,.58,1)')(0.5)).toBeCloseTo(0.5, 5);
    const back = easing('cubic-bezier(.34,1.56,.64,1)');
    expect(Math.max(...Array.from({ length: 99 }, (_, i) => back((i + 1) / 100)))).toBeGreaterThan(1.05);
    expect([0, 1].map(easing('cubic-bezier(.55,0,.45,1)'))).toEqual([0, 1]);
    // an overshooting scale goes past its end value, opacity stays within 0..1
    const z = sampleKeyframes(table, 'bs-zoom-in', 0.6, 'cubic-bezier(.34,1.56,.64,1)');
    expect(Number(/scale\(([\d.]+)\)/.exec(String(z.transform))![1])).toBeGreaterThan(1);
    expect(z.opacity).toBe('1');
  });
});
