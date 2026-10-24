'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getAdapter, type DisplayModel } from '@bs/domain';
import { findTemplate, LAYER_Z, type Layer, type TemplateDef } from '../catalog';
import type { Cue, OverlayPublicState } from '../state';
import { formatSize, resolveColourClash, type OutputFormat, type RenderCreative, type RenderData } from '../data';
import { canvasMeasure, type Measure } from '../fit';
import { parseKeyframes, sampleKeyframes, type KeyframeTable } from './motion';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** Scales the 1920×1080 logical stage into its container without changing placement. */
export function Stage({ children, background = 'transparent', className, style, format = '16:9' }: { children: ReactNode; background?: string; className?: string; style?: CSSProperties; format?: OutputFormat }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const { width: W, height: H } = formatSize(format);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / W, el.clientHeight / H) || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);
  return (
    <div ref={ref} className={className} data-format={format} style={{ position: 'absolute', left: '50%', top: '50%', width: W, height: H, marginLeft: -W / 2, marginTop: -H / 2, transform: `scale(${scale})`, transformOrigin: '50% 50%', background, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

export const CHECKERBOARD = 'repeating-conic-gradient(#2a2f3a 0% 25%, #1b1f27 0% 50%) 50% / 40px 40px';

/** Monotonic-ish server time source for animation/clock interpolation. */
export function useNow(serverNow: () => number, fps = 20) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 1000 / fps) {
        last = t;
        setNow(serverNow());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [serverNow, fps]);
  return now;
}

export interface GraphicProps {
  cue: Cue;
  t: TemplateDef;
  data: RenderData;
  display: DisplayModel;
  now: number;
  measure: Measure;
  creative: (placement: string, cue?: Cue) => RenderCreative | null;
  phase: 'in' | 'hold' | 'out';
  offsetMs: number;
  /** per-renderer animation memory (see animStyle / changeStyle); absent in static thumbnails */
  memo?: AnimMemo;
  /** a still frame at `now` (exports): entrances and exits are plain styles for that instant, not CSS animations */
  still?: boolean;
  /** what is on air on each layer at this instant (a look can draw one graphic through another, e.g. an event in its scorebug) */
  layers?: Partial<Record<Layer, OnAir>>;
}

/** A cue on air: its template and where it is in its own timeline. */
export interface OnAir {
  cue: Cue;
  t: TemplateDef;
  phase: 'in' | 'hold' | 'out';
  offsetMs: number;
}

/** Remembers when each animation was first rendered, so its CSS delay stays constant across re-renders. */
export type AnimMemo = Map<string, number | ChangeMemo>;
interface ChangeMemo { v: unknown; at: number; n: number; firstAge?: number }

export type ThemeComponents = Partial<Record<string, (p: GraphicProps) => ReactNode>>;

export interface AudioPolicyApi {
  /** programme (input) audio gain 0..1; renderers reset it when a cue ends or is interrupted */
  setProgrammeGain(g: number): void;
}
export const AudioPolicyContext = createContext<AudioPolicyApi | null>(null);
export const useAudioPolicy = () => useContext(AudioPolicyContext);

export interface RendererProps {
  state: OverlayPublicState;
  data: RenderData;
  themes: Record<string, ThemeComponents>;
  serverNow: () => number;
  /** custom designer templates resolved to TemplateDefs + scene renderer */
  customDefs?: TemplateDef[];
  renderCustom?: (p: GraphicProps) => ReactNode;
  /** called with cues that are actually visible (for delivery evidence) */
  onVisible?: (visible: Cue[], now: number) => void;
  slots?: Record<string, { creativeId: string; decisionId: string } | undefined>;
  monitor?: boolean;
  /** draw a still frame at `serverNow()` (see GraphicProps.still) */
  still?: boolean;
}

function phaseOf(c: Cue, t: TemplateDef, now: number): { phase: 'in' | 'hold' | 'out'; offset: number } {
  if (c.outAt) return { phase: 'out', offset: Math.max(0, now - c.outAt) };
  if (c.durationMs != null && now >= c.startedAt + c.durationMs) return { phase: 'out', offset: now - (c.startedAt + c.durationMs) };
  const off = Math.max(0, now - c.startedAt);
  return { phase: off < t.entranceMs ? 'in' : 'hold', offset: off };
}

const CUSTOM_FONT = 'BS Custom Font';

/**
 * Where a layer's 1920×1080 design lands in each output format. Anchored layers (scorebug, events, lower thirds,
 * ticker, sponsor) keep their edges, so in the vertical format they simply hug the 1080×1920 frame; full-frame
 * boards are scaled to the width and centred; the venue format enlarges the scorebug and events for a big screen.
 */
export function layerBox(layer: Layer, format: OutputFormat): CSSProperties {
  if (format === '9:16') {
    if (layer === 'fullframe') return { position: 'absolute', left: 0, top: (1920 - 1080 * (1080 / 1920)) / 2, width: 1920, height: 1080, transform: 'scale(0.5625)', transformOrigin: 'top left' };
    if (layer === 'background' || layer === 'transition') return { position: 'absolute', left: (1080 - 1920 * (1920 / 1080)) / 2, top: 0, width: 1920, height: 1080, transform: 'scale(1.7778)', transformOrigin: 'top left' };
    return { position: 'absolute', inset: 0 };
  }
  if (format === 'venue') {
    if (layer === 'scoreboard') return { position: 'absolute', inset: 0, transform: 'scale(1.5)', transformOrigin: 'top left' };
    if (layer === 'event' || layer === 'lower') return { position: 'absolute', inset: 0, transform: 'scale(1.45)', transformOrigin: 'bottom left' };
  }
  return { position: 'absolute', inset: 0 };
}


/** Renders the on-air state from an explicit snapshot. Shared by overlay, preview, rehearsal and programme. */
export function Renderer({ state, data: rawData, themes, serverNow, customDefs = [], renderCustom, onVisible, slots, monitor, still }: RendererProps) {
  // Colour clash resolution and the custom font are applied once per snapshot, so every graphic reads the same teams.
  const data = useMemo(() => {
    const { home, away } = resolveColourClash(rawData.match.teams.home, rawData.match.teams.away);
    const font = rawData.theme.fontUrl ? `'${CUSTOM_FONT}', ${rawData.theme.font}` : rawData.theme.font;
    return { ...rawData, match: { ...rawData.match, teams: { home, away } }, theme: { ...rawData.theme, font } };
  }, [rawData]);
  const format = data.format ?? '16:9';
  const now = useNow(serverNow, data.theme.motion === 'none' ? 5 : 20);
  const adapter = getAdapter(data.match.sport);
  const display = adapter.display(data.match.rulesConfig as never, data.match.projection, data.match.clocks, now);
  const measure = useRef<Measure>(canvasMeasure(data.theme.font)).current;
  const memo = useRef<AnimMemo>(new Map()).current;
  if (memo.size > 4000) memo.clear();
  const comps = themes[data.theme.themeKey] ?? themes.broadcast!;
  const creative = (placement: string, cue?: Cue): RenderCreative | null => {
    if (cue?.sponsor && cue.sponsor.placement === placement) return data.creatives[cue.sponsor.creativeId] ?? null;
    const s = slots?.[placement];
    return s ? (data.creatives[s.creativeId] ?? null) : null;
  };
  const cues = (Object.entries(state.layers) as [Layer, Cue][])
    .filter(([layer]) => layer !== 'scoreboard' || state.scorebugVisible || state.layers.scoreboard?.outAt)
    .sort(([a], [b]) => LAYER_Z[a] - LAYER_Z[b]);
  const visible: Cue[] = [];
  const onAir: Partial<Record<Layer, OnAir>> = {};
  for (const [layer, cue] of cues) {
    const t = findTemplate(cue.templateKey, customDefs);
    if (!t) continue;
    const { phase, offset } = phaseOf(cue, t, now);
    if (phase === 'out' && offset > t.exitMs) continue;
    onAir[layer] = { cue, t, phase, offsetMs: offset };
  }
  const nodes = cues.map(([layer, cue]) => {
    const on = onAir[layer];
    if (!on) return null;
    const { t, phase, offsetMs: offset } = on;
    if (phase !== 'out') visible.push(cue);
    const props: GraphicProps = { cue, t, data, display, now, measure, creative, phase, offsetMs: offset, memo, still, layers: onAir };
    const Comp = cue.templateKey.startsWith('custom:') ? renderCustom : comps[cue.templateKey.replace('builtin:', '')];
    if (!Comp) return null;
    return (
      <div key={`${layer}:${cue.cueId}`} data-layer={layer} data-cue={cue.cueId} style={{ ...layerBox(layer, format), zIndex: LAYER_Z[layer], pointerEvents: 'none' }}>
        {Comp(props)}
      </div>
    );
  });
  const visKey = visible.map((c) => c.cueId).join(',');
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    cb.current?.(visible, now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visKey]);
  return (
    <>
      {rawData.theme.fontUrl ? <style>{`@font-face{font-family:'${CUSTOM_FONT}';src:url(${JSON.stringify(rawData.theme.fontUrl)});font-display:swap;}`}</style> : null}
      {monitor ? <div style={{ position: 'absolute', inset: 0, background: CHECKERBOARD }} /> : null}
      {nodes}
    </>
  );
}

export type AnimKind = 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'scale' | 'wipe' | 'wipe-rtl' | 'wipe-up' | 'grow-x' | 'grow-y' | 'rise' | 'drop' | 'flip' | 'zoom' | 'shine' | 'sweep';

let table: KeyframeTable | undefined;
/** Keyframe animation `name` `localMs` into it (fill both), as plain styles: a still frame for an export. */
function stillAt(name: string, localMs: number, durMs: number, timing: string): CSSProperties {
  table ??= parseKeyframes(KEYFRAMES);
  return sampleKeyframes(table, name, durMs > 0 ? localMs / durMs : 1, timing);
}

/** Timeline offset when this animation was first rendered (constant afterwards). */
function firstOffset(p: GraphicProps, key: string): number {
  if (!p.memo) return p.offsetMs;
  const k = `${p.cue.cueId}:${key}`;
  const hit = p.memo.get(k);
  if (typeof hit === 'number') return hit;
  p.memo.set(k, p.offsetMs);
  return p.offsetMs;
}

/**
 * Entrance/exit animation for a graphic or one of its parts. `delayMs` staggers parts after the graphic's
 * Take In; the exit plays all parts together. A graphic joined mid-animation (refresh, late output) resumes at
 * its timeline offset instead of replaying. The CSS delay is fixed at first render: re-deriving it every frame
 * would advance the animation twice as fast.
 */
export function animStyle(p: GraphicProps, kind: AnimKind, delayMs = 0, durMs?: number): CSSProperties {
  if (p.data.theme.motion === 'none') return {};
  const out = p.phase === 'out';
  // parts may take longer than the graphic's entrance, but every part exits within the graphic's exit time
  const dur = out ? p.t.exitMs : (durMs ?? p.t.entranceMs);
  if (!out && p.offsetMs >= delayMs + dur) return {};
  const name = `bs-${kind}-${out ? 'out' : 'in'}`;
  const timing = out ? 'cubic-bezier(.5,0,.75,0)' : kind === 'zoom' || kind === 'drop' ? 'cubic-bezier(.34,1.56,.64,1)' : 'cubic-bezier(.2,.8,.2,1)';
  if (p.still) return stillAt(name, out ? p.offsetMs : p.offsetMs - delayMs, dur, timing);
  const start = firstOffset(p, `${name}:${delayMs}`);
  return {
    animationName: name,
    animationDuration: `${dur}ms`,
    animationDelay: `${out ? -start : delayMs - start}ms`,
    animationFillMode: 'both',
    animationTimingFunction: timing,
  };
}

/**
 * A part on its own schedule in both phases: in after `inDelay` over `inDur`, out after `outDelay` over `outDur`
 * (all within the graphic's entrance and exit times), so parts can also stagger their exit, e.g. transition bands.
 */
export function partAnim(p: GraphicProps, kind: AnimKind, inDelay: number, inDur: number, outDelay = 0, outDur = p.t.exitMs - outDelay, ease?: { in?: string; out?: string }): CSSProperties {
  if (p.data.theme.motion === 'none') return {};
  const out = p.phase === 'out';
  const delay = out ? outDelay : inDelay;
  const dur = out ? outDur : inDur;
  if (!out && p.offsetMs >= delay + dur) return {};
  const name = `bs-${kind}-${out ? 'out' : 'in'}`;
  const timing = out ? (ease?.out ?? 'cubic-bezier(.55,0,.8,.2)') : (ease?.in ?? 'cubic-bezier(.16,.84,.24,1)');
  if (p.still) return stillAt(name, p.offsetMs - delay, dur, timing);
  const start = firstOffset(p, `${name}:${delay}:part`);
  return {
    animationName: name,
    animationDuration: `${dur}ms`,
    animationDelay: `${delay - start}ms`,
    animationFillMode: 'both',
    animationTimingFunction: timing,
  };
}

/** Staggered entrance for the i-th item of a list (rows, players, stats). */
export const stagger = (p: GraphicProps, i: number, kind: AnimKind = 'rise', startMs = 180, stepMs = 45) => animStyle(p, kind, startMs + i * stepMs, 320);

/** Short emphasis when a live value changes while the graphic is on air (score, period, clock state). */
export function changeStyle(p: GraphicProps, id: string, value: unknown, kind: 'pop' | 'flip' = 'pop', durMs = 700): CSSProperties {
  const still: CSSProperties = { display: 'inline-block' };
  if (!p.memo || p.still || p.data.theme.motion === 'none') return still;
  const k = `chg:${p.cue.cueId}:${id}`;
  let m = p.memo.get(k) as ChangeMemo | undefined;
  if (!m) {
    p.memo.set(k, { v: value, at: -Infinity, n: 0 });
    return still;
  }
  if (m.v !== value) {
    m = { v: value, at: p.now, n: m.n + 1 };
    p.memo.set(k, m);
  }
  const age = p.now - m.at;
  if (age >= durMs) return still;
  m.firstAge ??= age;
  return { ...still, animationName: `bs-${kind}-${m.n % 2 ? 'a' : 'b'}`, animationDuration: `${durMs}ms`, animationDelay: `${-m.firstAge}ms`, animationTimingFunction: 'ease-out' };
}

const kf = (name: string, from: string, to = 'opacity:1;transform:none;clip-path:inset(0 0 0 0)') =>
  `@keyframes bs-${name}-in{from{${from}}to{${to}}}@keyframes bs-${name}-out{from{${to}}to{${from}}}`;

export const KEYFRAMES = [
  kf('fade', 'opacity:0', 'opacity:1'),
  kf('slide-left', 'opacity:0;transform:translateX(-60px)'),
  kf('slide-right', 'opacity:0;transform:translateX(60px)'),
  kf('slide-up', 'opacity:0;transform:translateY(40px)'),
  kf('slide-down', 'opacity:0;transform:translateY(-40px)'),
  kf('scale', 'opacity:0;transform:scale(.85)'),
  kf('zoom', 'opacity:0;transform:scale(.4)'),
  kf('rise', 'opacity:0;transform:translateY(18px)'),
  kf('drop', 'opacity:0;transform:translateY(-24px) scale(1.15)'),
  kf('flip', 'opacity:0;transform:perspective(600px) rotateX(90deg)'),
  kf('wipe', 'clip-path:inset(0 100% 0 0)', 'clip-path:inset(0 0 0 0)'),
  kf('wipe-rtl', 'clip-path:inset(0 0 0 100%)', 'clip-path:inset(0 0 0 0)'),
  kf('wipe-up', 'clip-path:inset(100% 0 0 0)', 'clip-path:inset(0 0 0 0)'),
  kf('grow-x', 'transform:scaleX(0)', 'transform:none'),
  kf('grow-y', 'transform:scaleY(0)', 'transform:none'),
  // transition bands: in from the left and out to the right (onwards, not back), across the whole frame
  '@keyframes bs-sweep-in{from{transform:translateX(-2900px)}to{transform:none}}@keyframes bs-sweep-out{from{transform:none}to{transform:translateX(2900px)}}',
  // value-change emphasis: two identical copies so back-to-back changes restart the animation
  ...['a', 'b'].map((x) => `@keyframes bs-pop-${x}{0%{transform:scale(1)}30%{transform:scale(1.35);filter:brightness(1.6)}100%{transform:scale(1)}}`),
  ...['a', 'b'].map((x) => `@keyframes bs-flip-${x}{0%{transform:perspective(400px) rotateX(-90deg);opacity:.2}60%{transform:perspective(400px) rotateX(10deg);opacity:1}100%{transform:none}}`),
  '@keyframes bs-ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}',
  '@keyframes bs-pulse{0%,100%{opacity:1}50%{opacity:.45}}',
  // one light sweep across a panel as it lands; invisible before and after (the element rests at opacity 0)
  '@keyframes bs-shine-in{0%{opacity:0;transform:translateX(-110%) skewX(-18deg)}20%{opacity:1}100%{opacity:0;transform:translateX(320%) skewX(-18deg)}}@keyframes bs-shine-out{from{opacity:0}to{opacity:0}}',
  // animated background: slow drifts and a breathing glow, transforms and opacity only (cheap in an OBS browser source)
  '@keyframes bs-bd-drift{from{transform:translateX(-4%)}to{transform:translateX(4%)}}',
  '@keyframes bs-bd-sweep{from{transform:translateX(-30%)}to{transform:translateX(30%)}}',
  '@keyframes bs-bd-glow{from{opacity:.45;transform:scale(.9)}to{opacity:1;transform:scale(1.1)}}',
].join('');

export function Keyframes() {
  return <style>{KEYFRAMES}</style>;
}
