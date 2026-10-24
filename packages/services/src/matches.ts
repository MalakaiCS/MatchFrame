import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  broadcastSessions,
  competitions,
  matchLineups,
  matchState,
  matches,
  overlayState,
  overlays,
  players,
  rosterMemberships,
  scorerLeases,
  seasons,
  streamOutputs,
  teams,
  venues,
  memberships,
  permissionGrants,
  rendererSessions,
  users,
  type Tx,
} from '@bs/db';
import { getAdapter, isValidTimeZone, resolveLocalTime, type FinalsBracket, type LineupPlayer, type LineupSnapshot, type Sport } from '@bs/domain';
import { z } from 'zod';
import { assertCan, assignedScopes, can, hasWideRead } from './authz';
import { audit } from './audit';
import { AppError, conflict, invalid, notFound } from './errors';
import { tx, type Ctx } from './context';
import { createOverlay, enqueuePlanAttached } from './overlays';
import { ensureStarterPlan } from './gameplans';
import { enqueueOutbox } from './outbox';
import { retuneMatchTx, stageRules, teamSnapshot } from './catalog';

export const matchInput = z.object({
  competitionId: z.string().uuid(),
  seasonId: z.string().uuid(),
  homeTeamId: z.string().uuid(),
  awayTeamId: z.string().uuid(),
  venueId: z.string().uuid().nullable().optional(),
  round: z.string().trim().max(40).nullable().optional(),
  /** finals matches take the competition's finals rules (a level score is decided) and stay out of the ladder */
  stage: z.enum(['regular', 'finals']).optional(),
  externalId: z.string().trim().max(100).nullable().optional(),
  kickoffLocal: z.string(),
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone'),
  isDemo: z.boolean().optional(),
  scoringSource: z.enum(['courtside', 'watching_stream']).optional(),
  scorerSourceDelayMs: z.number().int().min(0).max(120_000).optional(),
});

export { teamSnapshot };

async function rosterLineup(t: Tx, teamId: string, seasonId: string): Promise<LineupPlayer[]> {
  const rows = await t
    .select({ r: rosterMemberships, p: players })
    .from(rosterMemberships)
    .innerJoin(players, eq(players.id, rosterMemberships.playerId))
    .where(and(eq(rosterMemberships.teamId, teamId), eq(rosterMemberships.seasonId, seasonId), eq(rosterMemberships.status, 'active')))
    .orderBy(asc(rosterMemberships.number));
  return rows.map((x, i) => ({
    playerId: x.p.id,
    displayName: x.p.displayName,
    shortName: x.p.shortName,
    number: x.r.number ?? x.p.defaultNumber,
    position: x.r.position ?? x.p.position,
    photoAssetId: x.p.photoAssetId,
    starter: i < 11,
    captain: false,
  }));
}

export async function createMatchTx(ctx: Ctx, t: Tx, d: z.infer<typeof matchInput> & { scheduledAt?: Date; bracket?: FinalsBracket }) {
  if (d.homeTeamId === d.awayTeamId) throw invalid('Home and away team must differ', [{ field: 'awayTeamId', message: 'Choose a different team' }]);
  const [comp] = await t.select().from(competitions).where(and(eq(competitions.id, d.competitionId), eq(competitions.organisationId, ctx.actor.organisationId)));
  if (!comp) throw notFound('Competition');
  const [season] = await t.select().from(seasons).where(and(eq(seasons.id, d.seasonId), eq(seasons.competitionId, comp.id)));
  if (!season) throw invalid('Season does not belong to this competition', [{ field: 'seasonId', message: 'Choose a season of this competition' }]);
  const ts = await t.select().from(teams).where(and(inArray(teams.id, [d.homeTeamId, d.awayTeamId]), eq(teams.organisationId, ctx.actor.organisationId)));
  const home = ts.find((x) => x.id === d.homeTeamId);
  const away = ts.find((x) => x.id === d.awayTeamId);
  if (!home || !away) throw notFound('Team');
  if (home.sport !== comp.sport || away.sport !== comp.sport) throw invalid(`Both teams must be ${comp.sport} teams`, [{ field: 'homeTeamId', message: 'Sport mismatch' }]);
  let scheduledAt = d.scheduledAt;
  if (!scheduledAt) {
    const r = resolveLocalTime(d.kickoffLocal, d.timezone);
    if (!r.ok) throw invalid(r.message, [{ field: 'kickoffLocal', message: r.message }]);
    scheduledAt = r.utc;
  }
  const adapter = getAdapter(comp.sport);
  const stage = d.bracket ? 'finals' : (d.stage ?? 'regular');
  const rulesConfig = stageRules(comp, stage);
  const [m] = await t
    .insert(matches)
    .values({
      organisationId: ctx.actor.organisationId,
      competitionId: comp.id,
      seasonId: season.id,
      homeTeamId: home.id,
      awayTeamId: away.id,
      venueId: d.venueId ?? null,
      round: d.round ?? null,
      stage,
      bracket: (d.bracket as unknown as Record<string, unknown>) ?? null,
      externalId: d.externalId ?? null,
      scheduledAt,
      timezone: d.timezone,
      sport: comp.sport,
      sportRulesVersion: comp.rulesVersion,
      rulesConfig,
      isDemo: d.isDemo ?? false,
      gamePlanVersionId: comp.gamePlanVersionId,
      scoringSource: d.scoringSource ?? 'courtside',
      scorerSourceDelayMs: d.scorerSourceDelayMs ?? 0,
      createdBy: ctx.actor.userId,
    })
    .returning();
  const cfg = rulesConfig as never;
  await t.insert(matchState).values({
    matchId: m!.id,
    organisationId: ctx.actor.organisationId,
    projection: adapter.initialProjection(cfg) as never,
    clocks: adapter.initialClocks(cfg) as never,
  });
  await t.insert(scorerLeases).values({ matchId: m!.id, organisationId: ctx.actor.organisationId });
  const lineup: LineupSnapshot = { home: await rosterLineup(t, home.id, season.id), away: await rosterLineup(t, away.id, season.id) };
  await t.insert(matchLineups).values({ matchId: m!.id, organisationId: ctx.actor.organisationId, snapshot: lineup as never, teams: { home: teamSnapshot(home), away: teamSnapshot(away) } as never });
  // Every match gets one graphics output, so the OBS link exists from day one; a second output is an explicit add.
  try {
    await createOverlay(ctx, m!.id, { name: 'Main graphics' }, t, { defaultPlan: true, starterPlan: (tt, sport) => ensureStarterPlan(ctx, tt, sport as Sport) });
  } catch (e) {
    if (!(e instanceof AppError && e.status === 403)) throw e;
  }
  return m!;
}

export async function createMatch(ctx: Ctx, input: z.input<typeof matchInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = matchInput.parse(input);
  return tx(ctx, async (t) => {
    try {
      const m = await createMatchTx(ctx, t, d);
      await audit(t, ctx.actor, 'match.create', 'match', m.id, { after: { home: d.homeTeamId, away: d.awayTeamId, scheduledAt: m.scheduledAt } });
      return m;
    } catch (e) {
      if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE_FIXTURE', 'A fixture with this external ID already exists in the competition');
      throw e;
    }
  });
}

export const matchListQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sport: z.string().optional(),
  competitionId: z.string().uuid().optional(),
  status: z.string().optional(),
  search: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['scheduledAt', '-scheduledAt']).default('scheduledAt'),
  includeArchived: z.coerce.boolean().optional(),
});

function matchScope(ctx: Ctx): SQL | undefined {
  if (hasWideRead(ctx.actor)) return undefined;
  const s = assignedScopes(ctx.actor);
  const parts = [
    s.matchIds.length ? inArray(matches.id, s.matchIds) : undefined,
    s.competitionIds.length ? inArray(matches.competitionId, s.competitionIds) : undefined,
    s.teamIds.length ? or(inArray(matches.homeTeamId, s.teamIds), inArray(matches.awayTeamId, s.teamIds)) : undefined,
  ].filter(Boolean) as SQL[];
  return parts.length ? or(...parts) : sql`false`;
}

export async function listMatches(ctx: Ctx, query: z.input<typeof matchListQuery>) {
  const q = matchListQuery.parse(query);
  return tx(ctx, async (t) => {
    const conds: SQL[] = [eq(matches.organisationId, ctx.actor.organisationId)];
    if (q.from) conds.push(gte(matches.scheduledAt, new Date(q.from)));
    if (q.to) conds.push(lte(matches.scheduledAt, new Date(q.to)));
    if (q.sport) conds.push(eq(matches.sport, q.sport));
    if (q.competitionId) conds.push(eq(matches.competitionId, q.competitionId));
    if (q.status) conds.push(eq(matches.status, q.status));
    else if (!q.includeArchived) conds.push(ne(matches.status, 'archived'));
    const scope = matchScope(ctx);
    if (scope) conds.push(scope);
    const where = and(...conds);
    const [{ total } = { total: 0 }] = await t.select({ total: count() }).from(matches).where(where);
    const rows = await t
      .select({ m: matches, s: matchState, c: competitions, v: venues })
      .from(matches)
      .innerJoin(matchState, eq(matchState.matchId, matches.id))
      .innerJoin(competitions, eq(competitions.id, matches.competitionId))
      .leftJoin(venues, eq(venues.id, matches.venueId))
      .where(where)
      .orderBy(q.sort === 'scheduledAt' ? asc(matches.scheduledAt) : desc(matches.scheduledAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const ids = rows.map((r) => r.m.id);
    const teamIds = [...new Set(rows.flatMap((r) => [r.m.homeTeamId, r.m.awayTeamId]))];
    const orgId = ctx.actor.organisationId;
    const [ts, ovs, outs, sess, leases, lineups, assigned] = ids.length
      ? await Promise.all([
          t.select().from(teams).where(inArray(teams.id, teamIds)),
          t.select({ o: overlays, st: overlayState }).from(overlays).leftJoin(overlayState, eq(overlayState.overlayId, overlays.id)).where(inArray(overlays.matchId, ids)),
          t.select().from(streamOutputs).where(inArray(streamOutputs.matchId, ids)),
          t.select().from(broadcastSessions).where(inArray(broadcastSessions.matchId, ids)).orderBy(desc(broadcastSessions.createdAt)),
          t.select({ l: scorerLeases, name: users.name }).from(scorerLeases).leftJoin(users, eq(users.id, scorerLeases.holderUserId)).where(inArray(scorerLeases.matchId, ids)),
          t.select({ matchId: matchLineups.matchId, snapshot: matchLineups.snapshot }).from(matchLineups).where(and(eq(matchLineups.organisationId, orgId), inArray(matchLineups.matchId, ids))),
          t.select({ matchId: permissionGrants.scopeId }).from(permissionGrants).innerJoin(memberships, eq(memberships.id, permissionGrants.membershipId))
            .where(and(eq(permissionGrants.organisationId, orgId), eq(permissionGrants.scopeType, 'match'), inArray(permissionGrants.scopeId, ids), eq(permissionGrants.action, 'match.score'), eq(memberships.status, 'active'))),
        ])
      : [[], [], [], [], [], [], []];
    // OBS has the match's main output open (a production or compositor renderer connected now)
    const mainOverlay = new Map<string, string>();
    for (const o of [...ovs].sort((a, b) => a.o.createdAt.getTime() - b.o.createdAt.getTime())) if (!mainOverlay.has(o.o.matchId)) mainOverlay.set(o.o.matchId, o.o.id);
    const watching = mainOverlay.size
      ? await t.select({ overlayId: rendererSessions.overlayId }).from(rendererSessions)
          .where(and(eq(rendererSessions.organisationId, orgId), inArray(rendererSessions.overlayId, [...mainOverlay.values()]), inArray(rendererSessions.purpose, ['production', 'compositor']), isNull(rendererSessions.disconnectedAt)))
      : [];
    // the match page's match-day checklist, in short: what is still to do before the match can go out
    const readiness = (matchId: string) => {
      const main = ovs.find((o) => o.o.id === mainOverlay.get(matchId))?.o;
      const snap = lineups.find((l) => l.matchId === matchId)?.snapshot as LineupSnapshot | undefined;
      const starters = (side: 'home' | 'away') => (snap?.[side] ?? []).filter((p) => p.starter).length;
      const todo = [
        ...(starters('home') > 0 && starters('away') > 0 ? [] : ['line-ups']),
        ...(main?.themeProfileVersionId ? [] : ['a look']),
        ...(main?.gamePlanVersionId ? [] : ['automation']),
        ...(assigned.some((a) => a.matchId === matchId) ? [] : ['a scorer']),
        ...(main && watching.some((w) => w.overlayId === main.id) ? [] : ['OBS']),
      ];
      return { done: 5 - todo.length, total: 5, todo };
    };
    const search = q.search?.toLowerCase();
    const items = rows
      .map((r) => {
        const h = ts.find((x) => x.id === r.m.homeTeamId)!;
        const a = ts.find((x) => x.id === r.m.awayTeamId)!;
        const proj = r.s.projection as { score?: { home: number; away: number } };
        const lease = leases.find((l) => l.l.matchId === r.m.id);
        const session = sess.find((s) => s.matchId === r.m.id);
        return {
          ...r.m,
          competition: { id: r.c.id, name: r.c.name, shortName: r.c.shortName },
          venue: r.v ? { id: r.v.id, name: r.v.name } : null,
          home: h ? teamSnapshot(h) : null,
          away: a ? teamSnapshot(a) : null,
          phase: r.s.phase,
          score: proj.score ?? { home: 0, away: 0 },
          stateVersion: r.s.stateVersion,
          stateUpdatedAt: r.s.updatedAt,
          scorer: lease?.l.holderUserId && lease.l.expiresAt && lease.l.expiresAt.getTime() > Date.now() ? { name: lease.name } : null,
          overlays: ovs.filter((o) => o.o.matchId === r.m.id).map((o) => ({ id: o.o.id, name: o.o.name, kind: o.o.kind, publicId: o.o.publicId, mode: o.st?.mode, inhibited: o.st?.inhibited, revision: o.st?.revision, displayedRevision: o.st?.displayedRevision })),
          outputs: outs.filter((o) => o.matchId === r.m.id).map((o) => ({ id: o.id, name: o.name, mode: o.mode })),
          stream: session ? { id: session.id, state: session.state, error: session.error } : null,
          ready: readiness(r.m.id),
        };
      })
      .filter((x) => !search || [x.home?.name, x.away?.name, x.competition.name, x.round, x.externalId].some((s) => s?.toLowerCase().includes(search)));
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}

export async function getMatchRow(ctx: Ctx, t: Tx, id: string) {
  const [m] = await t.select().from(matches).where(and(eq(matches.id, id), eq(matches.organisationId, ctx.actor.organisationId)));
  if (!m) throw notFound('Match');
  return m;
}

export async function getMatch(ctx: Ctx, id: string) {
  return tx(ctx, async (t) => {
    const m = await getMatchRow(ctx, t, id);
    assertCan(ctx.actor, 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const [state] = await t.select().from(matchState).where(eq(matchState.matchId, id));
    const [lineup] = await t.select().from(matchLineups).where(eq(matchLineups.matchId, id));
    const [comp] = await t.select().from(competitions).where(eq(competitions.id, m.competitionId));
    const [season] = await t.select().from(seasons).where(eq(seasons.id, m.seasonId));
    const [venue] = m.venueId ? await t.select().from(venues).where(eq(venues.id, m.venueId)) : [null];
    const [lease] = await t.select({ l: scorerLeases, name: users.name }).from(scorerLeases).leftJoin(users, eq(users.id, scorerLeases.holderUserId)).where(eq(scorerLeases.matchId, id));
    const assigned = await t
      .select({ membershipId: memberships.id, name: users.name, status: memberships.status })
      .from(permissionGrants)
      .innerJoin(memberships, eq(memberships.id, permissionGrants.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(permissionGrants.scopeType, 'match'), eq(permissionGrants.scopeId, id), eq(permissionGrants.action, 'match.score')));
    const adapter = getAdapter(m.sport);
    const cfg = m.rulesConfig as never;
    return {
      ...m,
      competition: { id: comp!.id, name: comp!.name, shortName: comp!.shortName, logoAssetId: comp!.logoAssetId, themeProfileId: comp!.themeProfileId },
      season: { id: season!.id, name: season!.name },
      venue: venue ? { id: venue.id, name: venue.name, timezone: venue.timezone } : null,
      teams: lineup!.teams,
      lineup: lineup!.snapshot,
      lineupLocked: !!lineup!.lockedAt,
      state: { phase: state!.phase, projection: state!.projection, clocks: state!.clocks, stateVersion: state!.stateVersion, sequence: state!.sequence },
      lease: lease ? { holderUserId: lease.l.holderUserId, holderName: lease.name, holderDeviceId: lease.l.holderDeviceId, leaseVersion: lease.l.leaseVersion, expiresAt: lease.l.expiresAt, takenOverFrom: lease.l.takenOverFrom } : null,
      scorers: assigned.filter((x) => x.status === 'active').map((x) => ({ membershipId: x.membershipId, name: x.name })),
      rules: {
        description: adapter.describeRules(cfg),
        phases: adapter.phases(cfg),
        eventTypes: adapter.eventTypes(cfg),
        capabilities: adapter.capabilities(cfg),
        allowedTransitions: adapter.allowedTransitions(cfg, state!.projection as never),
        /** knockout: a level score is decided (extra time, penalties…); null when the sport always decides one */
        knockout: adapter.knockout ? { label: adapter.knockout.label, on: adapter.knockout.isOn(cfg) } : null,
      },
    };
  });
}

export const matchUpdateInput = z.object({
  venueId: z.string().uuid().nullable().optional(),
  round: z.string().trim().max(40).nullable().optional(),
  stage: z.enum(['regular', 'finals']).optional(),
  /** before anything is recorded: a level score is decided (extra time, penalties…); once scoring starts, the scorer switches it */
  knockout: z.boolean().optional(),
  kickoffLocal: z.string().optional(),
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone').optional(),
  status: z.enum(['scheduled', 'postponed', 'cancelled', 'archived']).optional(),
  scoringSource: z.enum(['courtside', 'watching_stream']).optional(),
  scorerSourceDelayMs: z.number().int().min(0).max(120_000).optional(),
  gamePlanVersionId: z.string().uuid().nullable().optional(),
  attendance: z.number().int().min(0).max(500_000).nullable().optional(),
  weather: z.object({ summary: z.string().trim().max(60).nullable().optional(), tempC: z.number().min(-40).max(60).nullable().optional(), condition: z.enum(['sunny', 'cloudy', 'rain', 'wind', 'storm', 'snow', 'indoor']).nullable().optional() }).nullable().optional(),
  officials: z.array(z.object({ role: z.enum(['referee', 'assistant_1', 'assistant_2', 'fourth', 'video', 'umpire', 'touch_judge', 'other']), name: z.string().trim().min(1).max(80) })).max(12).optional(),
});

export async function updateMatch(ctx: Ctx, id: string, input: z.input<typeof matchUpdateInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = matchUpdateInput.parse(input);
  return tx(ctx, async (t) => {
    const m = await getMatchRow(ctx, t, id);
    const set: Partial<typeof matches.$inferInsert> = { updatedAt: new Date() };
    if (d.kickoffLocal || d.timezone) {
      if (m.status === 'live' || m.status === 'completed') throw conflict('MATCH_STARTED', 'A live or completed match cannot be rescheduled');
      const tz = d.timezone ?? m.timezone;
      const r = resolveLocalTime(d.kickoffLocal ?? '', tz);
      if (!r.ok) throw invalid(r.message, [{ field: 'kickoffLocal', message: r.message }]);
      set.scheduledAt = r.utc;
      set.timezone = tz;
      set.scheduleVersion = m.scheduleVersion + 1; // obsolete schedule jobs carry the old version and are rejected
    }
    for (const k of ['venueId', 'round', 'status', 'scoringSource', 'scorerSourceDelayMs', 'gamePlanVersionId', 'attendance', 'weather', 'officials'] as const) if (d[k] !== undefined) (set as Record<string, unknown>)[k] = d[k];
    if (d.stage && d.stage !== m.stage) set.stage = d.stage;
    const [u] = await t.update(matches).set(set).where(eq(matches.id, id)).returning();
    if (set.stage || d.knockout !== undefined) {
      // a match nobody has scored yet takes the rules of its new stage (finals: a level score is decided)
      const [s] = await t.select().from(matchState).where(eq(matchState.matchId, id)).for('update');
      const [comp] = await t.select().from(competitions).where(eq(competitions.id, m.competitionId));
      const untouched = !!s && m.status === 'scheduled' && s.sequence === 0;
      let cfg = set.stage && comp ? stageRules(comp, set.stage as 'regular' | 'finals') : u!.rulesConfig;
      const ko = getAdapter(m.sport).knockout;
      if (d.knockout !== undefined) {
        if (!ko) throw invalid(`${getAdapter(m.sport).label} always decides a level match`, [{ field: 'knockout', message: 'Not available for this sport' }]);
        if (!untouched) throw conflict('MATCH_STARTED', 'Scoring has started: switch it from the scorer');
        cfg = ko.set(cfg as never, d.knockout);
      }
      if (untouched && JSON.stringify(cfg) !== JSON.stringify(u!.rulesConfig)) {
        const reason = d.knockout !== undefined ? (d.knockout ? 'knockout: a level score is decided' : 'a draw stands') : `moved to the ${set.stage === 'finals' ? 'finals' : 'regular season'}`;
        await retuneMatchTx(t, ctx, u!, s!, { rulesVersion: u!.sportRulesVersion, rulesConfig: cfg }, reason);
      }
    }
    if (set.scheduleVersion) {
      await t.update(streamOutputs).set({ scheduleVersion: sql`${streamOutputs.scheduleVersion} + 1` }).where(eq(streamOutputs.matchId, id));
      await enqueueOutbox(t, { organisationId: m.organisationId, topic: 'match.rescheduled', aggregateType: 'match', aggregateId: id, payload: { scheduleVersion: set.scheduleVersion, scheduledAt: set.scheduledAt } });
    }
    await audit(t, ctx.actor, 'match.update', 'match', id, { before: { scheduledAt: m.scheduledAt, status: m.status }, after: d });
    return u!;
  });
}

export const lineupInput = z.object({
  home: z.array(z.object({ playerId: z.string().uuid(), number: z.number().int().min(0).max(999).nullable().optional(), starter: z.boolean(), captain: z.boolean().optional(), position: z.string().max(30).nullable().optional() })).max(40),
  away: z.array(z.object({ playerId: z.string().uuid(), number: z.number().int().min(0).max(999).nullable().optional(), starter: z.boolean(), captain: z.boolean().optional(), position: z.string().max(30).nullable().optional() })).max(40),
  formations: z.object({ home: z.string().max(20).nullable().optional(), away: z.string().max(20).nullable().optional() }).optional(),
  lock: z.boolean().optional(),
});

/** Set the lineup; player identity (names/numbers/photos) is snapshotted for historical consistency. */
export async function setLineup(ctx: Ctx, matchId: string, input: z.input<typeof lineupInput>) {
  const d = lineupInput.parse(input);
  return tx(ctx, async (t) => {
    const m = await getMatchRow(ctx, t, matchId);
    // operators edit any lineup; the match's scorer may enter and change lineups from the phone
    if (!can(ctx.actor, 'competition.write')) assertCan(ctx.actor, 'match.score', { matchId: m.id, competitionId: m.competitionId }, 'You are not assigned to score this match');
    const [cur] = await t.select().from(matchLineups).where(eq(matchLineups.matchId, matchId));
    if (cur?.lockedAt && m.status !== 'scheduled') throw conflict('LINEUP_LOCKED', 'The lineup is locked for this match');
    const ids = [...d.home, ...d.away].map((p) => p.playerId);
    const ps = ids.length ? await t.select().from(players).where(and(inArray(players.id, ids), eq(players.organisationId, ctx.actor.organisationId))) : [];
    const roster = ids.length ? await t.select().from(rosterMemberships).where(and(inArray(rosterMemberships.playerId, ids), eq(rosterMemberships.seasonId, m.seasonId))) : [];
    const build = (side: 'home' | 'away', teamId: string): LineupPlayer[] =>
      d[side].map((x) => {
        const p = ps.find((y) => y.id === x.playerId);
        if (!p) throw invalid('Unknown player in lineup', [{ field: `${side}.playerId`, message: 'Player not found' }]);
        const onRoster = roster.some((r) => r.playerId === p.id && r.teamId === teamId);
        if (!onRoster) throw invalid(`${p.displayName} is not on this team's roster for the season`, [{ field: side, message: 'Add the player to the roster first' }]);
        return { playerId: p.id, displayName: p.displayName, shortName: p.shortName, number: x.number ?? roster.find((r) => r.playerId === p.id && r.teamId === teamId)?.number ?? p.defaultNumber, position: x.position ?? p.position, photoAssetId: p.photoAssetId, starter: x.starter, captain: x.captain ?? false };
      });
    const snapshot: LineupSnapshot = { home: build('home', m.homeTeamId), away: build('away', m.awayTeamId), formations: d.formations };
    const ts = await t.select().from(teams).where(inArray(teams.id, [m.homeTeamId, m.awayTeamId]));
    const teamSnap = { home: teamSnapshot(ts.find((x) => x.id === m.homeTeamId)!), away: teamSnapshot(ts.find((x) => x.id === m.awayTeamId)!) };
    const [row] = await t
      .update(matchLineups)
      .set({ snapshot: snapshot as never, teams: teamSnap as never, version: sql`${matchLineups.version} + 1`, lockedAt: d.lock ? new Date() : cur?.lockedAt ?? null, updatedAt: new Date() })
      .where(eq(matchLineups.matchId, matchId))
      .returning();
    await enqueueOutbox(t, { organisationId: m.organisationId, topic: 'match.lineup.updated', aggregateType: 'match', aggregateId: matchId, payload: { version: row!.version } });
    await audit(t, ctx.actor, 'match.lineup', 'match', matchId, { after: { home: snapshot.home.length, away: snapshot.away.length, locked: !!d.lock } });
    return row!;
  });
}

/** Scorer assignment = scoped grant on the match for the member. */
export async function assignScorer(ctx: Ctx, matchId: string, membershipId: string) {
  assertCan(ctx.actor, 'competition.write');
  return tx(ctx, async (t) => {
    await getMatchRow(ctx, t, matchId);
    const [m] = await t.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Member');
    const existing = await t.select().from(permissionGrants).where(and(eq(permissionGrants.membershipId, m.id), eq(permissionGrants.scopeType, 'match'), eq(permissionGrants.scopeId, matchId), eq(permissionGrants.action, 'match.score')));
    if (!existing.length) await t.insert(permissionGrants).values({ organisationId: ctx.actor.organisationId, membershipId: m.id, action: 'match.score', scopeType: 'match', scopeId: matchId });
    await audit(t, ctx.actor, 'match.assign_scorer', 'match', matchId, { after: { membershipId } });
    return { ok: true };
  });
}

/** Both teams' season rosters, for the lineup editor (names, numbers, positions, photos; nothing private). */
export async function matchRoster(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    const m = await getMatchRow(ctx, t, matchId);
    assertCan(ctx.actor, 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const rows = await t
      .select({ r: rosterMemberships, p: players })
      .from(rosterMemberships)
      .innerJoin(players, eq(players.id, rosterMemberships.playerId))
      .where(and(eq(rosterMemberships.seasonId, m.seasonId), eq(rosterMemberships.status, 'active'), inArray(rosterMemberships.teamId, [m.homeTeamId, m.awayTeamId])))
      .orderBy(asc(rosterMemberships.number));
    const pick = (teamId: string) => rows.filter((x) => x.r.teamId === teamId).map((x) => ({ playerId: x.p.id, displayName: x.p.displayName, shortName: x.p.shortName, number: x.r.number ?? x.p.defaultNumber, position: x.r.position ?? x.p.position, photoAssetId: x.p.photoAssetId }));
    return { home: pick(m.homeTeamId), away: pick(m.awayTeamId) };
  });
}

/** The lineup a match could start from: the team's last lineup in this competition, or its saved default. */
export async function suggestLineup(ctx: Ctx, matchId: string, side: 'home' | 'away', source: 'last' | 'default') {
  return tx(ctx, async (t) => {
    const m = await getMatchRow(ctx, t, matchId);
    assertCan(ctx.actor, 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const teamId = side === 'home' ? m.homeTeamId : m.awayTeamId;
    const toInput = (ps: LineupPlayer[]) => ps.map((p) => ({ playerId: p.playerId, number: p.number ?? null, position: p.position ?? null, starter: p.starter, captain: p.captain ?? false }));
    if (source === 'default') {
      const [team] = await t.select().from(teams).where(eq(teams.id, teamId));
      const dl = team?.defaultLineup as { players?: ReturnType<typeof toInput>; formation?: string | null } | null;
      if (!dl?.players?.length) return { source, players: [], formation: null, from: null, reason: 'This team has no saved default lineup yet' };
      return { source, players: dl.players, formation: dl.formation ?? null, from: null, reason: null };
    }
    const prev = await t
      .select({ m: matches, snapshot: matchLineups.snapshot })
      .from(matches)
      .innerJoin(matchLineups, eq(matchLineups.matchId, matches.id))
      .where(and(eq(matches.organisationId, ctx.actor.organisationId), eq(matches.competitionId, m.competitionId), or(eq(matches.homeTeamId, teamId), eq(matches.awayTeamId, teamId)), lt(matches.scheduledAt, m.scheduledAt), inArray(matches.status, ['live', 'completed'])))
      .orderBy(desc(matches.scheduledAt))
      .limit(1);
    const last = prev[0];
    if (!last) return { source, players: [], formation: null, from: null, reason: 'No earlier match for this team in the competition' };
    const snap = last.snapshot as unknown as LineupSnapshot;
    const prevSide = last.m.homeTeamId === teamId ? 'home' : 'away';
    return { source, players: toInput(snap[prevSide]), formation: snap.formations?.[prevSide] ?? null, from: { matchId: last.m.id, scheduledAt: last.m.scheduledAt }, reason: null };
  });
}

/** Copy a match's production setup (plan, look, output formats) onto another match of the same competition. */
export async function copyMatchSetup(ctx: Ctx, matchId: string, fromMatchId: string, t0?: Tx) {
  assertCan(ctx.actor, 'competition.write');
  const run = async (t: Tx) => {
    const target = await getMatchRow(ctx, t, matchId);
    const source = await getMatchRow(ctx, t, fromMatchId);
    if (source.id === target.id) throw invalid('Choose a different match to copy from', [{ field: 'fromMatchId', message: 'Same match' }]);
    await t.update(matches).set({ gamePlanVersionId: source.gamePlanVersionId, themeProfileVersion: source.themeProfileVersion, scoringSource: source.scoringSource, scorerSourceDelayMs: source.scorerSourceDelayMs, updatedAt: new Date() }).where(eq(matches.id, target.id));
    const [srcOverlay] = await t.select().from(overlays).where(and(eq(overlays.matchId, source.id), eq(overlays.kind, 'graphics'))).orderBy(asc(overlays.createdAt)).limit(1);
    const [dstOverlay] = await t.select().from(overlays).where(and(eq(overlays.matchId, target.id), eq(overlays.kind, 'graphics'))).orderBy(asc(overlays.createdAt)).limit(1);
    if (srcOverlay && dstOverlay)
      await t
        .update(overlays)
        .set({ themeProfileVersionId: srcOverlay.themeProfileVersionId, themeVersionId: srcOverlay.themeVersionId, gamePlanVersionId: srcOverlay.gamePlanVersionId, format: srcOverlay.format, updatedAt: new Date() })
        .where(eq(overlays.id, dstOverlay.id));
    if (srcOverlay && dstOverlay && srcOverlay.gamePlanVersionId && srcOverlay.gamePlanVersionId !== dstOverlay.gamePlanVersionId) await enqueuePlanAttached(t, target.organisationId, dstOverlay.id, target.id, srcOverlay.gamePlanVersionId);
    await audit(t, ctx.actor, 'match.copy_setup', 'match', target.id, { after: { fromMatchId: source.id, overlay: !!(srcOverlay && dstOverlay) } });
    return { ok: true, copiedOverlay: !!(srcOverlay && dstOverlay) };
  };
  return t0 ? run(t0) : tx(ctx, run);
}

export const bulkMatchInput = z.object({
  competitionId: z.string().uuid(),
  seasonId: z.string().uuid(),
  round: z.string().trim().max(40).nullable().optional(),
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone'),
  copySetupFromMatchId: z.string().uuid().nullable().optional(),
  fixtures: z.array(z.object({ homeTeamId: z.string().uuid(), awayTeamId: z.string().uuid(), kickoffLocal: z.string(), venueId: z.string().uuid().nullable().optional(), round: z.string().trim().max(40).nullable().optional() })).min(1).max(60),
});

/** Create a whole round at once; every fixture gets its output, and optionally a copied production setup. */
export async function bulkCreateMatches(ctx: Ctx, input: z.input<typeof bulkMatchInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = bulkMatchInput.parse(input);
  return tx(ctx, async (t) => {
    const created: { id: string; homeTeamId: string; awayTeamId: string; scheduledAt: Date }[] = [];
    for (const f of d.fixtures) {
      const m = await createMatchTx(ctx, t, { competitionId: d.competitionId, seasonId: d.seasonId, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, venueId: f.venueId ?? null, round: f.round ?? d.round ?? null, kickoffLocal: f.kickoffLocal, timezone: d.timezone });
      if (d.copySetupFromMatchId) await copyMatchSetup(ctx, m.id, d.copySetupFromMatchId, t);
      created.push({ id: m.id, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, scheduledAt: m.scheduledAt });
    }
    await audit(t, ctx.actor, 'match.bulk_create', 'season', d.seasonId, { after: { count: created.length, round: d.round ?? null, copiedFrom: d.copySetupFromMatchId ?? null } });
    return { created };
  });
}

/** Scorer landing list: matches this actor can score, record statistics for, or follow read-only. */
export async function listScorableMatches(ctx: Ctx) {
  const wide = hasWideRead(ctx.actor);
  const s = assignedScopes(ctx.actor);
  const scorable = ctx.actor.grants.filter((g) => ['match.score', 'match.stats', 'match.view'].includes(g.action) && g.scopeType === 'match').map((g) => g.scopeId!);
  if (!wide && !scorable.length) return [];
  // what is coming up (nearest first), the last twelve hours (live and running late), and the last month's matches
  // for the Completed tab; separate windows so a busy day never pushes the next kick-off off the list
  const now = Date.now();
  const at = (ms: number) => new Date(now - ms).toISOString();
  const ahead = await listMatches(ctx, { pageSize: 100, from: at(0) });
  const recent = await listMatches(ctx, { pageSize: 60, from: at(12 * 3_600_000), to: at(0), sort: '-scheduledAt' });
  const behind = await listMatches(ctx, { pageSize: 60, from: at(30 * 86_400_000), to: at(12 * 3_600_000), sort: '-scheduledAt' });
  const seen = new Set<string>();
  return [...behind.items.reverse(), ...recent.items.reverse(), ...ahead.items].filter((m) => !seen.has(m.id) && seen.add(m.id) && (wide || scorable.includes(m.id) || s.competitionIds.includes(m.competitionId)));
}

export const _internal = { rosterLineup };
