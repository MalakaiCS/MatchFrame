// Built-in graphic catalogue (spec §9.1). Each template declares sports, typed variables, required data,
// occupied layers, entrance/hold/exit durations, safe bounds and sponsor slots.
import { SPORTS, type Sport } from '@bs/domain';
import { z } from 'zod';

export const LAYERS = ['background', 'fullframe', 'scoreboard', 'event', 'lower', 'ticker', 'sponsor', 'transition'] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * Layer z-order (bottom → top). The full-screen background and the boards on it (match header, stats, line-ups)
 * cover every in-play graphic, scorebug included; only the stinger transition plays over them.
 */
export const LAYER_Z: Record<Layer, number> = { scoreboard: 30, event: 40, lower: 45, ticker: 50, sponsor: 60, background: 70, fullframe: 80, transition: 90 };

/** Taking a graphic onto `key` removes graphics on these layers (incompatible stacking). */
export const LAYER_EXCLUSIONS: Partial<Record<Layer, Layer[]>> = {
  fullframe: ['event', 'lower', 'ticker', 'sponsor'],
  // a background is the canvas the boards sit on: it clears the small graphics but keeps the board above it
  background: ['event', 'lower', 'ticker', 'sponsor'],
};
/** While these layers are on air, small-format takes onto the listed layers are refused unless forced. */
export const LAYER_BLOCKED_BY: Partial<Record<Layer, Layer[]>> = {
  event: ['fullframe', 'background'],
  lower: ['fullframe', 'background'],
  ticker: ['fullframe', 'background'],
  sponsor: ['fullframe', 'background'],
};

export const variableSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  label: z.string().max(60),
  type: z.enum(['text', 'number', 'boolean', 'team', 'player', 'image', 'stat', 'select', 'creative']),
  required: z.boolean().default(false),
  maxLength: z.number().int().min(1).max(500).optional(),
  options: z.array(z.string()).optional(),
  default: z.unknown().optional(),
});
export type VariableDef = z.input<typeof variableSchema>;

export type Category = 'Scorebug' | 'Match' | 'Teams' | 'Events' | 'Stats' | 'People' | 'Sponsors' | 'Media';

export interface TemplateDef {
  key: string; // builtin:<name> or custom:<versionId>
  name: string;
  category: Category;
  sports: Sport[];
  layer: Layer;
  /** extra layers reserved while on air */
  reserves?: Layer[];
  variables: VariableDef[];
  requiredData: ('teams' | 'score' | 'clock' | 'lineup' | 'stats' | 'player' | 'creative' | 'media')[];
  entranceMs: number;
  holdMs: number | null; // null = until taken out
  exitMs: number;
  sponsorSlots: string[];
  /** fraction of stage, inside title-safe area */
  bounds: { x: number; y: number; w: number; h: number };
}

const both: Sport[] = [...SPORTS];

export const BUILTIN_TEMPLATES: TemplateDef[] = [
  {
    key: 'builtin:scorebug', name: 'Scorebug', category: 'Scorebug', sports: both, layer: 'scoreboard',
    variables: [{ key: 'showSponsor', label: 'Sponsor slot', type: 'boolean', required: false, default: true }],
    requiredData: ['teams', 'score', 'clock'], entranceMs: 300, holdMs: null, exitMs: 250, sponsorSlots: ['scorebug_logo'], bounds: { x: 0.05, y: 0.05, w: 0.42, h: 0.08 },
  },
  {
    key: 'builtin:ident', name: 'Match header', category: 'Match', sports: both, layer: 'fullframe',
    variables: [
      { key: 'showCountdown', label: 'Countdown (to kick-off, or to the restart at a break)', type: 'boolean', required: false, default: true },
      { key: 'show', label: 'Shows', type: 'select', options: ['auto', 'countdown', 'score'], required: false, default: 'auto' },
      { key: 'message', label: 'Message', type: 'text', required: false, maxLength: 60 },
    ],
    // stays up until it is taken off (or the walk-out clears it): before the match it is the holding picture
    requiredData: ['teams'], entranceMs: 350, holdMs: null, exitMs: 300, sponsorSlots: ['detached_logo'], bounds: { x: 0.15, y: 0.25, w: 0.7, h: 0.5 },
  },
  {
    key: 'builtin:lineup', name: 'Team lineup', category: 'Teams', sports: both, layer: 'fullframe',
    variables: [
      { key: 'team', label: 'Team', type: 'team', required: true },
      { key: 'page', label: 'Page', type: 'number', required: false, default: 1 },
    ],
    requiredData: ['teams', 'lineup'], entranceMs: 350, holdMs: 10000, exitMs: 300, sponsorSlots: [], bounds: { x: 0.2, y: 0.12, w: 0.6, h: 0.76 },
  },
  {
    key: 'builtin:goal', name: 'Goal / score event', category: 'Events', sports: ['football', 'netball', 'rugby_league', 'afl', 'hockey'], layer: 'event',
    variables: [
      { key: 'team', label: 'Team', type: 'team', required: true },
      { key: 'player', label: 'Scorer', type: 'player', required: false },
      { key: 'assist', label: 'Assist', type: 'player', required: false },
      { key: 'minute', label: 'Minute', type: 'text', required: false, maxLength: 8 },
      { key: 'eventType', label: 'Type', type: 'select', options: ['goal', 'own_goal', 'penalty_scored', 'try', 'penalty_try', 'conversion', 'penalty_goal', 'field_goal', 'behind'], required: false, default: 'goal' },
      { key: 'points', label: 'Points', type: 'number', required: false },
    ],
    requiredData: ['teams', 'score'], entranceMs: 300, holdMs: 7000, exitMs: 250, sponsorSlots: ['event_partner'], bounds: { x: 0.05, y: 0.72, w: 0.5, h: 0.14 },
  },
  {
    key: 'builtin:score', name: 'Score update', category: 'Events', sports: ['basketball'], layer: 'event',
    variables: [
      { key: 'team', label: 'Team', type: 'team', required: true },
      { key: 'player', label: 'Player', type: 'player', required: false },
      { key: 'points', label: 'Points', type: 'number', required: false },
    ],
    requiredData: ['teams', 'score'], entranceMs: 250, holdMs: 5000, exitMs: 200, sponsorSlots: ['event_partner'], bounds: { x: 0.05, y: 0.72, w: 0.5, h: 0.14 },
  },
  {
    key: 'builtin:card', name: 'Card', category: 'Events', sports: ['football', 'hockey', 'rugby_league'], layer: 'event',
    variables: [
      { key: 'team', label: 'Team', type: 'team', required: true },
      { key: 'player', label: 'Player', type: 'player', required: false },
      { key: 'cardType', label: 'Card', type: 'select', options: ['yellow', 'second_yellow', 'red', 'green', 'sin_bin'], required: true, default: 'yellow' },
      { key: 'minute', label: 'Minute', type: 'text', required: false, maxLength: 8 },
    ],
    requiredData: ['teams'], entranceMs: 300, holdMs: 6000, exitMs: 250, sponsorSlots: [], bounds: { x: 0.05, y: 0.72, w: 0.45, h: 0.14 },
  },
  {
    key: 'builtin:substitution', name: 'Substitution', category: 'Events', sports: both, layer: 'event',
    variables: [
      { key: 'team', label: 'Team', type: 'team', required: true },
      { key: 'playerOut', label: 'Player off', type: 'player', required: false },
      { key: 'playerIn', label: 'Player on', type: 'player', required: false },
      { key: 'minute', label: 'Minute', type: 'text', required: false, maxLength: 8 },
    ],
    requiredData: ['teams'], entranceMs: 300, holdMs: 7000, exitMs: 250, sponsorSlots: [], bounds: { x: 0.05, y: 0.7, w: 0.5, h: 0.16 },
  },
  {
    key: 'builtin:period_banner', name: 'Kick-off / period banner', category: 'Match', sports: both, layer: 'lower',
    variables: [
      { key: 'heading', label: 'Heading', type: 'text', required: false, maxLength: 32, default: 'KICK-OFF' },
      { key: 'period', label: 'Period (blank = current)', type: 'text', required: false, maxLength: 32 },
    ],
    requiredData: ['teams', 'score'], entranceMs: 400, holdMs: 5000, exitMs: 300, sponsorSlots: ['lower_third_banner'], bounds: { x: 0.2, y: 0.72, w: 0.6, h: 0.18 },
  },
  {
    key: 'builtin:lower_third', name: 'Lower third', category: 'People', sports: both, layer: 'lower',
    variables: [
      { key: 'heading', label: 'Heading', type: 'text', required: true, maxLength: 48 },
      { key: 'subtitle', label: 'Subtitle', type: 'text', required: false, maxLength: 72 },
      { key: 'image', label: 'Image', type: 'image', required: false },
    ],
    requiredData: [], entranceMs: 300, holdMs: null, exitMs: 250, sponsorSlots: ['lower_third_banner'], bounds: { x: 0.05, y: 0.76, w: 0.55, h: 0.12 },
  },
  {
    key: 'builtin:player_card', name: 'Player card', category: 'People', sports: both, layer: 'event',
    variables: [
      { key: 'team', label: 'Team', type: 'team', required: true },
      { key: 'player', label: 'Player', type: 'player', required: true },
      { key: 'stat', label: 'Stat', type: 'stat', required: false },
    ],
    requiredData: ['teams', 'player'], entranceMs: 350, holdMs: 6000, exitMs: 300, sponsorSlots: [], bounds: { x: 0.6, y: 0.45, w: 0.35, h: 0.45 },
  },
  {
    key: 'builtin:stats', name: 'Match statistics', category: 'Stats', sports: both, layer: 'fullframe',
    variables: [{ key: 'rows', label: 'Stat rows (comma separated keys)', type: 'text', required: false, maxLength: 200 }],
    requiredData: ['teams', 'stats'], entranceMs: 350, holdMs: 10000, exitMs: 300, sponsorSlots: ['detached_logo'], bounds: { x: 0.25, y: 0.15, w: 0.5, h: 0.7 },
  },
  {
    key: 'builtin:break_score', name: 'Break / final score', category: 'Match', sports: both, layer: 'fullframe',
    variables: [{ key: 'label', label: 'Label', type: 'text', required: false, maxLength: 24 }, { key: 'showSponsor', label: 'Sponsor', type: 'boolean', required: false, default: true }],
    requiredData: ['teams', 'score'], entranceMs: 350, holdMs: null, exitMs: 300, sponsorSlots: ['detached_logo'], bounds: { x: 0.2, y: 0.3, w: 0.6, h: 0.4 },
  },
  {
    key: 'builtin:sponsor', name: 'Sponsor graphic', category: 'Sponsors', sports: both, layer: 'sponsor',
    variables: [{ key: 'creative', label: 'Creative', type: 'creative', required: false }, { key: 'placement', label: 'Placement', type: 'select', options: ['detached_logo', 'lower_third_banner', 'full_frame_image'], default: 'detached_logo' }],
    requiredData: ['creative'], entranceMs: 300, holdMs: 5000, exitMs: 250, sponsorSlots: ['detached_logo'], bounds: { x: 0.75, y: 0.05, w: 0.2, h: 0.12 },
  },
  {
    key: 'builtin:full_frame_media', name: 'Full-frame media', category: 'Media', sports: both, layer: 'fullframe',
    variables: [
      { key: 'image', label: 'Image or video', type: 'image', required: false },
      { key: 'creative', label: 'Sponsor creative', type: 'creative', required: false },
      { key: 'fit', label: 'Fit', type: 'select', options: ['contain', 'cover'], default: 'contain' },
      { key: 'audio', label: 'Audio policy', type: 'select', options: ['muted', 'replace', 'duck'], default: 'muted' },
    ],
    requiredData: ['media'], entranceMs: 250, holdMs: 10000, exitMs: 250, sponsorSlots: ['full_frame_image', 'full_frame_video'], bounds: { x: 0, y: 0, w: 1, h: 1 },
  },
  {
    key: 'builtin:ticker', name: 'Ticker', category: 'Media', sports: both, layer: 'ticker',
    variables: [
      { key: 'text', label: 'Text', type: 'text', required: false, maxLength: 500 },
      { key: 'speed', label: 'Speed', type: 'select', options: ['slow', 'normal', 'fast'], required: false, default: 'normal' },
      { key: 'mode', label: 'Content', type: 'select', options: ['text', 'scores'], required: false, default: 'text' },
    ],
    requiredData: [], entranceMs: 250, holdMs: null, exitMs: 250, sponsorSlots: [], bounds: { x: 0, y: 0.9, w: 1, h: 0.05 },
  },
  {
    key: 'builtin:slate', name: 'Holding slate', category: 'Match', sports: both, layer: 'background',
    // the slate's message is the whole picture: unlike the animated background, it takes any board off
    reserves: ['fullframe'],
    variables: [{ key: 'message', label: 'Message', type: 'select', options: ['waiting', 'pre_game', 'interval', 'end'], required: true, default: 'waiting' }, { key: 'text', label: 'Custom text', type: 'text', maxLength: 80, required: false }],
    requiredData: ['teams'], entranceMs: 400, holdMs: null, exitMs: 400, sponsorSlots: ['detached_logo'], bounds: { x: 0, y: 0, w: 1, h: 1 },
  },
  {
    key: 'builtin:backdrop', name: 'Animated background', category: 'Match', sports: both, layer: 'background',
    variables: [{ key: 'motion', label: 'Moving', type: 'boolean', required: false, default: true }],
    requiredData: [], entranceMs: 600, holdMs: null, exitMs: 600, sponsorSlots: [], bounds: { x: 0, y: 0, w: 1, h: 1 },
  },
  {
    key: 'builtin:league_table', name: 'League table', category: 'Stats', sports: both, layer: 'fullframe',
    variables: [
      { key: 'rows', label: 'Rows', type: 'number', required: false, default: 10 },
      { key: 'highlight', label: 'Highlight', type: 'select', options: ['both', 'home', 'away', 'none'], required: false, default: 'both' },
      { key: 'title', label: 'Title', type: 'text', required: false, maxLength: 40 },
    ],
    requiredData: ['teams'], entranceMs: 350, holdMs: 12000, exitMs: 300, sponsorSlots: ['detached_logo'], bounds: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
  },
  {
    key: 'builtin:fixtures', name: 'Fixtures and results', category: 'Match', sports: both, layer: 'fullframe',
    variables: [
      { key: 'mode', label: 'Show', type: 'select', options: ['round', 'results', 'next'], required: false, default: 'round' },
      { key: 'title', label: 'Title', type: 'text', required: false, maxLength: 40 },
    ],
    requiredData: ['teams'], entranceMs: 350, holdMs: 12000, exitMs: 300, sponsorSlots: ['detached_logo'], bounds: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
  },
  {
    key: 'builtin:formation', name: 'Formation', category: 'Teams', sports: both, layer: 'fullframe',
    variables: [{ key: 'team', label: 'Team', type: 'team', required: true, default: 'home' }],
    requiredData: ['teams', 'lineup'], entranceMs: 400, holdMs: 10000, exitMs: 300, sponsorSlots: ['detached_logo'], bounds: { x: 0.2, y: 0.08, w: 0.6, h: 0.84 },
  },
  {
    key: 'builtin:match_summary', name: 'Match summary', category: 'Match', sports: both, layer: 'fullframe',
    variables: [{ key: 'label', label: 'Heading', type: 'text', required: false, maxLength: 24 }],
    requiredData: ['teams', 'score'], entranceMs: 350, holdMs: null, exitMs: 300, sponsorSlots: ['detached_logo'], bounds: { x: 0.15, y: 0.1, w: 0.7, h: 0.8 },
  },
  {
    key: 'builtin:head_to_head', name: 'Head to head and form', category: 'Match', sports: both, layer: 'fullframe',
    variables: [],
    requiredData: ['teams'], entranceMs: 350, holdMs: 10000, exitMs: 300, sponsorSlots: ['detached_logo'], bounds: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
  },
  {
    key: 'builtin:match_info', name: 'Match information strap', category: 'Match', sports: both, layer: 'lower',
    variables: [],
    requiredData: ['teams'], entranceMs: 300, holdMs: 8000, exitMs: 250, sponsorSlots: ['lower_third_banner'], bounds: { x: 0.05, y: 0.76, w: 0.7, h: 0.12 },
  },
  {
    key: 'builtin:shootout', name: 'Shoot-out tracker', category: 'Events', sports: ['football', 'hockey'], layer: 'lower',
    variables: [],
    requiredData: ['teams', 'score'], entranceMs: 300, holdMs: null, exitMs: 250, sponsorSlots: [], bounds: { x: 0.2, y: 0.74, w: 0.6, h: 0.16 },
  },
  {
    key: 'builtin:stat_compare', name: 'Live statistic', category: 'Stats', sports: both, layer: 'lower',
    variables: [{ key: 'stat', label: 'Statistic', type: 'stat', required: false }],
    requiredData: ['teams', 'stats'], entranceMs: 300, holdMs: 8000, exitMs: 250, sponsorSlots: ['lower_third_banner'], bounds: { x: 0.2, y: 0.76, w: 0.6, h: 0.12 },
  },
  {
    key: 'builtin:top_scorers', name: 'Top scorers', category: 'Stats', sports: both, layer: 'fullframe',
    variables: [
      { key: 'rows', label: 'Rows', type: 'number', required: false, default: 5 },
      { key: 'metric', label: 'Ranked by', type: 'select', options: ['goals', 'points', 'assists'], required: false, default: 'goals' },
    ],
    requiredData: ['teams'], entranceMs: 350, holdMs: 10000, exitMs: 300, sponsorSlots: ['detached_logo'], bounds: { x: 0.25, y: 0.12, w: 0.5, h: 0.76 },
  },
  {
    key: 'builtin:player_of_match', name: 'Player of the match', category: 'People', sports: both, layer: 'event',
    variables: [
      { key: 'team', label: 'Team', type: 'team', required: true },
      { key: 'player', label: 'Player', type: 'player', required: true },
      { key: 'caption', label: 'Caption', type: 'text', required: false, maxLength: 30, default: 'PLAYER OF THE MATCH' },
    ],
    requiredData: ['teams', 'player'], entranceMs: 350, holdMs: 8000, exitMs: 300, sponsorSlots: ['event_partner'], bounds: { x: 0.05, y: 0.62, w: 0.5, h: 0.26 },
  },
  {
    key: 'builtin:timeout', name: 'Timeout', category: 'Events', sports: ['basketball'], layer: 'event',
    variables: [{ key: 'team', label: 'Team', type: 'team', required: true }],
    requiredData: ['teams'], entranceMs: 300, holdMs: 6000, exitMs: 250, sponsorSlots: ['event_partner'], bounds: { x: 0.05, y: 0.72, w: 0.5, h: 0.14 },
  },
  {
    key: 'builtin:stinger', name: 'Stinger wipe', category: 'Media', sports: both, layer: 'transition',
    variables: [{ key: 'text', label: 'Text', type: 'text', required: false, maxLength: 30 }],
    requiredData: [], entranceMs: 450, holdMs: 500, exitMs: 450, sponsorSlots: ['detached_logo'], bounds: { x: 0, y: 0, w: 1, h: 1 },
  },
];

export const TITLE_SAFE = 0.05;

export function findTemplate(key: string, custom: TemplateDef[] = []): TemplateDef | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.key === key) ?? custom.find((t) => t.key === key);
}

/** Validate operator/automation variables against the template definition; returns sanitized values. */
export function validateVariables(t: TemplateDef, vars: Record<string, unknown>): { ok: true; value: Record<string, unknown> } | { ok: false; field: string; message: string } {
  const out: Record<string, unknown> = {};
  for (const v of t.variables) {
    let val = vars[v.key] ?? v.default;
    if (val === undefined || val === null || val === '') {
      if (v.required) return { ok: false, field: v.key, message: `${v.label} is required` };
      continue;
    }
    switch (v.type) {
      case 'text':
        if (typeof val !== 'string') return { ok: false, field: v.key, message: `${v.label} must be text` };
        // plain text only: strip control characters and markup-looking content
        // eslint-disable-next-line no-control-regex
        val = val.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, '');
        if (v.maxLength && (val as string).length > v.maxLength) return { ok: false, field: v.key, message: `${v.label} must be ${v.maxLength} characters or fewer` };
        break;
      case 'number':
        if (typeof val !== 'number' || !Number.isFinite(val)) return { ok: false, field: v.key, message: `${v.label} must be a number` };
        break;
      case 'boolean':
        if (typeof val !== 'boolean') return { ok: false, field: v.key, message: `${v.label} must be on or off` };
        break;
      case 'team':
        if (val !== 'home' && val !== 'away') return { ok: false, field: v.key, message: `${v.label} must be home or away` };
        break;
      case 'player':
      case 'image':
      case 'creative':
        if (typeof val !== 'string' || !/^[0-9a-f-]{36}$/.test(val)) return { ok: false, field: v.key, message: `${v.label} must be selected from the list` };
        break;
      case 'stat':
        if (typeof val !== 'string' || !/^[a-z_]{1,40}$/.test(val)) return { ok: false, field: v.key, message: `${v.label} is not a supported stat` };
        break;
      case 'select':
        if (typeof val !== 'string' || !(v.options ?? []).includes(val)) return { ok: false, field: v.key, message: `${v.label} must be one of ${(v.options ?? []).join(', ')}` };
        break;
    }
    out[v.key] = val;
  }
  return { ok: true, value: out };
}
