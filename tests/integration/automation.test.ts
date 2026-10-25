// Automation + sponsor delivery against real PostgreSQL with the worker role (A23–A28, A30–A32, A34).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { automationCues, automationRuns, createDb, destinations, mediaAssets, outboxEvents, overlays, withTenant } from '@bs/db';
import { createFakeProvider } from '@bs/media';
import { automationSvc, catalog, gamePlansSvc, matchesSvc, overlaysSvc, scoring, sponsorsSvc, streamsSvc, type Ctx } from '@bs/services';
import { STARTER_PLANS, type GamePlan } from '@bs/domain';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
const worker = createDb(deps.config.DATABASE_WORKER_URL, { max: 6 });
let T = Date.now();
const clock = () => T;
const W = (id = 'worker-a') => ({ db: worker.db, config: deps.config, workerId: id, now: clock });
let A: Awaited<ReturnType<typeof makeOrg>>;
let ctx: Ctx;

const TEST_PLAN: GamePlan = {
  version: 1,
  sport: 'football',
  defaultScorebug: true,
  freshnessMs: 10_000,
  playlists: [
    { id: 'promo_loop', name: 'Promo loop', kind: 'in_play', priority: 3, promotional: true, cooldownMs: 0, triggers: [{ id: 't_manual', type: 'manual' }], guards: [], repeat: { mode: 'loop', gapMs: 1000, maxIterations: 5 }, items: [{ id: 'banner', action: 'sponsor', placement: 'lower_third_banner', offsetMs: 0, durationMs: 5000 }] },
    { id: 'goal', name: 'Goal', kind: 'in_play', priority: 1, promotional: false, cooldownMs: 0, triggers: [{ id: 't_goal', type: 'event', eventTypes: ['goal'] }], guards: [], repeat: { mode: 'once', gapMs: 0, maxIterations: 1 }, items: [{ id: 'g', action: 'show', templateKey: 'builtin:lower_third', layer: 'lower', variables: { heading: 'GOAL', subtitle: { from: 'event.side' } }, offsetMs: 0, durationMs: 6000 }] },
    { id: 'ten_min', name: '10 minute stat', kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0, triggers: [{ id: 't_10', type: 'match_clock', atMs: 600_000, periodIds: [] }], guards: [], repeat: { mode: 'once', gapMs: 0, maxIterations: 1 }, items: [{ id: 'st', action: 'show', templateKey: 'builtin:stats', offsetMs: 0, durationMs: 5000 }] },
  ],
};

async function newMatch(planDraft: GamePlan = TEST_PLAN) {
  const comp = await catalog.createCompetition(ctx, { name: `Auto League ${crypto.randomUUID().slice(0, 4)}`, sport: 'football', defaultTimezone: 'Australia/Brisbane' });
  const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
  const h = await catalog.createTeam(ctx, { name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', sport: 'football' });
  const a = await catalog.createTeam(ctx, { name: 'Ridgeback United', shortName: 'Ridge', abbreviation: 'RBU', sport: 'football' });
  const m = await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-11-07 15:00', timezone: 'Australia/Brisbane' });
  const plan = await gamePlansSvc.createGamePlan(ctx, { name: `Plan ${m.id.slice(0, 4)}`, sport: 'football', fromStarter: false });
  await gamePlansSvc.updateGamePlanDraft(ctx, plan.id, { draft: planDraft });
  const v = await gamePlansSvc.publishGamePlan(ctx, plan.id);
  // the output every match gets when it is created (it may already carry the organisation's latest plan)
  const [ov] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, m.id)));
  await overlaysSvc.setOverlayGamePlan(ctx, ov!.id, v.id);
  const send = async (type: string, payload: Record<string, unknown>) => {
    const lease = await scoring.scorerLease(ctx, m.id, { action: 'acquire', deviceId: 'dev-auto' });
    const st = await scoring.getMatchState(ctx, m.id);
    return scoring.handleMatchCommand(ctx, m.id, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease!.leaseVersion, deviceId: 'dev-auto', type, payload });
  };
  return { m, ov: ov!, send, versionId: v.id, season, h, a };
}

async function phase(x: Awaited<ReturnType<typeof newMatch>>, to: string) {
  const r = await x.send('SET_PHASE', { to });
  await automationSvc.onPhaseChanged(W(), A.org.id, x.m.id, to, r.event.sequence, T);
  return r;
}
async function goal(x: Awaited<ReturnType<typeof newMatch>>, side: 'home' | 'away', occurredAt = T) {
  const r = await x.send('ADD_FACT', { type: 'goal', side, occurredAt, payload: {} });
  return r;
}
/** run the dispatcher/run lifecycle as the worker would at simulated time T */
async function pump(id = 'worker-a') {
  const fence = await automationSvc.acquireLease(worker.db, id);
  if (!fence) throw new Error('lease not acquired');
  await automationSvc.dispatchDueCues(W(id), fence);
  await automationSvc.advanceRuns(W(id));
  await automationSvc.dispatchDueCues(W(id), fence);
  return fence;
}
const runs = (overlayId: string) => withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(automationRuns).where(eq(automationRuns.overlayId, overlayId)));
const state = async (overlayId: string) => (await overlaysSvc.getOverlay(ctx, overlayId)).state;

async function sponsorSetup() {
  const mk = (name: string, width: number, height: number) =>
    withTenant(deps.db, { organisationId: A.org.id }, async (t) => (await t.insert(mediaAssets).values({ organisationId: A.org.id, kind: 'logo', name, originalKey: `test/${name}`, detectedMime: 'image/png', width, height, state: 'READY' }).returning())[0]!);
  const brand = await sponsorsSvc.createBrand(ctx, { name: '=HYPERLINK("http://evil.example") Coffee', category: 'beverage' });
  const banner = await mk('banner', 1200, 200);
  const logo = await mk('logo', 400, 200);
  const cb = await sponsorsSvc.addCreative(ctx, { creativeSetId: brand.creativeSetId, assetId: banner.id, name: '+cmd|calc banner' });
  const cl = await sponsorsSvc.addCreative(ctx, { creativeSetId: brand.creativeSetId, assetId: logo.id, name: 'Logo' });
  await sponsorsSvc.setCreativeApproval(ctx, cb.id, 'approved');
  await sponsorsSvc.setCreativeApproval(ctx, cl.id, 'approved');
  const campaign = await sponsorsSvc.saveCampaign(ctx, {
    brandId: brand.id,
    creativeSetId: brand.creativeSetId,
    name: 'Season partner',
    startsAt: new Date(T - 86400_000).toISOString(),
    endsAt: new Date(T + 30 * 86400_000).toISOString(),
    allocations: [{ scopeType: 'organisation', placement: 'lower_third_banner' }, { scopeType: 'organisation', placement: 'scorebug_logo' }, { scopeType: 'organisation', placement: 'detached_logo' }],
  });
  return { brand, campaign, banner: cb, logo: cl };
}

let sponsors: Awaited<ReturnType<typeof sponsorSetup>>;

beforeAll(async () => {
  A = await makeOrg(deps, 'Automation A');
  ctx = { ...A.ctx, now: clock };
  sponsors = await sponsorSetup();
});
afterAll(async () => {
  await automationSvc.releaseLease(worker.db, 'worker-a');
  await automationSvc.releaseLease(worker.db, 'worker-b');
  await worker.pool.end();
  await deps.close();
});

describe('automation runtime', () => {
  it('starts the default scorebug in play and runs one execution per fact even when delivered twice (A23)', async () => {
    const x = await newMatch();
    await phase(x, 'first_half');
    await pump();
    expect((await state(x.ov.id)).scorebugVisible).toBe(true);
    const g = await goal(x, 'home');
    const first = await automationSvc.onFactAccepted(W(), A.org.id, x.m.id, g.event.eventId);
    const again = await automationSvc.onFactAccepted(W(), A.org.id, x.m.id, g.event.eventId);
    expect(first[0]!.started).toEqual(['goal']);
    expect(again[0]!.started).toEqual([]);
    const goalRuns = (await runs(x.ov.id)).filter((r) => r.playlistId === 'goal');
    expect(goalRuns).toHaveLength(1);
    await pump();
    const s = await state(x.ov.id);
    expect(s.layers.lower).toMatchObject({ templateKey: 'builtin:lower_third', source: 'automation', variables: { heading: 'GOAL', subtitle: 'home' } });
  });

  it('an output that gets a plan catches up with the match phase; Pre-match leaves the same graphics alone; new matches get the latest plan', async () => {
    const plan: GamePlan = {
      version: 1, sport: 'football', defaultScorebug: true, freshnessMs: 10_000,
      playlists: [{
        id: 'before', name: 'Before the match', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
        triggers: [{ id: 't_before', type: 'phase', phaseTags: ['pre_match'], phaseIds: ['scheduled'] }], guards: [], repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
        items: [
          { id: 'bd', action: 'show', templateKey: 'builtin:backdrop', offsetMs: 0, durationMs: null },
          { id: 'hd', action: 'show', templateKey: 'builtin:ident', variables: { showCountdown: true }, offsetMs: 600, durationMs: null },
        ],
      }],
    };
    const x = await newMatch(plan);
    // choosing the plan queued the catch-up in the same transaction; the worker delivers it after commit
    const queued = await worker.db.select().from(outboxEvents).where(and(eq(outboxEvents.topic, 'overlay.plan.attached'), eq(outboxEvents.aggregateId, x.ov.id)));
    expect(queued.length).toBeGreaterThanOrEqual(1);
    expect((await automationSvc.onOutputReady(W(), A.org.id, x.ov.id))[0]!.started).toEqual(['before']);
    await pump();
    T += 1000;
    await pump();
    let s = await state(x.ov.id);
    expect(s.layers.background).toMatchObject({ templateKey: 'builtin:backdrop', outAt: null });
    expect(s.layers.fullframe).toMatchObject({ templateKey: 'builtin:ident', outAt: null });
    const first = { bd: s.layers.background!.cueId, hd: s.layers.fullframe!.cueId };
    // a second delivery of the same event starts nothing
    expect((await automationSvc.onOutputReady(W(), A.org.id, x.ov.id))[0]!.started).toEqual([]);
    // "Pre-match" asks for the same graphics: they stay as they are, no second entrance
    await phase(x, 'pre_match');
    await pump();
    T += 1000;
    await pump();
    s = await state(x.ov.id);
    expect({ bd: s.layers.background!.cueId, hd: s.layers.fullframe!.cueId }).toEqual(first);
    const cues = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(automationCues).where(eq(automationCues.overlayId, x.ov.id)));
    expect(cues.filter((c) => c.reason === 'already on air')).toHaveLength(2);
    // a match created now gets this organisation's latest published football plan on its own output, and the catch-up
    const m2 = await matchesSvc.createMatch(ctx, { competitionId: x.m.competitionId, seasonId: x.season.id, homeTeamId: x.h.id, awayTeamId: x.a.id, kickoffLocal: '2026-11-14 15:00', timezone: 'Australia/Brisbane' });
    const [own] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, m2.id)));
    expect(own!.gamePlanVersionId).toBe(x.versionId);
    expect(await worker.db.select().from(outboxEvents).where(and(eq(outboxEvents.topic, 'overlay.plan.attached'), eq(outboxEvents.aggregateId, own!.id)))).toHaveLength(1);
  });

  it('the first match in an organisation with no plan publishes the starter flow; its output shows the background and the header until removed', async () => {
    const B = await makeOrg(deps, 'Automation B');
    const bctx: Ctx = { ...B.ctx, now: clock };
    const comp = await catalog.createCompetition(bctx, { name: 'Fresh League', sport: 'football', defaultTimezone: 'Australia/Brisbane' });
    const season = await catalog.createSeason(bctx, comp.id, { name: '2026' });
    const h = await catalog.createTeam(bctx, { name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', sport: 'football' });
    const a = await catalog.createTeam(bctx, { name: 'Ridgeback United', shortName: 'Ridge', abbreviation: 'RBU', sport: 'football' });
    expect(await gamePlansSvc.listGamePlans(bctx)).toHaveLength(0);
    const m = await matchesSvc.createMatch(bctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-12-05 15:00', timezone: 'Australia/Brisbane' });
    const plans = await gamePlansSvc.listGamePlans(bctx);
    expect(plans.map((p) => [p.name, p.currentVersion])).toEqual([['Football starter flow', 1]]);
    const [own] = await withTenant(deps.db, { organisationId: B.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, m.id)));
    expect(own!.gamePlanVersionId).toBeTruthy();
    expect((await automationSvc.onOutputReady(W(), B.org.id, own!.id))[0]!.started).toEqual(['pre_match']);
    await pump();
    T += 1000;
    await pump();
    T += 60_000; // well past the header's old 8-second hold
    await pump();
    const s = (await overlaysSvc.getOverlay(bctx, own!.id)).state;
    expect(s.layers.background).toMatchObject({ templateKey: 'builtin:backdrop', durationMs: null, outAt: null });
    expect(s.layers.fullframe).toMatchObject({ templateKey: 'builtin:ident', durationMs: null, outAt: null, variables: { showCountdown: true } });
    // the next match reuses that plan rather than publishing another
    const m2 = await matchesSvc.createMatch(bctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-12-12 15:00', timezone: 'Australia/Brisbane' });
    expect(await gamePlansSvc.listGamePlans(bctx)).toHaveLength(1);
    const [own2] = await withTenant(deps.db, { organisationId: B.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, m2.id)));
    expect(own2!.gamePlanVersionId).toBe(own!.gamePlanVersionId);
    // an output left without a plan (a match from before) gets it back with "Use the starter flow", and catches up
    await overlaysSvc.setOverlayGamePlan(bctx, own2!.id, null);
    expect(await gamePlansSvc.applyStarterPlan(bctx, own2!.id)).toEqual({ gamePlanVersionId: own!.gamePlanVersionId });
    const [again] = await withTenant(deps.db, { organisationId: B.org.id }, (t) => t.select().from(overlays).where(eq(overlays.id, own2!.id)));
    expect(again!.gamePlanVersionId).toBe(own!.gamePlanVersionId);
    expect(await worker.db.select().from(outboxEvents).where(and(eq(outboxEvents.topic, 'overlay.plan.attached'), eq(outboxEvents.aggregateId, own2!.id)))).toHaveLength(2);
    expect(await gamePlansSvc.listGamePlans(bctx)).toHaveLength(1);
  });

  it('on worker start, an output that never had a plan gets one; one a person turned off stays off', async () => {
    const C = await makeOrg(deps, 'Automation C');
    const cctx: Ctx = { ...C.ctx, now: clock };
    const comp = await catalog.createCompetition(cctx, { name: 'Old League', sport: 'football', defaultTimezone: 'Australia/Brisbane' });
    const season = await catalog.createSeason(cctx, comp.id, { name: '2026' });
    const h = await catalog.createTeam(cctx, { name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', sport: 'football' });
    const a = await catalog.createTeam(cctx, { name: 'Ridgeback United', shortName: 'Ridge', abbreviation: 'RBU', sport: 'football' });
    const m1 = await matchesSvc.createMatch(cctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-12-19 15:00', timezone: 'Australia/Brisbane' });
    const m2 = await matchesSvc.createMatch(cctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-12-26 15:00', timezone: 'Australia/Brisbane' });
    // like matches created before outputs got a plan by default: no plan, and nothing in the audit log about one
    await worker.db.update(overlays).set({ gamePlanVersionId: null }).where(inArray(overlays.matchId, [m1.id, m2.id]));
    const out = async (matchId: string) => (await withTenant(deps.db, { organisationId: C.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, matchId))))[0]!;
    // someone deliberately took the automation off the second match's output
    await overlaysSvc.setOverlayGamePlan(cctx, (await out(m2.id)).id, null);
    await gamePlansSvc.backfillDefaultPlans({ db: worker.db, config: deps.config });
    const [plan] = await gamePlansSvc.listGamePlans(cctx);
    expect((await out(m1.id)).gamePlanVersionId).toBe(plan!.versions[0]!.id);
    expect((await out(m2.id)).gamePlanVersionId).toBeNull();
    expect(await worker.db.select().from(outboxEvents).where(and(eq(outboxEvents.topic, 'overlay.plan.attached'), eq(outboxEvents.aggregateId, (await out(m1.id)).id)))).toHaveLength(2);
    // a second start changes nothing; an extra output added to a match is never given a plan
    const extra = await overlaysSvc.createOverlay(cctx, m1.id, { name: 'Venue screen' });
    await gamePlansSvc.backfillDefaultPlans({ db: worker.db, config: deps.config });
    expect((await out(m2.id)).gamePlanVersionId).toBeNull();
    const [ex] = await withTenant(deps.db, { organisationId: C.org.id }, (t) => t.select().from(overlays).where(eq(overlays.id, extra.id)));
    expect(ex!.gamePlanVersionId).toBeNull();
    expect(await gamePlansSvc.listGamePlans(cctx)).toHaveLength(1);
  });

  it('on worker start, an untouched copy of an older starter flow gets the current one and upcoming outputs catch up; an edited plan is left alone', async () => {
    const D = await makeOrg(deps, 'Automation D');
    const dctx: Ctx = { ...D.ctx, now: clock };
    const publish = async (name: string, draft: unknown) => {
      const p = await gamePlansSvc.createGamePlan(dctx, { name, sport: 'football', fromStarter: false });
      await gamePlansSvc.updateGamePlanDraft(dctx, p.id, { draft });
      return { id: p.id, versionId: (await gamePlansSvc.publishGamePlan(dctx, p.id)).id };
    };
    // the football starter flow of 20 October: the background and header only came up at "Pre-match"
    const old = JSON.parse(fs.readFileSync(new URL('../fixtures/football-starter-2026-10-20.json', import.meta.url), 'utf8')) as GamePlan;
    const edited = structuredClone(old);
    edited.playlists[0]!.name = 'Our walk-out';
    const keep = await publish('Our plan', edited);
    const copy = await publish('Football starter', old);
    const comp = await catalog.createCompetition(dctx, { name: 'Older League', sport: 'football', defaultTimezone: 'Australia/Brisbane' });
    const season = await catalog.createSeason(dctx, comp.id, { name: '2026' });
    const h = await catalog.createTeam(dctx, { name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', sport: 'football' });
    const a = await catalog.createTeam(dctx, { name: 'Ridgeback United', shortName: 'Ridge', abbreviation: 'RBU', sport: 'football' });
    const m = await matchesSvc.createMatch(dctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-12-19 15:00', timezone: 'Australia/Brisbane' });
    const out = async () => (await withTenant(deps.db, { organisationId: D.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, m.id))))[0]!;
    // what the operator saw: the match's output has the old copy, and nothing goes on air before "Pre-match"
    expect((await out()).gamePlanVersionId).toBe(copy.versionId);
    expect((await automationSvc.onOutputReady(W(), D.org.id, (await out()).id))[0]!.started).toEqual([]);

    expect(await gamePlansSvc.upgradeStarterPlans({ db: worker.db, config: deps.config })).toBeGreaterThanOrEqual(1);
    const plans = await gamePlansSvc.listGamePlans(dctx);
    expect(plans.map((p) => [p.name, p.currentVersion])).toEqual([['Football starter', 2], ['Our plan', 1]]);
    const upgraded = await gamePlansSvc.getGamePlan(dctx, copy.id);
    expect(upgraded.draft).toEqual(STARTER_PLANS.football);
    expect((await gamePlansSvc.getGamePlan(dctx, keep.id)).draft).toEqual(edited);
    const own = await out();
    expect(own.gamePlanVersionId).toBe(upgraded.versions[0]!.id);
    expect((await automationSvc.onOutputReady(W(), D.org.id, own.id))[0]!.started).toEqual(['pre_match']);
    await pump();
    T += 1000;
    await pump();
    const s = (await overlaysSvc.getOverlay(dctx, own.id)).state;
    expect(s.layers.background).toMatchObject({ templateKey: 'builtin:backdrop', durationMs: null });
    expect(s.layers.fullframe).toMatchObject({ templateKey: 'builtin:ident', durationMs: null, variables: { showCountdown: true } });
    // a second start changes nothing
    await gamePlansSvc.upgradeStarterPlans({ db: worker.db, config: deps.config });
    expect((await gamePlansSvc.listGamePlans(dctx)).map((p) => p.currentVersion)).toEqual([2, 1]);
  });

  it('a line-up board goes to air only for a team whose line-up was entered; the other is skipped with the reason', async () => {
    const plan: GamePlan = {
      version: 1, sport: 'football', defaultScorebug: false, freshnessMs: 10_000,
      playlists: [{
        id: 'walkout', name: 'Walk-out', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0, continueOnPhaseStep: true,
        triggers: [{ id: 't_walk', type: 'phase', phaseTags: [], phaseIds: ['players_entering'] }], guards: [], repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
        items: [
          { id: 'lu_home', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'home' }, offsetMs: 0, durationMs: 8000 },
          { id: 'lu_away', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'away' }, offsetMs: 8600, durationMs: 8000 },
        ],
      }],
    };
    const x = await newMatch(plan);
    const pl = await catalog.createPlayer(ctx, { displayName: 'Sam Okafor', defaultNumber: 9 });
    await catalog.addToRoster(ctx, { playerId: pl.id, teamId: x.h.id, seasonId: x.season.id, number: 9 });
    await matchesSvc.setLineup(ctx, x.m.id, { home: [{ playerId: pl.id, starter: true }], away: [] });
    await phase(x, 'pre_match');
    await phase(x, 'players_entering');
    await pump();
    expect((await state(x.ov.id)).layers.fullframe).toMatchObject({ templateKey: 'builtin:lineup', variables: { team: 'home' } });
    T += 1500;
    // "About to start" does not cut the walk-out playlist short
    await phase(x, 'about_to_start');
    await pump();
    expect((await state(x.ov.id)).layers.fullframe).toMatchObject({ templateKey: 'builtin:lineup', variables: { team: 'home' }, outAt: null });
    T += 7500;
    await pump();
    const cues = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(automationCues).where(eq(automationCues.overlayId, x.ov.id)));
    const away = cues.find((c) => c.action === 'show' && c.itemIndex === 1)!;
    expect(away).toMatchObject({ state: 'skipped', reason: 'no line-up entered for the away team: not shown' });
    expect(cues.find((c) => c.action === 'show' && c.itemIndex === 0)?.state).toBe('done');
    // no "to be confirmed" board for the away side: nothing new went to air on the full-screen layer
    const ff = (await state(x.ov.id)).layers.fullframe;
    expect(ff == null || (ff.templateKey === 'builtin:lineup' && ff.variables.team === 'home')).toBe(true);
  });

  it('correcting a goal withdraws its pending/on-air automation (A12)', async () => {
    const x = await newMatch();
    await phase(x, 'first_half');
    await pump();
    const g = await goal(x, 'home');
    await automationSvc.onFactAccepted(W(), A.org.id, x.m.id, g.event.eventId);
    await pump();
    expect((await state(x.ov.id)).layers.lower).toBeTruthy();
    await x.send('CORRECT_FACT', { factId: g.event.eventId, reason: 'was the away side', changes: { side: 'away' } });
    expect(await automationSvc.onFactCorrected(W(), A.org.id, g.event.eventId, 2)).toBe(1);
    await pump();
    const run = (await runs(x.ov.id)).find((r) => r.playlistId === 'goal')!;
    expect(run).toMatchObject({ state: 'cancelled' });
    expect(run.reason).toMatch(/corrected/);
    expect((await state(x.ov.id)).layers.lower?.outAt).toBeTruthy(); // taken out, not left celebrating
  });

  it('a high-priority goal preempts a promotional sponsor loop; the scorebug stays (A24)', async () => {
    const x = await newMatch();
    await phase(x, 'first_half');
    await pump();
    const r = await automationSvc.triggerManualPlaylist(ctx, W(), x.ov.id, 'promo_loop', crypto.randomUUID());
    expect(r.started).toEqual(['promo_loop']);
    await pump();
    let s = await state(x.ov.id);
    expect(s.layers.lower?.sponsor).toMatchObject({ placement: 'lower_third_banner', creativeId: sponsors.banner.id });
    T += 2000;
    const g = await goal(x, 'away');
    await automationSvc.onFactAccepted(W(), A.org.id, x.m.id, g.event.eventId);
    await pump();
    const all = await runs(x.ov.id);
    expect(all.find((q) => q.playlistId === 'promo_loop')).toMatchObject({ state: 'preempted' });
    s = await state(x.ov.id);
    expect(s.layers.lower).toMatchObject({ templateKey: 'builtin:lower_third', variables: { heading: 'GOAL' } });
    expect(s.layers.lower?.sponsor).toBeFalsy();
    expect(s.scorebugVisible).toBe(true);
    // loop does not come back after the goal graphic expires
    T += 8000;
    await pump();
    s = await state(x.ov.id);
    expect(s.layers.lower?.sponsor).toBeFalsy();
  });

  it('match-clock thresholds: no firing while paused, exactly once across correction/resume (A25)', async () => {
    const x = await newMatch();
    await phase(x, 'first_half');
    if (!(await scoring.getMatchState(ctx, x.m.id)).clocks.main?.running) await x.send('CLOCK_ACTION', { clockId: 'main', action: 'start' });
    await automationSvc.scanClockTriggers(W()); // first observation
    T += 590_000;
    // simulate scanner ticking every second up to 9:58, then pause
    for (let i = 0; i < 3; i++) {
      T += 1000;
      await automationSvc.scanClockTriggers(W());
    }
    await x.send('CLOCK_ACTION', { clockId: 'main', action: 'pause' });
    T += 30_000;
    await automationSvc.scanClockTriggers(W());
    expect((await runs(x.ov.id)).filter((r) => r.playlistId === 'ten_min')).toHaveLength(0);
    await x.send('CLOCK_ACTION', { clockId: 'main', action: 'resume' });
    for (let i = 0; i < 12; i++) {
      T += 1000;
      await automationSvc.scanClockTriggers(W());
    }
    expect((await runs(x.ov.id)).filter((r) => r.playlistId === 'ten_min')).toHaveLength(1);
    // correction back across the threshold and forward again: no duplicate
    await x.send('CLOCK_ACTION', { clockId: 'main', action: 'set', ms: 595_000, reason: 'scorer correction' });
    for (let i = 0; i < 10; i++) {
      T += 1000;
      await automationSvc.scanClockTriggers(W());
    }
    expect((await runs(x.ov.id)).filter((r) => r.playlistId === 'ten_min')).toHaveLength(1);
  });

  it('Manual then Auto: no backlog replay; scorebug default is restored (A26)', async () => {
    const x = await newMatch();
    await phase(x, 'first_half');
    await pump();
    const m = await overlaysSvc.overlayCommand(ctx, x.ov.id, { commandId: crypto.randomUUID(), command: { type: 'SET_MODE', mode: 'manual' } as never });
    await automationSvc.onOverlayCommand(W(), A.org.id, x.ov.id, { type: 'SET_MODE', cancelAutomation: true });
    await overlaysSvc.overlayCommand(ctx, x.ov.id, { commandId: crypto.randomUUID(), command: { type: 'HIDE_SCOREBUG' } as never });
    expect(m.state.mode).toBe('manual');
    const g = await goal(x, 'home');
    const r = await automationSvc.onFactAccepted(W(), A.org.id, x.m.id, g.event.eventId);
    expect(r[0]!.skipped[0]!.reason).toMatch(/Manual mode/);
    await overlaysSvc.overlayCommand(ctx, x.ov.id, { commandId: crypto.randomUUID(), command: { type: 'SET_MODE', mode: 'auto' } as never });
    await automationSvc.onOverlayCommand(W(), A.org.id, x.ov.id, { type: 'SET_MODE' });
    await pump();
    const s = await state(x.ov.id);
    expect(s.mode).toBe('auto');
    expect(s.scorebugVisible).toBe(true);
    expect(s.layers.lower).toBeUndefined(); // the goal during Manual never replays
  });

  it('Emergency Clear inhibits automation until an explicit resume (A27)', async () => {
    const x = await newMatch();
    await phase(x, 'first_half');
    await pump();
    await overlaysSvc.overlayCommand(ctx, x.ov.id, { commandId: crypto.randomUUID(), command: { type: 'CLEAR_OUTPUT' } as never });
    await automationSvc.onOverlayCommand(W(), A.org.id, x.ov.id, { type: 'CLEAR_OUTPUT', cancelAutomation: true });
    const g = await goal(x, 'home');
    const r = await automationSvc.onFactAccepted(W(), A.org.id, x.m.id, g.event.eventId);
    expect(r[0]!.skipped[0]!.reason).toMatch(/Emergency/);
    await pump();
    let s = await state(x.ov.id);
    expect(s).toMatchObject({ inhibited: true, scorebugVisible: false, layers: {} });
    await overlaysSvc.overlayCommand(ctx, x.ov.id, { commandId: crypto.randomUUID(), command: { type: 'RESUME' } as never });
    await automationSvc.onOverlayCommand(W(), A.org.id, x.ov.id, { type: 'RESUME' });
    await pump();
    s = await state(x.ov.id);
    expect(s.inhibited).toBe(false);
    expect(s.scorebugVisible).toBe(true);
  });

  it('worker restart: expired cues do not replay and the fenced old worker cannot take (A28)', async () => {
    const x = await newMatch();
    await phase(x, 'first_half');
    await pump();
    const old = await automationSvc.acquireLease(worker.db, 'worker-a');
    const g = await goal(x, 'home');
    await automationSvc.onFactAccepted(W(), A.org.id, x.m.id, g.event.eventId);
    // worker-a dies before dispatching; lease expires; worker-b takes over much later
    await worker.db.execute(`update worker_leases set expires_at = now() - interval '1 second' where resource = 'automation'` as never);
    T += 60_000;
    const fb = await pump('worker-b');
    expect(fb.fence).toBeGreaterThan(old!.fence);
    const goalRun = (await runs(x.ov.id)).find((r) => r.playlistId === 'goal')!;
    const cues = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(automationCues).where(eq(automationCues.runId, goalRun.id)));
    expect(cues[0]).toMatchObject({ state: 'skipped', reason: 'missed its freshness deadline' });
    expect((await state(x.ov.id)).layers.lower).toBeUndefined();
    // the old owner's fenced command is refused
    await expect(
      withTenant(worker.db, { organisationId: A.org.id }, (t) => overlaysSvc.applyOverlayCommandTx({ ...ctx, db: worker.db }, t, x.ov.id, { commandId: crypto.randomUUID(), command: { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'stale' } } as never }, { source: 'automation', fence: old })),
    ).rejects.toMatchObject({ code: 'FENCED' });
    await automationSvc.releaseLease(worker.db, 'worker-b');
  });
});

describe('rehearsal isolation', () => {
  it('rehearsing at any speed writes nothing: no overlay, sponsor, stream or usage records (A29)', async () => {
    const x = await newMatch();
    const count = () => worker.db.execute(`select (select count(*) from automation_runs) a, (select count(*) from automation_cues) b, (select count(*) from overlay_commands) c, (select count(*) from sponsor_decisions) d, (select count(*) from sponsor_exposures) e, (select count(*) from usage_ledger) f, (select count(*) from outbox_events) g, (select count(*) from broadcast_sessions) h` as never).then((r) => JSON.stringify(r.rows[0]));
    const before = await count();
    const plans = await gamePlansSvc.listGamePlans(ctx);
    const g = await gamePlansSvc.getGamePlan(ctx, plans[0]!.id);
    const { simulateRehearsal, syntheticTimeline, getAdapter, gamePlanSchema } = await import('@bs/domain');
    for (const speed of [1, 2, 5, 10]) {
      const r = simulateRehearsal(gamePlanSchema.parse(g.draft), getAdapter('football').defaultConfig, syntheticTimeline('football'), { templateLayers: g.templateLayers, sponsorAvailable: () => true });
      expect(r.decisions.length).toBeGreaterThan(0);
      void speed; // playback speed only scales the client-side timeline; decisions are identical
    }
    expect(await count()).toBe(before);
    void x;
  });
});

describe('sponsor delivery', () => {
  it('ineligible placements are skipped with a reason (A30)', async () => {
    const x = await newMatch();
    const preview = await sponsorsSvc.eligibilityPreview(ctx, x.m.id);
    expect(preview.find((p) => p.placement === 'lower_third_banner')).toMatchObject({ outcome: 'selected', creativeId: sponsors.banner.id });
    const ff = preview.find((p) => p.placement === 'full_frame_image')!;
    expect(ff.outcome).not.toBe('selected');
    expect(ff.reason).toBeTruthy();
    // expire the campaign: nothing eligible anymore
    await sponsorsSvc.saveCampaign(ctx, { brandId: sponsors.brand.id, creativeSetId: sponsors.brand.creativeSetId, name: 'Season partner', startsAt: new Date(T - 3 * 86400_000).toISOString(), endsAt: new Date(T - 86400_000).toISOString(), allocations: [{ scopeType: 'organisation', placement: 'lower_third_banner' }] }, sponsors.campaign.id);
    const after = await sponsorsSvc.eligibilityPreview(ctx, x.m.id);
    expect(after.find((p) => p.placement === 'lower_third_banner')!.outcome).not.toBe('selected');
    await sponsorsSvc.saveCampaign(ctx, { brandId: sponsors.brand.id, creativeSetId: sponsors.brand.creativeSetId, name: 'Season partner', startsAt: new Date(T - 86400_000).toISOString(), endsAt: new Date(T + 30 * 86400_000).toISOString(), allocations: [{ scopeType: 'organisation', placement: 'lower_third_banner' }, { scopeType: 'organisation', placement: 'scorebug_logo' }, { scopeType: 'organisation', placement: 'detached_logo' }] }, sponsors.campaign.id);
  });

  it('only the reporting authority records exposure; disconnect closes conservatively; CSV is neutralised (A31, A32, A34)', async () => {
    const x = await newMatch();
    const urls = await overlaysSvc.overlayUrls(ctx, x.ov.id);
    const tok = (u: string) => new URL(u).searchParams.get('t')!;
    const prod = (await overlaysSvc.resolveRendererToken(deps.db, deps.config, tok(urls.production!)))!;
    const mon = (await overlaysSvc.resolveRendererToken(deps.db, deps.config, tok(urls.monitor!)))!;
    const r1 = await overlaysSvc.rendererConnected(deps.db, prod, 'copy-1');
    const r2 = await overlaysSvc.rendererConnected(deps.db, prod, 'copy-2');
    const rm = await overlaysSvc.rendererConnected(deps.db, mon, 'monitor');
    const ev = { cueId: 'cue-1', creativeId: sponsors.logo.id, placement: 'scorebug_logo', revision: 3, visible: true };
    const t0 = Date.now();
    expect(await sponsorsSvc.recordExposure(deps.db, prod, r1.id, ev, t0)).toMatchObject({ counted: true });
    expect(await sponsorsSvc.recordExposure(deps.db, prod, r2.id, ev, t0)).toMatchObject({ counted: false });
    expect(await sponsorsSvc.recordExposure(deps.db, mon, rm.id, ev, t0)).toMatchObject({ counted: false });
    await sponsorsSvc.recordExposure(deps.db, prod, r1.id, ev, t0 + 5000); // heartbeat
    await overlaysSvc.rendererDisconnected(deps.db, prod, r1.id);
    // renderer vanished: close at the last confirmation, never later
    const closed = await sponsorsSvc.closeStaleExposures(worker.db, t0 + 60_000);
    expect(closed).toBeGreaterThanOrEqual(1);
    await matchesSvc.updateMatch(ctx, x.m.id, { isDemo: false } as never).catch(() => undefined);
    const rep = await sponsorsSvc.sponsorReport(ctx, { matchId: x.m.id });
    const occ = rep.occurrences.filter((o) => o.overlayId === x.ov.id);
    expect(occ).toHaveLength(1);
    expect(occ[0]!.confirmedSeconds).toBeLessThanOrEqual(5.1);
    expect(occ[0]!.closeReason).toBe('disconnected');
    // matches and outputs are named, not shown as ids
    expect(occ[0]!.matchLabel).toBe('Harbour City FC v Ridgeback United');
    expect(rep.byMatch.find((b) => b.matchId === x.m.id)).toMatchObject({ key: 'Harbour City FC v Ridgeback United', occurrences: 1 });
    expect(rep.byOutput.find((b) => b.overlayId === x.ov.id)).toMatchObject({ key: x.ov.name, match: 'Harbour City FC v Ridgeback United', matchId: x.m.id });
    expect(rep.definitions.notIncluded).toMatch(/not measured/);
    const csv = sponsorsSvc.sponsorReportCsv(rep);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"") Coffee"`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('programme to three destinations: occurrence labelled with destination status, no audience views (A33)', async () => {
    const x = await newMatch();
    const sctx = { ...ctx, media: createFakeProvider() };
    const input = await streamsSvc.createInput(sctx, { name: 'A33 cam' });
    const prog = await streamsSvc.saveOutput(sctx, x.m.id, { mode: 'PROGRAMME', inputId: input.id });
    const ds = [];
    for (const n of ['YouTube', 'Facebook', 'Venue screen']) ds.push(await streamsSvc.addDestination(sctx, prog.id, { name: n, serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: n }));
    await worker.db.update(destinations).set({ lastStatus: { status: 'active' } }).where(eq(destinations.outputId, prog.id));
    await worker.db.update(destinations).set({ lastStatus: { status: 'failed', error: 'Connection refused' } }).where(eq(destinations.id, ds[1]!.id));
    const scope = (await overlaysSvc.resolveRendererToken(deps.db, deps.config, overlaysSvc.compositorToken(deps.config, { organisationId: A.org.id, overlayId: prog.overlayId!, matchId: x.m.id })))!;
    const comp = await overlaysSvc.rendererConnected(deps.db, scope, 'egress-1');
    expect(comp.isReportingAuthority).toBe(true);
    const t0 = Date.now();
    const ev = { cueId: 'c33', creativeId: sponsors.logo.id, placement: 'scorebug_logo', revision: 1, visible: true };
    await sponsorsSvc.recordExposure(deps.db, scope, comp.id, ev, t0);
    await sponsorsSvc.recordExposure(deps.db, scope, comp.id, ev, t0 + 4000);
    await sponsorsSvc.recordExposure(deps.db, scope, comp.id, { ...ev, visible: false }, t0 + 5000);
    const rep = await sponsorsSvc.sponsorReport(ctx, { matchId: x.m.id });
    const occ = rep.occurrences.filter((o) => o.overlayId === prog.overlayId);
    expect(occ).toHaveLength(1); // one occurrence per output, not per destination
    expect(occ[0]).toMatchObject({ evidenceType: 'compositor', confirmedSeconds: 5 });
    expect((occ[0]!.destinationStatuses as { name: string; status: string }[]).map((d) => `${d.name}:${d.status}`).sort()).toEqual(['Facebook:failed', 'Venue screen:active', 'YouTube:active']);
    expect(JSON.stringify({ totals: rep.totals, occurrences: rep.occurrences, byOutput: rep.byOutput })).not.toMatch(/impression|viewer|audience|cpm|reach/i);
    expect(sponsorsSvc.sponsorReportCsv(rep)).toContain('Facebook: failed');
  });

  it('rotates the scorebug sponsor slot into overlay state', async () => {
    const x = await newMatch();
    await phase(x, 'first_half');
    const fence = await pump();
    await automationSvc.rotateScorebugSlots(W(), fence);
    const s = await state(x.ov.id);
    expect(s.slots?.scorebug_logo).toMatchObject({ creativeId: sponsors.logo.id });
    const [o] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(automationRuns).where(and(eq(automationRuns.overlayId, x.ov.id), eq(automationRuns.playlistId, '_default_scorebug'))));
    expect(o).toBeTruthy();
  });
});
