// Season-level data derived from results: league tables, fixtures and results by round, pre-match previews
// (head-to-head and form), player statistics across a season, and the season rollover.
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { competitions, matchLineups, matchState, matches, players, rosterMemberships, seasons, teams, type Tx } from '@bs/db';
import {
  computeStandings,
  formGuide,
  getAdapter,
  headToHead,
  standingsRules,
  type FormEntry,
  type LineupSnapshot,
  type MatchProjection,
  type PlayerTally,
  type Sport,
  type StandingRow,
  type StandingsResult,
  type StandingsRules,
} from '@bs/domain';
import { assertCan, hasWideRead, assignedScopes } from './authz';
import { audit } from './audit';
import { conflict, invalid, notFound } from './errors';
import { tx, type Ctx } from './context';

type MatchRow = typeof matches.$inferSelect;

export interface TeamRef { id: string; name: string; shortName: string; abbreviation: string; logoAssetId: string | null; primaryColor: string; secondaryColor: string }
const teamRef = (t: typeof teams.$inferSelect): TeamRef => ({ id: t.id, name: t.name, shortName: t.shortName, abbreviation: t.abbreviation, logoAssetId: t.logoAssetId, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor });

async function seasonRow(ctx: Ctx, t: Tx, seasonId: string) {
  const [s] = await t.select().from(seasons).where(and(eq(seasons.id, seasonId), eq(seasons.organisationId, ctx.actor.organisationId)));
  if (!s) throw notFound('Season');
  const [c] = await t.select().from(competitions).where(eq(competitions.id, s.competitionId));
  if (!c) throw notFound('Competition');
  assertCan(ctx.actor, 'competition.read', { competitionId: c.id });
  return { season: s, competition: c };
}

/** A match counts for the table once it reached its final phase (or was marked completed). */
const isFinal = (m: MatchRow, phase: string | undefined) => m.status === 'completed' || phase === 'full_time';

async function resultsFor(t: Tx, organisationId: string, where: ReturnType<typeof and>) {
  const rows = await t
    .select({ m: matches, phase: matchState.phase, projection: matchState.projection })
    .from(matches)
    .innerJoin(matchState, eq(matchState.matchId, matches.id))
    .where(and(eq(matches.organisationId, organisationId), where));
  const results: StandingsResult[] = [];
  for (const r of rows) {
    if (!isFinal(r.m, r.phase) || r.m.isDemo) continue;
    const proj = r.projection as unknown as MatchProjection;
    results.push({ matchId: r.m.id, homeTeamId: r.m.homeTeamId, awayTeamId: r.m.awayTeamId, homeScore: proj.score.home, awayScore: proj.score.away, playedAt: r.m.scheduledAt.toISOString(), round: r.m.round });
  }
  return { rows, results };
}

async function seasonTeams(t: Tx, organisationId: string, seasonId: string, matchRows: { m: MatchRow }[]) {
  const ids = new Set<string>();
  for (const r of matchRows) {
    ids.add(r.m.homeTeamId);
    ids.add(r.m.awayTeamId);
  }
  const roster = await t.selectDistinct({ teamId: rosterMemberships.teamId }).from(rosterMemberships).where(and(eq(rosterMemberships.seasonId, seasonId), eq(rosterMemberships.organisationId, organisationId)));
  for (const r of roster) ids.add(r.teamId);
  if (!ids.size) return [];
  return t.select().from(teams).where(and(inArray(teams.id, [...ids]), eq(teams.organisationId, organisationId)));
}

export interface StandingsResponse {
  season: { id: string; name: string; status: string };
  competition: { id: string; name: string; shortName: string | null; sport: Sport; logoAssetId: string | null };
  rules: StandingsRules;
  rows: (StandingRow & { team: TeamRef })[];
  resultsCounted: number;
}

export async function getStandings(ctx: Ctx, seasonId: string): Promise<StandingsResponse> {
  return tx(ctx, async (t) => {
    const { season, competition } = await seasonRow(ctx, t, seasonId);
    const { rows, results } = await resultsFor(t, ctx.actor.organisationId, eq(matches.seasonId, seasonId));
    const ts = await seasonTeams(t, ctx.actor.organisationId, seasonId, rows);
    const rules = standingsRules(competition.sport as Sport, competition.standingsRules as Partial<StandingsRules>);
    const names = Object.fromEntries(ts.map((x) => [x.id, x.name]));
    const byId = new Map(ts.map((x) => [x.id, teamRef(x)]));
    const table = computeStandings(ts.map((x) => x.id), results, rules, names);
    return {
      season: { id: season.id, name: season.name, status: season.status },
      competition: { id: competition.id, name: competition.name, shortName: competition.shortName, sport: competition.sport as Sport, logoAssetId: competition.logoAssetId },
      rules,
      rows: table.map((r) => ({ ...r, team: byId.get(r.teamId) ?? { id: r.teamId, name: 'Unknown team', shortName: '?', abbreviation: '???', logoAssetId: null, primaryColor: '#888888', secondaryColor: '#000000' } })),
      resultsCounted: results.length,
    };
  });
}

export interface FixtureItem {
  id: string;
  round: string | null;
  scheduledAt: string;
  timezone: string;
  status: string;
  phase: string;
  isDemo: boolean;
  venue: string | null;
  home: TeamRef;
  away: TeamRef;
  score: { home: number; away: number } | null;
  scoreDetail: { home: string; away: string } | null;
}

/** Every match of the season, grouped by round in kick-off order; results carry the score. */
export async function getFixtures(ctx: Ctx, seasonId: string): Promise<{ rounds: { round: string | null; matches: FixtureItem[] }[] }> {
  return tx(ctx, async (t) => {
    const { competition } = await seasonRow(ctx, t, seasonId);
    const rows = await t
      .select({ m: matches, phase: matchState.phase, projection: matchState.projection, clocks: matchState.clocks, teamsSnap: matchLineups.teams })
      .from(matches)
      .innerJoin(matchState, eq(matchState.matchId, matches.id))
      .leftJoin(matchLineups, eq(matchLineups.matchId, matches.id))
      .where(and(eq(matches.organisationId, ctx.actor.organisationId), eq(matches.seasonId, seasonId)))
      .orderBy(asc(matches.scheduledAt));
    const adapter = getAdapter(competition.sport);
    const venueIds = [...new Set(rows.map((r) => r.m.venueId).filter(Boolean))] as string[];
    const venueRows = venueIds.length ? await t.execute<{ id: string; name: string }>(sql`select id, name from venues where id in ${venueIds}`) : { rows: [] as { id: string; name: string }[] };
    const venueName = new Map(venueRows.rows.map((v) => [v.id, v.name]));
    const items: FixtureItem[] = rows.map((r) => {
      const snap = (r.teamsSnap ?? {}) as { home?: TeamRef; away?: TeamRef };
      const proj = r.projection as unknown as MatchProjection;
      const started = r.m.status === 'live' || r.m.status === 'completed' || (r.phase !== 'scheduled' && r.phase !== 'ready' && r.phase !== 'pre_match');
      const detail = started ? adapter.display(r.m.rulesConfig as never, proj, r.clocks as never, Date.now()).scoreDetail ?? null : null;
      return {
        id: r.m.id,
        round: r.m.round,
        scheduledAt: r.m.scheduledAt.toISOString(),
        timezone: r.m.timezone,
        status: r.m.status,
        phase: r.phase,
        isDemo: r.m.isDemo,
        venue: r.m.venueId ? venueName.get(r.m.venueId) ?? null : null,
        home: snap.home ?? { id: r.m.homeTeamId, name: 'Home', shortName: 'Home', abbreviation: 'HOM', logoAssetId: null, primaryColor: '#888888', secondaryColor: '#000000' },
        away: snap.away ?? { id: r.m.awayTeamId, name: 'Away', shortName: 'Away', abbreviation: 'AWY', logoAssetId: null, primaryColor: '#888888', secondaryColor: '#000000' },
        score: started ? { ...proj.score } : null,
        scoreDetail: detail,
      };
    });
    const groups = new Map<string | null, FixtureItem[]>();
    for (const it of items) {
      const k = it.round ?? null;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(it);
    }
    const rounds = [...groups.entries()].map(([round, ms]) => ({ round, matches: ms }));
    // numeric rounds in order, then named rounds, then unscheduled
    rounds.sort((a, b) => {
      if (a.round === null) return 1;
      if (b.round === null) return -1;
      const na = Number(a.round), nb = Number(b.round);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      if (!Number.isNaN(na)) return -1;
      if (!Number.isNaN(nb)) return 1;
      return (a.matches[0]?.scheduledAt ?? '').localeCompare(b.matches[0]?.scheduledAt ?? '');
    });
    return { rounds };
  });
}

export interface MatchPreview {
  headToHead: { played: number; homeWins: number; awayWins: number; draws: number; homeFor: number; awayFor: number; meetings: (StandingsResult & { homeTeam: TeamRef; awayTeam: TeamRef })[] };
  form: { home: (FormEntry & { opponent: TeamRef | null })[]; away: (FormEntry & { opponent: TeamRef | null })[] };
  standings: { home: StandingRow | null; away: StandingRow | null; rules: StandingsRules } | null;
}

/** Everything a pre-match board needs: meetings across the competition's history, recent form, table positions. */
export async function getMatchPreview(ctx: Ctx, matchId: string): Promise<MatchPreview> {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const [comp] = await t.select().from(competitions).where(eq(competitions.id, m.competitionId));
    const { results: compResults } = await resultsFor(t, ctx.actor.organisationId, and(eq(matches.competitionId, m.competitionId), lt(matches.scheduledAt, m.scheduledAt))!);
    const seasonResults = await resultsFor(t, ctx.actor.organisationId, and(eq(matches.seasonId, m.seasonId), lt(matches.scheduledAt, m.scheduledAt))!);
    const teamIds = new Set<string>([m.homeTeamId, m.awayTeamId]);
    for (const r of compResults) {
      teamIds.add(r.homeTeamId);
      teamIds.add(r.awayTeamId);
    }
    const ts = await t.select().from(teams).where(and(inArray(teams.id, [...teamIds]), eq(teams.organisationId, ctx.actor.organisationId)));
    const ref = new Map(ts.map((x) => [x.id, teamRef(x)]));
    const h2h = headToHead(m.homeTeamId, m.awayTeamId, compResults, 5);
    const withOpp = (f: FormEntry) => ({ ...f, opponent: ref.get(f.opponentId) ?? null });
    let standings: MatchPreview['standings'] = null;
    if (seasonResults.rows.length) {
      const rules = standingsRules(comp!.sport as Sport, comp!.standingsRules as Partial<StandingsRules>);
      const sTeams = await seasonTeams(t, ctx.actor.organisationId, m.seasonId, seasonResults.rows);
      const table = computeStandings(sTeams.map((x) => x.id), seasonResults.results, rules, Object.fromEntries(sTeams.map((x) => [x.id, x.name])));
      standings = { home: table.find((r) => r.teamId === m.homeTeamId) ?? null, away: table.find((r) => r.teamId === m.awayTeamId) ?? null, rules };
    }
    return {
      headToHead: {
        played: h2h.played, homeWins: h2h.aWins, awayWins: h2h.bWins, draws: h2h.draws, homeFor: h2h.aFor, awayFor: h2h.bFor,
        meetings: h2h.meetings.map((x) => ({ ...x, homeTeam: ref.get(x.homeTeamId)!, awayTeam: ref.get(x.awayTeamId)! })),
      },
      form: { home: formGuide(m.homeTeamId, seasonResults.results).map(withOpp), away: formGuide(m.awayTeamId, seasonResults.results).map(withOpp) },
      standings,
    };
  });
}

export interface PlayerSeasonRow {
  playerId: string;
  displayName: string;
  shortName: string | null;
  photoAssetId: string | null;
  team: TeamRef | null;
  appearances: number;
  starts: number;
  goals: number;
  assists: number;
  points: number;
  yellow: number;
  red: number;
  fouls: number;
  breakdown: Record<string, number>;
}

/** Per-player totals across a season, from each match's lineup and its stored projection. */
export async function getSeasonPlayerStats(ctx: Ctx, seasonId: string): Promise<{ rows: PlayerSeasonRow[]; sport: Sport }> {
  return tx(ctx, async (t) => {
    const { competition } = await seasonRow(ctx, t, seasonId);
    const rows = await t
      .select({ m: matches, phase: matchState.phase, projection: matchState.projection, lineup: matchLineups.snapshot })
      .from(matches)
      .innerJoin(matchState, eq(matchState.matchId, matches.id))
      .innerJoin(matchLineups, eq(matchLineups.matchId, matches.id))
      .where(and(eq(matches.organisationId, ctx.actor.organisationId), eq(matches.seasonId, seasonId), or(eq(matches.status, 'live'), eq(matches.status, 'completed'))));
    const acc = new Map<string, PlayerSeasonRow & { teamId: string | null }>();
    const get = (id: string, teamId: string | null) => {
      if (!acc.has(id)) acc.set(id, { playerId: id, displayName: '', shortName: null, photoAssetId: null, team: null, teamId, appearances: 0, starts: 0, goals: 0, assists: 0, points: 0, yellow: 0, red: 0, fouls: 0, breakdown: {} });
      return acc.get(id)!;
    };
    for (const r of rows) {
      if (r.m.isDemo) continue;
      const lineup = r.lineup as unknown as LineupSnapshot;
      const proj = r.projection as unknown as MatchProjection;
      const tallies = proj.players as Record<string, PlayerTally>;
      for (const side of ['home', 'away'] as const) {
        const teamId = side === 'home' ? r.m.homeTeamId : r.m.awayTeamId;
        for (const p of lineup[side] ?? []) {
          const row = get(p.playerId, teamId);
          const tally = tallies[p.playerId];
          const played = p.starter || tally?.onCourt === true || (tally && Object.keys(tally).length > 0);
          if (played) row.appearances++;
          if (p.starter) row.starts++;
        }
      }
      for (const [id, tally] of Object.entries(tallies)) {
        const row = get(id, null);
        row.goals += tally.goals ?? 0;
        row.assists += tally.assists ?? 0;
        row.points += tally.points ?? 0;
        row.yellow += tally.yellow ?? 0;
        row.red += tally.red ? 1 : 0;
        row.fouls += tally.fouls ?? 0;
        for (const [k, v] of Object.entries(tally.breakdown ?? {})) row.breakdown[k] = (row.breakdown[k] ?? 0) + v;
      }
    }
    const ids = [...acc.keys()];
    const ps = ids.length ? await t.select().from(players).where(and(inArray(players.id, ids), eq(players.organisationId, ctx.actor.organisationId))) : [];
    const teamIds = [...new Set([...acc.values()].map((x) => x.teamId).filter(Boolean))] as string[];
    const ts = teamIds.length ? await t.select().from(teams).where(inArray(teams.id, teamIds)) : [];
    const ref = new Map(ts.map((x) => [x.id, teamRef(x)]));
    const out: PlayerSeasonRow[] = [];
    for (const row of acc.values()) {
      const p = ps.find((x) => x.id === row.playerId);
      if (!p) continue;
      const { teamId, ...rest } = row;
      out.push({ ...rest, displayName: p.displayName, shortName: p.shortName, photoAssetId: p.photoAssetId, team: teamId ? ref.get(teamId) ?? null : null });
    }
    out.sort((a, b) => b.goals - a.goals || b.points - a.points || b.assists - a.assists || a.displayName.localeCompare(b.displayName));
    return { rows: out, sport: competition.sport as Sport };
  });
}

export const rolloverInput = z.object({
  name: z.string().trim().min(1).max(60),
  startsOn: z.string().date().nullable().optional(),
  endsOn: z.string().date().nullable().optional(),
  carryRosters: z.boolean().default(true),
  archivePrevious: z.boolean().default(true),
});

/** Close a season and start the next one, carrying teams and their rosters forward. */
export async function rolloverSeason(ctx: Ctx, seasonId: string, input: z.input<typeof rolloverInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = rolloverInput.parse(input);
  return tx(ctx, async (t) => {
    const { season, competition } = await seasonRow(ctx, t, seasonId);
    const [clash] = await t.select().from(seasons).where(and(eq(seasons.competitionId, competition.id), eq(seasons.name, d.name)));
    if (clash) throw conflict('SEASON_EXISTS', `A season called "${d.name}" already exists in this competition`);
    const [next] = await t
      .insert(seasons)
      .values({ organisationId: ctx.actor.organisationId, competitionId: competition.id, name: d.name, startsOn: d.startsOn ?? null, endsOn: d.endsOn ?? null, status: 'active', rolledFromSeasonId: season.id })
      .returning();
    let carried = 0;
    if (d.carryRosters) {
      const roster = await t.select().from(rosterMemberships).where(and(eq(rosterMemberships.seasonId, season.id), eq(rosterMemberships.status, 'active')));
      if (roster.length) {
        await t.insert(rosterMemberships).values(roster.map((r) => ({ organisationId: r.organisationId, playerId: r.playerId, teamId: r.teamId, seasonId: next!.id, number: r.number, position: r.position, validFrom: d.startsOn ?? null, status: 'active' })));
        carried = roster.length;
      }
    }
    if (d.archivePrevious) await t.update(seasons).set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() }).where(eq(seasons.id, season.id));
    await audit(t, ctx.actor, 'season.rollover', 'season', next!.id, { before: { from: season.id, name: season.name }, after: { name: d.name, carriedRosterRows: carried, archivedPrevious: d.archivePrevious } });
    return { season: next!, carriedRosterRows: carried };
  });
}

/** Seasons the actor can read, for pickers. */
export async function listSeasons(ctx: Ctx, competitionId: string) {
  return tx(ctx, async (t) => {
    assertCan(ctx.actor, 'competition.read', { competitionId });
    const wide = hasWideRead(ctx.actor);
    const s = assignedScopes(ctx.actor);
    if (!wide && !s.competitionIds.includes(competitionId)) throw notFound('Competition');
    return t.select().from(seasons).where(and(eq(seasons.competitionId, competitionId), eq(seasons.organisationId, ctx.actor.organisationId))).orderBy(desc(seasons.createdAt));
  });
}

export const _test = { isFinal, invalid };
