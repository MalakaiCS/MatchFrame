// Overlay on-air state and the pure command reducer (spec §9.3, §11.3). The same reducer serves operator
// commands and automation cues, so manual safety rules are enforced in exactly one place.
import { findTemplate, LAYER_BLOCKED_BY, LAYER_EXCLUSIONS, LAYERS, validateVariables, type Layer, type TemplateDef } from './catalog';

export interface Cue {
  cueId: string;
  templateKey: string;
  layer: Layer;
  variables: Record<string, unknown>;
  startedAt: number; // server epoch ms of Take In (timeline origin)
  durationMs: number | null; // null = until taken out
  source: 'operator' | 'automation';
  runId?: string | null;
  priority?: number | null;
  sponsor?: { decisionId: string; creativeId: string; campaignId: string | null; placement: string } | null;
  /** set when Take Out was requested: renderer plays exit then removes */
  outAt?: number | null;
}

export interface OverlayPublicState {
  revision: number;
  mode: 'auto' | 'manual';
  inhibited: boolean;
  scorebugVisible: boolean;
  layers: Partial<Record<Layer, Cue>>;
  themeVersionId: string | null;
  themeProfileVersionId: string | null;
}

export type OverlayCommand =
  | { type: 'TAKE_IN'; templateKey: string; variables?: Record<string, unknown>; layer?: Layer; durationMs?: number | null; cueId?: string; force?: boolean; sponsor?: Cue['sponsor'] }
  | { type: 'UPDATE'; layer: Layer; variables: Record<string, unknown> }
  | { type: 'TAKE_OUT'; layer: Layer }
  | { type: 'CLEAR_LAYER'; layer: Layer }
  | { type: 'CLEAR_OUTPUT' } // emergency clear: persistent inhibit
  | { type: 'SHOW_SCOREBUG' }
  | { type: 'HIDE_SCOREBUG' }
  | { type: 'SET_MODE'; mode: 'auto' | 'manual' }
  | { type: 'RESUME' }; // lift emergency inhibit (explicit operator action)

export class OverlayCommandError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
  }
}

export interface ReduceResult {
  state: OverlayPublicState;
  removed: Cue[];
  added: Cue | null;
  /** automation should cancel pending automatic cues (manual mode / emergency) */
  cancelAutomation: boolean;
}

export const emptyState = (): OverlayPublicState => ({ revision: 0, mode: 'auto', inhibited: false, scorebugVisible: false, layers: {}, themeVersionId: null, themeProfileVersionId: null });

/** Cues whose hold has elapsed (plus exit) are no longer on air. */
export function isExpired(c: Cue, now: number, t?: TemplateDef): boolean {
  const exit = t?.exitMs ?? 300;
  if (c.outAt && now >= c.outAt + exit) return true;
  if (c.durationMs != null && now >= c.startedAt + c.durationMs + exit) return true;
  return false;
}

export function pruneExpired(s: OverlayPublicState, now: number, custom: TemplateDef[] = []): { state: OverlayPublicState; removed: Cue[] } {
  const removed: Cue[] = [];
  const layers: OverlayPublicState['layers'] = {};
  for (const [k, c] of Object.entries(s.layers) as [Layer, Cue][]) {
    if (isExpired(c, now, findTemplate(c.templateKey, custom))) removed.push(c);
    else layers[k] = c;
  }
  return { state: removed.length ? { ...s, layers } : s, removed };
}

export function reduceOverlay(
  prev: OverlayPublicState,
  cmd: OverlayCommand,
  ctx: { now: number; source: 'operator' | 'automation' | 'system'; cueId: string; custom?: TemplateDef[]; runId?: string | null; priority?: number | null },
): ReduceResult {
  const { state: s0 } = pruneExpired(prev, ctx.now, ctx.custom);
  const s: OverlayPublicState = { ...s0, layers: { ...s0.layers } };
  const removed: Cue[] = [];
  let added: Cue | null = null;
  let cancelAutomation = false;
  const auto = ctx.source === 'automation';

  if (auto && s.inhibited) throw new OverlayCommandError('OUTPUT_INHIBITED', 'Emergency clear is active; automation cannot take graphics');
  if (auto && s.mode === 'manual' && cmd.type !== 'UPDATE') throw new OverlayCommandError('MANUAL_MODE', 'Overlay is in Manual mode; automatic takes are paused');

  switch (cmd.type) {
    case 'TAKE_IN': {
      if (s.inhibited && ctx.source !== 'system') throw new OverlayCommandError('OUTPUT_INHIBITED', 'Emergency clear is active. Resume output before taking graphics.');
      const t = findTemplate(cmd.templateKey, ctx.custom);
      if (!t) throw new OverlayCommandError('UNKNOWN_TEMPLATE', 'Unknown graphic template', 422);
      const v = validateVariables(t, cmd.variables ?? {});
      if (!v.ok) throw new OverlayCommandError('INVALID_VARIABLES', v.message, 422);
      const layer = cmd.layer && (LAYERS as readonly string[]).includes(cmd.layer) ? cmd.layer : t.layer;
      if (layer === 'scoreboard') {
        s.scorebugVisible = true;
      }
      const blockers = (LAYER_BLOCKED_BY[layer] ?? []).filter((l) => s.layers[l] && !s.layers[l]!.outAt);
      if (blockers.length && !cmd.force) {
        throw new OverlayCommandError('LAYER_CONFLICT', `A ${blockers.join('/')} graphic is on air; take it out first or force the take`);
      }
      // automation may not displace an operator's take; priority preemption between automatic runs is decided upstream
      const existing = s.layers[layer];
      if (auto && existing && existing.source === 'operator' && !existing.outAt) throw new OverlayCommandError('LAYER_BUSY', 'An operator graphic is on this layer');
      for (const l of [layer, ...(LAYER_EXCLUSIONS[layer] ?? []), ...(t.reserves ?? [])]) {
        const c = s.layers[l];
        if (c) {
          removed.push(c);
          delete s.layers[l];
        }
      }
      added = {
        cueId: cmd.cueId ?? ctx.cueId,
        templateKey: t.key,
        layer,
        variables: v.value,
        startedAt: ctx.now,
        durationMs: cmd.durationMs === undefined ? t.holdMs : cmd.durationMs,
        source: auto ? 'automation' : 'operator',
        runId: ctx.runId ?? null,
        priority: ctx.priority ?? null,
        sponsor: cmd.sponsor ?? null,
        outAt: null,
      };
      s.layers[layer] = added;
      break;
    }
    case 'UPDATE': {
      const c = s.layers[cmd.layer];
      if (!c) throw new OverlayCommandError('NOTHING_ON_AIR', 'Nothing is on air on that layer');
      const t = findTemplate(c.templateKey, ctx.custom)!;
      const v = validateVariables(t, { ...c.variables, ...cmd.variables });
      if (!v.ok) throw new OverlayCommandError('INVALID_VARIABLES', v.message, 422);
      s.layers[cmd.layer] = { ...c, variables: v.value };
      break;
    }
    case 'TAKE_OUT': {
      const c = s.layers[cmd.layer];
      if (!c) throw new OverlayCommandError('NOTHING_ON_AIR', 'Nothing is on air on that layer');
      if (auto && c.source === 'operator') throw new OverlayCommandError('LAYER_BUSY', 'Automation cannot take out an operator graphic');
      s.layers[cmd.layer] = { ...c, outAt: ctx.now };
      if (cmd.layer === 'scoreboard') s.scorebugVisible = false;
      break;
    }
    case 'CLEAR_LAYER': {
      const c = s.layers[cmd.layer];
      if (c) {
        removed.push(c);
        delete s.layers[cmd.layer];
      }
      if (cmd.layer === 'scoreboard') s.scorebugVisible = false;
      break;
    }
    case 'CLEAR_OUTPUT': {
      removed.push(...(Object.values(s.layers) as Cue[]));
      s.layers = {};
      s.scorebugVisible = false;
      s.inhibited = true;
      cancelAutomation = true;
      break;
    }
    case 'RESUME': {
      if (auto) throw new OverlayCommandError('FORBIDDEN', 'Only an operator can resume output');
      s.inhibited = false;
      break;
    }
    case 'SHOW_SCOREBUG': {
      if (s.inhibited && ctx.source !== 'system') throw new OverlayCommandError('OUTPUT_INHIBITED', 'Emergency clear is active. Resume output first.');
      s.scorebugVisible = true;
      if (!s.layers.scoreboard) {
        s.layers.scoreboard = { cueId: ctx.cueId, templateKey: 'builtin:scorebug', layer: 'scoreboard', variables: { showSponsor: true }, startedAt: ctx.now, durationMs: null, source: auto ? 'automation' : 'operator', outAt: null };
        added = s.layers.scoreboard;
      } else if (s.layers.scoreboard.outAt) s.layers.scoreboard = { ...s.layers.scoreboard, outAt: null, startedAt: ctx.now };
      break;
    }
    case 'HIDE_SCOREBUG': {
      s.scorebugVisible = false;
      if (s.layers.scoreboard) s.layers.scoreboard = { ...s.layers.scoreboard, outAt: ctx.now };
      break;
    }
    case 'SET_MODE': {
      if (auto) throw new OverlayCommandError('FORBIDDEN', 'Automation cannot change mode');
      if (cmd.mode === s.mode) break;
      s.mode = cmd.mode;
      // Manual: pause automatic takes and cancel pending automatic cues; current graphic stays.
      if (cmd.mode === 'manual') cancelAutomation = true;
      // Auto: clear manual transient layers (those with a finite duration or already taken out); no backlog replay.
      if (cmd.mode === 'auto') {
        for (const [k, c] of Object.entries(s.layers) as [Layer, Cue][]) {
          if (c.source === 'operator' && k !== 'scoreboard' && (c.durationMs != null || c.outAt)) {
            removed.push(c);
            delete s.layers[k];
          }
        }
      }
      break;
    }
  }
  s.revision = prev.revision + 1;
  return { state: s, removed, added, cancelAutomation };
}

/** Elapsed timeline offset for rejoining a cue mid-way (renderer reconnects don't replay entrances). */
export function cueOffset(c: Cue, now: number): number {
  return Math.max(0, now - c.startedAt);
}
