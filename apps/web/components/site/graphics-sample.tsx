'use client';
// The homepage's broadcast preview: the real MatchFrame renderer and overlay rules running in the browser on
// fictional teams over an illustrated stadium (labelled Sample). Nothing here talks to the server, a match or a
// stream. It opens with the scorebug on air and plays a short sample sequence (goal, line-up, statistics, sponsor)
// that the visitor can pause and replay; pressing any control hands it over to them. On a goal the view eases in on
// the scorebug, where the goal plays, and back out. No sequence and no camera moves for visitors who prefer reduced
// motion, and nothing runs while the preview is off screen. Until the page has loaded (or without JavaScript) a
// still of the same frame stands in, and the live preview fades in over it.
//
// Kept cheap to draw: the stadium is a JPEG (the SVG it was drawn from used noise filters that are slow to paint),
// no blur filters around or over the preview, and the clock stops ticking while the preview is out of view.
import type { Sport } from '@bs/domain';
import { DEFAULT_THEMES, emptyState, reduceOverlay, type OverlayCommand, type OverlayPublicState, type ThemeKey } from '@bs/graphics';
import { Renderer, Stage, THEMES } from '@bs/graphics/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Goal, Megaphone, Pause, Play, RotateCcw, Users } from 'lucide-react';
import { SAMPLE_SLOTS, samplePlayerId, sampleData, sampleVariables } from '@/components/theme-preview';

const SPORT: Sport = 'football';
const LOOK: ThemeKey = 'derby';
export const SCENE = { football: "url('/site/scene-pitch.jpg') center / cover no-repeat #1d4f2a", basketball: "url('/site/scene-court.jpg') center / cover no-repeat #6b4626" } as const;
const START = { home: 2, away: 1 };

type Key = 'goal' | 'lineup' | 'stats' | 'sponsor';
type Step = Key | 'out';
const ACTIONS: { key: Key; label: string; icon: typeof Goal; say: string }[] = [
  { key: 'goal', label: 'Goal Harbour', icon: Goal, say: 'Goal for Harbour City: the score changes and the goal graphic goes to air' },
  { key: 'lineup', label: 'Line-up', icon: Users, say: 'Home line-up board on air' },
  { key: 'stats', label: 'Stats', icon: BarChart3, say: 'Match statistics board on air' },
  { key: 'sponsor', label: 'Sponsor', icon: Megaphone, say: 'Sponsor placement on air' },
];
/** The sample sequence: seconds from the start of each loop; 'out' takes everything off before the loop restarts. */
const SEQUENCE: { at: number; key: Step }[] = [
  { at: 2.5, key: 'goal' },
  { at: 11.5, key: 'sponsor' },
  { at: 18, key: 'lineup' },
  { at: 28.5, key: 'stats' },
  { at: 37, key: 'out' },
];
const LOOP_S = 39;
const GOAL_MS = 7000;
/** The camera on a goal: the scorebug at this share of the frame's width, eased in and out. */
const ZOOM_WIDTH = 0.66;
const CAMERA_EASE = 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)';

function command(key: Key, minute: number): OverlayCommand {
  switch (key) {
    case 'goal':
      return { type: 'TAKE_IN', templateKey: 'builtin:goal', variables: { team: 'home', player: samplePlayerId('home', 9), minute: String(minute), eventType: 'goal' }, durationMs: GOAL_MS, force: true };
    case 'lineup':
      return { type: 'TAKE_IN', templateKey: 'builtin:lineup', variables: sampleVariables('builtin:lineup', SPORT), durationMs: 9000, force: true };
    case 'stats':
      return { type: 'TAKE_IN', templateKey: 'builtin:stats', variables: sampleVariables('builtin:stats', SPORT), durationMs: 9000, force: true };
    case 'sponsor':
      return { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'Live from Bayside Oval', subtitle: 'Round 12 · Coastal Premier League' }, durationMs: 5500, force: true };
  }
}

/** The scorebug on air: already settled on first load (it matches the still), or animating in after a reset. */
function startState(now: number, animate: boolean): OverlayPublicState {
  return reduceOverlay(emptyState(), { type: 'TAKE_IN', templateKey: 'builtin:scorebug', variables: sampleVariables('builtin:scorebug', SPORT) }, { now: animate ? now : now - 5000, source: 'operator', cueId: `bug-${now}` }).state;
}

/** Everything on air takes its exit animation. */
function allOut(s: OverlayPublicState, now: number): OverlayPublicState {
  let next = s;
  for (const layer of Object.keys(s.layers) as (keyof OverlayPublicState['layers'])[]) {
    try {
      next = reduceOverlay(next, layer === 'scoreboard' ? { type: 'HIDE_SCOREBUG' } : { type: 'TAKE_OUT', layer }, { now, source: 'operator', cueId: `out-${layer}-${now}` }).state;
    } catch {
      // already gone
    }
  }
  return next;
}

/** Where to move the camera so the scorebug fills ZOOM_WIDTH of the frame, from the scorebug as drawn now. */
function cameraOn(frame: HTMLElement): string | null {
  const bug = frame.querySelector('[data-layer="scoreboard"]');
  if (!bug) return null;
  const f = frame.getBoundingClientRect();
  const parts = [...bug.querySelectorAll('*')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 2 && r.height > 2 && r.right > f.left && r.left < f.right);
  if (!parts.length || !f.width) return null;
  const left = (Math.min(...parts.map((r) => r.left)) - f.left) / f.width;
  const top = (Math.min(...parts.map((r) => r.top)) - f.top) / f.height;
  const width = (Math.max(...parts.map((r) => r.right)) - f.left) / f.width - left;
  const scale = Math.min(2.6, Math.max(1.2, ZOOM_WIDTH / width));
  // keep the scorebug's top-left corner a little in from the frame's after scaling
  const tx = 0.06 - scale * left;
  const ty = 0.1 - scale * top;
  return `translate(${(tx * 100).toFixed(2)}%, ${(ty * 100).toFixed(2)}%) scale(${scale.toFixed(3)})`;
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
  // the live preview fades in over the still once its fonts are ready; the still is then dropped
  const [ready, setReady] = useState(false);
  const [stillGone, setStillGone] = useState(false);
  const [camera, setCamera] = useState<string | null>(null);
  const t0 = useRef(Date.now());
  const n = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  const loopStart = useRef(0);
  const reducedMotion = useRef(false);
  const cameraTimer = useRef(0);
  // the renderer's clock: frozen while the preview is off screen, so nothing redraws that nobody sees
  const onScreen = useRef(true);
  const frozenAt = useRef(0);
  const clock = useCallback(() => (onScreen.current ? Date.now() : frozenAt.current), []);

  const cameraOut = useCallback(() => {
    window.clearTimeout(cameraTimer.current);
    setCamera(null);
  }, []);

  const reset = useCallback((animate: boolean) => {
    const now = Date.now();
    t0.current = now;
    loopStart.current = now;
    cameraOut();
    setScore(START);
    setState(startState(now, animate));
    setSaid('Scorebug on air, score reset to 2–1');
    setLast(null);
  }, [cameraOut]);

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setMounted(true);
    reset(false);
    if (!reducedMotion.current) setMode('playing');
    let cancelled = false;
    // fade in only once the fonts and the stadium image are ready, so the still is never swapped for a bare pitch
    const scene = new Image();
    scene.src = '/site/scene-pitch.jpg';
    void Promise.all([document.fonts.ready, scene.decode().catch(() => undefined)]).then(() => requestAnimationFrame(() => !cancelled && setReady(true)));
    return () => {
      cancelled = true;
      window.clearTimeout(cameraTimer.current);
    };
  }, [reset]);

  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => setStillGone(true), 600);
    return () => window.clearTimeout(id);
  }, [ready]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      const on = !!e?.isIntersecting;
      if (!on) frozenAt.current = Date.now();
      onScreen.current = on;
      setVisible(on);
    }, { threshold: 0.1 });
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
    // the goal plays inside the scorebug: ease in on it while it does, then back out before it leaves
    cameraOut();
    if (key === 'goal' && !reducedMotion.current && frame.current) {
      const to = cameraOn(frame.current);
      if (to) {
        setCamera(to);
        cameraTimer.current = window.setTimeout(() => setCamera(null), GOAL_MS - 600);
      }
    }
  }, [cameraOut]);

  // the sample sequence, while playing and on screen (a loop restarts from the opening score)
  useEffect(() => {
    if (mode !== 'playing' || !visible || !mounted) return;
    const fired = new Set<number>();
    const elapsed0 = (Date.now() - loopStart.current) / 1000;
    SEQUENCE.forEach((s, i) => s.at <= elapsed0 && fired.add(i));
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - loopStart.current) / 1000;
      if (elapsed >= LOOP_S) {
        reset(true);
        fired.clear();
        return;
      }
      SEQUENCE.forEach((s, i) => {
        if (!fired.has(i) && elapsed >= s.at) {
          fired.add(i);
          if (s.key === 'out') {
            cameraOut();
            setState((st) => allOut(st, Date.now()));
          } else run(s.key);
        }
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [mode, visible, mounted, reset, run, cameraOut]);

  const press = (key: Key) => {
    setMode('manual');
    run(key);
  };
  const replay = () => {
    reset(true);
    setMode('playing');
  };

  return (
    <div className="relative">
      {/* a soft glow from a plain gradient (a blur filter here was slow to draw behind a moving picture) */}
      <div aria-hidden className="pointer-events-none absolute -inset-12 -z-10 bg-[radial-gradient(50%_55%_at_55%_45%,color-mix(in_oklab,var(--color-primary)_22%,transparent),transparent_70%)]" />
      <div className="overflow-hidden rounded-2xl border border-border bg-[#05080d] shadow-pop ring-1 ring-black/5">
        <div ref={frame} className="relative aspect-video overflow-hidden [contain:layout_paint]">
          {!stillGone ? (
            <img src="/site/hero-poster.jpg" alt={mounted ? '' : 'A MatchFrame scorebug for a fictional football match over an illustrated stadium'} width={1600} height={900} className="absolute inset-0 size-full object-cover" />
          ) : null}
          {mounted ? (
            <div
              className={`absolute inset-0 ${ready ? 'opacity-100' : 'opacity-0'}`}
              style={{ transform: camera ?? 'translate(0, 0) scale(1)', transformOrigin: '0 0', transition: `${CAMERA_EASE}, opacity 500ms ease` }}
            >
              <Stage background={SCENE.football}>
                <Renderer state={state} data={data} themes={THEMES} serverNow={clock} slots={SAMPLE_SLOTS} />
              </Stage>
            </div>
          ) : null}
          <span data-sample-chip className="pointer-events-none absolute bottom-2.5 right-2.5 inline-flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
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
            <button type="button" onClick={() => { setMode('manual'); reset(true); }} disabled={!mounted} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-50">
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
