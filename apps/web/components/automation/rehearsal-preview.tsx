'use client';
// Plays a rehearsal's cue list through the real graphics renderer, so a plan can be watched before match day.
import type { Sport } from '@bs/domain';
import { useMemo, useRef } from 'react';
import { DEFAULT_THEMES, emptyState, type Cue, type Layer, type OverlayPublicState, type ThemeConfig } from '@bs/graphics';
import { Keyframes, Renderer, Stage, THEMES } from '@bs/graphics/react';
import { SAMPLE_MEDIA, SAMPLE_SLOTS, SAMPLE_SPONSOR, sampleData } from '@/components/theme-preview';

export interface RehearsalCue { t: number; playlistId: string; runId: string; action: string; templateKey?: string; layer: string | null; variables?: Record<string, unknown>; durationMs: number | null; placement?: string }

const PITCH = 'linear-gradient(180deg, #24476b 0%, #1d3b2a 55%, #2f6b3c 100%)';

/** The on-air state at rehearsal time `t`: cues applied in order, finished ones removed once their exit is over. */
export function stateAt(cues: RehearsalCue[], t: number, base: number): OverlayPublicState {
  const s = emptyState();
  const cue = (c: RehearsalCue, templateKey: string, layer: Layer, variables: Record<string, unknown>): Cue => ({ cueId: `${c.runId}:${c.t}:${layer}`, templateKey, layer, variables, startedAt: base + c.t, durationMs: c.durationMs, source: 'automation' });
  for (const c of cues.filter((x) => x.t <= t && !x.action.includes('cancelled')).sort((a, b) => a.t - b.t)) {
    switch (c.action) {
      case 'scorebug_show':
        s.scorebugVisible = true;
        s.layers.scoreboard = { ...cue(c, 'builtin:scorebug', 'scoreboard', { showSponsor: true }), durationMs: null };
        break;
      case 'scorebug_hide':
        s.scorebugVisible = false;
        break;
      case 'clear_layers':
        for (const l of ['fullframe', 'background', 'lower'] as Layer[]) delete s.layers[l];
        break;
      case 'show':
        if (c.templateKey && c.layer) s.layers[c.layer as Layer] = cue(c, c.templateKey, c.layer as Layer, c.variables ?? {});
        break;
      case 'sponsor':
      case 'creative': {
        const layer: Layer = c.placement?.startsWith('full_frame') ? 'fullframe' : c.placement === 'lower_third_banner' ? 'lower' : 'sponsor';
        s.layers[layer] = cue(c, 'builtin:sponsor', layer, { creative: SAMPLE_SPONSOR, placement: c.placement ?? 'detached_logo' });
        break;
      }
      case 'media':
        s.layers.fullframe = cue(c, 'builtin:full_frame_media', 'fullframe', { image: SAMPLE_MEDIA, fit: 'cover', audio: 'muted' });
        break;
    }
  }
  for (const [l, c] of Object.entries(s.layers) as [Layer, Cue][]) if (c.durationMs != null && t > c.startedAt - base + c.durationMs + 600) delete s.layers[l];
  return s;
}

export function RehearsalPreview({ cues, t, sport, themeKey = 'broadcast' }: { cues: RehearsalCue[]; t: number; sport: Sport; themeKey?: ThemeConfig['themeKey'] }) {
  const base = useRef(Date.now()).current;
  const data = useMemo(() => sampleData(DEFAULT_THEMES[themeKey], sport), [themeKey, sport]);
  const state = useMemo(() => stateAt(cues, t, base), [cues, t, base]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-md border border-border" data-testid="rehearsal-stage">
      <Keyframes />
      <Stage background={PITCH}>
        <Renderer state={state} data={data} themes={THEMES} serverNow={() => base + t} slots={SAMPLE_SLOTS} />
      </Stage>
    </div>
  );
}
