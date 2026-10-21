// Futsal against real PostgreSQL: a futsal competition with a preset, a match scored through the scoring service
// (accumulated fouls, timeouts, a send-off and the goal that ends it), and the futsal starter flow on its output.
import crypto from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { overlays, withTenant } from '@bs/db';
import { catalog, gamePlansSvc, matchesSvc, scoring, type Ctx } from '@bs/services';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
afterAll(async () => deps.close());

describe('futsal', () => {
  it('scores a futsal match under the Futsal Laws through the scoring service, and the match output gets the futsal starter flow', async () => {
    const A = await makeOrg(deps, 'Futsal A');
    let T = Date.parse('2026-11-07T05:00:00Z');
    const ctx: Ctx = { ...A.ctx, now: () => T };
    const comp = await catalog.createCompetition(ctx, { name: 'Harbour Futsal League', sport: 'futsal', defaultTimezone: 'Australia/Sydney', rulesPreset: 'knockout' });
    expect(comp.rulesConfig).toMatchObject({ periodMinutes: 20, timeouts: { perPeriod: 1, seconds: 60 }, foulLimit: 5, sendOffMinutes: 2, extraTime: { enabled: true, periodMinutes: 5 }, shootout: { enabled: true } });
    const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
    const home = await catalog.createTeam(ctx, { name: 'Bayside Futsal Club', shortName: 'Bayside', abbreviation: 'BFC', sport: 'futsal' });
    const away = await catalog.createTeam(ctx, { name: 'Northgate Futsal', shortName: 'Northgate', abbreviation: 'NGF', sport: 'futsal' });
    const m = await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, kickoffLocal: '2026-11-07 19:00', timezone: 'Australia/Sydney' });

    // the first futsal match publishes the futsal starter flow and puts it on the match's output
    const plans = await gamePlansSvc.listGamePlans(ctx);
    expect(plans.map((p) => [p.name, p.sport, p.currentVersion])).toEqual([['Futsal starter flow', 'futsal', 1]]);
    const [out] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, m.id)));
    expect(out!.gamePlanVersionId).toBe(plans[0]!.versions[0]!.id);

    const cmd = async (type: string, payload: unknown) => {
      const lease = (await scoring.scorerLease(ctx, m.id, { action: 'acquire', deviceId: 'futsal-phone' }))!;
      const st = await scoring.getMatchState(ctx, m.id);
      return scoring.handleMatchCommand(ctx, m.id, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'futsal-phone', type, payload });
    };
    const fact = (type: string, side: 'home' | 'away', payload: Record<string, unknown> = {}) => cmd('ADD_FACT', { type, side, payload, occurredAt: T });
    const state = () => scoring.getMatchState(ctx, m.id);
    for (const to of ['pre_match', 'players_entering', 'about_to_start', 'p1']) await cmd('SET_PHASE', { to });
    expect((await state()).display).toMatchObject({ periodLabel: '1st Half', clockText: '20:00', fouls: { home: 0, away: 0 }, timeouts: { home: 1, away: 1 } });

    // accumulated fouls: at five the next one is a 10 m kick
    T += 60_000;
    for (let i = 0; i < 5; i++) await fact('foul', 'home');
    let s = await state();
    expect(s.display).toMatchObject({ clockText: '19:00', fouls: { home: 5, away: 0 }, bonus: { home: true, away: false } });
    expect(s.display.alerts).toContain('Home: 5 accumulated fouls, the next one is a 10 m kick');

    // a timeout stops the clock; the second in the half is refused
    await fact('timeout', 'home');
    s = await state();
    expect(s.clocks.main).toMatchObject({ running: false });
    expect(s.display.timeouts).toEqual({ home: 0, away: 1 });
    await expect(fact('timeout', 'home')).rejects.toMatchObject({ code: 'NO_TIMEOUTS_LEFT' });
    T += 60_000;
    await cmd('CLOCK_ACTION', { clockId: 'main', action: 'start' });

    // a send-off: two minutes of playing time a player short, ended early by a goal for the team with more players
    T += 30_000;
    await fact('red_card', 'away');
    T += 30_000;
    s = await state();
    expect(s.display.shortHanded).toEqual([{ side: 'away', players: 4, remainingText: '1:30' }]);
    await fact('goal', 'home');
    s = await state();
    expect(s.display.score).toEqual({ home: 1, away: 0 });
    expect(s.display.shortHanded).toBeNull();

    // the second half starts with no fouls and a timeout each
    await cmd('SET_PHASE', { to: 'half_time' });
    await cmd('SET_PHASE', { to: 'p2' });
    expect((await state()).display).toMatchObject({ fouls: { home: 0, away: 0 }, timeouts: { home: 1, away: 1 } });
  });
});
