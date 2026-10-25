// Finals series of a season: the top of the ladder in knockout rounds, each round created from the winners of the
// one before. Finals matches take the competition's finals rules (a level score is decided) and never count for
// the ladder. Matches are created through the ordinary match creation, so they get their graphics output too.
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { competitions, matchState, matches, seasons } from '@bs/db';
import {
  FINALS_FORMAT_INFO,
  FINALS_FORMATS,
  getAdapter,
  isValidTimeZone,
  knockoutWinner,
  nextFinalsRound,
  type FinalsBracket,
  type FinalsFormat,
  type MatchProjection,
  type PlayedFinal,
} from '@bs/domain';
import { assertCan } from './authz';
import { audit } from './audit';
import { conflict, invalid, notFound } from './errors';
import { tx, type Ctx } from './context';
import type { Tx } from '@bs/db';
import { createMatchTx } from './matches';
import { stageRules } from './catalog';
import { isFinal, ladderTx, type TeamRef } from './season-data';

async function seasonOf(ctx: Ctx, t: Tx, seasonId: string) {
  const [s] = await t.select().from(seasons).where(and(eq(seasons.id, seasonId), eq(seasons.organisationId, ctx.actor.organisationId)));
  if (!s) throw notFound('Season');
  const [c] = await t.select().from(competitions).where(and(eq(competitions.id, s.competitionId), eq(competitions.organisationId, ctx.actor.organisationId)));
  if (!c) throw notFound('Competition');
  assertCan(ctx.actor, 'competition.read', { competitionId: c.id });
  return { season: s, competition: c };
}

const unknownTeam = (id: string): TeamRef => ({ id, name: 'Unknown team', shortName: '?', abbreviation: '???', logoAssetId: null, primaryColor: '#888888', secondaryColor: '#000000' });

async function finalsState(ctx: Ctx, t: Tx, seasonId: string) {
  const { season, competition } = await seasonOf(ctx, t, seasonId);
  const { table, teams, regularLeft } = await ladderTx(t, ctx.actor.organisationId, seasonId, competition);
  const ladder = table.map((r) => r.teamId);
  const rows = await t
    .select({ m: matches, phase: matchState.phase, projection: matchState.projection })
    .from(matches)
    .innerJoin(matchState, eq(matchState.matchId, matches.id))
    .where(and(eq(matches.organisationId, ctx.actor.organisationId), eq(matches.seasonId, seasonId), eq(matches.stage, 'finals')))
    .orderBy(asc(matches.scheduledAt));
  const team = (id: string) => teams.get(id) ?? unknownTeam(id);
  const live = rows.filter((r) => !['cancelled', 'archived'].includes(r.m.status));
  const list = live.map((r) => {
    const proj = r.projection as unknown as MatchProjection;
    const done = isFinal(r.m, r.phase);
    const shootout = proj.shootout ? { home: proj.shootout.home, away: proj.shootout.away } : null;
    return {
      id: r.m.id,
      round: r.m.round,
      scheduledAt: r.m.scheduledAt.toISOString(),
      timezone: r.m.timezone,
      status: r.m.status,
      bracket: (r.m.bracket as unknown as FinalsBracket | null) ?? null,
      home: team(r.m.homeTeamId),
      away: team(r.m.awayTeamId),
      score: r.m.status === 'scheduled' && r.phase === 'scheduled' ? null : { ...proj.score },
      shootout,
      winner: done ? knockoutWinner(proj.score, shootout) : null,
      done,
    };
  });
  // the series follows the format of its bracket matches; finals added by hand sit beside it
  const format = (list.find((f) => f.bracket && f.bracket.format !== 'manual')?.bracket?.format ?? null) as FinalsFormat | null;
  const played: PlayedFinal[] = list.filter((f) => f.bracket && f.bracket.format === format).map((f) => ({ bracket: f.bracket!, homeTeamId: f.home.id, awayTeamId: f.away.id, winner: f.winner }));
  return { season, competition, table, team, ladder, regularLeft, list, format, played };
}

export interface FinalsView {
  season: { id: string; name: string };
  formats: { id: FinalsFormat; label: string; teams: number; rounds: string[] }[];
  format: FinalsFormat | null;
  ladder: { position: number; team: TeamRef; points: number; played: number }[];
  /** regular-season matches still to be played */
  regularLeft: number;
  matches: Awaited<ReturnType<typeof finalsState>>['list'];
  next:
    | { kind: 'start' }
    | { kind: 'round'; week: number; round: string; fixtures: { round: string; slot: number; seeds: { home: number; away: number }; home: TeamRef; away: TeamRef }[] }
    | { kind: 'waiting'; week: number; unresolved: { home: TeamRef; away: TeamRef; round: string | null }[] }
    | { kind: 'done'; champion: TeamRef | null };
  rules: { description: string[]; knockoutLabel: string | null; own: boolean };
}

export async function getFinals(ctx: Ctx, seasonId: string): Promise<FinalsView> {
  return tx(ctx, async (t) => {
    const st = await finalsState(ctx, t, seasonId);
    const adapter = getAdapter(st.competition.sport);
    let next: FinalsView['next'] = { kind: 'start' };
    if (st.format) {
      const n = nextFinalsRound(st.format, st.played, st.ladder);
      if (n.kind === 'round') next = { kind: 'round', week: n.week, round: n.fixtures[0]?.round ?? '', fixtures: n.fixtures.map((f) => ({ round: f.round, slot: f.bracket.slot, seeds: f.bracket.seeds, home: st.team(f.homeTeamId), away: st.team(f.awayTeamId) })) };
      else if (n.kind === 'waiting') next = { kind: 'waiting', week: n.week, unresolved: st.list.filter((f) => f.bracket?.format === st.format && f.bracket.week === n.week && !f.winner).map((f) => ({ home: f.home, away: f.away, round: f.round })) };
      else next = { kind: 'done', champion: n.championTeamId ? st.team(n.championTeamId) : null };
    }
    const finals = stageRules(st.competition, 'finals');
    return {
      season: { id: st.season.id, name: st.season.name },
      formats: FINALS_FORMATS.map((id) => ({ id, ...FINALS_FORMAT_INFO[id] })),
      format: st.format,
      ladder: st.table.slice(0, 8).map((r) => ({ position: r.position, team: st.team(r.teamId), points: r.points, played: r.played })),
      regularLeft: st.regularLeft,
      matches: st.list,
      next,
      rules: { description: adapter.describeRules(finals as never), knockoutLabel: adapter.knockout?.label ?? null, own: !!st.competition.finalsRulesConfig },
    };
  });
}

export const finalsRoundInput = z.object({
  /** the format, for the first round; later rounds follow the series already under way */
  format: z.enum(FINALS_FORMATS).optional(),
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone'),
  /** one kick-off per match of the round, in order */
  matches: z.array(z.object({ kickoffLocal: z.string().min(1), venueId: z.string().uuid().nullable().optional() })).min(1).max(8),
});

/** Create the next round of the finals: the first from the ladder, each later one from the winners. */
export async function createFinalsRound(ctx: Ctx, seasonId: string, input: z.input<typeof finalsRoundInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = finalsRoundInput.parse(input);
  return tx(ctx, async (t) => {
    // one round at a time per season, even with two people pressing the button
    await t.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`finals:${seasonId}`}, 0))`);
    const st = await finalsState(ctx, t, seasonId);
    const format = st.format ?? d.format;
    if (!format) throw invalid('Choose a finals format', [{ field: 'format', message: 'Required for the first finals round' }]);
    if (st.format && d.format && d.format !== st.format) throw conflict('FINALS_FORMAT_FIXED', `These finals are already ${FINALS_FORMAT_INFO[st.format].label.split(':')[0]}`);
    let n;
    try {
      n = nextFinalsRound(format, st.played, st.ladder);
    } catch (e) {
      throw invalid((e as Error).message, [{ field: 'format', message: (e as Error).message }]);
    }
    if (n.kind === 'waiting') throw conflict('FINALS_ROUND_UNDECIDED', `Every ${st.list.find((f) => f.bracket?.week === n.week)?.round ?? 'finals'} match needs a winner first (${n.unresolved.length} still to be decided)`);
    if (n.kind === 'done') throw conflict('FINALS_COMPLETE', 'The finals are complete');
    if (d.matches.length !== n.fixtures.length) throw invalid(`This round has ${n.fixtures.length} match${n.fixtures.length === 1 ? '' : 'es'}`, [{ field: 'matches', message: `Give ${n.fixtures.length} kick-off times` }]);
    const created = [];
    for (const [i, f] of n.fixtures.entries()) {
      const k = d.matches[i]!;
      const m = await createMatchTx(ctx, t, { competitionId: st.competition.id, seasonId, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, round: f.round, kickoffLocal: k.kickoffLocal, venueId: k.venueId ?? null, timezone: d.timezone, bracket: f.bracket });
      created.push({ id: m.id, round: m.round, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, scheduledAt: m.scheduledAt.toISOString(), bracket: f.bracket });
    }
    await audit(t, ctx.actor, 'finals.round_create', 'season', seasonId, { after: { format, week: n.week, round: n.fixtures[0]!.round, matches: created.map((c) => c.id) } });
    return { format, week: n.week, round: n.fixtures[0]!.round, created };
  });
}
