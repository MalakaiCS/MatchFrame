'use client';
import { useMemo } from 'react';
import { getAdapter } from '@bs/domain';
import { emptyState, type OverlayPublicState, type RenderData, type ThemeConfig } from '@bs/graphics';
import { Renderer, Stage, THEMES } from '@bs/graphics/react';

/** Synthetic preview data (fictional teams) for theme thumbnails and the designer. */
export function sampleData(theme: ThemeConfig, sport: 'football' | 'basketball' = 'football'): RenderData {
  const a = getAdapter(sport);
  const cfg = a.defaultConfig;
  const proj = { ...a.initialProjection(cfg), phase: sport === 'football' ? 'second_half' : 'p3', score: { home: 2, away: 1 }, stats: { home: { goals: 2, shots_on_target: 6, corners: 4, points: 54 }, away: { goals: 1, shots_on_target: 3, corners: 2, points: 49 } } };
  const clocks = a.initialClocks(cfg);
  clocks.main = { ...clocks.main!, baseMs: sport === 'football' ? 63 * 60_000 + 12_000 : 4 * 60_000 + 31_000, periodId: proj.phase };
  const mk = (n: number, side: 'home' | 'away') => ({ playerId: `00000000-0000-4000-8000-${side === 'home' ? '1' : '2'}${String(n).padStart(11, '0')}`, displayName: ['Mia Torres', 'Léa Ångström', 'Kai Fitzgerald-Montgomery', 'Noah Ito', 'Aroha Te Huia', 'Theo Rossi', 'Isla Walker', 'Mateo Ramírez', 'Zoe Okafor', 'Finn Larsen', 'Ana Silva'][n % 11]!, number: n + 1, starter: n < 11, photoAssetId: null });
  const lineup = { home: Array.from({ length: 14 }, (_, i) => mk(i, 'home')), away: Array.from({ length: 14 }, (_, i) => mk(i, 'away')) };
  const players: RenderData['players'] = {};
  for (const s of ['home', 'away'] as const) for (const p of lineup[s]) players[p.playerId] = { playerId: p.playerId, displayName: p.displayName, number: p.number, photoUrl: null, side: s };
  return {
    match: {
      id: 'sample', sport, rulesConfig: cfg as Record<string, unknown>, competition: { name: 'Coastal Premier League', shortName: 'CPL', logoUrl: null }, venue: 'Bayside Oval', scheduledAt: new Date(Date.now() + 15 * 60_000).toISOString(), timezone: 'Australia/Brisbane',
      teams: { home: { id: 'h', name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', primaryColor: '#1F6FEB', secondaryColor: '#FFFFFF', logoUrl: null }, away: { id: 'a', name: 'Saltmarsh Rovers Football & Sporting Club', shortName: 'Saltmarsh', abbreviation: 'SMR', primaryColor: '#E5484D', secondaryColor: '#111111', logoUrl: null } },
      lineup, projection: proj, clocks, stateVersion: 1, statRows: a.capabilities(cfg).statRows,
    },
    players, assets: {}, creatives: {}, theme, customTemplates: [],
  };
}

function sampleState(): OverlayPublicState {
  const s = emptyState();
  const at = Date.now() - 60_000;
  s.scorebugVisible = true;
  s.layers.scoreboard = { cueId: 's', templateKey: 'builtin:scorebug', layer: 'scoreboard', variables: {}, startedAt: at, durationMs: null, source: 'operator' };
  s.layers.event = { cueId: 'e', templateKey: 'builtin:goal', layer: 'event', variables: { team: 'home', player: '00000000-0000-4000-8000-100000000002', minute: '63', eventType: 'goal' }, startedAt: at, durationMs: null, source: 'operator' };
  return s;
}

export function ThemeThumb({ theme, state }: { theme: ThemeConfig; state?: OverlayPublicState }) {
  const data = useMemo(() => sampleData(theme), [theme]);
  const st = useMemo(() => state ?? sampleState(), [state]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-md bg-gradient-to-br from-[#2b3a4f] to-[#121a26]">
      <Stage><Renderer state={st} data={data} themes={THEMES} serverNow={() => Date.now()} /></Stage>
    </div>
  );
}

