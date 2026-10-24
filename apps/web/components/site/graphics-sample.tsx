'use client';
// The homepage's broadcast preview: the real MatchFrame renderer and overlay rules running in the browser on
// fictional teams over an illustrated stadium (labelled Sample). Nothing here talks to the server, a match or a
// stream. It opens with the scorebug on air and plays a short sample sequence (goal, line-up, statistics, sponsor)
// that the visitor can pause and replay; pressing any control hands it over to them. No sequence for visitors
// who prefer reduced motion, and none while the preview is off screen. Until the page has loaded (or without
// JavaScript) a still of the same graphics stands in.
import type { Sport } from '@bs/domain';
import { DEFAULT_THEMES, emptyState, reduceOverlay, type OverlayCommand, type OverlayPublicState, type ThemeKey } from '@bs/graphics';
import { Renderer, Stage, THEMES } from '@bs/graphics/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Goal, Megaphone, Pause, Play, RotateCcw, Users } from 'lucide-react';
import { SAMPLE_SLOTS, samplePlayerId, sampleData, sampleVariables } from '@/components/theme-preview';

const SPORT: Sport = 'football';
const LOOK: ThemeKey = 'derby';
export const SCENE = { football: "url('/site/scene-pitch.svg') center / cover no-repeat #1d4f2a", basketball: "url('/site/scene-court.svg') center / cover no-repeat #6b4626" } as const;
const START = { home: 2, away: 1 };

type Key = 'goal' | 'lineup' | 'stats' | 'sponsor';
const ACTIONS: { key: Key; label: string; icon: typeof Goal; say: string }[] = [
  { key: 'goal', label: 'Goal Harbour', icon: Goal, say: 'Goal for Harbour City: the score changes and the goal graphic goes to air' },
  { key: 'lineup', label: 'Line-up', icon: Users, say: 'Home line-up board on air' },
  { key: 'stats', label: 'Stats', icon: BarChart3, say: 'Match statistics board on air' },
  { key: 'sponsor', label: 'Sponsor', icon: Megaphone, say: 'Sponsor placement on air' },
];
/** The sample sequence: seconds from the start of each loop. */
const SEQUENCE: { at: number; key: Key }[] = [
  { at: 2, key: 'goal' },
  { at: 11, key: 'sponsor' },
  { at: 17, key: 'lineup' },
  { at: 28, key: 'stats' },
];
const LOOP_S = 40;

function command(key: Key, minute: number): OverlayCommand {
  switch (key) {
    case 'goal':
      return { type: 'TAKE_IN', templateKey: 'builtin:goal', variables: { team: 'home', player: samplePlayerId('home', 9), minute: String(minute), eventType: 'goal' }, durationMs: 7000, force: true };
    case 'lineup':
      return { type: 'TAKE_IN', templateKey: 'builtin:lineup', variables: sampleVariables('builtin:lineup', SPORT), durationMs: 9000, force: true };
    case 'stats':
      return { type: 'TAKE_IN', templateKey: 'builtin:stats', variables: sampleVariables('builtin:stats', SPORT), durationMs: 9000, force: true };
    case 'sponsor':
      return { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'Live from Bayside Oval', subtitle: 'Round 12 · Coastal Premier League' }, durationMs: 5500, force: true };
  }
}

function startState(now: number): OverlayPublicState {
  return reduceOverlay(emptyState(), { type: 'TAKE_IN', templateKey: 'builtin:scorebug', variables: sampleVariables('builtin:scorebug', SPORT) }, { now: now - 5000, source: 'operator', cueId: 'bug' }).state;
}

export function GraphicsSample() {
  const [mounted, setMounted] = useState(false);
  const [score, setScore] = useState(START);
  const [state, setState] = useState<OverlayPublicState>(() => emptyState());
  const [said, setSaid] = useState('Scorebug on air');
  const [last, setLast] = useState<Key | null>(null);
  // 'playing' the sample sequence, 'paused' by the visitor, 'manual' once they press a control
  const [mode, setMode] = useState<'playing' | 'paused' | 'manual'>('paused');
  const [visible, setVisible] = useState(true);
  const t0 = useRef(Date.now());
  const n = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  const loopStart = useRef(0);

  const reset = useCallback(() => {
    const now = Date.now();
    t0.current = now;
    loopStart.current = now;
    setScore(START);
    setState(startState(now));
    setSaid('Scorebug on air, score reset to 2–1');
    setLast(null);
  }, []);

  useEffect(() => {
    setMounted(true);
    reset();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setMode('playing');
  }, [reset]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const data = useMemo(() => {
    const d = sampleData(DEFAULT_THEMES[LOOK], SPORT);
    d.match.projection = { ...d.match.projection, score };
    const main = d.match.clocks.main!;
    d.match.clocks = { ...d.match.clocks, main: { ...main, running: true, anchorAt: t0.current } };
    return d;
  }, [score]);

  const run = useCallback((key: Key) => {
    const minute = 63 + Math.floor((Date.now() - t0.current) / 60_000);
    if (key === 'goal') setScore((s) => ({ ...s, home: s.home + 1 }));
    const cmd = command(key, minute);
    setState((s) => {
      try {
        return reduceOverlay(s, cmd, { now: Date.now(), source: 'operator', cueId: `sample-${++n.current}` }).state;
      } catch {
        return s;
      }
    });
    setSaid(ACTIONS.find((a) => a.key === key)!.say);
    setLast(key);
  }, []);

  // the sample sequence, while playing and on screen (a loop restarts from the opening score)
  useEffect(() => {
    if (mode !== 'playing' || !visible || !mounted) return;
    const fired = new Set<number>();
    const elapsed0 = (Date.now() - loopStart.current) / 1000;
    SEQUENCE.forEach((s, i) => s.at <= elapsed0 && fired.add(i));
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - loopStart.current) / 1000;
      if (elapsed >= LOOP_S) {
        reset();
        fired.clear();
        return;
      }
      SEQUENCE.forEach((s, i) => {
        if (!fired.has(i) && elapsed >= s.at) {
          fired.add(i);
          run(s.key);
        }
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [mode, visible, mounted, reset, run]);

  const press = (key: Key) => {
    setMode('manual');
    run(key);
  };
  const replay = () => {
    reset();
    setMode('playing');
  };

  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] bg-[radial-gradient(60%_60%_at_60%_40%,color-mix(in_oklab,var(--color-primary)_30%,transparent),transparent_75%)] opacity-70 blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-border bg-[#05080d] shadow-pop ring-1 ring-black/5">
        <div ref={frame} className="relative aspect-video">
          {mounted ? (
            <Stage background={SCENE.football}>
              <Renderer state={state} data={data} themes={THEMES} serverNow={() => Date.now()} slots={SAMPLE_SLOTS} />
            </Stage>
          ) : (
            <img src="/site/hero-poster.jpg" alt="A MatchFrame scorebug for a fictional football match over an illustrated stadium" width={1600} height={900} className="size-full object-cover" />
          )}
          <span data-sample-chip className="pointer-events-none absolute bottom-2.5 right-2.5 inline-flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur">
            <span className="size-1.5 rounded-full bg-[#ff5263]" aria-hidden /> Sample
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-[#0b1220] px-3 py-2.5 sm:px-4">
          <div role="group" aria-label="Send a graphic" className="flex flex-1 flex-wrap gap-1.5">
            {ACTIONS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => press(a.key)}
                disabled={!mounted}
                aria-pressed={mode === 'manual' && last === a.key}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition disabled:opacity-50 ${last === a.key ? 'border-[#00c8f0] bg-[#00c8f0]/15 text-white' : 'border-white/15 bg-white/[0.04] text-white/90 hover:border-[#00c8f0] hover:text-white'}`}
              >
                <a.icon className="size-4 text-[#00c8f0]" aria-hidden />
                {a.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {mode === 'playing' ? (
              <button type="button" onClick={() => setMode('paused')} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white">
                <Pause className="size-4" aria-hidden /> Pause sample
              </button>
            ) : (
              <button type="button" onClick={replay} disabled={!mounted} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-50">
                <Play className="size-4" aria-hidden /> Play sample
              </button>
            )}
            <button type="button" onClick={() => { setMode('manual'); reset(); }} disabled={!mounted} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-50">
              <RotateCcw className="size-4" aria-hidden /> Reset
            </button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        {mode === 'playing' ? 'Playing a sample sequence. Press a button to take over.' : 'The real MatchFrame graphics engine, running in your browser with fictional teams.'}
      </p>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
