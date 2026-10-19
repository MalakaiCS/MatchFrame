import type { ClockState, LineupSnapshot, MatchProjection } from '@bs/domain';

export interface RenderTeam {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
}

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
  themeKey: 'minimal' | 'broadcast' | 'club';
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
    sport: 'football' | 'basketball';
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
  };
  players: Record<string, RenderPlayer>;
  assets: Record<string, string>;
  creatives: Record<string, RenderCreative>;
  theme: ThemeConfig;
  customTemplates: { key: string; scene: unknown }[];
}

export const DEFAULT_THEMES: Record<ThemeConfig['themeKey'], ThemeConfig> = {
  minimal: { themeKey: 'minimal', primary: '#F3F6FB', secondary: '#0B1220', accent: '#3EA6FF', text: '#0B1220', panel: '#F3F6FB', font: 'Inter Variable', radius: 2, motion: 'subtle', entranceMs: 220, exitMs: 200, safeArea: 0.05 },
  broadcast: { themeKey: 'broadcast', primary: '#3EA6FF', secondary: '#0B1220', accent: '#FFCE66', text: '#F3F6FB', panel: '#131F32', font: 'Inter Variable', radius: 4, motion: 'full', entranceMs: 320, exitMs: 260, safeArea: 0.05 },
  club: { themeKey: 'club', primary: '#55D99D', secondary: '#0B1220', accent: '#FFFFFF', text: '#FFFFFF', panel: '#1C2C43', font: 'Inter Variable', radius: 18, motion: 'subtle', entranceMs: 280, exitMs: 240, safeArea: 0.05 },
};

export function playerIndex(lineup: LineupSnapshot, photo: (assetId: string | null | undefined) => string | null): Record<string, RenderPlayer> {
  const out: Record<string, RenderPlayer> = {};
  for (const side of ['home', 'away'] as const)
    for (const p of lineup[side]) out[p.playerId] = { playerId: p.playerId, displayName: p.displayName, shortName: p.shortName, number: p.number ?? null, photoUrl: photo(p.photoAssetId), side, position: p.position };
  return out;
}
