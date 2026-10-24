'use client';
import type { MatchProjection, Sport } from '@bs/domain';
import { useMemo } from 'react';
import { futsalMatchMs, getAdapter, rugbyLeagueMatchMs } from '@bs/domain';
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
export function sampleVariables(templateKey: string, sport: Sport): Record<string, unknown> {
  switch (templateKey.replace('builtin:', '')) {
    case 'scorebug': return { showSponsor: true };
    case 'ident': return { showCountdown: true, show: 'countdown' };
    case 'backdrop': return { motion: true };
    case 'lineup': return { team: 'home', page: 1 };
    case 'goal': return { team: 'home', player: samplePlayerId('home', 9), minute: '63', eventType: 'goal' };
    case 'score': return { team: 'home', player: samplePlayerId('home', 4), points: 3 };
    case 'period_banner': return { heading: 'KICK-OFF', period: sport === 'football' || sport === 'futsal' ? '2nd Half' : '3rd Quarter' };
    case 'card': return { team: 'away', player: samplePlayerId('away', 5), cardType: 'yellow', minute: '58' };
    case 'substitution': return { team: 'home', playerOut: samplePlayerId('home', 8), playerIn: samplePlayerId('home', 12), minute: '70' };
    case 'lower_third': return { heading: 'Sam Patel', subtitle: 'Head coach, Harbour City FC' };
    case 'player_card': return { team: 'home', player: samplePlayerId('home', 9), stat: sport === 'football' || sport === 'futsal' ? 'goals' : 'points' };
    case 'stats': return {};
    case 'break_score': return { label: sport === 'football' || sport === 'futsal' ? 'Half time' : 'End of Q3', showSponsor: true };
    case 'sponsor': return { creative: SAMPLE_SPONSOR, placement: 'detached_logo' };
    case 'full_frame_media': return { image: SAMPLE_MEDIA, fit: 'cover', audio: 'muted' };
    case 'ticker': return { text: 'Next match: Saltmarsh Rovers v Bayside United, Saturday 3 pm  •  Tickets at the gate  •  Follow us for highlights', speed: 'normal' };
    case 'slate': return { message: 'pre_game' };
    case 'league_table': return { rows: 8, highlight: 'both' };
    case 'fixtures': return { mode: 'round' };
    case 'formation': return { team: 'home' };
    case 'match_summary': return { label: 'FULL TIME' };
    case 'head_to_head': return {};
    case 'match_info': return {};
    case 'shootout': return {};
    case 'stat_compare': return { stat: sport === 'football' || sport === 'futsal' ? 'shots_on_target' : sport === 'basketball' ? 'rebounds' : '' };
    case 'top_scorers': return { rows: 5, metric: sport === 'basketball' || sport === 'rugby_league' || sport === 'afl' ? 'points' : 'goals' };
    case 'player_of_match': return { team: 'home', player: samplePlayerId('home', 9), caption: 'PLAYER OF THE MATCH' };
    case 'timeout': return { team: 'away' };
    case 'added_time': return { minutes: 4 };
    case 'review': return { outcome: 'auto' };
    case 'stinger': return { text: 'Harbour City v Saltmarsh' };
    default: return {};
  }
}

const FOOTBALL_POSITIONS = ['Goalkeeper', 'Defender', 'Defender', 'Defender', 'Defender', 'Midfielder', 'Midfielder', 'Midfielder', 'Forward', 'Forward', 'Forward'];
const BASKETBALL_POSITIONS = ['Guard', 'Guard', 'Forward', 'Forward', 'Center', 'Guard', 'Forward', 'Center', 'Guard', 'Forward', 'Center'];
const FUTSAL_POSITIONS = ['Goalkeeper', 'Defender', 'Winger', 'Winger', 'Pivot', 'Goalkeeper', 'Defender', 'Winger', 'Winger', 'Pivot', 'Defender'];

/** Synthetic preview data (fictional teams) for theme thumbnails and the designer. */
/** A score that looks like the sport's (the public showcase); everywhere else the samples stay at 2–1. */
const REAL_SCORE: Partial<Record<Sport, { home: number; away: number }>> = { basketball: { home: 78, away: 74 }, netball: { home: 41, away: 38 }, rugby_league: { home: 18, away: 12 } };

export function sampleData(theme: ThemeConfig, sport: Sport = 'football', opts: { shootout?: boolean; review?: boolean; timers?: boolean; format?: RenderData['format']; now?: number; realScore?: boolean } = {}): RenderData {
  // kick-off is 15 minutes after the sample's own "now": a still frame drawn at a fixed time passes the same time
  const now = opts.now ?? Date.now();
  const a = getAdapter(sport);
  const cfg = a.defaultConfig;
  const proj: MatchProjection = { ...a.initialProjection(cfg), phase: sport === 'football' ? 'second_half' : sport === 'rugby_league' || sport === 'futsal' ? 'p2' : 'p3', score: (opts.realScore && REAL_SCORE[sport]) || { home: 2, away: 1 }, ...(sport === 'futsal' ? { teamFouls: { home: 3, away: 5 } } : {}), shootout: opts.shootout && (sport === 'football' || sport === 'hockey' || sport === 'futsal') ? { home: 3, away: 2, kicks: [{ side: 'home' as const, scored: true }, { side: 'away' as const, scored: true }, { side: 'home' as const, scored: false }, { side: 'away' as const, scored: false }, { side: 'home' as const, scored: true }, { side: 'away' as const, scored: true }, { side: 'home' as const, scored: true }] } : null, stats: sampleStats(sport) };
  const clocks = a.initialClocks(cfg);
  clocks.main = { ...clocks.main!, baseMs: sport === 'football' ? 63 * 60_000 + 12_000 : sport === 'rugby_league' ? 52 * 60_000 + 8_000 : sport === 'afl' ? 12 * 60_000 + 31_000 : sport === 'futsal' ? 12 * 60_000 + 31_000 : 4 * 60_000 + 31_000, periodId: proj.phase };
  // the scorebug's countdown tabs: an away player in the sin bin (rugby league), the away team a player short (futsal)
  if (opts.timers && sport === 'rugby_league') proj.sinBins = [{ side: 'away', playerId: null, atMs: rugbyLeagueMatchMs(cfg as never, 'p2', clocks.main.baseMs)! - 218_000, endedAtMs: null }];
  if (opts.timers && sport === 'futsal') proj.sendOffs = [{ side: 'away', playerId: null, atMs: futsalMatchMs(cfg as never, 'p2', clocks.main.baseMs)! - 49_000, endedBy: null, endedAtMs: null }];
  // and the red card on the scorebug for the away team, in the sports that have them
  if (opts.timers && (sport === 'football' || sport === 'futsal' || sport === 'hockey')) proj.stats = { ...proj.stats, away: { ...proj.stats.away, red_cards: 1 } };
  if (opts.review && sport === 'rugby_league') proj.review = { subject: 'try', side: 'home', outcome: null, sequence: 1 };
  const mk = (n: number, side: 'home' | 'away') => ({ playerId: `00000000-0000-4000-8000-${side === 'home' ? '1' : '2'}${String(n).padStart(11, '0')}`, displayName: ['Mia Torres', 'Léa Ångström', 'Kai Fitzgerald-Montgomery', 'Noah Ito', 'Aroha Te Huia', 'Theo Rossi', 'Isla Walker', 'Mateo Ramírez', 'Zoe Okafor', 'Finn Larsen', 'Ana Silva'][n % 11]!, number: n + 1, starter: n < (sport === 'futsal' ? 5 : 11), photoAssetId: null });
  const lineup = { home: Array.from({ length: 14 }, (_, i) => mk(i, 'home')), away: Array.from({ length: 14 }, (_, i) => mk(i, 'away')) };
  const players: RenderData['players'] = {};
  for (const s of ['home', 'away'] as const) for (const p of lineup[s]) players[p.playerId] = { playerId: p.playerId, displayName: p.displayName, number: p.number, photoUrl: null, side: s, position: (sport === 'football' ? FOOTBALL_POSITIONS : sport === 'futsal' ? FUTSAL_POSITIONS : BASKETBALL_POSITIONS)[(p.number - 1) % 11] };
  return {
    match: {
      id: 'sample', sport, rulesConfig: cfg as Record<string, unknown>, competition: { name: 'Coastal Premier League', shortName: 'CPL', logoUrl: null }, venue: 'Bayside Oval', scheduledAt: new Date(now + 15 * 60_000).toISOString(), timezone: 'Australia/Brisbane',
      teams: { home: { id: 'h', name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', primaryColor: '#1F6FEB', secondaryColor: '#FFFFFF', logoUrl: null }, away: { id: 'a', name: 'Saltmarsh Rovers Football & Sporting Club', shortName: 'Saltmarsh', abbreviation: 'SMR', primaryColor: '#E5484D', secondaryColor: '#111111', logoUrl: null } },
      lineup, projection: proj, clocks, stateVersion: 1, statRows: a.capabilities(cfg).statRows,
      round: '12', attendance: 1204, weather: { tempC: 24, condition: 'sunny', summary: 'Light breeze' }, officials: [{ role: sport === 'afl' || sport === 'netball' ? 'umpire' : 'referee', name: 'Sam Lee' }, { role: 'assistant_1', name: 'Priya Nair' }, { role: 'assistant_2', name: 'Tom Okafor' }],
      events: sampleEvents(sport),
    },
    players, assets: { [SAMPLE_MEDIA]: SAMPLE_MEDIA_URL }, creatives: { [SAMPLE_SPONSOR]: { id: SAMPLE_SPONSOR, kind: 'image', url: SAMPLE_SPONSOR_URL, width: 600, height: 200, brandName: 'Your sponsor' } }, theme, customTemplates: [],
    format: opts.format ?? '16:9',
    season: sampleSeason(sport, now),
    preview: samplePreview(),
  };
}


/** Mid-match team statistics for each code (home first). */
export function sampleStats(sport: Sport): { home: Record<string, number>; away: Record<string, number> } {
  switch (sport) {
    case 'basketball': return { home: { points: 2, fouls: 4, rebounds: 18, assists: 9, timeouts_used: 1, two_pt_made: 12, three_pt_made: 5, free_throws_made: 6 }, away: { points: 1, fouls: 6, rebounds: 15, assists: 7, timeouts_used: 2, two_pt_made: 10, three_pt_made: 4, free_throws_made: 8 } };
    case 'netball': return { home: { goals: 2, attempts: 3, intercepts: 6, rebounds: 4, turnovers: 9, penalties: 31 }, away: { goals: 1, attempts: 2, intercepts: 4, rebounds: 5, turnovers: 12, penalties: 36 } };
    case 'rugby_league': return { home: { points: 2, tries: 3, conversions: 2, penalty_goals: 1, field_goals: 0, line_breaks: 5, errors: 7, penalties: 4, six_agains: 3, interchanges: 5 }, away: { points: 1, tries: 2, conversions: 1, penalty_goals: 0, field_goals: 1, line_breaks: 3, errors: 9, penalties: 6, six_agains: 5, interchanges: 6 } };
    case 'afl': return { home: { goals: 8, behinds: 7, points: 55, marks: 64, tackles: 41, inside_50s: 31, clearances: 22, free_kicks: 12 }, away: { goals: 6, behinds: 9, points: 45, marks: 58, tackles: 48, inside_50s: 27, clearances: 25, free_kicks: 15 } };
    case 'hockey': return { home: { goals: 2, shots: 11, penalty_corners: 5, circle_entries: 19, green_cards: 1, yellow_cards: 0, red_cards: 0 }, away: { goals: 1, shots: 7, penalty_corners: 3, circle_entries: 13, green_cards: 0, yellow_cards: 1, red_cards: 0 } };
    case 'futsal': return { home: { goals: 2, shots_on_target: 9, shots_off_target: 7, fouls: 4, corners: 5, saves: 6, yellow_cards: 1, red_cards: 0, timeouts_used: 1, ten_metre_kicks: 0, assists: 2 }, away: { goals: 1, shots_on_target: 6, shots_off_target: 8, fouls: 5, corners: 3, saves: 7, yellow_cards: 2, red_cards: 0, timeouts_used: 0, ten_metre_kicks: 1, assists: 1 } };
    default: return { home: { goals: 2, shots_on_target: 6, shots_off_target: 4, corners: 4, offsides: 1, fouls: 7, yellow_cards: 1, red_cards: 0, saves: 3, possession_pct: 56, assists: 2 }, away: { goals: 1, shots_on_target: 3, shots_off_target: 5, corners: 2, offsides: 3, fouls: 11, yellow_cards: 2, red_cards: 0, saves: 4, possession_pct: 44, assists: 1 } };
  }
}

const SAMPLE_TEAMS = [
  ['Harbour City FC', 'Harbour', 'HCF', '#1F6FEB'], ['Saltmarsh Rovers', 'Saltmarsh', 'SMR', '#E5484D'], ['Bayside United', 'Bayside', 'BAY', '#55D99D'],
  ['Northgate Athletic', 'Northgate', 'NGA', '#FFCE66'], ['Riverbend SC', 'Riverbend', 'RIV', '#8E5CF6'], ['Kingsford Town', 'Kingsford', 'KIN', '#F97316'],
  ['Westlake Wanderers', 'Westlake', 'WLW', '#0EA5E9'], ['Hilltop Hawks', 'Hilltop', 'HTH', '#64748B'],
] as const;
const sampleTeam = (i: number) => ({ id: i === 0 ? 'h' : i === 1 ? 'a' : `t${i}`, name: SAMPLE_TEAMS[i]![0], shortName: SAMPLE_TEAMS[i]![1], abbreviation: SAMPLE_TEAMS[i]![2], primaryColor: SAMPLE_TEAMS[i]![3], logoUrl: null });

/** A plausible mid-season table, fixtures list and top scorers, so tables and boards preview with content. */
export function sampleSeason(sport: Sport, now = Date.now()): RenderData['season'] {
  const unit = sport === 'basketball' || sport === 'rugby_league' || sport === 'afl' ? 'points' : 'goals';
  const base = sport === 'basketball' ? 80 : sport === 'afl' ? 90 : sport === 'rugby_league' ? 22 : sport === 'netball' ? 55 : 1.6;
  const rows = SAMPLE_TEAMS.map((_, i) => {
    const played = 11;
    const won = Math.max(0, 9 - i - (i % 2));
    const drawn = sport === 'basketball' ? 0 : i % 3 === 1 ? 2 : 1;
    const lost = Math.max(0, played - won - drawn);
    const f = Math.round(base * (played - i * 0.6));
    const ag = Math.round(base * (5 + i * 0.7));
    const pts = sport === 'afl' || sport === 'netball' ? won * 4 + drawn * 2 : sport === 'rugby_league' || sport === 'basketball' ? won * 2 + drawn : won * 3 + drawn;
    const form = ['W', 'W', 'D', 'L', 'W', 'L', 'D', 'W'].slice(i % 3, (i % 3) + 5) as ('W' | 'D' | 'L')[];
    return { position: i + 1, team: sampleTeam(i), played, won, drawn, lost, for: f, against: ag, difference: f - ag, percentage: ag ? Math.round((f / ag) * 10000) / 100 : 0, points: pts, winPct: Math.round(((won + drawn / 2) / played) * 10000) / 10000, form };
  });
  const day = now;
  const fx = (i: number, h: number, a: number, score: [number, number] | null, live = false) => ({
    id: i === 0 ? 'sample' : `fx${i}`, round: i < 4 ? '12' : '13', scheduledAt: new Date(day + (i < 4 ? i * 3600_000 : 7 * 86_400_000 + (i - 4) * 3600_000)).toISOString(), status: score ? (live ? 'live' : 'completed') : 'scheduled', live,
    home: sampleTeam(h), away: sampleTeam(a), score: score ? { home: score[0], away: score[1] } : null,
    scoreDetail: score && sport === 'afl' ? { home: `${Math.floor(score[0] / 6)}.${score[0] % 6} (${score[0]})`, away: `${Math.floor(score[1] / 6)}.${score[1] % 6} (${score[1]})` } : null,
  });
  const sc = (g: number) => (sport === 'basketball' ? 70 + g * 7 : sport === 'afl' ? 60 + g * 9 : sport === 'rugby_league' ? 12 + g * 6 : sport === 'netball' ? 40 + g * 5 : g);
  const fixtures = [fx(0, 0, 1, [sc(2), sc(1)], true), fx(1, 2, 3, [sc(1), sc(1)]), fx(2, 4, 5, [sc(0), sc(3)]), fx(3, 6, 7, null), fx(4, 1, 2, null), fx(5, 3, 0, null), fx(6, 5, 6, null), fx(7, 7, 4, null)];
  const names = ['Mia Torres', 'Léa Ångström', 'Kai Fitzgerald', 'Noa Kimura', 'Zara Okafor'];
  const topScorers = names.map((n, i) => ({ playerId: samplePlayerId(i % 2 ? 'away' : 'home', 9 - i), displayName: n, shortName: n.split(' ')[1] ?? n, photoUrl: null, team: sampleTeam(i % 2), goals: 9 - i * 2, assists: 3 + (i % 3), points: sport === 'basketball' ? 212 - i * 27 : sport === 'afl' ? (9 - i * 2) * 6 + 4 : sport === 'rugby_league' ? (9 - i * 2) * 4 : 9 - i * 2 }));
  return { name: '2026 Season', standings: rows, standingsUnit: unit, rankBy: sport === 'basketball' ? 'win_pct' : 'points', fixtures: fixtures, otherScores: fixtures.slice(1, 4), topScorers };
}

export function samplePreview(): RenderData['preview'] {
  const d = (n: number) => new Date(Date.now() - n * 86_400_000 * 30).toISOString();
  return {
    headToHead: { played: 4, homeWins: 2, awayWins: 1, draws: 1, homeFor: 7, awayFor: 5, meetings: [{ matchId: 'm1', playedAt: d(3), homeTeamId: 'a', awayTeamId: 'h', homeScore: 1, awayScore: 2 }, { matchId: 'm2', playedAt: d(9), homeTeamId: 'h', awayTeamId: 'a', homeScore: 1, awayScore: 1 }, { matchId: 'm3', playedAt: d(15), homeTeamId: 'a', awayTeamId: 'h', homeScore: 2, awayScore: 1 }, { matchId: 'm4', playedAt: d(21), homeTeamId: 'h', awayTeamId: 'a', homeScore: 3, awayScore: 1 }] },
    form: { home: ['W', 'W', 'D', 'L', 'W'], away: ['L', 'W', 'D', 'D', 'L'] },
    positions: { home: 1, away: 2 },
  };
}

/** Scoring and discipline events for the summary board. */
export function sampleEvents(sport: Sport): NonNullable<RenderData['match']['events']> {
  const score = sport === 'basketball' ? 'score' : sport === 'rugby_league' ? 'try' : sport === 'afl' ? 'goal' : 'goal';
  const down = sport === 'basketball' || sport === 'netball' || sport === 'hockey';
  // futsal events read as the minute of play, like football's
  const min = (m: number) => (down ? `${String(m % 10).padStart(1, '0')}:${String((m * 7) % 60).padStart(2, '0')}` : `${m}'`);
  return [
    { id: 'e1', type: score, group: 'score', side: 'home', playerId: samplePlayerId('home', 9), minute: min(23), periodId: 'p1', payload: {} },
    { id: 'e2', type: sport === 'football' || sport === 'futsal' ? 'yellow_card' : sport === 'hockey' ? 'green_card' : sport === 'rugby_league' ? 'sin_bin' : 'foul', group: sport === 'basketball' || sport === 'netball' || sport === 'afl' ? 'other' : 'discipline', side: 'away', playerId: samplePlayerId('away', 5), minute: min(31), periodId: 'p1', payload: {} },
    { id: 'e3', type: score, group: 'score', side: 'away', playerId: samplePlayerId('away', 10), minute: min(44), periodId: 'p2', payload: {} },
    { id: 'e4', type: 'substitution', group: 'change', side: 'home', playerId: null, minute: min(58), periodId: 'p2', payload: {} },
    { id: 'e5', type: score, group: 'score', side: 'home', playerId: samplePlayerId('home', 9), minute: min(63), periodId: 'p2', payload: {} },
  ].filter((e) => e.group !== 'other') as NonNullable<RenderData['match']['events']>;
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

