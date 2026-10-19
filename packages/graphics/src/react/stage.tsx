'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getAdapter, type DisplayModel } from '@bs/domain';
import { findTemplate, LAYER_Z, type Layer, type TemplateDef } from '../catalog';
import type { Cue, OverlayPublicState } from '../state';
import type { RenderCreative, RenderData } from '../data';
import { canvasMeasure, type Measure } from '../fit';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** Scales the 1920×1080 logical stage into its container without changing placement. */
export function Stage({ children, background = 'transparent', className, style }: { children: ReactNode; background?: string; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H) || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={{ position: 'absolute', left: '50%', top: '50%', width: STAGE_W, height: STAGE_H, marginLeft: -STAGE_W / 2, marginTop: -STAGE_H / 2, transform: `scale(${scale})`, transformOrigin: '50% 50%', background, overflow: 'hidden', ...style }}>
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
}

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
}

function phaseOf(c: Cue, t: TemplateDef, now: number): { phase: 'in' | 'hold' | 'out'; offset: number } {
  if (c.outAt) return { phase: 'out', offset: Math.max(0, now - c.outAt) };
  if (c.durationMs != null && now >= c.startedAt + c.durationMs) return { phase: 'out', offset: now - (c.startedAt + c.durationMs) };
  const off = Math.max(0, now - c.startedAt);
  return { phase: off < t.entranceMs ? 'in' : 'hold', offset: off };
}

/** Renders the on-air state from an explicit snapshot. Shared by overlay, preview, rehearsal and programme. */
export function Renderer({ state, data, themes, serverNow, customDefs = [], renderCustom, onVisible, slots, monitor }: RendererProps) {
  const now = useNow(serverNow);
  const adapter = getAdapter(data.match.sport);
  const display = adapter.display(data.match.rulesConfig as never, data.match.projection, data.match.clocks, now);
  const measure = useRef<Measure>(canvasMeasure(data.theme.font)).current;
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
  const nodes = cues.map(([layer, cue]) => {
    const t = findTemplate(cue.templateKey, customDefs);
    if (!t) return null;
    const { phase, offset } = phaseOf(cue, t, now);
    if (phase === 'out' && offset > t.exitMs) return null;
    if (phase !== 'out') visible.push(cue);
    const props: GraphicProps = { cue, t, data, display, now, measure, creative, phase, offsetMs: offset };
    const Comp = cue.templateKey.startsWith('custom:') ? renderCustom : comps[cue.templateKey.replace('builtin:', '')];
    if (!Comp) return null;
    return (
      <div key={`${layer}:${cue.cueId}`} data-layer={layer} data-cue={cue.cueId} style={{ position: 'absolute', inset: 0, zIndex: LAYER_Z[layer], pointerEvents: 'none' }}>
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
      {monitor ? <div style={{ position: 'absolute', inset: 0, background: CHECKERBOARD }} /> : null}
      {nodes}
    </>
  );
}

/** Entrance/exit animation that rejoins at the current timeline offset (negative delay) instead of replaying. */
export function animStyle(p: GraphicProps, kind: 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'scale' | 'wipe', delayMs = 0): CSSProperties {
  const dur = p.phase === 'out' ? p.t.exitMs : p.t.entranceMs;
  if (p.phase === 'hold' || p.data.theme.motion === 'none') return {};
  const name = `bs-${kind}-${p.phase}`;
  return { animationName: name, animationDuration: `${dur}ms`, animationDelay: `${delayMs - p.offsetMs}ms`, animationFillMode: 'both', animationTimingFunction: p.phase === 'in' ? 'cubic-bezier(.2,.8,.2,1)' : 'ease-in' };
}

export const KEYFRAMES = `
@keyframes bs-fade-in{from{opacity:0}to{opacity:1}}@keyframes bs-fade-out{from{opacity:1}to{opacity:0}}
@keyframes bs-slide-left-in{from{opacity:0;transform:translateX(-60px)}to{opacity:1;transform:none}}@keyframes bs-slide-left-out{from{opacity:1;transform:none}to{opacity:0;transform:translateX(-60px)}}
@keyframes bs-slide-right-in{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:none}}@keyframes bs-slide-right-out{from{opacity:1;transform:none}to{opacity:0;transform:translateX(60px)}}
@keyframes bs-slide-up-in{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}@keyframes bs-slide-up-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(40px)}}
@keyframes bs-scale-in{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}@keyframes bs-scale-out{from{opacity:1;transform:none}to{opacity:0;transform:scale(.92)}}
@keyframes bs-wipe-in{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}@keyframes bs-wipe-out{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 0 100%)}}
@keyframes bs-ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
`;

export function Keyframes() {
  return <style>{KEYFRAMES}</style>;
}
