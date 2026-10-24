// The graphics of a highlights package, frame by frame: at any time of the package, which graphics are on (from the
// plan's cues, timed as an output would time them), and the match as the picture shows it then (the score and cards
// from the log up to that moment, the clock from the moment's reading; in a replay, the match after its moment). A frame's key changes only when what it
// draws can change, so the browser draws and sends only those frames.
import { effectiveAt, getAdapter, pictureAt, replay, segmentAt, type HighlightOptions, type HighlightPlan, type MatchProjection, type StoredFact } from '@bs/domain';
import { findTemplate, type Layer } from './catalog';
import type { RenderData } from './data';
import type { Cue, OverlayPublicState } from './state';

export const HIGHLIGHTS_FPS = 25;
export const FRAME_MS = 1000 / HIGHLIGHTS_FPS;
/** any fixed instant: every cue is timed from it */
export const ORIGIN = 1_000_000;
/** after a graphic goes on, its parts keep moving for up to this long beyond its own entrance */
const SETTLE_MS = 1_600;

export interface HighlightFrames {
  plan: HighlightPlan;
  facts: StoredFact[];
  overrides: HighlightOptions['overrides'];
  data: RenderData;
}

export interface HighlightFrame {
  data: RenderData;
  state: OverlayPublicState;
  /** the same key: the same picture */
  key: string;
}

const emptyState = (layers: OverlayPublicState['layers'], scorebugVisible: boolean): OverlayPublicState => ({ revision: 1, mode: 'manual', inhibited: false, scorebugVisible, themeVersionId: null, themeProfileVersionId: null, slots: {}, layers });

/** The graphics of a package, ready to be asked for any frame. The replay transition is not in it: see `stingerFrame`. */
export function highlightFrames(src: HighlightFrames) {
  const adapter = getAdapter(src.data.match.sport);
  const cfg = src.data.match.rulesConfig as never;
  // the log in the order the picture reaches it, for the match at any moment
  const facts = [...src.facts].sort((a, b) => a.sequence - b.sequence);
  const times = facts.map((f) => effectiveAt(f, src.overrides));
  const timeOf = new Map(facts.map((f, i) => [f.id, times[i]!]));
  const projections = new Map<string, MatchProjection>();
  const projectionAt = (at: number) => {
    const upTo = facts.filter((_, i) => times[i]! <= at);
    const key = upTo.map((f) => f.sequence).join(',');
    let p = projections.get(key);
    if (!p) {
      p = replay(adapter, cfg, upTo);
      projections.set(key, p);
    }
    return p;
  };
  const base = adapter.initialClocks(cfg);
  const cues = src.plan.cues.filter((c) => c.layer !== 'transition');

  return function frame(ms: number): HighlightFrame {
    const now = ORIGIN + ms;
    const seg = segmentAt(src.plan, ms);
    const at = seg ? pictureAt(seg, ms) : 0;
    // a replay shows the match as it stands after its moment (the strap reads the new score), as a broadcast does
    const projection = projectionAt(seg?.kind === 'replay' ? Math.max(at, ...seg.factIds.map((id) => timeOf.get(id) ?? at)) : at);
    const main = base.main!;
    // the moment's reading, run on (or back) to the picture's time: a clip starts before its moment
    const reading = seg?.clock ? Math.max(0, seg.clock.clockMs + (main.direction === 'down' ? -1 : 1) * (at - seg.clock.at)) : main.baseMs;
    const clocks = { ...base, main: { ...main, baseMs: reading, anchorAt: now, running: true, periodId: projection.phase } };
    const data: RenderData = { ...src.data, match: { ...src.data.match, projection, clocks } };
    // the graphics on: the latest on each layer, as a take-in replaces what is there
    const layers: OverlayPublicState['layers'] = {};
    const parts: string[] = [];
    for (const c of cues) {
      if (ms < c.fromMs) continue;
      const t = findTemplate(c.templateKey);
      if (!t) continue;
      const outAt = c.toMs != null ? c.toMs : c.holdMs != null ? c.fromMs + c.holdMs : null;
      if (outAt != null && ms >= outAt + t.exitMs + FRAME_MS) continue;
      const layer = (c.layer as Layer) ?? t.layer;
      const prev = layers[layer];
      if (prev && prev.startedAt > ORIGIN + c.fromMs) continue;
      // taken out only once its time comes (a renderer treats a cue with an out time as already going out)
      layers[layer] = { cueId: c.id, templateKey: c.templateKey, layer, variables: c.variables, startedAt: ORIGIN + c.fromMs, durationMs: c.toMs == null && c.holdMs != null ? c.holdMs : null, outAt: c.toMs != null && ms >= c.toMs ? ORIGIN + c.toMs : null, source: 'operator' };
      // moving while it comes in and goes out; still in between
      const moving = ms - c.fromMs < t.entranceMs + SETTLE_MS || (outAt != null && ms >= outAt);
      parts.push(`${c.id}:${moving ? Math.round(ms / FRAME_MS) : 'h'}`);
    }
    const d = adapter.display(cfg, projection, clocks, now);
    const key = JSON.stringify([parts.sort(), d.clockText, d.periodShort, d.score, d.stoppageText ?? null, d.addedMinutes ?? null, (d.timers ?? []).map((x) => x.remainingText), d.shootout ?? null, d.possession ?? null, projection.lastFactSequence ?? 0]);
    return { data, state: emptyState(layers, !!layers.scoreboard), key };
  };
}

/** The replay transition alone, `ms` into its run: drawn once and laid over the package at each replay. */
export function stingerFrame(data: RenderData, ms: number, variables: Record<string, unknown> = { teams: true }): { data: RenderData; state: OverlayPublicState; now: number } {
  const t = findTemplate('builtin:replay')!;
  const cue: Cue = { cueId: 'stinger', templateKey: t.key, layer: 'transition', variables, startedAt: ORIGIN, durationMs: t.holdMs, outAt: null, source: 'operator' };
  return { data, state: emptyState({ transition: cue }, false), now: ORIGIN + ms };
}

/** How long the replay transition runs, start to gone. */
export function stingerMs(): number {
  const t = findTemplate('builtin:replay')!;
  return (t.holdMs ?? 0) + t.exitMs;
}
