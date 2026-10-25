// Stream links against real PostgreSQL as bs_app: one OBS link for a day of back-to-back matches at a ground. Which
// match it is on (just finished, then the next when its kick-off is close, a match put on by hand), its intermission
// link (always the intermission, with the next match's output), the stream link switching to the intermission by
// itself only when asked, the output token it hands the page, rotation, the "Matches today" data and count, and
// tenant isolation.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { matches, overlays, withTenant } from '@bs/db';
import { catalog, channelsSvc, matchesSvc, overlaysSvc, scoring, type Ctx } from '@bs/services';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
let A: Awaited<ReturnType<typeof makeOrg>>;
let B: Awaited<ReturnType<typeof makeOrg>>;

/** A fixed-offset zone where it is about midday now, so "today" has room either side whenever the test runs. */
const now = new Date();
const offset = 12 - now.getUTCHours();
const TZ = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const tokenOf = (url: string) => new URL(url).searchParams.get('t')!;
const publicIdOf = (url: string) => new URL(url).pathname.split('/').pop()!;

async function finish(ctx: Ctx, matchId: string) {
  const lease = (await scoring.scorerLease(ctx, matchId, { action: 'acquire', deviceId: 'dev-1' }))!;
  for (const to of ['first_half', 'half_time', 'second_half', 'full_time']) {
    const st = await scoring.getMatchState(ctx, matchId);
    await scoring.handleMatchCommand(ctx, matchId, { commandId: crypto.randomUUID(), expectedStateVersion: st.stateVersion, scorerLeaseVersion: lease.leaseVersion, deviceId: 'dev-1', type: 'SET_PHASE', payload: { to } });
  }
}

let ground: { id: string; name: string };
let day: { id: string }[];
let link: { id: string; url: string; intermissionUrl: string };

beforeAll(async () => {
  A = await makeOrg(deps, 'Links Club');
  B = await makeOrg(deps, 'Other Club');
  const ctx = A.ctx;
  ground = await catalog.createVenue(ctx, { name: 'Northgate Arena', timezone: TZ });
  const comp = await catalog.createCompetition(ctx, { name: 'Day League', shortName: 'DL', sport: 'football', defaultTimezone: TZ });
  const season = await catalog.createSeason(ctx, comp.id, { name: '2026' });
  const t = await Promise.all(['Harbour', 'Ridge', 'Bayside', 'Metro', 'Coast', 'Valley'].map((n, i) => catalog.createTeam(ctx, { name: `${n} FC`, shortName: n, abbreviation: `${n.slice(0, 2).toUpperCase()}${i}`, sport: 'football' })));
  const at = (time: string, h: number, a: number) => matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: t[h]!.id, awayTeamId: t[a]!.id, venueId: ground.id, kickoffLocal: `${today} ${time}`, timezone: TZ });
  day = [await at('09:00', 0, 1), await at('13:30', 2, 3), await at('16:00', 4, 5)];
  // another ground's match today, not on the link
  await matchesSvc.createMatch(ctx, { competitionId: comp.id, seasonId: season.id, homeTeamId: t[0]!.id, awayTeamId: t[3]!.id, kickoffLocal: `${today} 13:30`, timezone: TZ });
  await finish(ctx, day[0]!.id);
  link = await channelsSvc.createChannel(ctx, { name: 'Northgate stream', venueId: ground.id });
});
afterAll(async () => deps.close());

describe('stream links', () => {
  it('between matches: the match just finished, then the next one when its kick-off is close', async () => {
    const scope = (await channelsSvc.resolveChannelToken(deps.db, tokenOf(link.url)))!;
    expect(scope).toMatchObject({ organisationId: A.org.id, channelId: link.id });
    const cur = (await channelsSvc.channelCurrent(deps.db, deps.config, scope, publicIdOf(link.url)))!;
    expect(cur).toMatchObject({ matchId: day[0]!.id, reason: 'just_finished' });
    // the page gets the production token of that match's own output: it resolves to that output
    const [main] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, day[0]!.id)));
    const r = await overlaysSvc.resolveRendererToken(deps.db, deps.config, cur.overlay!.token);
    expect(r).toMatchObject({ overlayId: main!.id, purpose: 'production', matchId: day[0]!.id });
    expect(cur.overlay!.publicId).toBe(main!.publicId);

    // two hours before kick-off counts as close: the next match comes on
    await channelsSvc.updateChannel(A.ctx, link.id, { switchBeforeMinutes: 120 });
    expect(await channelsSvc.channelCurrent(deps.db, deps.config, scope, publicIdOf(link.url))).toMatchObject({ matchId: day[1]!.id, reason: 'next' });
    await channelsSvc.updateChannel(A.ctx, link.id, { switchBeforeMinutes: 10 });
  });

  it('the intermission link: always the intermission, drawn with the next match’s output; the stream link stays on the thank-you', async () => {
    expect(link.intermissionUrl).toBe(link.url.replace('?t=', '/intermission?t='));
    const scope = (await channelsSvc.resolveChannelToken(deps.db, tokenOf(link.intermissionUrl)))!;
    const im = (await channelsSvc.channelCurrent(deps.db, deps.config, scope, publicIdOf(link.url), { intermission: true }))!;
    expect(im).toMatchObject({ matchId: day[1]!.id, reason: 'pinned_intermission', screen: 'intermission' });
    const [next] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, day[1]!.id)));
    expect(im.overlay!.publicId).toBe(next!.publicId);
    // the stream link itself does not switch unless asked to
    expect(await channelsSvc.channelCurrent(deps.db, deps.config, scope, publicIdOf(link.url))).toMatchObject({ matchId: day[0]!.id, reason: 'just_finished', screen: 'match' });
  });

  it('asked to, the stream link switches to the intermission after full time; or by hand until back to automatic', async () => {
    const scope = (await channelsSvc.resolveChannelToken(deps.db, tokenOf(link.url)))!;
    await channelsSvc.updateChannel(A.ctx, link.id, { intermissionAfterMinutes: 0 });
    expect(await channelsSvc.channelCurrent(deps.db, deps.config, scope, publicIdOf(link.url))).toMatchObject({ matchId: day[1]!.id, reason: 'intermission', screen: 'intermission' });
    expect((await channelsSvc.matchStreamLink(A.ctx, day[1]!.id)).link).toMatchObject({ onNow: false, intermission: true });
    await channelsSvc.updateChannel(A.ctx, link.id, { intermissionAfterMinutes: null });
    await channelsSvc.pinChannel(A.ctx, link.id, 'intermission');
    expect(await channelsSvc.channelCurrent(deps.db, deps.config, scope, publicIdOf(link.url))).toMatchObject({ matchId: day[1]!.id, reason: 'pinned_intermission', screen: 'intermission' });
    expect((await channelsSvc.listChannels(A.ctx))[0]).toMatchObject({ pinnedIntermission: true, pinnedMatchId: null, intermissionAfterMinutes: null });
    await channelsSvc.pinChannel(A.ctx, link.id, null);
    expect(await channelsSvc.channelCurrent(deps.db, deps.config, scope, publicIdOf(link.url))).toMatchObject({ reason: 'just_finished', screen: 'match' });
  });

  it('lists today in order with the one on now, and OBS counts as connected once the page has asked', async () => {
    const [l] = await channelsSvc.listChannels(A.ctx);
    expect(l!.matches.map((m) => m.id)).toEqual(day.map((m) => m.id));
    expect(l!.current).toEqual({ id: day[0]!.id, reason: 'just_finished' });
    expect(l!.matches[0]).toMatchObject({ status: 'completed', home: 'Harbour FC', away: 'Ridge FC' });
    expect(l!.connected).toBe(true);
    expect(JSON.stringify(l)).not.toContain(tokenOf(link.url)); // the list never carries the links
    const ms = await channelsSvc.matchStreamLink(A.ctx, day[2]!.id);
    expect(ms.link).toMatchObject({ id: link.id, name: 'Northgate stream', today: true, onNow: false, connected: true });
  });

  it('a match put on by hand stays on until back to automatic', async () => {
    const scope = (await channelsSvc.resolveChannelToken(deps.db, tokenOf(link.url)))!;
    await channelsSvc.pinChannel(A.ctx, link.id, day[2]!.id);
    expect(await channelsSvc.channelCurrent(deps.db, deps.config, scope, publicIdOf(link.url))).toMatchObject({ matchId: day[2]!.id, reason: 'pinned' });
    await channelsSvc.pinChannel(A.ctx, link.id, null);
    expect(await channelsSvc.channelCurrent(deps.db, deps.config, scope, publicIdOf(link.url))).toMatchObject({ matchId: day[0]!.id, reason: 'just_finished' });
  });

  it("the matches today board and count: the link's day at its ground, this match highlighted", async () => {
    const [ov] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(overlays).where(eq(overlays.matchId, day[1]!.id)));
    const snap = await overlaysSvc.rendererSnapshot(deps.db, deps.config, { organisationId: A.org.id, overlayId: ov!.id, matchId: day[1]!.id, purpose: 'production', tokenVersion: 1 });
    expect(snap.data.today!.title).toBe('TODAY AT NORTHGATE ARENA');
    expect(snap.data.today!.rows.map((r) => r.id)).toEqual(day.map((m) => m.id));
    expect(snap.data.today!.rows[0]).toMatchObject({ status: 'completed', score: { home: 0, away: 0 }, current: false, competition: 'DL' });
    expect(snap.data.today!.rows[1]).toMatchObject({ status: 'scheduled', score: null, current: true });
    const n = await withTenant(deps.db, { organisationId: A.org.id }, async (t) => {
      const [m] = await t.select().from(matches).where(eq(matches.id, day[1]!.id));
      return channelsSvc.matchesTodayCountTx(t, A.org.id, m!);
    });
    expect(n).toBe(3);
  });

  it('a new OBS link stops the old one at once', async () => {
    const old = tokenOf(link.url);
    const { url, intermissionUrl } = await channelsSvc.rotateChannel(A.ctx, link.id);
    expect(await channelsSvc.resolveChannelToken(deps.db, old)).toBeNull();
    expect(await channelsSvc.resolveChannelToken(deps.db, tokenOf(url))).toMatchObject({ channelId: link.id });
    expect(await channelsSvc.channelLink(A.ctx, link.id)).toMatchObject({ url, intermissionUrl });
    link = { ...link, url, intermissionUrl };
  });

  it("another organisation sees nothing of it and cannot use its ground", async () => {
    expect(await channelsSvc.listChannels(B.ctx)).toEqual([]);
    await expect(channelsSvc.channelLink(B.ctx, link.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(channelsSvc.pinChannel(B.ctx, link.id, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(channelsSvc.createChannel(B.ctx, { name: 'Sneaky', venueId: ground.id })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // a token is only good with its own link's page
    const scope = (await channelsSvc.resolveChannelToken(deps.db, tokenOf(link.url)))!;
    expect(await channelsSvc.channelCurrent(deps.db, deps.config, scope, 'sl_someoneelse')).toBeNull();
  });

  it('removed: the link no longer resolves', async () => {
    await channelsSvc.deleteChannel(A.ctx, link.id);
    expect(await channelsSvc.resolveChannelToken(deps.db, tokenOf(link.url))).toBeNull();
  });
});
