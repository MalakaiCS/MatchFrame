'use client';
import { useMemo } from 'react';
import { getAdapter } from '@bs/domain';
import { emptyState, type OverlayPublicState, type RenderData, type ThemeConfig } from '@bs/graphics';
import { Renderer, Stage, THEMES } from '@bs/graphics/react';

export const SAMPLE_SPONSOR = 'sample-sponsor';
export const SAMPLE_MEDIA = 'sample-media';
const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const SAMPLE_SPONSOR_URL = svgUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect width="600" height="200" rx="20" fill="#0B1220"/><circle cx="100" cy="100" r="56" fill="#FFCE66"/><text x="185" y="120" font-family="system-ui,sans-serif" font-size="58" font-weight="800" fill="#F3F6FB">YOUR LOGO</text></svg>',
);
const SAMPLE_MEDIA_URL = svgUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1F6FEB"/><stop offset="1" stop-color="#0B1220"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><text x="960" y="560" text-anchor="middle" font-family="system-ui,sans-serif" font-size="96" font-weight="800" fill="#FFFFFF">Your image or video</text></svg>',
);
/** Fictional player id from sampleData(): n = squad index (0–13). */
export const samplePlayerId = (side: 'home' | 'away', n: number) => `00000000-0000-4000-8000-${side === 'home' ? '1' : '2'}${String(n).padStart(11, '0')}`;
/** Sponsor slots filled with the placeholder logo, so previews show where sponsors appear. */
export const SAMPLE_SLOTS = Object.fromEntries(
  ['scorebug_logo', 'lower_third_banner', 'event_partner', 'detached_logo'].map((k) => [k, { creativeId: SAMPLE_SPONSOR, decisionId: 'sample' }]),
);

/** Example variables for each built-in graphic (fictional people and text). */
export function sampleVariables(templateKey: string, sport: 'football' | 'basketball'): Record<string, unknown> {
  switch (templateKey.replace('builtin:', '')) {
    case 'scorebug': return { showSponsor: true };
    case 'ident': return { showCountdown: true };
    case 'lineup': return { team: 'home', page: 1 };
    case 'goal': return { team: 'home', player: samplePlayerId('home', 9), minute: '63', eventType: 'goal' };
    case 'score': return { team: 'home', player: samplePlayerId('home', 4), points: 3 };
    case 'period_banner': return { heading: 'KICK-OFF', period: sport === 'football' ? '2nd Half' : '3rd Quarter' };
    case 'card': return { team: 'away', player: samplePlayerId('away', 5), cardType: 'yellow', minute: '58' };
    case 'substitution': return { team: 'home', playerOut: samplePlayerId('home', 8), playerIn: samplePlayerId('home', 12), minute: '70' };
    case 'lower_third': return { heading: 'Sam Patel', subtitle: 'Head coach, Harbour City FC' };
    case 'player_card': return { team: 'home', player: samplePlayerId('home', 9), stat: sport === 'football' ? 'goals' : 'points' };
    case 'stats': return {};
    case 'break_score': return { label: sport === 'football' ? 'Half time' : 'End of Q3', showSponsor: true };
    case 'sponsor': return { creative: SAMPLE_SPONSOR, placement: 'detached_logo' };
    case 'full_frame_media': return { image: SAMPLE_MEDIA, fit: 'cover', audio: 'muted' };
    case 'ticker': return { text: 'Next match: Saltmarsh Rovers v Bayside United, Saturday 3 pm  •  Tickets at the gate  •  Follow us for highlights', speed: 'normal' };
    case 'slate': return { message: 'pre_game' };
    default: return {};
  }
}

const FOOTBALL_POSITIONS = ['Goalkeeper', 'Defender', 'Defender', 'Defender', 'Defender', 'Midfielder', 'Midfielder', 'Midfielder', 'Forward', 'Forward', 'Forward'];
const BASKETBALL_POSITIONS = ['Guard', 'Guard', 'Forward', 'Forward', 'Center', 'Guard', 'Forward', 'Center', 'Guard', 'Forward', 'Center'];

/** Synthetic preview data (fictional teams) for theme thumbnails and the designer. */
export function sampleData(theme: ThemeConfig, sport: 'football' | 'basketball' = 'football'): RenderData {
  const a = getAdapter(sport);
  const cfg = a.defaultConfig;
  const proj = { ...a.initialProjection(cfg), phase: sport === 'football' ? 'second_half' : 'p3', score: { home: 2, away: 1 }, stats: { home: { goals: 2, shots_on_target: 6, shots_off_target: 4, corners: 4, offsides: 1, fouls: 7, yellow_cards: 1, saves: 2, points: 54 }, away: { goals: 1, shots_on_target: 3, shots_off_target: 5, corners: 2, offsides: 3, fouls: 9, yellow_cards: 2, saves: 4, points: 49 } } };
  const clocks = a.initialClocks(cfg);
  clocks.main = { ...clocks.main!, baseMs: sport === 'football' ? 63 * 60_000 + 12_000 : 4 * 60_000 + 31_000, periodId: proj.phase };
  const mk = (n: number, side: 'home' | 'away') => ({ playerId: `00000000-0000-4000-8000-${side === 'home' ? '1' : '2'}${String(n).padStart(11, '0')}`, displayName: ['Mia Torres', 'Léa Ångström', 'Kai Fitzgerald-Montgomery', 'Noah Ito', 'Aroha Te Huia', 'Theo Rossi', 'Isla Walker', 'Mateo Ramírez', 'Zoe Okafor', 'Finn Larsen', 'Ana Silva'][n % 11]!, number: n + 1, starter: n < 11, photoAssetId: null });
  const lineup = { home: Array.from({ length: 14 }, (_, i) => mk(i, 'home')), away: Array.from({ length: 14 }, (_, i) => mk(i, 'away')) };
  const players: RenderData['players'] = {};
  for (const s of ['home', 'away'] as const) for (const p of lineup[s]) players[p.playerId] = { playerId: p.playerId, displayName: p.displayName, number: p.number, photoUrl: null, side: s, position: (sport === 'football' ? FOOTBALL_POSITIONS : BASKETBALL_POSITIONS)[(p.number - 1) % 11] };
  return {
    match: {
      id: 'sample', sport, rulesConfig: cfg as Record<string, unknown>, competition: { name: 'Coastal Premier League', shortName: 'CPL', logoUrl: null }, venue: 'Bayside Oval', scheduledAt: new Date(Date.now() + 15 * 60_000).toISOString(), timezone: 'Australia/Brisbane',
      teams: { home: { id: 'h', name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', primaryColor: '#1F6FEB', secondaryColor: '#FFFFFF', logoUrl: null }, away: { id: 'a', name: 'Saltmarsh Rovers Football & Sporting Club', shortName: 'Saltmarsh', abbreviation: 'SMR', primaryColor: '#E5484D', secondaryColor: '#111111', logoUrl: null } },
      lineup, projection: proj, clocks, stateVersion: 1, statRows: a.capabilities(cfg).statRows,
    },
    players, assets: { [SAMPLE_MEDIA]: SAMPLE_MEDIA_URL }, creatives: { [SAMPLE_SPONSOR]: { id: SAMPLE_SPONSOR, kind: 'image', url: SAMPLE_SPONSOR_URL, width: 600, height: 200, brandName: 'Your sponsor' } }, theme, customTemplates: [],
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

