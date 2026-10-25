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
export const teamRef = (t: typeof teams.$inferSelect): TeamRef => ({ id: t.id, name: t.name, shortName: t.shortName, abbreviation: t.abbreviation, logoAssetId: t.logoAssetId, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor });

async function seasonRow(ctx: Ctx, t: Tx, seasonId: string) {
  const [s] = await t.select().from(seasons).where(and(eq(seasons.id, seasonId), eq(seasons.organisationId, ctx.actor.organisationId)));
  if (!s) throw notFound('Season');
  const [c] = await t.select().from(competitions).where(eq(competitions.id, s.competitionId));
  if (!c) throw notFound('Competition');
  assertCan(ctx.actor, 'competition.read', { competitionId: c.id });
  return { season: s, competition: c };
}

/** A match counts for the table once it reached its final phase (or was marked completed). */
export const isFinal = (m: MatchRow, phase: string | undefined) => m.status === 'completed' || phase === 'full_time';

async function resultsFor(t: Tx, organisationId: string, where: ReturnType<typeof and>) {
  const rows = await t
    .select({ m: matches, phase: matchState.phase, projection: matchState.projection })
    .from(matches)
    .innerJoin(matchState, eq(matchState.matchId, matches.id))
    .where(and(eq(matches.organisationId, organisationId), where));
  const results: StandingsResult[] = [];
  /** regular-season results only: finals never count for the ladder */
  const ladder: StandingsResult[] = [];
  for (const r of rows) {
    if (!isFinal(r.m, r.phase) || r.m.isDemo) continue;
    const proj = r.projection as unknown as MatchProjection;
    const res = { matchId: r.m.id, homeTeamId: r.m.homeTeamId, awayTeamId: r.m.awayTeamId, homeScore: proj.score.home, awayScore: proj.score.away, playedAt: r.m.scheduledAt.toISOString(), round: r.m.round };
    results.push(res);
    if (r.m.stage !== 'finals') ladder.push(res);
  }
  return { rows, results, ladder };
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

/** The season's ladder (regular-season results only), top first, with the teams. */
export async function ladderTx(t: Tx, organisationId: string, seasonId: string, competition: typeof competitions.$inferSelect) {
  const { rows, ladder } = await resultsFor(t, organisationId, eq(matches.seasonId, seasonId));
  const ts = await seasonTeams(t, organisationId, seasonId, rows);
  const rules = standingsRules(competition.sport as Sport, competition.standingsRules as Partial<StandingsRules>);
  const table = computeStandings(ts.map((x) => x.id), ladder, rules, Object.fromEntries(ts.map((x) => [x.id, x.name])));
  const byId = new Map(ts.map((x) => [x.id, teamRef(x)]));
  const regularLeft = rows.filter((r) => r.m.stage !== 'finals' && !r.m.isDemo && !isFinal(r.m, r.phase) && !['cancelled', 'abandoned', 'postponed', 'archived'].includes(r.m.status)).length;
  return { table, teams: byId, regularLeft };
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
    const { rows, ladder: results } = await resultsFor(t, ctx.actor.organisationId, eq(matches.seasonId, seasonId));
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
  stage: 'regular' | 'finals';
  shootout: { home: number; away: number } | null;
}

/** Every match of the season, grouped by round in kick-off order (the regular season, then the finals); results carry the score. */
export async function getFixtures(ctx: Ctx, seasonId: string): Promise<{ rounds: { round: string | null; stage: 'regular' | 'finals'; matches: FixtureItem[] }[] }> {
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
        stage: r.m.stage === 'finals' ? 'finals' : 'regular',
        shootout: started && proj.shootout ? { home: proj.shootout.home, away: proj.shootout.away } : null,
      };
    });
    const groups = new Map<string, { round: string | null; stage: 'regular' | 'finals'; matches: FixtureItem[] }>();
    for (const it of items) {
      const k = `${it.stage}:${it.round ?? ''}`;
      if (!groups.has(k)) groups.set(k, { round: it.round ?? null, stage: it.stage, matches: [] });
      groups.get(k)!.matches.push(it);
    }
    const rounds = [...groups.values()];
    // numeric rounds in order, then named rounds, then unscheduled; the finals after the regular season
    rounds.sort((a, b) => {
      if (a.stage !== b.stage) return a.stage === 'finals' ? 1 : -1;
      if (a.stage === 'finals') return (a.matches[0]?.scheduledAt ?? '').localeCompare(b.matches[0]?.scheduledAt ?? '');
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
      const table = computeStandings(sTeams.map((x) => x.id), seasonResults.ladder, rules, Object.fromEntries(sTeams.map((x) => [x.id, x.name])));
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

// ---------------------------------------------------------------- renderer context (no actor: called from the overlay snapshot)

type UrlFor = (assetId: string | null | undefined) => string | null;

/** Season context and pre-match preview for one match, shaped for the renderer. */
export async function renderSeasonTx(t: Tx, organisationId: string, m: MatchRow, url: UrlFor) {
  const [comp] = await t.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const [season] = await t.select().from(seasons).where(eq(seasons.id, m.seasonId));
  if (!comp || !season) return { season: null, preview: null };
  const sport = comp.sport as Sport;
  const adapter = getAdapter(sport);
  const rules = standingsRules(sport, comp.standingsRules as Partial<StandingsRules>);
  const rows = await t
    .select({ m: matches, phase: matchState.phase, projection: matchState.projection, clocks: matchState.clocks })
    .from(matches)
    .innerJoin(matchState, eq(matchState.matchId, matches.id))
    .where(and(eq(matches.organisationId, organisationId), eq(matches.seasonId, m.seasonId)))
    .orderBy(asc(matches.scheduledAt));
  const results: StandingsResult[] = [];
  for (const r of rows) {
    if (!isFinal(r.m, r.phase) || r.m.isDemo || r.m.stage === 'finals') continue;
    const proj = r.projection as unknown as MatchProjection;
    results.push({ matchId: r.m.id, homeTeamId: r.m.homeTeamId, awayTeamId: r.m.awayTeamId, homeScore: proj.score.home, awayScore: proj.score.away, playedAt: r.m.scheduledAt.toISOString(), round: r.m.round });
  }
  const ts = await seasonTeams(t, organisationId, m.seasonId, rows);
  const ref = (x: typeof teams.$inferSelect) => ({ id: x.id, name: x.name, shortName: x.shortName, abbreviation: x.abbreviation, primaryColor: x.primaryColor, logoUrl: url(x.logoAssetId) });
  const byId = new Map(ts.map((x) => [x.id, ref(x)]));
  const unknown = (id: string) => ({ id, name: 'Unknown', shortName: '?', abbreviation: '???', primaryColor: '#888888', logoUrl: null });
  const table = computeStandings(ts.map((x) => x.id), results, rules, Object.fromEntries(ts.map((x) => [x.id, x.name])));
  const standings = table.map((r) => ({ position: r.position, team: byId.get(r.teamId) ?? unknown(r.teamId), played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, for: r.for, against: r.against, difference: r.difference, percentage: r.percentage, points: r.points, winPct: r.winPct, form: r.form }));
  const started = (r: (typeof rows)[number]) => r.m.status === 'live' || r.m.status === 'completed' || !['scheduled', 'ready', 'pre_match', 'players_entering', 'about_to_start'].includes(r.phase);
  const fixture = (r: (typeof rows)[number]) => {
    const proj = r.projection as unknown as MatchProjection;
    const on = started(r);
    const detail = on ? adapter.display(r.m.rulesConfig as never, proj, r.clocks as never, Date.now()).scoreDetail ?? null : null;
    return { id: r.m.id, round: r.m.round, scheduledAt: r.m.scheduledAt.toISOString(), status: r.m.status, live: r.m.status === 'live', home: byId.get(r.m.homeTeamId) ?? unknown(r.m.homeTeamId), away: byId.get(r.m.awayTeamId) ?? unknown(r.m.awayTeamId), score: on ? { ...proj.score } : null, scoreDetail: detail };
  };
  const live = rows.filter((r) => !r.m.isDemo);
  const roundOrder = [...new Set(live.map((r) => r.m.round ?? ''))];
  const thisIdx = roundOrder.indexOf(m.round ?? '');
  const wanted = new Set([m.round ?? '', roundOrder[thisIdx + 1] ?? '\u0000']);
  const fixtures = live.filter((r) => wanted.has(r.m.round ?? '')).map(fixture);
  const day = m.scheduledAt.toISOString().slice(0, 10);
  const otherScores = live.filter((r) => r.m.id !== m.id && r.m.scheduledAt.toISOString().slice(0, 10) === day).map(fixture);
  // top scorers from stored tallies
  const tallies = new Map<string, { goals: number; assists: number; points: number; teamId: string | null }>();
  const lineups = await t.select({ matchId: matchLineups.matchId, snapshot: matchLineups.snapshot }).from(matchLineups).where(inArray(matchLineups.matchId, live.map((r) => r.m.id).length ? live.map((r) => r.m.id) : ['00000000-0000-0000-0000-000000000000']));
  const sideOf = new Map<string, Map<string, 'home' | 'away'>>();
  for (const l of lineups) {
    const snap = l.snapshot as unknown as LineupSnapshot;
    const mm = new Map<string, 'home' | 'away'>();
    for (const s of ['home', 'away'] as const) for (const pl of snap[s] ?? []) mm.set(pl.playerId, s);
    sideOf.set(l.matchId, mm);
  }
  for (const r of live) {
    if (r.m.status !== 'live' && r.m.status !== 'completed') continue;
    const proj = r.projection as unknown as MatchProjection;
    for (const [id, tally] of Object.entries(proj.players as Record<string, PlayerTally>)) {
      const cur = tallies.get(id) ?? { goals: 0, assists: 0, points: 0, teamId: null };
      cur.goals += tally.goals ?? 0;
      cur.assists += tally.assists ?? 0;
      cur.points += tally.points ?? 0;
      const s = sideOf.get(r.m.id)?.get(id);
      if (s) cur.teamId = s === 'home' ? r.m.homeTeamId : r.m.awayTeamId;
      tallies.set(id, cur);
    }
  }
  const top = [...tallies.entries()].filter(([, v]) => v.goals || v.points || v.assists).sort((a, b) => b[1].goals - a[1].goals || b[1].points - a[1].points).slice(0, 12);
  const ps = top.length ? await t.select().from(players).where(inArray(players.id, top.map(([id]) => id))) : [];
  const topScorers = top
    .map(([id, v]) => {
      const pl = ps.find((x) => x.id === id);
      if (!pl) return null;
      const tm = v.teamId ? byId.get(v.teamId) : null;
      return { playerId: id, displayName: pl.displayName, shortName: pl.shortName, photoUrl: url(pl.photoAssetId), team: tm ? { id: tm.id, abbreviation: tm.abbreviation, primaryColor: tm.primaryColor, logoUrl: tm.logoUrl } : null, goals: v.goals, assists: v.assists, points: v.points };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  // preview: meetings across the competition, form this season, table positions
  const compResults = (await resultsFor(t, organisationId, and(eq(matches.competitionId, m.competitionId), lt(matches.scheduledAt, m.scheduledAt))!)).results;
  const before = results.filter((r) => r.playedAt < m.scheduledAt.toISOString());
  const h2h = headToHead(m.homeTeamId, m.awayTeamId, compResults, 5);
  const preview = {
    headToHead: { played: h2h.played, homeWins: h2h.aWins, awayWins: h2h.bWins, draws: h2h.draws, homeFor: h2h.aFor, awayFor: h2h.bFor, meetings: h2h.meetings.map((x) => ({ matchId: x.matchId, playedAt: x.playedAt, homeTeamId: x.homeTeamId, awayTeamId: x.awayTeamId, homeScore: x.homeScore, awayScore: x.awayScore })) },
    form: { home: formGuide(m.homeTeamId, before).map((f) => f.result), away: formGuide(m.awayTeamId, before).map((f) => f.result) },
    positions: table.length ? { home: table.find((r) => r.teamId === m.homeTeamId)?.position ?? null, away: table.find((r) => r.teamId === m.awayTeamId)?.position ?? null } : null,
  };
  return { season: { name: season.name, standings, standingsUnit: rules.unit, rankBy: rules.rankBy, fixtures, otherScores, topScorers }, preview };
}
