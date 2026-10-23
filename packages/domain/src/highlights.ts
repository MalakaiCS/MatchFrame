// Match highlights from the scorer's log and a video of the match: which moments go in, where each one is in the
// video, and the package's timeline. The package follows a broadcaster's match highlights: a title panel over the
// first clip, the moments in match order with the scorebug as it stood at each one, each goal (try) followed by a
// slow-motion replay introduced by the look's replay transition with the goal strap on it, a red card with its card
// strap, the full-time whistle with the final score, and an end board. Pure: the browser (which draws the graphics)
// and the media worker (which cuts and joins the video) work out the same plan from the same input.
import type { SportAdapter } from './adapter';
import type { StoredFact } from './engine';
import type { Side } from './types';

export type MomentKind = 'score' | 'key' | 'chance' | 'minor' | 'shootout';

interface MomentDef {
  kind: MomentKind;
  label: string;
  /** ms of video before and after the moment the scorer recorded it (they record it a few seconds after) */
  lead: number;
  after: number;
  replay?: boolean;
  /** the card strap shown with the moment */
  card?: 'red' | 'second_yellow' | 'sin_bin';
}

const SCORE = (label: string, replay = true): MomentDef => ({ kind: 'score', label, lead: 20_000, after: 8_000, replay });
const KEY = (label: string, card?: MomentDef['card']): MomentDef => ({ kind: 'key', label, lead: 12_000, after: 6_000, card });
const CHANCE = (label: string): MomentDef => ({ kind: 'chance', label, lead: 10_000, after: 3_000 });
const MINOR = (label: string): MomentDef => ({ kind: 'minor', label, lead: 8_000, after: 3_000 });
const KICK = (label: string): MomentDef => ({ kind: 'shootout', label, lead: 7_000, after: 3_000 });

/** The moments a package can show, by event type. Sports scoring dozens of times a match (basketball, netball) are not offered. */
const MOMENTS: Record<string, MomentDef> = {
  goal: SCORE('Goal'),
  own_goal: SCORE('Own goal'),
  penalty_scored: SCORE('Penalty'),
  ten_metre_scored: SCORE('10 m kick'),
  try: SCORE('Try'),
  penalty_try: SCORE('Penalty try'),
  field_goal: SCORE('Field goal'),
  penalty_goal: { ...KEY('Penalty goal'), after: 4_000 },
  conversion: MINOR('Conversion'),
  red_card: KEY('Red card', 'red'),
  second_yellow: KEY('Second yellow', 'second_yellow'),
  send_off: KEY('Send off', 'red'),
  sin_bin: KEY('Sin bin', 'sin_bin'),
  penalty_missed: KEY('Penalty missed'),
  ten_metre_missed: KEY('10 m kick missed'),
  penalty_stroke_missed: KEY('Penalty stroke missed'),
  shot_on_target: CHANCE('Shot on target'),
  save: CHANCE('Save'),
  shot: CHANCE('Shot'),
  line_break: CHANCE('Line break'),
  shot_off_target: MINOR('Shot off target'),
  corner: MINOR('Corner'),
  penalty_corner: MINOR('Penalty corner'),
  yellow_card: MINOR('Yellow card'),
  green_card: MINOR('Green card'),
  behind: MINOR('Behind'),
  shootout_kick: KICK('Shoot-out kick'),
  shootout_stroke: KICK('Shoot-out'),
};

export const HIGHLIGHT_SPORTS = ['football', 'futsal', 'hockey', 'rugby_league', 'afl'] as const;
/** AFL kicks a goal every few minutes: its goals go in without replays and with less lead-up. */
const AFL_GOAL: MomentDef = { kind: 'score', label: 'Goal', lead: 12_000, after: 4_000, replay: false };

export const HIGHLIGHT_TIMING = {
  introMs: 5_500,
  endCardMs: 5_000,
  crossfadeMs: 300,
  /** a cut hidden behind the replay transition (one frame at 25 fps) */
  cutMs: 40,
  /** the replay: from this long before the recorded moment to this long before it, slowed down */
  replayFrom: 12_000,
  replayTo: 5_000,
  fullTimeLead: 10_000,
  fullTimeAfter: 3_000,
  /** the final score shows for the last part of the full-time clip */
  fullTimeBoardMs: 6_500,
  /** the replay transition covers the picture at this point of its run (the cut) */
  stingerCutMs: 1_000,
  /** windows closer than this are joined into one clip */
  mergeGapMs: 1_500,
};

export const highlightOptionsDefaults = {
  /** about how long the package runs; goals, tries and red cards always go in */
  targetMs: 4 * 60_000,
  kinds: { score: true, key: true, chance: true, minor: false, shootout: true } as Record<MomentKind, boolean>,
  replays: true,
  replaySpeed: 0.75,
  stinger: true,
  intro: true,
  fullTime: true,
  endCard: true,
  /** draw the scorebug (off when the video already shows one) */
  scorebug: true,
  title: 'MATCH HIGHLIGHTS',
  endMessage: 'Thank you for watching',
};
export type HighlightOptions = typeof highlightOptionsDefaults & {
  /** per moment (fact id): left in or out, and moved earlier (-) or later (+) in ms */
  overrides?: Record<string, { include?: boolean; shiftMs?: number }>;
};

/** Where the match is in the video: the video's length and, per period of play, the video time it kicked off. */
export interface VideoSync {
  durationMs: number;
  /** period id ("first_half", "p2") → ms into the video at that period's start */
  anchors: Record<string, number>;
}

export interface HighlightMoment {
  factId: string;
  type: string;
  kind: MomentKind;
  label: string;
  side: Side | null;
  playerId: string | null;
  periodId: string;
  clockMs: number | null;
  minute: number | null;
  /** when it was recorded (server ms), moved by the operator's shift */
  at: number;
  shiftMs: number;
  /** in the package: always for goals and red cards, by the target length for chances */
  included: boolean;
  /** why it is not in (no video at that time, left out, over the target) */
  reason: string | null;
  /** where it is in the video */
  videoMs: number | null;
  replay: boolean;
  card: MomentDef['card'] | null;
}

/** The match clock of a stretch of video: its reading at a known instant, running on from there. */
export interface ClockRef {
  periodId: string;
  clockMs: number;
  at: number;
}

export interface HighlightSegment {
  id: string;
  kind: 'clip' | 'replay' | 'full_time' | 'end_card';
  /** the moments it shows */
  factIds: string[];
  /** the video to cut (end card: none) */
  videoFromMs: number;
  videoToMs: number;
  /** 1 = real time, 0.75 = slow motion */
  speed: number;
  /** server ms at videoFromMs: the match state of the picture is the state at this time plus the time into it */
  atFrom: number;
  clock: ClockRef | null;
  /** where it is in the package, and how it joins the one before (a cross-fade, or a cut under the replay transition) */
  outFromMs: number;
  outToMs: number;
  join: 'none' | 'crossfade' | 'cut';
  joinMs: number;
}

export interface HighlightCue {
  id: string;
  templateKey: string;
  layer: string;
  variables: Record<string, unknown>;
  /** package ms the graphic goes on, and the ms it is taken out (null: stays to the end, or leaves by its own hold) */
  fromMs: number;
  toMs: number | null;
  /** the graphic leaves by itself after this (the template's hold) */
  holdMs?: number | null;
}

export interface HighlightPlan {
  version: 1;
  moments: HighlightMoment[];
  segments: HighlightSegment[];
  cues: HighlightCue[];
  durationMs: number;
  /** changes whenever the input that shapes the package changes (a correction, new sync, other options) */
  key: string;
}

export interface HighlightInput<C> {
  adapter: SportAdapter<C>;
  cfg: C;
  facts: StoredFact[];
  video: VideoSync;
  options: HighlightOptions;
}

const def = (sport: string, type: string): MomentDef | null => (sport === 'afl' && type === 'goal' ? AFL_GOAL : (MOMENTS[type] ?? null));

/** The play periods that started, in order, with the server time each started. */
export function periodStarts<C>(adapter: SportAdapter<C>, cfg: C, facts: StoredFact[]) {
  const out: { periodId: string; at: number }[] = [];
  for (const f of [...facts].sort((a, b) => a.sequence - b.sequence)) {
    if (f.category !== 'phase' || f.voided) continue;
    const to = String(f.payload.to ?? '');
    const kind = adapter.phase(cfg, to)?.kind;
    if ((kind === 'play' || to === 'shootout') && !out.some((p) => p.periodId === to)) out.push({ periodId: to, at: f.occurredAt });
  }
  return out;
}

/** The time the match ended (the move to a final phase), if it did. */
function finalAt<C>(adapter: SportAdapter<C>, cfg: C, facts: StoredFact[]) {
  const f = [...facts].sort((a, b) => a.sequence - b.sequence).find((x) => x.category === 'phase' && !x.voided && adapter.phase(cfg, String(x.payload.to ?? ''))?.kind === 'final');
  return f ? { at: f.occurredAt, periodId: f.periodId, clockMs: f.clockMs ?? null } : null;
}

/**
 * Where a server time is in the video. Each period with an anchor maps from its own kick-off; a period without one
 * follows the last anchored period before it (a recording that ran on without a break), or the first one after it.
 */
export function videoAt(starts: { periodId: string; at: number }[], sync: VideoSync, at: number): number | null {
  const anchored = starts.filter((s) => sync.anchors[s.periodId] != null);
  if (!anchored.length) return null;
  const before = anchored.filter((s) => s.at <= at);
  const ref = before.length ? before[before.length - 1]! : anchored[0]!;
  const ms = sync.anchors[ref.periodId]! + (at - ref.at);
  return ms >= 0 && ms <= sync.durationMs ? ms : null;
}

const hashText = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

export function planHighlights<C>(input: HighlightInput<C>): HighlightPlan {
  const { adapter, cfg, video } = input;
  const o = { ...highlightOptionsDefaults, ...input.options, kinds: { ...highlightOptionsDefaults.kinds, ...input.options.kinds } };
  const T = HIGHLIGHT_TIMING;
  const facts = input.facts.filter((f) => !f.voided);
  const starts = periodStarts(adapter, cfg, facts);
  const overrides = o.overrides ?? {};

  // ---- the moments
  const moments: HighlightMoment[] = [];
  const offered = (HIGHLIGHT_SPORTS as readonly string[]).includes(adapter.sport);
  for (const f of [...facts].sort((a, b) => a.occurredAt - b.occurredAt || a.sequence - b.sequence)) {
    if (f.category !== 'event' || !offered) continue;
    const d = def(adapter.sport, f.type);
    if (!d) continue;
    const ov = overrides[f.id] ?? {};
    const shiftMs = Math.max(-60_000, Math.min(60_000, ov.shiftMs ?? 0));
    const at = f.occurredAt + shiftMs;
    const videoMs = videoAt(starts, video, at);
    moments.push({
      factId: f.id, type: f.type, kind: d.kind, label: d.label, side: (f.side as Side | null) ?? null, playerId: f.playerId ?? null, periodId: f.periodId,
      clockMs: f.clockMs ?? null, minute: adapter.minuteOf?.(cfg, f.periodId, f.clockMs ?? null) ?? (f.clockMs != null ? Math.floor(f.clockMs / 60_000) + 1 : null),
      at, shiftMs, included: false, reason: null, videoMs, replay: !!d.replay && o.replays, card: d.card ?? null,
    });
  }
  const window = (m: HighlightMoment) => {
    const d = def(adapter.sport, m.type)!;
    return { from: m.videoMs! - d.lead, to: m.videoMs! + d.after };
  };
  for (const m of moments) {
    const ov = overrides[m.factId] ?? {};
    if (m.videoMs == null) m.reason = 'Not in the video (check the kick-off times)';
    else if (ov.include === false) m.reason = 'Left out';
    else if (ov.include === true || ((m.kind === 'score' || m.kind === 'key' || m.kind === 'shootout') && o.kinds[m.kind])) m.included = true;
    else if (!o.kinds[m.kind]) m.reason = 'Not chosen';
  }

  // ---- fill to the target with chances (then minor moments), each time the one furthest from what is in
  const ft = o.fullTime ? finalAt(adapter, cfg, facts) : null;
  const ftVideo = ft ? videoAt(starts, video, ft.at) : null;
  const estimate = () => {
    const clips = mergeWindows(moments.filter((m) => m.included).map((m) => ({ ...window(m), periodId: m.periodId, ids: [m.factId] })), video.durationMs);
    let ms = clips.reduce((n, c) => n + (c.to - c.from), 0);
    ms += moments.filter((m) => m.included && m.replay).length * ((T.replayFrom - T.replayTo) / o.replaySpeed);
    if (o.endCard) ms += T.endCardMs;
    if (ftVideo != null) ms += T.fullTimeLead + T.fullTimeAfter;
    return ms;
  };
  for (const kind of ['chance', 'minor'] as const) {
    if (!o.kinds[kind]) continue;
    const pool = moments.filter((m) => m.kind === kind && !m.included && m.videoMs != null && overrides[m.factId]?.include !== false);
    while (pool.length) {
      const inAt = moments.filter((m) => m.included).map((m) => m.at);
      pool.sort((a, b) => dist(b.at, inAt) - dist(a.at, inAt) || a.at - b.at);
      const next = pool.shift()!;
      next.included = true;
      if (estimate() > o.targetMs) {
        next.included = false;
        next.reason = 'Over the package length';
        for (const m of pool) m.reason = 'Over the package length';
        break;
      }
    }
  }

  // ---- clips: overlapping windows (within one period) joined, each goal's replay after its clip
  const segs: Omit<HighlightSegment, 'outFromMs' | 'outToMs' | 'join' | 'joinMs'>[] = [];
  const included = moments.filter((m) => m.included);
  const clips = mergeWindows(included.map((m) => ({ ...window(m), periodId: m.periodId, ids: [m.factId] })), video.durationMs);
  const byId = new Map(moments.map((m) => [m.factId, m]));
  // the full-time whistle: its own clip, or the end of the last clip when they meet
  let ftClip: { from: number; to: number } | null = null;
  if (ft && ftVideo != null) {
    ftClip = { from: Math.max(0, ftVideo - T.fullTimeLead), to: Math.min(video.durationMs, ftVideo + T.fullTimeAfter) };
    const last = clips[clips.length - 1];
    if (last && ftClip.from - last.to < T.mergeGapMs && ftClip.from >= last.from) {
      ftClip.from = last.to;
      if (ftClip.to - ftClip.from < 2_000) ftClip = null;
    }
  }
  // the server time a point of the video shows, through the moment's place in it (one period: one straight line)
  const atOf = (videoMs: number, m: HighlightMoment) => m.at + (videoMs - m.videoMs!);
  // the match clock of the moment: its reading when it was recorded (before any shift)
  const clockOf = (m: HighlightMoment): ClockRef | null => (m.clockMs != null ? { periodId: m.periodId, clockMs: m.clockMs, at: m.at - m.shiftMs } : null);
  clips.forEach((c, i) => {
    const first = byId.get(c.ids[0]!)!;
    segs.push({ id: `clip-${i + 1}`, kind: 'clip', factIds: c.ids, videoFromMs: c.from, videoToMs: c.to, speed: 1, atFrom: atOf(c.from, first), clock: clockOf(first) });
    for (const id of c.ids) {
      const m = byId.get(id)!;
      if (!m.replay || m.videoMs == null) continue;
      const from = Math.max(0, m.videoMs - T.replayFrom);
      const to = Math.max(from + 1_000, m.videoMs - T.replayTo);
      segs.push({ id: `replay-${m.factId}`, kind: 'replay', factIds: [m.factId], videoFromMs: from, videoToMs: Math.min(video.durationMs, to), speed: o.replaySpeed, atFrom: atOf(from, m), clock: clockOf(m) });
    }
  });
  if (ftClip && ft) segs.push({ id: 'full-time', kind: 'full_time', factIds: [], videoFromMs: ftClip.from, videoToMs: ftClip.to, speed: 1, atFrom: ft.at - (ftVideo! - ftClip.from), clock: ft.clockMs != null ? { periodId: ft.periodId, clockMs: ft.clockMs, at: ft.at } : null });
  if (o.endCard && segs.length) segs.push({ id: 'end-card', kind: 'end_card', factIds: [], videoFromMs: 0, videoToMs: 0, speed: 1, atFrom: ft?.at ?? 0, clock: null });

  // ---- the package timeline: each segment after the one before, overlapping by its join
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [i, s] of segs.entries()) {
    const len = s.kind === 'end_card' ? T.endCardMs : (s.videoToMs - s.videoFromMs) / s.speed;
    const join: HighlightSegment['join'] = i === 0 ? 'none' : s.kind === 'replay' && o.stinger ? 'cut' : 'crossfade';
    const joinMs = join === 'none' ? 0 : join === 'cut' ? T.cutMs : s.kind === 'end_card' ? 500 : T.crossfadeMs;
    const outFromMs = Math.max(0, cursor - joinMs);
    segments.push({ ...s, outFromMs: Math.round(outFromMs), outToMs: Math.round(outFromMs + len), join, joinMs });
    cursor = outFromMs + len;
  }
  const durationMs = Math.round(cursor);

  // ---- the graphics over it
  const cues: HighlightCue[] = [];
  const firstClip = segments.find((s) => s.kind !== 'end_card');
  const endCard = segments.find((s) => s.kind === 'end_card');
  if (o.intro && firstClip) cues.push({ id: 'intro', templateKey: 'builtin:highlights_intro', layer: 'fullframe', variables: { title: o.title }, fromMs: 0, toMs: T.introMs });
  if (o.scorebug && firstClip) cues.push({ id: 'scorebug', templateKey: 'builtin:scorebug', layer: 'scoreboard', variables: { showSponsor: false }, fromMs: o.intro ? T.introMs - 200 : 300, toMs: endCard ? endCard.outFromMs : null });
  for (const s of segments) {
    if (s.kind === 'replay') {
      const m = byId.get(s.factIds[0]!)!;
      if (o.stinger) cues.push({ id: `stinger-${m.factId}`, templateKey: 'builtin:replay', layer: 'transition', variables: { teams: true }, fromMs: Math.max(0, s.outFromMs - T.stingerCutMs), toMs: null, holdMs: 1_200 });
      cues.push({ id: `strap-${m.factId}`, templateKey: 'builtin:goal', layer: 'event', variables: strapVars(m), fromMs: s.outFromMs + (o.stinger ? 900 : 400), toMs: Math.max(s.outFromMs + 2_500, s.outToMs - 600) });
    }
    if (s.kind === 'clip') {
      for (const id of s.factIds) {
        const m = byId.get(id)!;
        const at = s.outFromMs + (m.videoMs! - s.videoFromMs);
        if (m.card) cues.push({ id: `card-${m.factId}`, templateKey: 'builtin:card', layer: 'event', variables: { team: m.side ?? 'home', ...(m.playerId ? { player: m.playerId } : {}), cardType: m.card === 'red' ? 'red' : m.card, ...(m.minute != null ? { minute: String(m.minute) } : {}) }, fromMs: at + 500, toMs: Math.min(s.outToMs - 200, at + 5_500) });
        // a goal with no replay to show it: the strap over the celebration
        else if (m.kind === 'score' && !m.replay) cues.push({ id: `strap-${m.factId}`, templateKey: 'builtin:goal', layer: 'event', variables: strapVars(m), fromMs: at + 500, toMs: Math.min(s.outToMs - 200, at + 6_000) });
      }
    }
    if (s.kind === 'full_time') cues.push({ id: 'full-time', templateKey: 'builtin:break_score', layer: 'fullframe', variables: { label: 'FULL TIME', showSponsor: false }, fromMs: Math.max(s.outFromMs, s.outToMs - T.fullTimeBoardMs), toMs: endCard ? s.outToMs - 100 : null });
    if (s.kind === 'end_card') {
      cues.push({ id: 'end-background', templateKey: 'builtin:backdrop', layer: 'background', variables: { motion: true }, fromMs: s.outFromMs, toMs: null });
      cues.push({ id: 'end-header', templateKey: 'builtin:ident', layer: 'fullframe', variables: { show: 'score', showCountdown: false, ...(o.endMessage ? { message: o.endMessage } : {}) }, fromMs: s.outFromMs + 300, toMs: null });
    }
  }

  const key = hashText(JSON.stringify({ v: 1, f: facts.map((f) => [f.id, f.revision, f.occurredAt, f.clockMs]), video, o: { ...o, overrides: o.overrides ?? {} } }));
  return { version: 1, moments, segments, cues, durationMs, key };
}

function strapVars(m: HighlightMoment): Record<string, unknown> {
  return { team: m.side ?? 'home', ...(m.playerId ? { player: m.playerId } : {}), eventType: m.type, ...(m.minute != null ? { minute: String(m.minute) } : {}) };
}

const dist = (at: number, others: number[]) => (others.length ? Math.min(...others.map((x) => Math.abs(x - at))) : Number.MAX_SAFE_INTEGER);

/** Windows clamped to the video and joined where they overlap or nearly touch, within one period. */
function mergeWindows(ws: { from: number; to: number; periodId: string; ids: string[] }[], durationMs: number) {
  const sorted = ws.map((w) => ({ ...w, from: Math.max(0, w.from), to: Math.min(durationMs, w.to) })).filter((w) => w.to - w.from >= 1_000).sort((a, b) => a.from - b.from);
  const out: typeof sorted = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && last.periodId === w.periodId && w.from - last.to < HIGHLIGHT_TIMING.mergeGapMs) {
      last.to = Math.max(last.to, w.to);
      last.ids.push(...w.ids);
    } else out.push({ ...w, ids: [...w.ids] });
  }
  return out;
}

/** The server time a fact counts from in the package: a moment moved by the operator moves its fact with it. */
export function effectiveAt(f: Pick<StoredFact, 'id' | 'occurredAt'>, overrides: HighlightOptions['overrides']): number {
  return f.occurredAt + Math.max(-60_000, Math.min(60_000, overrides?.[f.id]?.shiftMs ?? 0));
}

/** The segment showing at package time `ms` (in a cross-fade, the incoming one from its middle). */
export function segmentAt(plan: Pick<HighlightPlan, 'segments'>, ms: number): HighlightSegment | null {
  let cur: HighlightSegment | null = null;
  for (const s of plan.segments) if (ms >= s.outFromMs + s.joinMs / 2 || (!cur && ms >= s.outFromMs)) cur = s;
  return cur;
}

/** The server time the picture shows at package time `ms` (the match state of the graphics follows it). */
export function pictureAt(s: HighlightSegment, ms: number): number {
  return s.atFrom + Math.max(0, ms - s.outFromMs) * s.speed;
}
