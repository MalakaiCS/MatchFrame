import type { Sport } from '@bs/domain';
import type { ClockState, LineupSnapshot, MatchProjection } from '@bs/domain';

export interface RenderTeam {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  primaryColor: string;
  secondaryColor: string;
  /** change strip colours, used when the two teams' main colours are too close to tell apart */
  awayPrimaryColor?: string | null;
  awaySecondaryColor?: string | null;
  logoUrl: string | null;
}

/** 16:9 is the broadcast overlay; 9:16 lays the same graphics out for a vertical social stream; venue scales the
 *  scorebug and events up for a stadium screen. */
export type OutputFormat = '16:9' | '9:16' | 'venue';
export const OUTPUT_FORMATS: { key: OutputFormat; label: string; width: number; height: number }[] = [
  { key: '16:9', label: 'Broadcast 16:9', width: 1920, height: 1080 },
  { key: '9:16', label: 'Vertical 9:16 (social)', width: 1080, height: 1920 },
  { key: 'venue', label: 'Venue screen (large type)', width: 1920, height: 1080 },
];
export const formatSize = (f: OutputFormat | undefined) => (f === '9:16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });

export interface RenderPlayer {
  playerId: string;
  displayName: string;
  shortName?: string | null;
  number: number | null;
  photoUrl: string | null;
  side: 'home' | 'away';
  position?: string | null;
}

export interface ThemeConfig {
  themeKey: 'minimal' | 'broadcast' | 'club' | 'premier';
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  panel: string;
  font: string;
  radius: number;
  motion: 'none' | 'subtle' | 'full';
  entranceMs: number;
  exitMs: number;
  safeArea: number; // fraction (0.05 = 5%)
  logoUrl?: string | null;
  /** a club's own typeface (woff2/ttf) from the asset store; registered by the renderer as the theme font */
  fontUrl?: string | null;
  scorebug?: { variant?: 'box' | 'strip'; position?: 'left' | 'centre' | 'right' };
  clock?: { hideSeconds?: boolean; stoppage?: 'plus' | 'label' };
  /** wording overrides for on-air labels, keyed by the default wording (e.g. { 'HALF TIME': 'MI-TEMPS' }) */
  wording?: Record<string, string>;
  /** short audio stings on goals and cards (the OBS browser source captures them) */
  stings?: boolean;
}

/** League table row as the renderer sees it. */
export interface RenderStandingRow {
  position: number;
  team: Pick<RenderTeam, 'id' | 'name' | 'shortName' | 'abbreviation' | 'primaryColor' | 'logoUrl'>;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  for: number;
  against: number;
  difference: number;
  percentage: number;
  points: number;
  winPct: number;
  form: ('W' | 'D' | 'L')[];
}

export interface RenderFixture {
  id: string;
  round: string | null;
  scheduledAt: string;
  status: string;
  live: boolean;
  home: Pick<RenderTeam, 'id' | 'name' | 'shortName' | 'abbreviation' | 'primaryColor' | 'logoUrl'>;
  away: Pick<RenderTeam, 'id' | 'name' | 'shortName' | 'abbreviation' | 'primaryColor' | 'logoUrl'>;
  score: { home: number; away: number } | null;
  scoreDetail: { home: string; away: string } | null;
}

export interface RenderTopScorer {
  playerId: string;
  displayName: string;
  shortName: string | null;
  photoUrl: string | null;
  team: Pick<RenderTeam, 'id' | 'abbreviation' | 'primaryColor' | 'logoUrl'> | null;
  goals: number;
  assists: number;
  points: number;
}

/** Season context for tables, fixtures, the ticker and top scorers (absent for previews without a season). */
export interface RenderSeason {
  name: string;
  standings: RenderStandingRow[];
  standingsUnit: 'goals' | 'points';
  rankBy: 'points' | 'win_pct';
  /** this match's round and the one after, in kick-off order */
  fixtures: RenderFixture[];
  /** other matches of the competition on the same day (around the grounds) */
  otherScores: RenderFixture[];
  topScorers: RenderTopScorer[];
}

export interface RenderPreview {
  headToHead: { played: number; homeWins: number; awayWins: number; draws: number; homeFor: number; awayFor: number; meetings: { matchId: string; playedAt: string; homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number }[] };
  form: { home: ('W' | 'D' | 'L')[]; away: ('W' | 'D' | 'L')[] };
  positions: { home: number | null; away: number | null } | null;
}

/** A scoring, discipline or change event, enough for a summary board (no private data). */
export interface RenderEvent {
  id: string;
  type: string;
  group: 'score' | 'discipline' | 'change' | 'other';
  side: 'home' | 'away' | null;
  playerId: string | null;
  minute: string | null;
  periodId: string;
  payload: Record<string, unknown>;
}

export interface RenderCreative {
  id: string;
  kind: 'image' | 'banner' | 'video';
  url: string;
  width: number | null;
  height: number | null;
  brandName: string;
}

/** Everything a renderer needs, from an explicit snapshot (no live queries inside components). */
export interface RenderData {
  match: {
    id: string;
    sport: Sport;
    rulesConfig: Record<string, unknown>;
    competition: { name: string; shortName: string | null; logoUrl: string | null };
    venue: string | null;
    scheduledAt: string;
    timezone: string;
    teams: { home: RenderTeam; away: RenderTeam };
    lineup: LineupSnapshot;
    projection: MatchProjection;
    clocks: Record<string, ClockState>;
    stateVersion: number;
    statRows: { key: string; label: string; unit?: string }[];
    round?: string | null;
    attendance?: number | null;
    weather?: { summary?: string | null; tempC?: number | null; condition?: string | null } | null;
    officials?: { role: string; name: string }[];
    /** accepted (non-voided) scoring, discipline and change events in order */
    events?: RenderEvent[];
  };
  players: Record<string, RenderPlayer>;
  assets: Record<string, string>;
  creatives: Record<string, RenderCreative>;
  theme: ThemeConfig;
  customTemplates: { key: string; scene: unknown }[];
  format?: OutputFormat;
  season?: RenderSeason | null;
  preview?: RenderPreview | null;
}

const hexRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** Perceptual-ish distance (0–~765) between two hex colours; below 120 the strips are hard to tell apart on air. */
export function colourDistance(a: string, b: string): number {
  const x = hexRgb(a);
  const y = hexRgb(b);
  if (!x || !y) return 999;
  const rm = (x[0] + y[0]) / 2;
  const dr = x[0] - y[0], dg = x[1] - y[1], db = x[2] - y[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 1.6;
}
export const COLOUR_CLASH_THRESHOLD = 120;

/** When both teams' main colours clash, the away side switches to its change colours (or its second colour). */
export function resolveColourClash(home: RenderTeam, away: RenderTeam): { home: RenderTeam; away: RenderTeam; clashed: boolean } {
  if (colourDistance(home.primaryColor, away.primaryColor) >= COLOUR_CLASH_THRESHOLD) return { home, away, clashed: false };
  const candidates = [away.awayPrimaryColor, away.secondaryColor, home.secondaryColor].filter((c): c is string => !!c);
  const pick = candidates.find((c) => colourDistance(home.primaryColor, c) >= COLOUR_CLASH_THRESHOLD) ?? candidates[0];
  if (!pick) return { home, away, clashed: false };
  const secondary = pick === away.awayPrimaryColor && away.awaySecondaryColor ? away.awaySecondaryColor : away.primaryColor;
  return { home, away: { ...away, primaryColor: pick, secondaryColor: secondary }, clashed: true };
}

export const DEFAULT_THEMES: Record<ThemeConfig['themeKey'], ThemeConfig> = {
  minimal: { themeKey: 'minimal', primary: '#F3F6FB', secondary: '#0B1220', accent: '#3EA6FF', text: '#0B1220', panel: '#F3F6FB', font: 'Inter Variable', radius: 2, motion: 'subtle', entranceMs: 220, exitMs: 200, safeArea: 0.05 },
  broadcast: { themeKey: 'broadcast', primary: '#3EA6FF', secondary: '#0B1220', accent: '#FFCE66', text: '#F3F6FB', panel: '#131F32', font: 'Inter Variable', radius: 4, motion: 'full', entranceMs: 320, exitMs: 260, safeArea: 0.05 },
  club: { themeKey: 'club', primary: '#55D99D', secondary: '#0B1220', accent: '#FFFFFF', text: '#FFFFFF', panel: '#1C2C43', font: 'Inter Variable', radius: 18, motion: 'subtle', entranceMs: 280, exitMs: 240, safeArea: 0.05 },
  // top-flight football broadcast look: deep purple, hot magenta, electric teal, white paper, condensed uppercase type
  premier: { themeKey: 'premier', primary: '#E90052', secondary: '#38003C', accent: '#04F5FF', text: '#38003C', panel: '#FFFFFF', font: "'Oswald Variable', 'Inter Variable', ui-sans-serif, sans-serif", radius: 6, motion: 'full', entranceMs: 320, exitMs: 260, safeArea: 0.05, scorebug: { variant: 'box', position: 'left' }, stings: true },
};

export function playerIndex(lineup: LineupSnapshot, photo: (assetId: string | null | undefined) => string | null): Record<string, RenderPlayer> {
  const out: Record<string, RenderPlayer> = {};
  for (const side of ['home', 'away'] as const)
    for (const p of lineup[side]) out[p.playerId] = { playerId: p.playerId, displayName: p.displayName, shortName: p.shortName, number: p.number ?? null, photoUrl: photo(p.photoAssetId), side, position: p.position };
  return out;
}
