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

  it('a tournament look and a match look, from any of the built-in looks; upcoming matches follow the tournament unless they have their own', async () => {
    const ctx = A.ctx;
    const comp = await catalog.createCompetition(ctx, { name: 'Look League', sport: 'football', defaultTimezone: 'Australia/Brisbane' });
    const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
    const h = await catalog.createTeam(ctx, { name: 'Northgate Rovers', shortName: 'Northgate', abbreviation: 'NGR', sport: 'football' });
    const a = await catalog.createTeam(ctx, { name: 'Southbank City', shortName: 'Southbank', abbreviation: 'SBC', sport: 'football' });
    const fixture = (day: string) => matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: `2026-12-${day} 15:00`, timezone: 'Australia/Brisbane' });
    const [m1, m2] = [await fixture('05'), await fixture('12')];
    const look = async (id: string) => (await overlaysSvc.listOverlays(ctx, id))[0]!.theme?.profile ?? null;
    const themeKey = async (id: string) => {
      const o = (await overlaysSvc.listOverlays(ctx, id))[0]!;
      return (await overlaysSvc.rendererSnapshot(deps.db, deps.config, { organisationId: A.org.id, overlayId: o.id, matchId: id, purpose: 'monitor', tokenVersion: 0 })).data.theme.themeKey;
    };

    // the tournament takes a built-in look: it is saved as the organisation's "Liga" and both upcoming matches show it
    expect(await overlaysSvc.setCompetitionLook(ctx, comp.id, { themeKey: 'liga' })).toMatchObject({ outputs: 2 });
    expect([await look(m1.id), await look(m2.id)]).toEqual(['Liga', 'Liga']);
    expect(await themeKey(m1.id)).toBe('liga');
    // one match gets a look of its own
    expect(await overlaysSvc.setMatchLook(ctx, m2.id, { themeKey: 'premier' })).toMatchObject({ outputs: 1 });
    expect(await themeKey(m2.id)).toBe('premier');
    // the tournament changes: the match that followed it changes too, the one with its own look keeps it, new fixtures start with it
    await overlaysSvc.setCompetitionLook(ctx, comp.id, { themeKey: 'meister' });
    expect([await look(m1.id), await look(m2.id)]).toEqual(['Meister', 'Premier']);
    const m3 = await fixture('19');
    expect(await look(m3.id)).toBe('Meister');
    // "same as the tournament" puts the match back on it
    await overlaysSvc.setMatchLook(ctx, m2.id, { follow: 'competition' });
    expect(await look(m2.id)).toBe('Meister');
    // a match under way keeps the look it started with
    const l = await scoring.scorerLease(ctx, m1.id, { action: 'acquire', deviceId: 'dev-look' });
    const st = await scoring.getMatchState(ctx, m1.id);
    await scoring.handleMatchCommand(ctx, m1.id, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: l!.leaseVersion, deviceId: 'dev-look', type: 'SET_PHASE', payload: { to: 'first_half' } });
    await overlaysSvc.setCompetitionLook(ctx, comp.id, { themeKey: 'liga' });
    expect([await look(m1.id), await look(m2.id), await look(m3.id)]).toEqual(['Meister', 'Liga', 'Liga']);
    // choosing a built-in look again reuses the look saved the first time
    const liga = (await themesSvc.listProfiles(ctx)).filter((p) => p.name === 'Liga');
    expect(liga).toHaveLength(1);
    // another organisation can neither see this match nor use this organisation's look on its own
    await expect(overlaysSvc.setMatchLook(B.ctx, m1.id, { themeKey: 'liga' })).rejects.toThrow(/not found/i);
    const other = await setup(B.ctx);
    await expect(overlaysSvc.setMatchLook(B.ctx, other.m.id, { themeProfileId: liga[0]!.id })).rejects.toThrow(/not found/i);
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
