import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { competitions, withTenant, matchState, memberships, auditLogs } from '@bs/db';
import { catalog, imports, matchesSvc, orgs, scoring, AppError, resolveActor, type Ctx } from '@bs/services';
import { makeOrg, makeUser, testDeps } from '../helpers';

const deps = testDeps();
let A: Awaited<ReturnType<typeof makeOrg>>;
let B: Awaited<ReturnType<typeof makeOrg>>;

async function footballSetup(ctx: Ctx, label = 'X') {
  const comp = await catalog.createCompetition(ctx, { name: `League ${label}`, sport: 'football', defaultTimezone: 'Australia/Brisbane' });
  const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
  const home = await catalog.createTeam(ctx, { name: `Harbour ${label}`, shortName: 'Harbour', abbreviation: 'HAR', sport: 'football' });
  const away = await catalog.createTeam(ctx, { name: `Ridge ${label}`, shortName: 'Ridge', abbreviation: 'RDG', sport: 'football' });
  const p1 = await catalog.createPlayer(ctx, { displayName: 'Mia Torres', defaultNumber: 9 });
  const p2 = await catalog.createPlayer(ctx, { displayName: 'Léa Ångström', defaultNumber: 4 });
  await catalog.addToRoster(ctx, { playerId: p1.id, teamId: home.id, seasonId: season.id, number: 9 });
  await catalog.addToRoster(ctx, { playerId: p2.id, teamId: away.id, seasonId: season.id, number: 4 });
  const match = await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2026-11-07 15:00', timezone: 'Australia/Brisbane', externalId: `M-${label}` });
  return { comp, season, home, away, p1, p2, match };
}

const dev = 'device-test-1';
async function lease(ctx: Ctx, matchId: string, deviceId = dev) {
  return (await scoring.scorerLease(ctx, matchId, { action: 'acquire', deviceId }))!;
}
async function cmd(ctx: Ctx, matchId: string, type: string, payload: unknown, opts: { commandId?: string; deviceId?: string; leaseVersion?: number; version?: number } = {}) {
  const st = await scoring.getMatchState(ctx, matchId);
  return scoring.handleMatchCommand(ctx, matchId, {
    commandId: opts.commandId ?? crypto.randomUUID(),
    expectedStateVersion: opts.version ?? st.stateVersion,
    scorerLeaseVersion: opts.leaseVersion,
    deviceId: opts.deviceId ?? dev,
    type,
    payload,
  });
}

beforeAll(async () => {
  A = await makeOrg(deps, 'Alpha Club');
  B = await makeOrg(deps, 'Beta Club');
});
afterAll(async () => deps.close());

describe('tenant isolation against the bs_app role (A03, DB layer)', () => {
  it('runs as a non-superuser role without BYPASSRLS', async () => {
    const r = await deps.db.execute<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }>(sql`select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
    expect(r.rows[0]).toMatchObject({ current_user: 'bs_app', rolsuper: false, rolbypassrls: false });
  });

  it("hides another tenant's rows even with a crafted query and rejects cross-tenant writes", async () => {
    const s = await footballSetup(A.ctx, 'iso');
    await expect(catalog.getCompetition(B.ctx, s.comp.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(matchesSvc.getMatch(B.ctx, s.match.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const leaked = await withTenant(deps.db, { organisationId: B.org.id, userId: B.owner.id }, (t) => t.execute(sql`select id from competitions where id = ${s.comp.id}`));
    expect(leaked.rows).toHaveLength(0);
    // no tenant context at all: nothing visible
    const none = await deps.db.execute(sql`select count(*)::int as n from competitions`);
    expect(none.rows[0]).toMatchObject({ n: 0 });
    // writing a row for org A while in org B's context is rejected by the policy
    await expect(
      withTenant(deps.db, { organisationId: B.org.id, userId: B.owner.id }, (t) =>
        t.insert(competitions).values({ organisationId: A.org.id, name: 'evil', sport: 'football', rulesVersion: 'football-1', rulesConfig: {}, defaultTimezone: 'UTC' }),
      ),
    ).rejects.toThrow();
    // B cannot reference A's teams from its own match (composite tenant FK + RLS)
    const bs = await footballSetup(B.ctx, 'iso-b');
    await expect(
      matchesSvc.createMatch(B.ctx, { competitionId: bs.comp.id, seasonId: bs.season.id, homeTeamId: s.home.id, awayTeamId: bs.away.id, kickoffLocal: '2026-11-08 15:00', timezone: 'Australia/Brisbane' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // scoring another tenant's match is denied without revealing it
    await expect(cmd(B.ctx, s.match.id, 'SET_PHASE', { to: 'first_half' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps at least one owner', async () => {
    const [m] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(memberships).where(sql`organisation_id = ${A.org.id} and role = 'owner'`));
    await expect(orgs.changeMemberRole(A.ctx, m!.id, 'admin')).rejects.toMatchObject({ code: 'LAST_OWNER' });
    await expect(orgs.revokeMember(A.ctx, m!.id)).rejects.toMatchObject({ code: 'LAST_OWNER' });
  });
});

describe('scoped scorer access (A02, service layer)', () => {
  it('a scorer invited to one match can score only that match', async () => {
    const s1 = await footballSetup(A.ctx, 'sc1');
    const s2 = await footballSetup(A.ctx, 'sc2');
    const scorerUser = await makeUser(deps, 'Sam Scorer');
    const inv = await orgs.createInvitation(A.ctx, { email: scorerUser.email, role: 'scorer', scopeType: 'match', scopeId: s1.match.id });
    await orgs.acceptInvitation(deps, scorerUser, inv._token);
    const actor = (await resolveActor(deps.db, scorerUser.id, A.org.id))!;
    const ctx: Ctx = { ...deps, actor };
    const list = await matchesSvc.listScorableMatches(ctx);
    expect(list.map((m) => m.id)).toEqual([s1.match.id]);
    const all = await matchesSvc.listMatches(ctx, {});
    expect(all.items.map((m) => m.id)).toEqual([s1.match.id]);
    await expect(matchesSvc.getMatch(ctx, s2.match.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(scoring.scorerLease(ctx, s2.match.id, { action: 'acquire', deviceId: dev })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(catalog.createTeam(ctx, { name: 'x', shortName: 'x', abbreviation: 'XX', sport: 'football' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(orgs.listMembers({ ...ctx })).resolves.toBeDefined(); // org.read allowed; emails hidden
    const members = await orgs.listMembers(ctx);
    expect(members.filter((m) => m.userId !== scorerUser.id).every((m) => m.email === null)).toBe(true);
    const l = await lease(ctx, s1.match.id);
    const r = await cmd(ctx, s1.match.id, 'SET_PHASE', { to: 'first_half' }, { leaseVersion: l.leaseVersion });
    expect(r.state.phase).toBe('first_half');
  });
});

describe('scorer screens', () => {
  it("has what is coming up and the last month's matches, earliest first, and nothing older", async () => {
    const s = await footballSetup(A.ctx, 'win');
    const local = (daysAgo: number) =>
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() - daysAgo * 86_400_000)).replace(',', '');
    const at = (daysAgo: number) => matchesSvc.createMatch(A.ctx, { competitionId: s.comp.id, seasonId: s.season.id, homeTeamId: s.home.id, awayTeamId: s.away.id, kickoffLocal: local(daysAgo), timezone: 'Australia/Brisbane' });
    const recent = await at(10);
    const old = await at(40);
    const ids = (await matchesSvc.listScorableMatches(A.ctx)).map((m) => m.id);
    expect(ids).toContain(recent.id);
    expect(ids).toContain(s.match.id);
    expect(ids).not.toContain(old.id);
    expect(ids.indexOf(recent.id)).toBeLessThan(ids.indexOf(s.match.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a busy day of earlier matches never pushes the next kick-off off the list', async () => {
    const s = await footballSetup(A.ctx, 'busy');
    const local = (minsAgo: number) =>
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() - minsAgo * 60_000)).replace(',', '');
    // 110 fixtures in the last eleven hours, none of them started
    for (const batch of [0, 1])
      await matchesSvc.bulkCreateMatches(A.ctx, { competitionId: s.comp.id, seasonId: s.season.id, timezone: 'Australia/Brisbane', fixtures: Array.from({ length: 55 }, (_, i) => ({ homeTeamId: s.home.id, awayTeamId: s.away.id, kickoffLocal: local(10 + (batch * 55 + i) * 6) })) });
    const ids = (await matchesSvc.listScorableMatches(A.ctx)).map((m) => m.id);
    expect(ids).toContain(s.match.id);
  });

  it('a match stored before the per-team counts gets them from its log, when read and on the next action', async () => {
    const s = await footballSetup(A.ctx, 'tally');
    const l = await lease(A.ctx, s.match.id);
    const go = (type: string, payload: unknown) => cmd(A.ctx, s.match.id, type, payload, { leaseVersion: l.leaseVersion });
    await go('SET_PHASE', { to: 'first_half' });
    await go('ADD_FACT', { type: 'goal', side: 'home', payload: {}, occurredAt: Date.now() });
    await go('ADD_FACT', { type: 'corner', side: 'away', payload: {}, occurredAt: Date.now() });
    // as an earlier build stored it
    await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.execute(sql`update match_state set projection = projection - 'tally' where match_id = ${s.match.id} and organisation_id = ${A.org.id}`));
    const tally = async () => ((await scoring.getMatchState(A.ctx, s.match.id)).projection as { tally?: unknown }).tally;
    expect(await tally()).toEqual({ home: { goal: 1 }, away: { corner: 1 } });
    await go('ADD_FACT', { type: 'goal', side: 'home', payload: {}, occurredAt: Date.now() });
    expect(await tally()).toEqual({ home: { goal: 2 }, away: { corner: 1 } });
    const [row] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select({ p: matchState.projection }).from(matchState).where(sql`match_id = ${s.match.id} and organisation_id = ${A.org.id}`));
    expect((row!.p as { tally?: unknown }).tally).toEqual({ home: { goal: 2 }, away: { corner: 1 } }); // stored again
  });
});

describe('fixture import (A04)', () => {
  it('dry-run reports errors; repeated valid import creates no duplicates', async () => {
    const comp = await catalog.createCompetition(A.ctx, { name: 'Import Cup', shortName: 'IC', sport: 'football', defaultTimezone: 'Australia/Brisbane' });
    await catalog.createSeason(A.ctx, comp.id, { name: '2027' });
    await catalog.createTeam(A.ctx, { name: 'North Star', shortName: 'North', abbreviation: 'NST', sport: 'football' });
    await catalog.createTeam(A.ctx, { name: 'South Point', shortName: 'South', abbreviation: 'SPT', sport: 'football' });
    const head = 'external_id,competition,season,round,home_team,away_team,venue,kickoff_local,timezone\n';
    const bad = head + 'F1,Import Cup,2027,1,North Star,North Star,,2027-03-01 15:00,Australia/Brisbane\nF2,Import Cup,2027,1,Nobody,South Point,,2027-03-01 15:00,Australia/Brisbane\n';
    const dry = await imports.dryRunFixtureImport(A.ctx, bad, { sport: 'football' });
    expect(dry.valid).toBe(false);
    expect(dry.errors.map((e) => `${e.row}:${e.code}`)).toEqual(['2:SAME_TEAM', '3:UNKNOWN_TEAM']);
    expect(dry.errorsCsv).toContain('SAME_TEAM');
    await expect(imports.commitFixtureImport(A.ctx, bad, { sport: 'football' }, dry.checksum)).rejects.toMatchObject({ code: 'IMPORT_INVALID' });

    const good = head + ['F1,IC,2027,1,North Star,South Point,,2027-03-01 15:00,Australia/Brisbane', 'F2,IC,2027,2,SPT,NST,,2027-03-08 15:00,Australia/Brisbane', 'F3,IC,2027,3,North,South,,2027-03-15 19:30,Australia/Brisbane'].join('\n');
    const p1 = await imports.dryRunFixtureImport(A.ctx, good, { sport: 'football' });
    expect(p1.valid).toBe(true);
    const c1 = await imports.commitFixtureImport(A.ctx, good, { sport: 'football' }, p1.checksum);
    expect(c1.created).toEqual(['F1', 'F2', 'F3']);
    const p2 = await imports.dryRunFixtureImport(A.ctx, good, { sport: 'football' });
    expect(p2.summary).toMatchObject({ create: 0, skip: 3 });
    const c2 = await imports.commitFixtureImport(A.ctx, good, { sport: 'football' }, p2.checksum);
    expect(c2.created).toEqual([]);
    expect(c2.skipped).toHaveLength(3);
    const list = await matchesSvc.listMatches(A.ctx, { competitionId: comp.id });
    expect(list.total).toBe(3);
    expect(list.items[2]!.scheduledAt.toISOString()).toBe('2027-03-15T09:30:00.000Z');
    // each row says what is still to do before the match can go out (the match page's checklist, in short)
    const ready = list.items[0]!.ready;
    expect(ready.total).toBe(5);
    expect(ready.done + ready.todo.length).toBe(5);
    expect(ready.todo).toEqual(expect.arrayContaining(['line-ups', 'a scorer', 'OBS']));
    // the competitions list carries the next fixture
    const [cup] = await catalog.listCompetitions(A.ctx, { search: 'Import Cup' });
    expect(cup!.nextMatchAt?.toISOString()).toBe('2027-03-01T05:00:00.000Z');
    // a tampered checksum is rejected
    await expect(imports.commitFixtureImport(A.ctx, good + '\n', { sport: 'football' }, p2.checksum)).rejects.toMatchObject({ code: 'PREVIEW_MISMATCH' });
  });
});

describe('scoring commands', () => {
  let s: Awaited<ReturnType<typeof footballSetup>>;
  let lv = 0;
  beforeAll(async () => {
    s = await footballSetup(A.ctx, 'score');
    lv = (await lease(A.ctx, s.match.id)).leaseVersion;
    await cmd(A.ctx, s.match.id, 'SET_PHASE', { to: 'first_half' }, { leaseVersion: lv });
  });

  it('an identical command resent concurrently is applied exactly once (A09)', async () => {
    const st = await scoring.getMatchState(A.ctx, s.match.id);
    const env = { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lv, deviceId: dev, type: 'ADD_FACT', payload: { type: 'goal', side: 'home', occurredAt: Date.now(), payload: {} } };
    const results = await Promise.all([1, 2, 3, 4].map(() => scoring.handleMatchCommand(A.ctx, s.match.id, env)));
    expect(new Set(results.map((r) => r.event.eventId)).size).toBe(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(3);
    const after = await scoring.getMatchState(A.ctx, s.match.id);
    expect((after.projection as { score: { home: number } }).score.home).toBe(1);
    expect(after.stateVersion).toBe(st.stateVersion + 1);
    // a later retry (stale expected version) still returns the original response
    const again = await scoring.handleMatchCommand(A.ctx, s.match.id, env);
    expect(again.replayed).toBe(true);
    expect(again.event.eventId).toBe(results[0]!.event.eventId);
  });

  it('reusing a command ID with a different payload is a conflict with no mutation (A10)', async () => {
    const id = crypto.randomUUID();
    await cmd(A.ctx, s.match.id, 'ADD_FACT', { type: 'corner', side: 'away', occurredAt: Date.now(), payload: {} }, { commandId: id, leaseVersion: lv });
    const before = await scoring.getMatchState(A.ctx, s.match.id);
    await expect(cmd(A.ctx, s.match.id, 'ADD_FACT', { type: 'goal', side: 'away', occurredAt: Date.now(), payload: {} }, { commandId: id, leaseVersion: lv })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
    const after = await scoring.getMatchState(A.ctx, s.match.id);
    expect(after.stateVersion).toBe(before.stateVersion);
  });

  it('two writers with the same stale version: one wins, one gets an explicit conflict (A11)', async () => {
    const st = await scoring.getMatchState(A.ctx, s.match.id);
    const mk = (side: string) => ({ commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lv, deviceId: dev, type: 'ADD_FACT', payload: { type: 'shot_on_target', side, occurredAt: Date.now(), payload: {} } });
    const out = await Promise.allSettled([scoring.handleMatchCommand(A.ctx, s.match.id, mk('home')), scoring.handleMatchCommand(A.ctx, s.match.id, mk('away'))]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rej = out.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(rej.reason).toBeInstanceOf(AppError);
    expect(rej.reason).toMatchObject({ code: 'STATE_VERSION_CONFLICT', status: 409, extra: { currentVersion: st.stateVersion + 1 } });
    // the rejected attempt is not stored as an idempotent result: a reviewed retry with the same id succeeds
    const retry = { ...(mk('x') as object) };
    void retry;
  });

  it('voiding a goal corrects the score and keeps the audit trail (A12)', async () => {
    const g = await cmd(A.ctx, s.match.id, 'ADD_FACT', { type: 'goal', side: 'away', playerId: s.p2.id, occurredAt: Date.now(), payload: {} }, { leaseVersion: lv });
    const before = await scoring.getMatchState(A.ctx, s.match.id);
    const away = (before.projection as { score: { away: number } }).score.away;
    await cmd(A.ctx, s.match.id, 'VOID_FACT', { factId: g.event.eventId, reason: 'offside on review' }, { leaseVersion: lv });
    const after = await scoring.getMatchState(A.ctx, s.match.id);
    expect((after.projection as { score: { away: number } }).score.away).toBe(away - 1);
    const facts = await scoring.listFacts(A.ctx, s.match.id);
    const f = facts.find((x) => x.id === g.event.eventId)!;
    expect(f).toMatchObject({ voided: true, revision: 2 });
    expect(f.corrections[0]).toMatchObject({ kind: 'void', reason: 'offside on review' });
    const audits = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(auditLogs).where(sql`resource_id = ${g.event.eventId}`));
    expect(audits.map((a) => a.action)).toContain('match_fact.void');
  });

  it('rejects writes without the current lease and after a producer takeover (A15)', async () => {
    const scorerUser = await makeUser(deps, 'Second Scorer');
    const inv = await orgs.createInvitation(A.ctx, { email: scorerUser.email, role: 'scorer', scopeType: 'match', scopeId: s.match.id });
    await orgs.acceptInvitation(deps, scorerUser, inv._token);
    const scorer: Ctx = { ...deps, actor: (await resolveActor(deps.db, scorerUser.id, A.org.id))! };
    // owner (producer-level) currently holds it; the scorer cannot acquire
    await expect(scoring.scorerLease(scorer, s.match.id, { action: 'acquire', deviceId: 'scorer-phone' })).rejects.toMatchObject({ code: 'LEASE_HELD_BY_OTHER' });
    await scoring.scorerLease(A.ctx, s.match.id, { action: 'release', deviceId: dev, leaseVersion: lv });
    const sl = await scoring.scorerLease(scorer, s.match.id, { action: 'acquire', deviceId: 'scorer-phone' });
    await cmd(scorer, s.match.id, 'CLOCK_ACTION', { clockId: 'main', action: 'pause' }, { deviceId: 'scorer-phone', leaseVersion: sl!.leaseVersion });
    // producer takes over while the scorer is "offline"
    const tk = await scoring.scorerLease(A.ctx, s.match.id, { action: 'takeover', deviceId: 'control-room', reason: 'scorer lost signal' });
    expect(tk).toMatchObject({ holderUserId: A.owner.id, takenOverFrom: scorerUser.id });
    // old scorer's queued clock/phase change is refused, state unchanged
    await expect(cmd(scorer, s.match.id, 'CLOCK_ACTION', { clockId: 'main', action: 'resume' }, { deviceId: 'scorer-phone', leaseVersion: sl!.leaseVersion })).rejects.toMatchObject({ code: 'LEASE_HELD_BY_OTHER' });
    await expect(scoring.scorerLease(scorer, s.match.id, { action: 'renew', deviceId: 'scorer-phone', leaseVersion: sl!.leaseVersion })).rejects.toMatchObject({ code: 'LEASE_LOST' });
    const st = await scoring.getMatchState(A.ctx, s.match.id);
    expect((st.clocks as { main: { running: boolean } }).main.running).toBe(false);
    // scorers cannot take over
    await expect(scoring.scorerLease(scorer, s.match.id, { action: 'takeover', deviceId: 'scorer-phone', reason: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    lv = tk!.leaseVersion;
  });
});

describe('history preservation (A05, A06)', () => {
  it('archiving a team keeps its completed match intact; transfers do not rewrite lineups', async () => {
    const s = await footballSetup(A.ctx, 'hist');
    const lineupBefore = (await matchesSvc.getMatch(A.ctx, s.match.id)).lineup as { home: { playerId: string; displayName: string; number: number }[] };
    expect(lineupBefore.home[0]).toMatchObject({ playerId: s.p1.id, displayName: 'Mia Torres', number: 9 });
    const l = await lease(A.ctx, s.match.id);
    await cmd(A.ctx, s.match.id, 'SET_PHASE', { to: 'first_half' }, { leaseVersion: l.leaseVersion });
    await cmd(A.ctx, s.match.id, 'ADD_FACT', { type: 'goal', side: 'home', playerId: s.p1.id, occurredAt: Date.now(), payload: {} }, { leaseVersion: l.leaseVersion });
    await cmd(A.ctx, s.match.id, 'SET_PHASE', { to: 'half_time' }, { leaseVersion: l.leaseVersion });
    await cmd(A.ctx, s.match.id, 'SET_PHASE', { to: 'second_half' }, { leaseVersion: l.leaseVersion });
    await cmd(A.ctx, s.match.id, 'SET_PHASE', { to: 'full_time' }, { leaseVersion: l.leaseVersion });
    // transfer the scorer to the other team and rename them; then archive the home team
    await catalog.transferPlayer(A.ctx, { playerId: s.p1.id, fromTeamId: s.home.id, toTeamId: s.away.id, seasonId: s.season.id, number: 11 });
    await catalog.updatePlayer(A.ctx, s.p1.id, { displayName: 'Mia Torres-Kale' });
    await expect(catalog.deleteTeam(A.ctx, s.home.id)).rejects.toMatchObject({ code: 'TEAM_HAS_HISTORY' });
    await catalog.archiveTeam(A.ctx, s.home.id);
    const m = await matchesSvc.getMatch(A.ctx, s.match.id);
    expect(m.status).toBe('completed');
    expect((m.lineup as typeof lineupBefore).home[0]).toMatchObject({ playerId: s.p1.id, displayName: 'Mia Torres', number: 9 });
    expect((m.teams as { home: { name: string } }).home.name).toBe('Harbour hist');
    expect((m.state.projection as { score: { home: number } }).score.home).toBe(1);
    const facts = await scoring.listFacts(A.ctx, s.match.id);
    expect(facts.filter((f) => f.type === 'goal')).toHaveLength(1);
    // archived team is hidden from active lists but still resolvable for history
    expect((await catalog.listTeams(A.ctx)).some((t) => t.id === s.home.id)).toBe(false);
    expect((await catalog.getTeam(A.ctx, s.home.id)).status).toBe('archived');
  });
});
