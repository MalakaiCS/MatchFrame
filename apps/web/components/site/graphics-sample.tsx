'use client';
// Interactive sample on the public homepage: the real MatchFrame renderer and overlay rules running in the
// browser on fictional teams. Nothing here talks to the server, a match or a stream. Until the page has loaded
// (or without JavaScript) a screenshot of the same graphics stands in.
import type { Sport } from '@bs/domain';
import { DEFAULT_THEMES, LOOKS as ALL_LOOKS, emptyState, reduceOverlay, type OverlayCommand, type OverlayPublicState, type ThemeKey } from '@bs/graphics';
import { Renderer, Stage, THEMES } from '@bs/graphics/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLE_SLOTS, samplePlayerId, sampleData, sampleVariables } from '@/components/theme-preview';

type Look = ThemeKey;
const LOOKS = ALL_LOOKS.map((l) => ({ key: l.key, label: l.name }));
const BACKGROUND: Record<string, string> = {
  football: 'radial-gradient(ellipse at 50% 120%, #3c8a4b 0%, #24613a 35%, #173d2a 60%, #0f1f2c 100%)',
  basketball: 'radial-gradient(ellipse at 50% 120%, #b9773d 0%, #8c5428 35%, #4d2f1a 62%, #131722 100%)',
};

interface Action {
  label: string;
  run: (s: { score: { home: number; away: number } }) => { cmd?: OverlayCommand; score?: { home: number; away: number }; say: string };
}

function actionsFor(sport: Sport): Action[] {
  const board = (key: string, say: string, extra: Record<string, unknown> = {}): Action['run'] => () => ({ cmd: { type: 'TAKE_IN', templateKey: key, variables: { ...sampleVariables(key, sport), ...extra }, durationMs: 9000, force: true }, say });
  if (sport === 'basketball')
    return [
      { label: '+3 Harbour', run: ({ score }) => ({ score: { ...score, home: score.home + 3 }, cmd: { type: 'TAKE_IN', templateKey: 'builtin:score', variables: { team: 'home', player: samplePlayerId('home', 4), points: 3 }, durationMs: 6000, force: true }, say: 'Three points for Harbour City' }) },
      { label: '+2 Saltmarsh', run: ({ score }) => ({ score: { ...score, away: score.away + 2 }, cmd: { type: 'TAKE_IN', templateKey: 'builtin:score', variables: { team: 'away', player: samplePlayerId('away', 6), points: 2 }, durationMs: 6000, force: true }, say: 'Two points for Saltmarsh' }) },
      { label: 'Timeout', run: () => ({ cmd: { type: 'TAKE_IN', templateKey: 'builtin:timeout', variables: { team: 'away' }, durationMs: 6000, force: true }, say: 'Timeout graphic' }) },
      { label: 'Line-up', run: board('builtin:lineup', 'Home line-up board') },
      { label: 'Match header', run: board('builtin:ident', 'Match header with the score', { show: 'auto' }) },
      { label: 'Stats board', run: board('builtin:stats', 'Match statistics board') },
      { label: 'Lower third', run: () => ({ cmd: { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'Sam Patel', subtitle: 'Head coach, Harbour City' }, durationMs: 6000, force: true }, say: 'Lower third caption' }) },
    ];
  return [
    { label: 'Goal Harbour', run: ({ score }) => ({ score: { ...score, home: score.home + 1 }, cmd: { type: 'TAKE_IN', templateKey: 'builtin:goal', variables: { team: 'home', player: samplePlayerId('home', 9), minute: '64', eventType: 'goal' }, durationMs: 6500, force: true }, say: 'Goal for Harbour City' }) },
    { label: 'Goal Saltmarsh', run: ({ score }) => ({ score: { ...score, away: score.away + 1 }, cmd: { type: 'TAKE_IN', templateKey: 'builtin:goal', variables: { team: 'away', player: samplePlayerId('away', 10), minute: '66', eventType: 'goal' }, durationMs: 6500, force: true }, say: 'Goal for Saltmarsh' }) },
    { label: 'Yellow card', run: () => ({ cmd: { type: 'TAKE_IN', templateKey: 'builtin:card', variables: sampleVariables('builtin:card', sport), durationMs: 6000, force: true }, say: 'Yellow card graphic' }) },
    { label: 'Line-up', run: board('builtin:lineup', 'Home line-up board') },
    { label: 'Match header', run: board('builtin:ident', 'Match header with the score', { show: 'auto' }) },
    { label: 'Stats board', run: board('builtin:stats', 'Match statistics board') },
    { label: 'Lower third', run: () => ({ cmd: { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: sampleVariables('builtin:lower_third', sport), durationMs: 6000, force: true }, say: 'Lower third caption' }) },
  ];
}

function startState(sport: Sport): OverlayPublicState {
  let s = emptyState();
  s = reduceOverlay(s, { type: 'TAKE_IN', templateKey: 'builtin:scorebug', variables: sampleVariables('builtin:scorebug', sport) }, { now: Date.now() - 5000, source: 'operator', cueId: 'bug' }).state;
  return s;
}

export function GraphicsSample({ compact = false }: { compact?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [look, setLook] = useState<Look>('broadcast');
  const [sport, setSport] = useState<Sport>('football');
  const [score, setScore] = useState({ home: 2, away: 1 });
  const [state, setState] = useState<OverlayPublicState>(() => emptyState());
  const [said, setSaid] = useState('Scorebug on air');
  const t0 = useRef(Date.now());
  const n = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    t0.current = Date.now();
    setScore(sport === 'basketball' ? { home: 64, away: 58 } : { home: 2, away: 1 });
    setState(startState(sport));
    setSaid('Scorebug on air');
  }, [sport]);

  const data = useMemo(() => {
    const d = sampleData(DEFAULT_THEMES[look], sport);
    d.match.projection = { ...d.match.projection, score };
    const main = d.match.clocks.main!;
    d.match.clocks = { ...d.match.clocks, main: { ...main, running: true, anchorAt: t0.current } };
    return d;
  }, [look, sport, score]);

  const run = (a: Action) => {
    const r = a.run({ score });
    if (r.score) setScore(r.score);
    if (r.cmd) {
      const cmd = r.cmd;
      setState((s) => {
        try {
          return reduceOverlay(s, cmd, { now: Date.now(), source: 'operator', cueId: `sample-${++n.current}` }).state;
        } catch {
          return s;
        }
      });
    }
    setSaid(r.say);
  };
  const clear = () => {
    setState((s) => {
      let x = s;
      for (const layer of ['fullframe', 'event', 'lower'] as const) {
        if (x.layers[layer] && !x.layers[layer]!.outAt) x = reduceOverlay(x, { type: 'TAKE_OUT', layer }, { now: Date.now(), source: 'operator', cueId: `sample-${++n.current}` }).state;
      }
      return x;
    });
    setSaid('Back to the scorebug');
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-panel/60 p-3 shadow-[0_30px_120px_-40px_rgba(0,210,255,0.45)] sm:p-4">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
        {mounted ? (
          <Stage background={BACKGROUND[sport]}>
            <Renderer state={state} data={data} themes={THEMES} serverNow={() => Date.now()} slots={SAMPLE_SLOTS} />
          </Stage>
        ) : (
          <img src="/site/sample-goal.png" alt="A MatchFrame scorebug and goal graphic for a fictional football match" className="size-full object-cover" />
        )}
        <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur">Interactive sample · fictional teams</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Sport" className="flex rounded-lg border border-white/10 p-0.5">
          {(['football', 'basketball'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={sport === s} onClick={() => setSport(s)} className={`min-h-9 rounded-md px-3 text-xs font-medium capitalize ${sport === s ? 'bg-white/10 text-white' : 'text-muted hover:text-white'}`}>
              {s}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Look" className="flex flex-wrap rounded-lg border border-white/10 p-0.5">
          {LOOKS.map((l) => (
            <button key={l.key} type="button" aria-pressed={look === l.key} onClick={() => setLook(l.key)} className={`min-h-9 rounded-md px-3 text-xs font-medium ${look === l.key ? 'bg-white/10 text-white' : 'text-muted hover:text-white'}`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Send a graphic" className={`mt-2 grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {actionsFor(sport).map((a) => (
          <button key={a.label} type="button" onClick={() => run(a)} disabled={!mounted} className="min-h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white transition hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-50">
            {a.label}
          </button>
        ))}
        <button type="button" onClick={clear} disabled={!mounted} className="min-h-10 rounded-lg border border-white/10 px-3 text-sm text-muted transition hover:text-white disabled:opacity-50">
          Clear
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
