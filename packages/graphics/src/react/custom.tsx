'use client';
// Renders published designer scenes. Only validated element types and bindings exist here.
import type { CSSProperties } from 'react';
import { resolveBinding, type Binding } from '../bindings';
import type { Scene, SceneElement } from '../scene';
import { findTemplate, type TemplateDef } from '../catalog';
import { animStyle, type GraphicProps } from './stage';
import { Fitted } from './common';

const isBinding = (v: unknown): v is Binding => !!v && typeof v === 'object' && 'binding' in (v as object);

function anchorOffset(e: SceneElement): CSSProperties {
  const [v, h] = [e.anchor[0], e.anchor[1]];
  const tx = h === 'c' ? -e.w / 2 : h === 'r' ? -e.w : 0;
  const ty = v === 'm' ? -e.h / 2 : v === 'b' ? -e.h : 0;
  return { left: e.x + tx, top: e.y + ty, width: e.w, height: e.h };
}

function El({ e, p }: { e: SceneElement; p: GraphicProps }) {
  if (e.hidden) return null;
  const ctx = { data: p.data, variables: p.cue.variables, now: p.now, playerId: (p.cue.variables.player as string) ?? null };
  const val = (v: unknown, fallback = '') => (isBinding(v) ? resolveBinding(v, ctx) : typeof v === 'string' ? v : fallback);
  const kind = e.animation.in === 'none' ? 'fade' : e.animation.in;
  const base: CSSProperties = { position: 'absolute', ...anchorOffset(e), opacity: e.opacity, zIndex: e.z, ...(e.animation.in === 'none' && p.phase === 'in' ? {} : animStyle(p, kind, e.animation.delayMs)) };
  switch (e.type) {
    case 'rect':
      return <div style={{ ...base, background: val(e.fill, '#131F32'), borderRadius: e.radius, border: e.stroke ? `${e.strokeWidth ?? 1}px solid ${e.stroke}` : undefined }} />;
    case 'text': {
      const text = val(e.text);
      const shown = e.uppercase ? text.toUpperCase() : text;
      return (
        <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: e.align === 'center' ? 'center' : e.align === 'right' ? 'flex-end' : 'flex-start', color: val(e.color, '#FFFFFF'), fontFamily: p.data.theme.font }}>
          <Fitted full={shown} width={e.w} fontPx={e.fontSize} minFontPx={e.minFontSize ?? Math.round(e.fontSize * 0.65)} weight={e.fontWeight} measure={p.measure} />
        </div>
      );
    }
    case 'image': {
      const src = e.assetId ? p.data.assets[e.assetId] : e.source ? resolveBinding(e.source, ctx) : null;
      return src ? <img alt="" src={src} style={{ ...base, objectFit: e.fit }} /> : <div style={{ ...base, background: 'rgba(255,255,255,.06)' }} />;
    }
    case 'sponsor_slot': {
      const c = p.creative(e.placement, p.cue);
      return c ? <img alt={c.brandName} src={c.url} style={{ ...base, objectFit: 'contain' }} data-sponsor-creative={c.id} /> : null;
    }
    case 'group':
      return (
        <div style={base}>
          {e.children.map((c) => (
            <El key={c.id} e={{ ...c, x: c.x - e.x, y: c.y - e.y } as SceneElement} p={p} />
          ))}
        </div>
      );
  }
}

export function renderCustomScene(p: GraphicProps) {
  const scene = p.data.customTemplates.find((c) => c.key === p.cue.templateKey)?.scene as Scene | undefined;
  if (!scene) return null;
  return (
    <div style={{ position: 'absolute', inset: 0 }} data-graphic={p.cue.templateKey}>
      {[...scene.elements].sort((a, b) => a.z - b.z).map((e) => <El key={e.id} e={e} p={p} />)}
    </div>
  );
}

/** TemplateDefs for published custom scenes, so the reducer and catalogue treat them like built-ins. */
export function customDefsFrom(list: { key: string; scene: unknown }[]): TemplateDef[] {
  return list.map(({ key, scene }) => {
    const s = scene as Scene;
    return { key, name: s.name, category: s.category, sports: s.sports, layer: s.layer, variables: s.variables, requiredData: [], entranceMs: s.entranceMs, holdMs: s.holdMs, exitMs: s.exitMs, sponsorSlots: [], bounds: { x: 0, y: 0, w: 1, h: 1 } };
  });
}

export { findTemplate };
