// Public match centre: a capability link per match that shows the live score, events and lineups to fans,
// a read-only companion view for commentators, and a JSON feed for club websites. Only public display data.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { competitions, matchFacts, matchLineups, matchState, matches, teams, venues, withTenant, type Db } from '@bs/db';
import { getAdapter, type LineupSnapshot, type MatchProjection, type Sport } from '@bs/domain';
import { assertCan } from './authz';
import { audit } from './audit';
import { randomToken } from './crypto';
import { tx, type Ctx } from './context';
import { notFound } from './errors';
import { renderSeasonTx } from './season-data';

/** Create (or rotate) the public link of a match. */
export async function shareMatch(ctx: Ctx, matchId: string, action: 'create' | 'rotate' | 'disable' = 'create') {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'competition.write', { matchId: m.id, competitionId: m.competitionId });
    const token = action === 'disable' ? null : action === 'rotate' || !m.publicToken ? randomToken(18) : m.publicToken;
    await t.update(matches).set({ publicToken: token, updatedAt: new Date() }).where(eq(matches.id, matchId));
    await audit(t, ctx.actor, 'match.share', 'match', matchId, { after: { shared: !!token, rotated: action === 'rotate' } });
    return { token, url: token ? `${ctx.config.PUBLIC_WEB_URL}/m/${token}` : null, feedUrl: token ? `${ctx.config.PUBLIC_API_URL}/api/v1/public/match/${token}/feed.json` : null };
  });
}

export interface PublicMatch {
  id: string;
  sport: Sport;
  status: string;
  competition: { name: string; shortName: string | null };
  round: string | null;
  venue: string | null;
  scheduledAt: string;
  timezone: string;
  teams: { home: PublicTeam; away: PublicTeam };
  score: { home: number; away: number };
  scoreDetail: { home: string; away: string } | null;
  phase: { id: string; label: string; short: string; kind: string };
  clock: { text: string; running: boolean; stoppage: string | null; serverNow: number };
  shootout: { home: number; away: number } | null;
  events: { id: string; type: string; side: 'home' | 'away' | null; player: string | null; number: number | null; minute: string | null; periodId: string }[];
  lineups: { home: PublicPlayer[]; away: PublicPlayer[]; formations?: { home?: string | null; away?: string | null } };
  stats: { key: string; label: string; home: number; away: number }[];
  officials: { role: string; name: string }[];
  attendance: number | null;
  standings: { position: number; team: string; played: number; points: number; teamId: string }[] | null;
  stateVersion: number;
}
interface PublicTeam { id: string; name: string; shortName: string; abbreviation: string; primaryColor: string; secondaryColor: string; logoUrl: string | null }
interface PublicPlayer { id: string; name: string; number: number | null; position: string | null; starter: boolean; captain: boolean }

/** Everything the fan page and the JSON feed show (no actor: token-authenticated). */
export async function publicMatchByToken(rootDb: Db, token: string, assetUrl: (orgId: string, assetId: string | null | undefined) => string | null): Promise<PublicMatch | null> {
  if (!token || token.length < 16) return null;
  // the token is resolved by a SECURITY DEFINER function, then everything else runs inside that tenant
  const r = await rootDb.execute<{ match_id: string; organisation_id: string }>(sql`select * from resolve_match_public_token(${token})`);
  const hit = r.rows[0];
  if (!hit) return null;
  return withTenant(rootDb, { organisationId: hit.organisation_id }, (db) => publicMatchTx(db, hit.match_id, assetUrl));
}

async function publicMatchTx(db: Parameters<Parameters<typeof withTenant>[2]>[0], matchId: string, assetUrl: (orgId: string, assetId: string | null | undefined) => string | null): Promise<PublicMatch | null> {
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m) return null;
  const [st] = await db.select().from(matchState).where(eq(matchState.matchId, m.id));
  const [lu] = await db.select().from(matchLineups).where(eq(matchLineups.matchId, m.id));
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const [venue] = m.venueId ? await db.select().from(venues).where(eq(venues.id, m.venueId)) : [undefined];
  const ts = await db.select().from(teams).where(inArray(teams.id, [m.homeTeamId, m.awayTeamId]));
  const adapter = getAdapter(m.sport);
  const cfg = m.rulesConfig as never;
  const proj = st!.projection as unknown as MatchProjection;
  const clocks = st!.clocks as never;
  const now = Date.now();
  const display = adapter.display(cfg, proj, clocks, now);
  const phase = adapter.phase(cfg, proj.phase)!;
  const lineup = (lu?.snapshot ?? { home: [], away: [] }) as unknown as LineupSnapshot;
  const names = new Map<string, { name: string; number: number | null }>();
  for (const s of ['home', 'away'] as const) for (const p of lineup[s] ?? []) names.set(p.playerId, { name: p.shortName ?? p.displayName, number: p.number ?? null });
  const team = (id: string): PublicTeam => {
    const t = ts.find((x) => x.id === id)!;
    return { id: t.id, name: t.name, shortName: t.shortName, abbreviation: t.abbreviation, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, logoUrl: assetUrl(m.organisationId, t.logoAssetId) };
  };
  const defs = adapter.eventTypes(cfg);
  const facts = await db.select().from(matchFacts).where(and(eq(matchFacts.matchId, m.id), eq(matchFacts.category, 'event'), eq(matchFacts.voided, false))).orderBy(asc(matchFacts.sequence));
  const mainDown = (st!.clocks as Record<string, { direction?: string }>).main?.direction === 'down';
  const minute = (ms: number | null) => (ms == null ? null : mainDown ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : `${Math.floor(ms / 60000) + 1}'`);
  const events = facts
    .filter((f) => ['score', 'discipline', 'change', 'shootout'].includes(defs.find((d) => d.type === f.type)?.group ?? ''))
    .map((f) => ({ id: f.id, type: f.type, side: (f.side as 'home' | 'away' | null) ?? null, player: f.playerId ? names.get(f.playerId)?.name ?? null : null, number: f.playerId ? names.get(f.playerId)?.number ?? null : null, minute: minute(f.clockMs), periodId: f.periodId }));
  const rows = adapter.capabilities(cfg).statRows;
  const url = (id: string | null | undefined) => assetUrl(m.organisationId, id);
  const season = await renderSeasonTx(db, m.organisationId, m, url).catch(() => ({ season: null, preview: null }));
  const players = (s: 'home' | 'away'): PublicPlayer[] => (lineup[s] ?? []).map((p) => ({ id: p.playerId, name: p.displayName, number: p.number ?? null, position: p.position ?? null, starter: p.starter, captain: !!p.captain }));
  return {
    id: m.id,
    sport: m.sport as Sport,
    status: m.status,
    competition: { name: comp!.name, shortName: comp!.shortName },
    round: m.round,
    venue: venue?.name ?? null,
    scheduledAt: m.scheduledAt.toISOString(),
    timezone: m.timezone,
    teams: { home: team(m.homeTeamId), away: team(m.awayTeamId) },
    score: { ...display.score },
    scoreDetail: display.scoreDetail ?? null,
    phase: { id: phase.id, label: phase.label, short: phase.short, kind: phase.kind },
    clock: { text: display.clockText, running: display.clockRunning, stoppage: display.stoppageText ?? null, serverNow: now },
    shootout: display.shootout ?? null,
    events,
    lineups: { home: players('home'), away: players('away'), formations: lineup.formations },
    stats: rows.map((r) => ({ key: r.key, label: r.label, home: Number(proj.stats.home?.[r.key] ?? 0), away: Number(proj.stats.away?.[r.key] ?? 0) })),
    officials: (m.officials as { role: string; name: string }[]) ?? [],
    attendance: m.attendance,
    standings: season.season ? season.season.standings.slice(0, 20).map((r) => ({ position: r.position, team: r.team.shortName, played: r.played, points: r.points, teamId: r.team.id })) : null,
    stateVersion: st!.stateVersion,
  };
}
