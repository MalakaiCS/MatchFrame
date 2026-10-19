import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog, matchesSvc, overlaysSvc, scoring, themesSvc, type Ctx } from '@bs/services';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
let A: Awaited<ReturnType<typeof makeOrg>>;
let B: Awaited<ReturnType<typeof makeOrg>>;
let matchId: string;
let competitionId: string;

async function setup(ctx: Ctx) {
  const comp = await catalog.createCompetition(ctx, { name: 'Graphics League', sport: 'football', defaultTimezone: 'Australia/Brisbane' });
  const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
  const h = await catalog.createTeam(ctx, { name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', sport: 'football' });
  const a = await catalog.createTeam(ctx, { name: 'Ridgeback United', shortName: 'Ridge', abbreviation: 'RBU', sport: 'football' });
  const m = await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-11-07 15:00', timezone: 'Australia/Brisbane' });
  return { comp, m };
}
const cmd = (ctx: Ctx, overlayId: string, command: Record<string, unknown>, commandId = crypto.randomUUID()) => overlaysSvc.overlayCommand(ctx, overlayId, { commandId, command: command as never });

beforeAll(async () => {
  A = await makeOrg(deps, 'Graphics A');
  B = await makeOrg(deps, 'Graphics B');
  const s = await setup(A.ctx);
  matchId = s.m.id;
  competitionId = s.comp.id;
  await themesSvc.createProfile(A.ctx, { name: 'League look', themeKey: 'broadcast', competitionId, publish: true });
});
afterAll(async () => deps.close());

describe('overlays', () => {
  it('runs independent overlays on one match with shared match data (A19)', async () => {
    const o1 = await overlaysSvc.createOverlay(A.ctx, matchId, { name: 'Main' });
    const o2 = await overlaysSvc.createOverlay(A.ctx, matchId, { name: 'Venue screen' });
    await cmd(A.ctx, o1.id, { type: 'SHOW_SCOREBUG' });
    await cmd(A.ctx, o2.id, { type: 'SET_MODE', mode: 'manual' });
    await cmd(A.ctx, o2.id, { type: 'TAKE_IN', templateKey: 'builtin:lower_third', variables: { heading: 'Welcome to Bayside Oval' } });
    const s1 = await overlaysSvc.getOverlay(A.ctx, o1.id);
    const s2 = await overlaysSvc.getOverlay(A.ctx, o2.id);
    expect(s1.state).toMatchObject({ mode: 'auto', scorebugVisible: true });
    expect(Object.keys(s1.state.layers)).toEqual(['scoreboard']);
    expect(s2.state).toMatchObject({ mode: 'manual', scorebugVisible: false });
    expect(Object.keys(s2.state.layers)).toEqual(['lower']);
    // shared match data: a goal is visible to both snapshots
    const l = await scoring.scorerLease(A.ctx, matchId, { action: 'acquire', deviceId: 'dev-ovl' });
    let st = await scoring.getMatchState(A.ctx, matchId);
    await scoring.handleMatchCommand(A.ctx, matchId, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: l!.leaseVersion, deviceId: 'dev-ovl', type: 'SET_PHASE', payload: { to: 'first_half' } });
    st = await scoring.getMatchState(A.ctx, matchId);
    await scoring.handleMatchCommand(A.ctx, matchId, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: l!.leaseVersion, deviceId: 'dev-ovl', type: 'ADD_FACT', payload: { type: 'goal', side: 'home', occurredAt: Date.now(), payload: {} } });
    const urls1 = await overlaysSvc.overlayUrls(A.ctx, o1.id);
    const urls2 = await overlaysSvc.overlayUrls(A.ctx, o2.id);
    const tok = (u: string) => new URL(u).searchParams.get('t')!;
    const sc1 = await overlaysSvc.resolveRendererToken(deps.db, deps.config, tok(urls1.production!));
    const sc2 = await overlaysSvc.resolveRendererToken(deps.db, deps.config, tok(urls2.production!));
    const snap1 = await overlaysSvc.rendererSnapshot(deps.db, deps.config, sc1!);
    const snap2 = await overlaysSvc.rendererSnapshot(deps.db, deps.config, sc2!);
    expect(snap1.data.match.projection.score.home).toBe(1);
    expect(snap2.data.match.projection.score.home).toBe(1);
    expect(snap1.state.layers.scoreboard).toBeTruthy();
    expect(snap2.state.layers.scoreboard).toBeUndefined();
  });

  it('is idempotent per command id and rejects id reuse for a different command', async () => {
    const o = await overlaysSvc.createOverlay(A.ctx, matchId, { name: 'Idem' });
    const id = crypto.randomUUID();
    const r1 = await cmd(A.ctx, o.id, { type: 'SHOW_SCOREBUG' }, id);
    const r2 = await cmd(A.ctx, o.id, { type: 'SHOW_SCOREBUG' }, id);
    expect(r2.replayed).toBe(true);
    expect(r2.revision).toBe(r1.revision);
    await expect(cmd(A.ctx, o.id, { type: 'HIDE_SCOREBUG' }, id)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('rotating a production URL revokes the old capability (A17) and scopes the new one to its output', async () => {
    const o = await overlaysSvc.createOverlay(A.ctx, matchId, { name: 'Rotate me' });
    const other = await overlaysSvc.createOverlay(A.ctx, matchId, { name: 'Other' });
    const before = await overlaysSvc.overlayUrls(A.ctx, o.id);
    const oldTok = new URL(before.production!).searchParams.get('t')!;
    expect(await overlaysSvc.resolveRendererToken(deps.db, deps.config, oldTok)).toMatchObject({ overlayId: o.id, purpose: 'production' });
    await overlaysSvc.rotateOverlayCredential(A.ctx, o.id, 'production');
    expect(await overlaysSvc.resolveRendererToken(deps.db, deps.config, oldTok)).toBeNull();
    const after = await overlaysSvc.overlayUrls(A.ctx, o.id);
    const newTok = new URL(after.production!).searchParams.get('t')!;
    expect(newTok).not.toBe(oldTok);
    const scope = await overlaysSvc.resolveRendererToken(deps.db, deps.config, newTok);
    expect(scope).toMatchObject({ overlayId: o.id, organisationId: A.org.id });
    expect(scope!.overlayId).not.toBe(other.id);
    // monitor URL unaffected by production rotation
    expect(await overlaysSvc.resolveRendererToken(deps.db, deps.config, new URL(before.monitor!).searchParams.get('t')!)).toMatchObject({ purpose: 'monitor' });
    // garbage and cross-shaped tokens are rejected
    expect(await overlaysSvc.resolveRendererToken(deps.db, deps.config, 'x'.repeat(43))).toBeNull();
    expect(await overlaysSvc.resolveRendererToken(deps.db, deps.config, 'abc.def')).toBeNull();
  });

  it('pins theme versions; publishing never changes a live overlay until an explicit apply (A22)', async () => {
    const o = await overlaysSvc.createOverlay(A.ctx, matchId, { name: 'Pinned' });
    const profiles = await themesSvc.listProfiles(A.ctx);
    const prof = profiles.find((p) => p.name === 'League look')!;
    const urls = await overlaysSvc.overlayUrls(A.ctx, o.id);
    const scope = (await overlaysSvc.resolveRendererToken(deps.db, deps.config, new URL(urls.production!).searchParams.get('t')!))!;
    const before = await overlaysSvc.rendererSnapshot(deps.db, deps.config, scope);
    // a draft edit does not leak
    await themesSvc.updateProfileDraft(A.ctx, prof.id, { config: { primary: '#FF00AA' } });
    expect((await overlaysSvc.rendererSnapshot(deps.db, deps.config, scope)).data.theme.primary).toBe(before.data.theme.primary);
    // publishing flags the overlay but keeps it pinned
    await themesSvc.publishProfile(A.ctx, prof.id);
    const pending = (await overlaysSvc.listOverlays(A.ctx, matchId)).find((x) => x.id === o.id)!;
    expect(pending.pendingTheme).toBeTruthy();
    expect((await overlaysSvc.rendererSnapshot(deps.db, deps.config, scope)).data.theme.primary).toBe(before.data.theme.primary);
    await overlaysSvc.applyPendingTheme(A.ctx, o.id);
    expect((await overlaysSvc.rendererSnapshot(deps.db, deps.config, scope)).data.theme.primary).toBe('#FF00AA');
  });

  it('records displayed revisions only from production renderers and keeps tenants apart', async () => {
    const o = await overlaysSvc.createOverlay(A.ctx, matchId, { name: 'Ack' });
    await cmd(A.ctx, o.id, { type: 'SHOW_SCOREBUG' });
    const urls = await overlaysSvc.overlayUrls(A.ctx, o.id);
    const prod = (await overlaysSvc.resolveRendererToken(deps.db, deps.config, new URL(urls.production!).searchParams.get('t')!))!;
    const mon = (await overlaysSvc.resolveRendererToken(deps.db, deps.config, new URL(urls.monitor!).searchParams.get('t')!))!;
    const rm = await overlaysSvc.rendererConnected(deps.db, mon, 'monitor-1');
    await overlaysSvc.rendererDisplayed(deps.db, mon, rm.id, 1);
    expect((await overlaysSvc.getOverlay(A.ctx, o.id)).displayedRevision).toBe(0);
    const rp = await overlaysSvc.rendererConnected(deps.db, prod, 'obs-1');
    expect(rp.isReportingAuthority).toBe(true);
    const rp2 = await overlaysSvc.rendererConnected(deps.db, prod, 'obs-2');
    expect(rp2.isReportingAuthority).toBe(false); // a second browser-source copy cannot become a second authority
    await overlaysSvc.rendererDisplayed(deps.db, prod, rp.id, 1);
    expect((await overlaysSvc.getOverlay(A.ctx, o.id)).displayedRevision).toBe(1);
    // the other tenant cannot read, command or reveal URLs for this overlay
    await expect(overlaysSvc.getOverlay(B.ctx, o.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(cmd(B.ctx, o.id, { type: 'CLEAR_OUTPUT' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(overlaysSvc.overlayUrls(B.ctx, o.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a production snapshot exposes only public display data (no roster directory, no private fields)', async () => {
    const o = await overlaysSvc.createOverlay(A.ctx, matchId, { name: 'Public' });
    const urls = await overlaysSvc.overlayUrls(A.ctx, o.id);
    const scope = (await overlaysSvc.resolveRendererToken(deps.db, deps.config, new URL(urls.production!).searchParams.get('t')!))!;
    const snap = await overlaysSvc.rendererSnapshot(deps.db, deps.config, scope);
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/dateOfBirth|email|password|stream_key|streamKey/i);
    expect(Object.keys(snap)).toEqual(['overlay', 'state', 'data', 'serverNow']);
  });
});
