// Competitions, seasons, clubs, teams, players, rosters, venues. Entities with history are archived, never cascaded.
import { and, asc, count, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  clubs,
  competitions,
  matchFacts,
  matches,
  matchState,
  rulesPresets,
  players,
  rosterMemberships,
  seasons,
  teams,
  venues,
  type Tx,
} from '@bs/db';
import { getAdapter, isValidTimeZone, SPORTS } from '@bs/domain';
import { z } from 'zod';
import { assertCan, assignedScopes, hasWideRead } from './authz';
import { audit } from './audit';
import { conflict, invalid, notFound } from './errors';
import { nowMs, tx, type Ctx } from './context';
import { enqueueOutbox } from './outbox';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour');
const name = z.string().trim().min(1).max(100);

// ------------------------------------------------------------------ competitions
export const competitionInput = z.object({
  name,
  shortName: z.string().trim().max(24).nullable().optional(),
  sport: z.enum(SPORTS),
  rulesPreset: z.string().optional(),
  rulesConfig: z.record(z.string(), z.unknown()).optional(),
  defaultTimezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone'),
  logoAssetId: z.string().uuid().nullable().optional(),
  themeProfileId: z.string().uuid().nullable().optional(),
  gamePlanVersionId: z.string().uuid().nullable().optional(),
  outputDefaults: z.record(z.string(), z.unknown()).optional(),
  /** league table rules; omitted keys fall back to the sport's convention */
  standingsRules: z
    .object({
      win: z.number().int().min(0).max(10),
      draw: z.number().int().min(0).max(10),
      loss: z.number().int().min(0).max(10),
      bye: z.number().int().min(0).max(10),
      rankBy: z.enum(['points', 'win_pct']),
      order: z.array(z.enum(['points', 'win_pct', 'difference', 'for', 'percentage', 'wins', 'head_to_head', 'name'])).max(8),
      unit: z.enum(['goals', 'points']),
    })
    .partial()
    .optional(),
});

function resolveRules(sport: string, preset?: string, cfg?: Record<string, unknown>) {
  const adapter = getAdapter(sport);
  const base = preset ? adapter.presets.find((p) => p.id === preset)?.config : adapter.defaultConfig;
  if (!base) throw invalid('Unknown rules preset', [{ field: 'rulesPreset', message: 'Unknown preset' }]);
  const merged = { ...(base as object), ...(cfg ?? {}) };
  const r = adapter.configSchema.safeParse(merged);
  if (!r.success) throw invalid('Invalid rules settings', r.error.issues.map((i) => ({ field: `rulesConfig.${i.path.join('.')}`, message: i.message })));
  return { rulesVersion: adapter.rulesVersion, rulesConfig: r.data as Record<string, unknown> };
}

/** An organisation's own preset ("org:<id>" in a rules-preset field): its saved settings, or an error if it is not one of this organisation's for this sport. */
async function ownPreset(t: Tx, ctx: Ctx, sport: string, preset: string): Promise<Record<string, unknown>> {
  const id = preset.slice(4);
  const [p] = z.string().uuid().safeParse(id).success
    ? await t.select().from(rulesPresets).where(and(eq(rulesPresets.id, id), eq(rulesPresets.organisationId, ctx.actor.organisationId), eq(rulesPresets.sport, sport)))
    : [];
  if (!p) throw invalid('Unknown rules preset', [{ field: 'rulesPreset', message: 'That preset is not one of yours for this sport' }]);
  return p.config;
}

/** Built-in preset id, or an own preset's settings under the given changes. */
async function rulesFor(t: Tx, ctx: Ctx, sport: string, preset: string | undefined, cfg: Record<string, unknown> | undefined) {
  if (preset?.startsWith('org:')) return resolveRules(sport, undefined, { ...(await ownPreset(t, ctx, sport, preset)), ...(cfg ?? {}) });
  return resolveRules(sport, preset, cfg);
}

/**
 * Upcoming matches of a competition that nobody has scored yet (nothing recorded, not even a phase step) take the
 * competition's new rules, as if they had been created under them: their rules and their untouched match state
 * (clock lengths, timeouts) start again from the new rules. Matches with anything recorded keep theirs.
 */
async function retuneUntouchedMatches(t: Tx, ctx: Ctx, competitionId: string, rules: { rulesVersion: string; rulesConfig: Record<string, unknown> }) {
  const rows = await t
    .select({ m: matches, s: matchState })
    .from(matches)
    .innerJoin(matchState, eq(matchState.matchId, matches.id))
    .where(and(eq(matches.competitionId, competitionId), eq(matches.organisationId, ctx.actor.organisationId), eq(matches.status, 'scheduled'), eq(matchState.sequence, 0)))
    .for('update');
  const now = nowMs(ctx);
  for (const { m, s } of rows) {
    const adapter = getAdapter(m.sport);
    const cfg = rules.rulesConfig as never;
    const projection = adapter.initialProjection(cfg);
    const clocks = adapter.initialClocks(cfg);
    const stateVersion = s.stateVersion + 1;
    await t.update(matches).set({ sportRulesVersion: rules.rulesVersion, rulesConfig: rules.rulesConfig, updatedAt: new Date(now) }).where(eq(matches.id, m.id));
    await t.update(matchState).set({ stateVersion, projection: projection as never, clocks: clocks as never, updatedAt: new Date(now) }).where(and(eq(matchState.matchId, m.id), eq(matchState.stateVersion, s.stateVersion)));
    const base = { organisationId: ctx.actor.organisationId, aggregateType: 'match', aggregateId: m.id, aggregateSeq: stateVersion };
    await enqueueOutbox(t, [
      { ...base, topic: 'clock.anchor.updated', payload: { matchId: m.id, stateVersion, clocks: clocks as never, serverNow: now } },
      { ...base, topic: 'match.state.updated', payload: { matchId: m.id, stateVersion, sequence: 0, phase: projection.phase, projection, clocks, status: m.status, serverNow: now } as never },
    ]);
    await audit(t, ctx.actor, 'match.rules', 'match', m.id, { before: { rulesConfig: m.rulesConfig }, after: { rulesConfig: rules.rulesConfig, reason: 'competition rules changed before the match was scored' } });
  }
  return rows.length;
}

function competitionScopeFilter(ctx: Ctx): SQL | undefined {
  if (hasWideRead(ctx.actor)) return undefined;
  const s = assignedScopes(ctx.actor);
  const viaMatches = s.matchIds.length
    ? inArray(competitions.id, sql`(select ${matches.competitionId} from ${matches} where ${inArray(matches.id, s.matchIds)})`)
    : undefined;
  const parts = [s.competitionIds.length ? inArray(competitions.id, s.competitionIds) : undefined, viaMatches].filter(Boolean) as SQL[];
  return parts.length ? or(...parts) : sql`false`;
}

export async function listCompetitions(ctx: Ctx, q: { search?: string; status?: string; sport?: string } = {}) {
  return tx(ctx, async (t) => {
    const conds = [eq(competitions.organisationId, ctx.actor.organisationId)];
    if (q.search) conds.push(or(ilike(competitions.name, `%${q.search}%`), ilike(competitions.shortName, `%${q.search}%`))!);
    if (q.status) conds.push(eq(competitions.status, q.status));
    else conds.push(ne(competitions.status, 'archived'));
    if (q.sport) conds.push(eq(competitions.sport, q.sport));
    const scope = competitionScopeFilter(ctx);
    if (scope) conds.push(scope);
    const rows = await t.select().from(competitions).where(and(...conds)).orderBy(asc(competitions.name));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const seasonCounts = await t.select({ id: seasons.competitionId, n: count() }).from(seasons).where(inArray(seasons.competitionId, ids)).groupBy(seasons.competitionId);
    const matchCounts = await t.select({ id: matches.competitionId, n: count() }).from(matches).where(inArray(matches.competitionId, ids)).groupBy(matches.competitionId);
    const current = await t.select().from(seasons).where(and(inArray(seasons.competitionId, ids), eq(seasons.status, 'active')));
    return rows.map((r) => ({
      ...r,
      seasonCount: seasonCounts.find((x) => x.id === r.id)?.n ?? 0,
      matchCount: matchCounts.find((x) => x.id === r.id)?.n ?? 0,
      currentSeason: current.filter((s) => s.competitionId === r.id).sort((a, b) => String(b.startsOn).localeCompare(String(a.startsOn)))[0] ?? null,
    }));
  });
}

export async function getCompetition(ctx: Ctx, id: string) {
  return tx(ctx, async (t) => {
    const [c] = await t.select().from(competitions).where(and(eq(competitions.id, id), eq(competitions.organisationId, ctx.actor.organisationId)));
    if (!c) throw notFound('Competition');
    assertCan(ctx.actor, 'competition.read', { competitionId: c.id });
    const ss = await t.select().from(seasons).where(eq(seasons.competitionId, id)).orderBy(asc(seasons.startsOn));
    const adapter = getAdapter(c.sport);
    return { ...c, seasons: ss, rulesDescription: adapter.describeRules(c.rulesConfig as never), presets: adapter.presets.map((p) => ({ id: p.id, label: p.label })) };
  });
}

export async function createCompetition(ctx: Ctx, input: z.input<typeof competitionInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = competitionInput.parse(input);
  return tx(ctx, async (t) => {
    const rules = await rulesFor(t, ctx, d.sport, d.rulesPreset, d.rulesConfig);
    const [c] = await t
      .insert(competitions)
      .values({
        organisationId: ctx.actor.organisationId,
        name: d.name,
        shortName: d.shortName ?? null,
        sport: d.sport,
        ...rules,
        defaultTimezone: d.defaultTimezone,
        logoAssetId: d.logoAssetId ?? null,
        themeProfileId: d.themeProfileId ?? null,
        gamePlanVersionId: d.gamePlanVersionId ?? null,
        outputDefaults: d.outputDefaults ?? {},
        createdBy: ctx.actor.userId,
      })
      .returning();
    await audit(t, ctx.actor, 'competition.create', 'competition', c!.id, { after: { name: c!.name, sport: c!.sport } });
    return c!;
  });
}

export async function updateCompetition(ctx: Ctx, id: string, input: Partial<z.input<typeof competitionInput>> & { status?: 'active' | 'archived'; applyToUpcoming?: boolean }) {
  assertCan(ctx.actor, 'competition.write');
  const { applyToUpcoming, ...d } = competitionInput.partial().extend({ status: z.enum(['active', 'archived']).optional(), applyToUpcoming: z.boolean().optional() }).parse(input);
  return tx(ctx, async (t) => {
    const [c] = await t.select().from(competitions).where(and(eq(competitions.id, id), eq(competitions.organisationId, ctx.actor.organisationId)));
    if (!c) throw notFound('Competition');
    if (d.sport && d.sport !== c.sport) throw invalid('Sport cannot change after creation', [{ field: 'sport', message: 'Create a new competition instead' }]);
    // Rules changes never affect matches that already pinned a rules version (matches.rules_config snapshot).
    const rules = d.rulesPreset || d.rulesConfig ? await rulesFor(t, ctx, c.sport, d.rulesPreset, { ...(d.rulesPreset ? {} : c.rulesConfig), ...(d.rulesConfig ?? {}) }) : null;
    const { rulesPreset: _p, rulesConfig: _c, ...rest } = d;
    const [u] = await t
      .update(competitions)
      .set({ ...rest, ...(rules ?? {}), updatedAt: new Date() })
      .where(eq(competitions.id, id))
      .returning();
    await audit(t, ctx.actor, d.status === 'archived' ? 'competition.archive' : 'competition.update', 'competition', id, { before: { name: c.name, status: c.status, ...(rules ? { rulesConfig: c.rulesConfig } : {}) }, after: d });
    const matchesUpdated = rules && applyToUpcoming ? await retuneUntouchedMatches(t, ctx, id, rules) : 0;
    return { ...u!, matchesUpdated };
  });
}

export const seasonInput = z.object({
  name: z.string().trim().min(1).max(40),
  startsOn: z.string().date().nullable().optional(),
  endsOn: z.string().date().nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export async function createSeason(ctx: Ctx, competitionId: string, input: z.input<typeof seasonInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = seasonInput.parse(input);
  if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) throw invalid('Season ends before it starts', [{ field: 'endsOn', message: 'Must be after the start date' }]);
  return tx(ctx, async (t) => {
    const [c] = await t.select({ id: competitions.id }).from(competitions).where(and(eq(competitions.id, competitionId), eq(competitions.organisationId, ctx.actor.organisationId)));
    if (!c) throw notFound('Competition');
    try {
      const [s] = await t.insert(seasons).values({ organisationId: ctx.actor.organisationId, competitionId, name: d.name, startsOn: d.startsOn ?? null, endsOn: d.endsOn ?? null }).returning();
      await audit(t, ctx.actor, 'season.create', 'season', s!.id, { after: d });
      return s!;
    } catch (e) {
      if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE_SEASON', `Season "${d.name}" already exists for this competition`);
      throw e;
    }
  });
}

export async function updateSeason(ctx: Ctx, id: string, input: Partial<z.input<typeof seasonInput>>) {
  assertCan(ctx.actor, 'competition.write');
  const d = seasonInput.partial().parse(input);
  return tx(ctx, async (t) => {
    const [s] = await t.update(seasons).set({ ...d, updatedAt: new Date() }).where(and(eq(seasons.id, id), eq(seasons.organisationId, ctx.actor.organisationId))).returning();
    if (!s) throw notFound('Season');
    await audit(t, ctx.actor, 'season.update', 'season', id, { after: d });
    return s;
  });
}

// ------------------------------------------------------------------ clubs & teams
export const clubInput = z.object({ name, shortName: z.string().trim().max(30).nullable().optional(), logoAssetId: z.string().uuid().nullable().optional() });

export async function listClubs(ctx: Ctx) {
  return tx(ctx, (t) => t.select().from(clubs).where(and(eq(clubs.organisationId, ctx.actor.organisationId), ne(clubs.status, 'archived'))).orderBy(asc(clubs.name)));
}

export async function createClub(ctx: Ctx, input: z.input<typeof clubInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = clubInput.parse(input);
  return tx(ctx, async (t) => {
    const [c] = await t.insert(clubs).values({ organisationId: ctx.actor.organisationId, ...d }).returning();
    await audit(t, ctx.actor, 'club.create', 'club', c!.id, { after: d });
    return c!;
  });
}

export const teamInput = z.object({
  name,
  shortName: z.string().trim().min(1).max(24),
  abbreviation: z.string().trim().toUpperCase().min(2).max(5),
  sport: z.enum(SPORTS),
  clubId: z.string().uuid().nullable().optional(),
  logoAssetId: z.string().uuid().nullable().optional(),
  primaryColor: color.default('#3EA6FF'),
  secondaryColor: color.default('#0B1220'),
  awayPrimaryColor: color.nullable().optional(),
  awaySecondaryColor: color.nullable().optional(),
  grade: z.string().trim().max(40).nullable().optional(),
  /** the saved starting side, applied to a match with "use the default lineup" */
  defaultLineup: z
    .object({
      players: z.array(z.object({ playerId: z.string().uuid(), number: z.number().int().min(0).max(999).nullable().optional(), position: z.string().max(20).nullable().optional(), starter: z.boolean(), captain: z.boolean().optional() })).max(40),
      formation: z.string().max(20).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export async function listTeams(ctx: Ctx, q: { sport?: string; search?: string; includeArchived?: boolean } = {}) {
  return tx(ctx, (t) => {
    const conds = [eq(teams.organisationId, ctx.actor.organisationId)];
    if (!q.includeArchived) conds.push(ne(teams.status, 'archived'));
    if (q.sport) conds.push(eq(teams.sport, q.sport));
    if (q.search) conds.push(or(ilike(teams.name, `%${q.search}%`), ilike(teams.abbreviation, `%${q.search}%`))!);
    return t.select().from(teams).where(and(...conds)).orderBy(asc(teams.name));
  });
}

export async function getTeam(ctx: Ctx, id: string) {
  return tx(ctx, async (t) => {
    const [team] = await t.select().from(teams).where(and(eq(teams.id, id), eq(teams.organisationId, ctx.actor.organisationId)));
    if (!team) throw notFound('Team');
    const roster = await t
      .select({ roster: rosterMemberships, player: players, season: seasons })
      .from(rosterMemberships)
      .innerJoin(players, eq(players.id, rosterMemberships.playerId))
      .innerJoin(seasons, eq(seasons.id, rosterMemberships.seasonId))
      .where(eq(rosterMemberships.teamId, id))
      .orderBy(asc(rosterMemberships.number));
    return {
      ...team,
      roster: roster.map((r) => ({
        id: r.roster.id,
        seasonId: r.season.id,
        seasonName: r.season.name,
        number: r.roster.number,
        position: r.roster.position ?? r.player.position,
        status: r.roster.status,
        player: { id: r.player.id, displayName: r.player.displayName, shortName: r.player.shortName, photoAssetId: r.player.photoAssetId },
      })),
    };
  });
}

export async function createTeam(ctx: Ctx, input: z.input<typeof teamInput>, t0?: Tx) {
  assertCan(ctx.actor, 'competition.write');
  const d = teamInput.parse(input);
  const run = async (t: Tx) => {
    const [team] = await t.insert(teams).values({ organisationId: ctx.actor.organisationId, ...d }).returning();
    await audit(t, ctx.actor, 'team.create', 'team', team!.id, { after: { name: d.name } });
    return team!;
  };
  return t0 ? run(t0) : tx(ctx, run);
}

export async function updateTeam(ctx: Ctx, id: string, input: Partial<z.input<typeof teamInput>> & { status?: 'active' | 'archived' }) {
  const d = teamInput.partial().extend({ status: z.enum(['active', 'archived']).optional() }).parse(input);
  return tx(ctx, async (t) => {
    const [team] = await t.select().from(teams).where(and(eq(teams.id, id), eq(teams.organisationId, ctx.actor.organisationId)));
    if (!team) throw notFound('Team');
    const brandingOnly = Object.keys(d).every((k) => ['logoAssetId', 'primaryColor', 'secondaryColor', 'awayPrimaryColor', 'awaySecondaryColor'].includes(k));
    assertCan(ctx.actor, brandingOnly ? 'team_assets.write' : 'competition.write', { teamIds: [id], ownerTeamId: id });
    const [u] = await t.update(teams).set({ ...d, updatedAt: new Date() }).where(eq(teams.id, id)).returning();
    await audit(t, ctx.actor, d.status === 'archived' ? 'team.archive' : 'team.update', 'team', id, { before: { name: team.name, status: team.status }, after: d });
    return u!;
  });
}

/** Archive keeps history: matches, lineups, facts and recordings keep referencing the team. */
export async function archiveTeam(ctx: Ctx, id: string) {
  return updateTeam(ctx, id, { status: 'archived' });
}

export async function deleteTeam(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'competition.write');
  return tx(ctx, async (t) => {
    const [used] = await t.select({ n: count() }).from(matches).where(or(eq(matches.homeTeamId, id), eq(matches.awayTeamId, id)));
    if ((used?.n ?? 0) > 0) throw conflict('TEAM_HAS_HISTORY', `This team is used by ${used!.n} match(es). Archive it instead; history is preserved.`);
    await t.delete(rosterMemberships).where(eq(rosterMemberships.teamId, id));
    const r = await t.delete(teams).where(and(eq(teams.id, id), eq(teams.organisationId, ctx.actor.organisationId))).returning();
    if (!r.length) throw notFound('Team');
    await audit(t, ctx.actor, 'team.delete', 'team', id, { before: { name: r[0]!.name } });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ players & rosters
export const playerInput = z.object({
  displayName: name,
  firstName: z.string().trim().max(60).nullable().optional(),
  lastName: z.string().trim().max(60).nullable().optional(),
  shortName: z.string().trim().max(24).nullable().optional(),
  defaultNumber: z.number().int().min(0).max(999).nullable().optional(),
  position: z.string().trim().max(30).nullable().optional(),
  photoAssetId: z.string().uuid().nullable().optional(),
  dateOfBirth: z.string().date().nullable().optional(),
});

export async function listPlayers(ctx: Ctx, q: { search?: string } = {}) {
  return tx(ctx, (t) => {
    const conds = [eq(players.organisationId, ctx.actor.organisationId), ne(players.status, 'archived')];
    if (q.search) conds.push(ilike(players.displayName, `%${q.search}%`));
    // dateOfBirth is private: only full-access roles see it
    return t
      .select({ id: players.id, displayName: players.displayName, firstName: players.firstName, lastName: players.lastName, shortName: players.shortName, defaultNumber: players.defaultNumber, position: players.position, photoAssetId: players.photoAssetId, status: players.status })
      .from(players)
      .where(and(...conds))
      .orderBy(asc(players.displayName))
      .limit(500);
  });
}

export async function createPlayer(ctx: Ctx, input: z.input<typeof playerInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = playerInput.parse(input);
  return tx(ctx, async (t) => {
    const [p] = await t.insert(players).values({ organisationId: ctx.actor.organisationId, ...d }).returning();
    await audit(t, ctx.actor, 'player.create', 'player', p!.id, { after: { displayName: d.displayName } });
    return p!;
  });
}

export async function updatePlayer(ctx: Ctx, id: string, input: Partial<z.input<typeof playerInput>>) {
  assertCan(ctx.actor, 'competition.write');
  const d = playerInput.partial().parse(input);
  return tx(ctx, async (t) => {
    const [p] = await t.update(players).set({ ...d, updatedAt: new Date() }).where(and(eq(players.id, id), eq(players.organisationId, ctx.actor.organisationId))).returning();
    if (!p) throw notFound('Player');
    await audit(t, ctx.actor, 'player.update', 'player', id, { after: { ...d, dateOfBirth: d.dateOfBirth ? '[set]' : undefined } });
    return p;
  });
}

export const rosterInput = z.object({
  playerId: z.string().uuid(),
  teamId: z.string().uuid(),
  seasonId: z.string().uuid(),
  number: z.number().int().min(0).max(999).nullable().optional(),
  position: z.string().trim().max(30).nullable().optional(),
  validFrom: z.string().date().nullable().optional(),
});

export async function addToRoster(ctx: Ctx, input: z.input<typeof rosterInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = rosterInput.parse(input);
  return tx(ctx, async (t) => {
    const existing = await t
      .select()
      .from(rosterMemberships)
      .where(and(eq(rosterMemberships.playerId, d.playerId), eq(rosterMemberships.seasonId, d.seasonId), eq(rosterMemberships.status, 'active')));
    if (existing.some((r) => r.teamId === d.teamId)) throw conflict('ALREADY_ON_ROSTER', 'Player is already on this team for the season');
    const [r] = await t.insert(rosterMemberships).values({ organisationId: ctx.actor.organisationId, ...d }).returning();
    await audit(t, ctx.actor, 'roster.add', 'roster_membership', r!.id, { after: d });
    return r!;
  });
}

/** Transfer: end the current membership (dated) and start a new one. Historical lineups are snapshots. */
export async function transferPlayer(ctx: Ctx, input: { playerId: string; fromTeamId: string; toTeamId: string; seasonId: string; number?: number | null; effectiveOn?: string }) {
  assertCan(ctx.actor, 'competition.write');
  const on = input.effectiveOn ?? new Date().toISOString().slice(0, 10);
  return tx(ctx, async (t) => {
    await t
      .update(rosterMemberships)
      .set({ status: 'left', validTo: on, updatedAt: new Date() })
      .where(and(eq(rosterMemberships.playerId, input.playerId), eq(rosterMemberships.teamId, input.fromTeamId), eq(rosterMemberships.status, 'active')));
    const [r] = await t
      .insert(rosterMemberships)
      .values({ organisationId: ctx.actor.organisationId, playerId: input.playerId, teamId: input.toTeamId, seasonId: input.seasonId, number: input.number ?? null, validFrom: on })
      .returning();
    await audit(t, ctx.actor, 'roster.transfer', 'player', input.playerId, { after: { from: input.fromTeamId, to: input.toTeamId, on } });
    return r!;
  });
}

export async function removeFromRoster(ctx: Ctx, rosterId: string) {
  assertCan(ctx.actor, 'competition.write');
  return tx(ctx, async (t) => {
    const [r] = await t
      .update(rosterMemberships)
      .set({ status: 'left', validTo: new Date().toISOString().slice(0, 10), updatedAt: new Date() })
      .where(and(eq(rosterMemberships.id, rosterId), eq(rosterMemberships.organisationId, ctx.actor.organisationId)))
      .returning();
    if (!r) throw notFound('Roster entry');
    await audit(t, ctx.actor, 'roster.remove', 'roster_membership', rosterId);
    return r;
  });
}

// ------------------------------------------------------------------ venues
export const venueInput = z.object({ name, address: z.string().trim().max(200).nullable().optional(), timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone') });

export async function listVenues(ctx: Ctx) {
  return tx(ctx, (t) => t.select().from(venues).where(and(eq(venues.organisationId, ctx.actor.organisationId), ne(venues.status, 'archived'))).orderBy(asc(venues.name)));
}

export async function createVenue(ctx: Ctx, input: z.input<typeof venueInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = venueInput.parse(input);
  return tx(ctx, async (t) => {
    const [v] = await t.insert(venues).values({ organisationId: ctx.actor.organisationId, ...d }).returning();
    await audit(t, ctx.actor, 'venue.create', 'venue', v!.id, { after: d });
    return v!;
  });
}

export async function updateVenue(ctx: Ctx, id: string, input: Partial<z.input<typeof venueInput>> & { status?: 'active' | 'archived' }) {
  assertCan(ctx.actor, 'competition.write');
  const d = venueInput.partial().extend({ status: z.enum(['active', 'archived']).optional() }).parse(input);
  return tx(ctx, async (t) => {
    const [v] = await t.update(venues).set({ ...d, updatedAt: new Date() }).where(and(eq(venues.id, id), eq(venues.organisationId, ctx.actor.organisationId))).returning();
    if (!v) throw notFound('Venue');
    await audit(t, ctx.actor, 'venue.update', 'venue', id, { after: d });
    return v;
  });
}

/** Has this team produced facts? Used by the UI to explain archive-vs-delete. */
export async function teamHistory(ctx: Ctx, id: string) {
  return tx(ctx, async (t) => {
    const [m] = await t.select({ n: count() }).from(matches).where(or(eq(matches.homeTeamId, id), eq(matches.awayTeamId, id)));
    const [f] = await t.select({ n: count() }).from(matchFacts).where(and(eq(matchFacts.teamId, id), isNull(matchFacts.playerId)));
    return { matches: m?.n ?? 0, facts: f?.n ?? 0 };
  });
}

// ------------------------------------------------------------------ rules presets

export const rulesPresetInput = z.object({ sport: z.enum(SPORTS), name: z.string().trim().min(1).max(80), config: z.record(z.string(), z.unknown()) });

/** The organisation's own rules presets (for one sport, or all), each with the rules it describes. */
export async function listRulesPresets(ctx: Ctx, sport?: string) {
  assertCan(ctx.actor, 'competition.read');
  return tx(ctx, async (t) => {
    const rows = await t
      .select()
      .from(rulesPresets)
      .where(and(eq(rulesPresets.organisationId, ctx.actor.organisationId), sport ? eq(rulesPresets.sport, sport) : undefined))
      .orderBy(asc(rulesPresets.sport), asc(rulesPresets.name));
    return rows.map((p) => ({ id: p.id, value: `org:${p.id}`, sport: p.sport, name: p.name, config: p.config, rulesDescription: getAdapter(p.sport).describeRules(p.config as never) }));
  });
}

/** Save rules as one of the organisation's presets for the sport; saving under an existing name replaces it. */
export async function saveRulesPreset(ctx: Ctx, input: z.input<typeof rulesPresetInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = rulesPresetInput.parse(input);
  const { rulesConfig } = resolveRules(d.sport, undefined, { ...d.config, label: d.name });
  return tx(ctx, async (t) => {
    const [p] = await t
      .insert(rulesPresets)
      .values({ organisationId: ctx.actor.organisationId, sport: d.sport, name: d.name, config: rulesConfig, createdBy: ctx.actor.userId })
      .onConflictDoUpdate({ target: [rulesPresets.organisationId, rulesPresets.sport, rulesPresets.name], set: { config: rulesConfig, updatedAt: new Date() } })
      .returning();
    await audit(t, ctx.actor, 'rules_preset.save', 'rules_preset', p!.id, { after: { sport: d.sport, name: d.name } });
    return { id: p!.id, value: `org:${p!.id}`, sport: p!.sport, name: p!.name, config: p!.config };
  });
}

export async function deleteRulesPreset(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'competition.write');
  return tx(ctx, async (t) => {
    const [p] = await t.delete(rulesPresets).where(and(eq(rulesPresets.id, id), eq(rulesPresets.organisationId, ctx.actor.organisationId))).returning();
    if (!p) throw notFound('Rules preset');
    await audit(t, ctx.actor, 'rules_preset.delete', 'rules_preset', id, { before: { sport: p.sport, name: p.name } });
    return { ok: true };
  });
}
