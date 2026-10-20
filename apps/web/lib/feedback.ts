'use client';
// Touch feedback for the scorer phone: a short vibration and a quiet tone when an action is recorded, both
// switchable per device, plus the sunlight (high-contrast) preference. Preferences live in the user's saved
// preferences so they follow the scorer between devices, with a local copy for the offline case.
import { useCallback, useEffect, useState } from 'react';
import { get, put } from './api';

export interface ScorerPrefs {
  vibrate: boolean;
  sound: boolean;
  sunlight: boolean;
  /** seconds the "undo last" button stays available after an action */
  undoWindowS: number;
}
export const DEFAULT_SCORER_PREFS: ScorerPrefs = { vibrate: true, sound: true, sunlight: false, undoWindowS: 12 };
const LOCAL_KEY = 'bs.scorer.prefs';

let audio: AudioContext | null = null;
/** A quiet confirmation tone (goal: two rising notes; card: one low note; tick: a short blip; warn: two low blips). */
export function tone(kind: 'score' | 'card' | 'tick' | 'warn') {
  try {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    audio ??= new AudioContext();
    const ctx = audio;
    const notes: [number, number, number][] = kind === 'score' ? [[660, 0, 0.09], [880, 0.09, 0.14]] : kind === 'card' ? [[330, 0, 0.18]] : kind === 'warn' ? [[220, 0, 0.12], [220, 0.18, 0.12]] : [[990, 0, 0.06]];
    for (const [f, at, dur] of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + dur + 0.05);
    }
  } catch {
    // feedback is best-effort
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    // not available on this device
  }
}

/** Confirm an action the way the scorer prefers. */
export function feedback(prefs: ScorerPrefs, kind: 'score' | 'card' | 'tick' | 'warn') {
  if (prefs.vibrate) vibrate(kind === 'score' ? [40, 40, 80] : kind === 'warn' ? [60, 60, 60] : 35);
  if (prefs.sound) tone(kind);
}

function readLocal(): Partial<ScorerPrefs> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Partial<ScorerPrefs>;
  } catch {
    return {};
  }
}

/** Scorer preferences: local first (works offline), then merged with the saved copy when online. */
export function useScorerPrefs() {
  const [prefs, setPrefs] = useState<ScorerPrefs>(() => ({ ...DEFAULT_SCORER_PREFS, ...(typeof window === 'undefined' ? {} : readLocal()) }));
  useEffect(() => {
    get<{ prefs?: { scorer?: Partial<ScorerPrefs> } }>('me/preferences')
      .then((p) => {
        if (p?.prefs?.scorer) setPrefs((cur) => ({ ...cur, ...p.prefs!.scorer }));
      })
      .catch(() => undefined);
  }, []);
  const update = useCallback((patch: Partial<ScorerPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      } catch {
        // storage may be unavailable
      }
      void put('me/preferences', { scorer: next }).catch(() => undefined);
      return next;
    });
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('sunlight', prefs.sunlight);
    return () => document.documentElement.classList.remove('sunlight');
  }, [prefs.sunlight]);
  return { prefs, update };
}
