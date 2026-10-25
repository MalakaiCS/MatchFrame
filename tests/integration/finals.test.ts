// Finals series and knockout matches against real PostgreSQL: a league season's ladder, the finals created from it
// (semi-finals, then the Grand Final from the winners), finals rules that decide a level score, the ladder leaving
// the finals out, and a league match switched to knockout while it is level.
import crypto from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, matchState, matches, withTenant } from '@bs/db';
import { catalog, finalsSvc, matchesSvc, scoring, seasonData, type Ctx } from '@bs/services';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
afterAll(async () => deps.close());

describe('finals series', () => {
  it('builds the finals from the ladder, decides a level semi-final on penalties and creates the Grand Final from the winners', async () => {
    const A = await makeOrg(deps, 'Finals A');
    const B = await makeOrg(deps, 'Finals B');
    let T = Date.parse('2026-09-01T05:00:00Z');
    const ctx: Ctx = { ...A.ctx, now: () => T };
    // a league: draws stand in the regular season
    const comp = await catalog.createCompetition(ctx, { name: 'Coastal League', sport: 'football', defaultTimezone: 'Australia/Sydney', rulesPreset: 'league' });
    expect(comp.rulesConfig).toMatchObject({ extraTime: { enabled: false }, shootout: { enabled: false } });
    const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
    const names = ['Harbour City', 'Bayside United', 'Northgate', 'Riverside', 'Eastwood'];
    const ts = [];
    for (const n of names) ts.push(await catalog.createTeam(ctx, { name: n, shortName: n.split(' ')[0]!, abbreviation: n.slice(0, 3).toUpperCase(), sport: 'football' }));
    // regular season results, written straight to the state (the ladder only reads final scores): Harbour > Bayside > Northgate > Riverside > Eastwood
    const result = async (h: number, a: number, hs: number, as: number, day: number) => {
      const m = await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: ts[h]!.id, awayTeamId: ts[a]!.id, round: String(day), kickoffLocal: `2026-08-${String(day).padStart(2, '0')} 15:00`, timezone: 'Australia/Sydney' });
      const [s] = await deps.adminDb.select().from(matchState).where(eq(matchState.matchId, m.id));
      await deps.adminDb.update(matchState).set({ phase: 'full_time', projection: { ...(s!.projection as object), phase: 'full_time', score: { home: hs, away: as } } as never }).where(eq(matchState.matchId, m.id));
      await deps.adminDb.update(matches).set({ status: 'completed' }).where(eq(matches.id, m.id));
      return m;
    };
    await result(0, 1, 2, 0, 1);
    await result(0, 2, 3, 1, 2);
    await result(1, 2, 2, 1, 3);
    await result(1, 3, 1, 0, 4);
    await result(2, 3, 2, 2, 5);
    await result(3, 4, 1, 0, 6);
    await result(2, 4, 3, 0, 7);
    const ladderBefore = (await seasonData.getStandings(ctx, season.id)).rows.map((r) => [r.team.name, r.played, r.points]);
    expect(ladderBefore.map((r) => r[0])).toEqual(['Harbour City', 'Bayside United', 'Northgate', 'Riverside', 'Eastwood']);

    let f = await finalsSvc.getFinals(ctx, season.id);
    expect(f).toMatchObject({ format: null, next: { kind: 'start' }, regularLeft: 0 });
    expect(f.ladder.map((r) => r.team.name)).toEqual(names);
    // finals rules: the competition's rules with a level score decided
    expect(f.rules.description).toEqual(expect.arrayContaining(['Extra time: 2×15 minutes when level (5-minute break before, 1-minute break between)', 'Penalty shootout when level (shootout score kept separately)']));
    await expect(finalsSvc.getFinals(B.ctx, season.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(finalsSvc.createFinalsRound(B.ctx, season.id, { format: 'top4', timezone: 'Australia/Sydney', matches: [{ kickoffLocal: '2026-09-05 15:00' }, { kickoffLocal: '2026-09-06 15:00' }] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(finalsSvc.createFinalsRound(ctx, season.id, { format: 'top8', timezone: 'Australia/Sydney', matches: [{ kickoffLocal: '2026-09-05 15:00' }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringMatching(/needs 8 teams/) });

    // semi-finals: 1st v 4th, 2nd v 3rd, the better-placed team at home
    const sf = await finalsSvc.createFinalsRound(ctx, season.id, { format: 'top4', timezone: 'Australia/Sydney', matches: [{ kickoffLocal: '2026-09-05 15:00' }, { kickoffLocal: '2026-09-06 15:00' }] });
    expect(sf).toMatchObject({ format: 'top4', week: 1, round: 'Semi-final' });
    const [sf1, sf2] = sf.created;
    expect([sf1!.homeTeamId, sf1!.awayTeamId, sf2!.homeTeamId, sf2!.awayTeamId]).toEqual([ts[0]!.id, ts[3]!.id, ts[1]!.id, ts[2]!.id]);
    const m1 = await matchesSvc.getMatch(ctx, sf1!.id);
    expect(m1).toMatchObject({ stage: 'finals', round: 'Semi-final', bracket: { format: 'top4', week: 1, slot: 1, seeds: { home: 1, away: 4 } }, rulesConfig: { extraTime: { enabled: true }, shootout: { enabled: true } }, rules: { knockout: { on: true } } });
    // nothing to create until both semi-finals have a winner
    await expect(finalsSvc.createFinalsRound(ctx, season.id, { timezone: 'Australia/Sydney', matches: [{ kickoffLocal: '2026-09-12 15:00' }] })).rejects.toMatchObject({ code: 'FINALS_ROUND_UNDECIDED' });

    // semi-final 1 is level after 90 minutes: extra time is next, then penalties decide it
    const cmd = async (matchId: string, type: string, payload: unknown) => {
      const lease = (await scoring.scorerLease(ctx, matchId, { action: 'acquire', deviceId: 'finals-phone' }))!;
      const st = await scoring.getMatchState(ctx, matchId);
      return scoring.handleMatchCommand(ctx, matchId, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'finals-phone', type, payload });
    };
    T = Date.parse('2026-09-05T05:00:00Z');
    for (const to of ['first_half', 'half_time', 'second_half']) await cmd(sf1!.id, 'SET_PHASE', { to });
    await cmd(sf1!.id, 'ADD_FACT', { type: 'goal', side: 'home', payload: {}, occurredAt: T });
    await cmd(sf1!.id, 'ADD_FACT', { type: 'goal', side: 'away', payload: {}, occurredAt: T });
    expect((await scoring.getMatchState(ctx, sf1!.id)).allowedTransitions).toEqual(['extra_time_break', 'shootout', 'full_time', 'abandoned']);
    for (const to of ['extra_time_break', 'et_first_half', 'et_half_time', 'et_second_half']) await cmd(sf1!.id, 'SET_PHASE', { to });
    expect((await scoring.getMatchState(ctx, sf1!.id)).allowedTransitions[0]).toBe('shootout');
    await cmd(sf1!.id, 'SET_PHASE', { to: 'shootout' });
    for (const [side, scored] of [['home', false], ['away', true], ['home', true], ['away', true]] as const) await cmd(sf1!.id, 'ADD_FACT', { type: 'shootout_kick', side, payload: { scored }, occurredAt: T });
    await cmd(sf1!.id, 'SET_PHASE', { to: 'full_time' });
    f = await finalsSvc.getFinals(ctx, season.id);
    expect(f.matches.find((x) => x.id === sf1!.id)).toMatchObject({ done: true, score: { home: 1, away: 1 }, shootout: { home: 1, away: 2 }, winner: 'away' });
    expect(f.next).toMatchObject({ kind: 'waiting', unresolved: [{ home: { name: 'Bayside United' } }] });

    // semi-final 2: Northgate win away
    await deps.adminDb.update(matchState).set({ phase: 'full_time', projection: { ...((await scoring.getMatchState(ctx, sf2!.id)).projection as object), phase: 'full_time', score: { home: 0, away: 1 } } as never }).where(eq(matchState.matchId, sf2!.id));
    await deps.adminDb.update(matches).set({ status: 'completed' }).where(eq(matches.id, sf2!.id));
    f = await finalsSvc.getFinals(ctx, season.id);
    expect(f.next).toMatchObject({ kind: 'round', week: 2, round: 'Grand Final', fixtures: [{ home: { name: 'Northgate' }, away: { name: 'Riverside' }, seeds: { home: 3, away: 4 } }] });
    await expect(finalsSvc.createFinalsRound(ctx, season.id, { format: 'top8', timezone: 'Australia/Sydney', matches: [{ kickoffLocal: '2026-09-12 15:00' }] })).rejects.toMatchObject({ code: 'FINALS_FORMAT_FIXED' });
    const gf = await finalsSvc.createFinalsRound(ctx, season.id, { timezone: 'Australia/Sydney', matches: [{ kickoffLocal: '2026-09-12 15:00' }] });
    expect(gf).toMatchObject({ week: 2, round: 'Grand Final', created: [{ homeTeamId: ts[2]!.id, awayTeamId: ts[3]!.id }] });

    // the finals stay out of the ladder and follow the regular season in the fixtures
    expect((await seasonData.getStandings(ctx, season.id)).rows.map((r) => [r.team.name, r.played, r.points])).toEqual(ladderBefore);
    const fx = await seasonData.getFixtures(ctx, season.id);
    expect(fx.rounds.slice(-2).map((r) => [r.stage, r.round, r.matches.length])).toEqual([['finals', 'Semi-final', 2], ['finals', 'Grand Final', 1]]);
    expect(fx.rounds.find((r) => r.round === 'Semi-final')!.matches[0]).toMatchObject({ shootout: { home: 1, away: 2 } });

    // the competition's own finals rules: extra time 2×10; the Grand Final (nothing recorded yet) takes them
    const own = { ...comp.rulesConfig, extraTime: { enabled: true, periodMinutes: 10 }, shootout: { enabled: true }, label: 'Finals 2×45, extra time 2×10' };
    await expect(catalog.updateCompetition(ctx, comp.id, { finalsRulesConfig: { ...own, periodMinutes: 500 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await catalog.updateCompetition(ctx, comp.id, { finalsRulesConfig: own, applyToUpcoming: true })).toMatchObject({ matchesUpdated: 1 });
    expect((await matchesSvc.getMatch(ctx, gf.created[0]!.id)).rulesConfig).toMatchObject({ extraTime: { enabled: true, periodMinutes: 10 } });
    expect((await catalog.getCompetition(ctx, comp.id)).finals).toMatchObject({ own: true, rulesDescription: expect.arrayContaining(['Extra time: 2×10 minutes when level (5-minute break before, 1-minute break between)']) });
    // the regular season is untouched by finals rules
    const later = await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: ts[0]!.id, awayTeamId: ts[4]!.id, kickoffLocal: '2026-09-20 15:00', timezone: 'Australia/Sydney' });
    expect((await matchesSvc.getMatch(ctx, later.id)).rules.knockout).toEqual({ label: 'Extra time and penalties when level', on: false });
    // ...until it is moved to the finals before anything is recorded
    await matchesSvc.updateMatch(ctx, later.id, { stage: 'finals', round: 'Third place play-off' });
    expect(await matchesSvc.getMatch(ctx, later.id)).toMatchObject({ stage: 'finals', rules: { knockout: { on: true } }, rulesConfig: { extraTime: { periodMinutes: 10 } } });
  });

  it('turns a level league match into a knockout through the scoring service; audited, closed once the match is over', async () => {
    const A = await makeOrg(deps, 'Knockout A');
    const T = Date.parse('2026-09-01T05:00:00Z');
    const ctx: Ctx = { ...A.ctx, now: () => T };
    const comp = await catalog.createCompetition(ctx, { name: 'Harbour Cup', sport: 'football', defaultTimezone: 'Australia/Sydney', rulesPreset: 'league' });
    const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
    const home = await catalog.createTeam(ctx, { name: 'Harbour City', shortName: 'Harbour', abbreviation: 'HAR', sport: 'football' });
    const away = await catalog.createTeam(ctx, { name: 'Bayside United', shortName: 'Bayside', abbreviation: 'BAY', sport: 'football' });
    const m = await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2026-09-05 15:00', timezone: 'Australia/Sydney' });
    const cmd = async (type: string, payload: unknown) => {
      const lease = (await scoring.scorerLease(ctx, m.id, { action: 'acquire', deviceId: 'cup-phone' }))!;
      const st = await scoring.getMatchState(ctx, m.id);
      return scoring.handleMatchCommand(ctx, m.id, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'cup-phone', type, payload });
    };
    for (const to of ['first_half', 'half_time', 'second_half']) await cmd('SET_PHASE', { to });
    expect((await scoring.getMatchState(ctx, m.id)).allowedTransitions).toEqual(['full_time', 'abandoned']);
    const r = await cmd('SET_KNOCKOUT', { on: true, reason: 'cup tie: must have a winner' });
    expect(r.event).toMatchObject({ type: 'rules_changed', payload: { knockout: true } });
    expect((await scoring.getMatchState(ctx, m.id)).allowedTransitions).toEqual(['extra_time_break', 'shootout', 'full_time', 'abandoned']);
    expect((await matchesSvc.getMatch(ctx, m.id)).rules.knockout).toEqual({ label: 'Extra time and penalties when level', on: true });
    const audits = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(auditLogs).where(and(eq(auditLogs.resourceId, m.id), eq(auditLogs.action, 'match.rules'))));
    expect(audits.map((x) => x.reason)).toEqual(['cup tie: must have a winner']);
    // in extra time it cannot be turned off; after full time nothing changes
    await cmd('SET_PHASE', { to: 'extra_time_break' });
    await expect(cmd('SET_KNOCKOUT', { on: false })).rejects.toMatchObject({ code: 'PHASE_NOT_ALLOWED' });
    await cmd('SET_PHASE', { to: 'et_first_half' });
    await cmd('ADD_FACT', { type: 'goal', side: 'home', payload: {}, occurredAt: T });
    for (const to of ['et_half_time', 'et_second_half', 'full_time']) await cmd('SET_PHASE', { to });
    await expect(cmd('SET_KNOCKOUT', { on: false })).rejects.toMatchObject({ code: 'MATCH_CLOSED' });
  });
});
