// Stream links: one OBS link for a day of back-to-back matches at one place (a ground, a competition, or both). The
// OBS page asks every few seconds which match is on (pickCurrentMatch in the domain) and shows that match's own
// graphics output, so its automation, the desk and the reports work exactly as for a single match. Each link also has
// an intermission link, for an OBS scene of its own to transition to between matches: it always shows the
// intermission screen (the next match and today's matches, drawn with the next match's output in its look), and the
// stream link itself can switch to it after full time if asked to. Also here: what
// "today in the same place" is for a match (the stream link it is on, else its ground, else its competition), which
// the "Matches today" board and the full-time automation use.
import crypto from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { competitions, matchState, matches, organisations, overlayCredentials, overlays, streamChannels, teams, venues, withTenant, type Db, type Tx } from '@bs/db';
import { getAdapter, isIntermission, localDayBounds, pickCurrentMatch, type CurrentReason, type MatchProjection, type Sport } from '@bs/domain';
import type { RenderToday } from '@bs/graphics';
import type { AppConfig } from '@bs/config';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { hmac, publicId, sha256 } from './crypto';
import { invalid, notFound } from './errors';
import { tx, type Ctx } from './context';
import { overlayToken } from './overlays';

/** a match still "live" with nothing recorded for this long was forgotten, not under way */
const STALE_MS = 3 * 3600_000;
/** an OBS page that asked within this long counts as connected */
const CONNECTED_MS = 30_000;

export const channelInput = z.object({
  name: z.string().trim().min(1).max(60),
  venueId: z.string().uuid().nullable().optional(),
  competitionId: z.string().uuid().nullable().optional(),
  switchBeforeMinutes: z.number().int().min(0).max(120).optional(),
  /** the intermission screen this many minutes after a match finishes (null: none, the finished match stays on) */
  intermissionAfterMinutes: z.number().int().min(0).max(60).nullable().optional(),
});

/** Capability token: HMAC over (link, version), re-derivable for an authorised reveal; rotation bumps the version. */
export function channelToken(secret: string, channelId: string, version: number) {
  return hmac(secret, `stream-link:${channelId}:${version}`).slice(0, 43);
}

export function channelUrl(cfg: AppConfig, publicIdStr: string, token: string) {
  return `${cfg.PUBLIC_WEB_URL}/channel/${publicIdStr}?t=${token}`;
}

/** The stream link and its intermission link (same capability: both only draw the day's graphics). */
export function channelUrls(cfg: AppConfig, publicIdStr: string, token: string) {
  return { url: channelUrl(cfg, publicIdStr, token), intermissionUrl: `${cfg.PUBLIC_WEB_URL}/channel/${publicIdStr}/intermission?t=${token}` };
}

interface Scope {
  venueId: string | null;
  competitionId: string | null;
}

/** Matches of a day in a scope, earliest kick-off first, with their state (demo matches only when asked). */
async function dayMatchesTx(t: Tx, organisationId: string, scope: Scope, day: { from: Date; to: Date }, includeDemo: boolean) {
  const conds = [eq(matches.organisationId, organisationId), gte(matches.scheduledAt, day.from), lt(matches.scheduledAt, day.to), ne(matches.status, 'archived')];
  if (scope.venueId) conds.push(eq(matches.venueId, scope.venueId));
  if (scope.competitionId) conds.push(eq(matches.competitionId, scope.competitionId));
  if (!includeDemo) conds.push(eq(matches.isDemo, false));
  return t
    .select({ m: matches, phase: matchState.phase, projection: matchState.projection, clocks: matchState.clocks, stateUpdatedAt: matchState.updatedAt })
    .from(matches)
    .innerJoin(matchState, and(eq(matchState.matchId, matches.id), eq(matchState.organisationId, matches.organisationId)))
    .where(and(...conds))
    .orderBy(asc(matches.scheduledAt))
    .limit(60);
}
type DayRow = Awaited<ReturnType<typeof dayMatchesTx>>[number];

/** Where "today" is for a match: the stream link it is on (the oldest that takes it), else its ground, else its competition. */
async function todayScopeTx(t: Tx, organisationId: string, m: { venueId: string | null; competitionId: string }) {
  const links = await t
    .select({ c: streamChannels, venue: venues.name })
    .from(streamChannels)
    .leftJoin(venues, and(eq(venues.id, streamChannels.venueId), eq(venues.organisationId, streamChannels.organisationId)))
    .where(eq(streamChannels.organisationId, organisationId))
    .orderBy(asc(streamChannels.createdAt));
  const link = links.find((l) => (!l.c.venueId || l.c.venueId === m.venueId) && (!l.c.competitionId || l.c.competitionId === m.competitionId));
  const [comp] = await t.select({ name: competitions.name, shortName: competitions.shortName }).from(competitions).where(and(eq(competitions.id, m.competitionId), eq(competitions.organisationId, organisationId)));
  const compName = comp?.shortName ?? comp?.name ?? '';
  if (link) {
    const title = link.venue ? `TODAY AT ${link.venue}` : link.c.competitionId ? `TODAY · ${compName}` : "TODAY'S MATCHES";
    return { scope: { venueId: link.c.venueId, competitionId: link.c.competitionId }, title: title.toUpperCase(), channelId: link.c.id };
  }
  if (m.venueId) {
    const [v] = await t.select({ name: venues.name }).from(venues).where(and(eq(venues.id, m.venueId), eq(venues.organisationId, organisationId)));
    return { scope: { venueId: m.venueId, competitionId: null }, title: `TODAY AT ${v?.name ?? 'THE GROUND'}`.toUpperCase(), channelId: null };
  }
  return { scope: { venueId: null, competitionId: m.competitionId }, title: `TODAY · ${compName}`.toUpperCase(), channelId: null };
}

type MatchRow = typeof matches.$inferSelect;

/** How many matches are on this match's day in the same place, this one included (the "matches today" condition). */
export async function matchesTodayCountTx(t: Tx, organisationId: string, m: MatchRow) {
  const { scope } = await todayScopeTx(t, organisationId, m);
  return (await dayMatchesTx(t, organisationId, scope, localDayBounds(m.scheduledAt, m.timezone), m.isDemo)).length;
}

const PRE = ['scheduled', 'ready', 'pre_match', 'players_entering', 'about_to_start'];

/**
 * Today's matches in the same place for a match's "Matches today" board, unsigned: the caller signs the team logos
 * it lists (`logoAssetIds`) with the rest of the output's assets, then `finish` gives the board.
 */
export async function renderTodayTx(t: Tx, organisationId: string, m: MatchRow) {
  const { scope, title } = await todayScopeTx(t, organisationId, m);
  const rows = await dayMatchesTx(t, organisationId, scope, localDayBounds(m.scheduledAt, m.timezone), m.isDemo);
  const teamIds = [...new Set(rows.flatMap((r) => [r.m.homeTeamId, r.m.awayTeamId]))];
  const ts = teamIds.length ? await t.select().from(teams).where(and(eq(teams.organisationId, organisationId), inArray(teams.id, teamIds))) : [];
  const compIds = [...new Set(rows.map((r) => r.m.competitionId))];
  const comps = compIds.length ? await t.select({ id: competitions.id, name: competitions.name, shortName: competitions.shortName }).from(competitions).where(and(eq(competitions.organisationId, organisationId), inArray(competitions.id, compIds))) : [];
  const logoAssetIds = ts.map((x) => x.logoAssetId).filter((x): x is string => !!x);
  const finish = (url: (id: string | null | undefined) => string | null): RenderToday => {
    const ref = (id: string) => {
      const x = ts.find((y) => y.id === id);
      return x ? { id, name: x.name, shortName: x.shortName, abbreviation: x.abbreviation, primaryColor: x.primaryColor, logoUrl: url(x.logoAssetId) } : { id, name: 'Unknown', shortName: '?', abbreviation: '???', primaryColor: '#888888', logoUrl: null };
    };
    return {
      title,
      rows: rows.map((r: DayRow) => {
        const adapter = getAdapter(r.m.sport as Sport);
        const proj = r.projection as unknown as MatchProjection;
        const started = r.m.status === 'live' || r.m.status === 'completed' || !PRE.includes(r.phase);
        const live = r.m.status === 'live';
        const comp = comps.find((c) => c.id === r.m.competitionId);
        return {
          id: r.m.id,
          round: r.m.round,
          scheduledAt: r.m.scheduledAt.toISOString(),
          status: r.m.status,
          live,
          home: ref(r.m.homeTeamId),
          away: ref(r.m.awayTeamId),
          score: started ? { ...proj.score } : null,
          scoreDetail: started ? adapter.display(r.m.rulesConfig as never, proj, r.clocks as never, Date.now()).scoreDetail ?? null : null,
          competition: comp?.shortName ?? comp?.name ?? '',
          phaseLabel: live ? adapter.phase(r.m.rulesConfig as never, r.phase)?.label ?? null : null,
          current: r.m.id === m.id,
        };
      }),
    };
  };
  return { logoAssetIds, finish };
}

// ---------------------------------------------------------------- which match a link is on

/** A link's day: today at its ground (in the ground's zone), else in the organisation's zone. */
async function linkDayTx(t: Tx, c: typeof streamChannels.$inferSelect, now: number) {
  const [v] = c.venueId ? await t.select({ timezone: venues.timezone }).from(venues).where(and(eq(venues.id, c.venueId), eq(venues.organisationId, c.organisationId))) : [];
  const [o] = await t.select({ timezone: organisations.timezone }).from(organisations).where(eq(organisations.id, c.organisationId));
  return localDayBounds(now, v?.timezone ?? o?.timezone ?? 'UTC');
}

/** Each match's graphics output: the first one made with it (the one its checklist and OBS link use). */
async function mainOutputsTx(t: Tx, organisationId: string, matchIds: string[]) {
  if (!matchIds.length) return new Map<string, typeof overlays.$inferSelect>();
  const rows = await t.select().from(overlays).where(and(eq(overlays.organisationId, organisationId), inArray(overlays.matchId, matchIds), eq(overlays.kind, 'graphics'))).orderBy(asc(overlays.createdAt));
  const out = new Map<string, typeof overlays.$inferSelect>();
  for (const o of rows) if (!out.has(o.matchId)) out.set(o.matchId, o);
  return out;
}

async function scheduleTx(t: Tx, c: typeof streamChannels.$inferSelect, now: number, o: { intermission?: boolean } = {}) {
  const rows = await dayMatchesTx(t, c.organisationId, { venueId: c.venueId, competitionId: c.competitionId }, await linkDayTx(t, c, now), false);
  const outputs = await mainOutputsTx(t, c.organisationId, rows.map((r) => r.m.id));
  const current = pickCurrentMatch(
    rows.map((r) => ({ id: r.m.id, scheduledAt: r.m.scheduledAt.getTime(), status: r.m.status, phase: r.phase, stateUpdatedAt: r.stateUpdatedAt.getTime(), hasOutput: outputs.has(r.m.id) })),
    { now, pinnedId: c.pinnedMatchId, pinnedIntermission: c.pinnedIntermission || !!o.intermission, switchBeforeMs: c.switchBeforeMinutes * 60_000, staleMs: STALE_MS, intermissionAfterMs: c.intermissionAfterMinutes == null ? null : c.intermissionAfterMinutes * 60_000 },
  );
  return { rows, outputs, current };
}

// ---------------------------------------------------------------- managing links (signed-in)

async function loadChannel(ctx: Ctx, t: Tx, id: string) {
  const [c] = await t.select().from(streamChannels).where(and(eq(streamChannels.id, id), eq(streamChannels.organisationId, ctx.actor.organisationId)));
  if (!c) throw notFound('Stream link');
  return c;
}

/** Every stream link with today's order: which match is on and why, and whether OBS has it open. */
export async function listChannels(ctx: Ctx) {
  assertCan(ctx.actor, 'competition.read');
  return tx(ctx, async (t) => {
    const links = await t
      .select({ c: streamChannels, venue: venues.name, competition: competitions.name })
      .from(streamChannels)
      .leftJoin(venues, and(eq(venues.id, streamChannels.venueId), eq(venues.organisationId, streamChannels.organisationId)))
      .leftJoin(competitions, and(eq(competitions.id, streamChannels.competitionId), eq(competitions.organisationId, streamChannels.organisationId)))
      .where(eq(streamChannels.organisationId, ctx.actor.organisationId))
      .orderBy(asc(streamChannels.createdAt));
    const now = Date.now();
    const out = [];
    for (const l of links) {
      const { rows, outputs, current } = await scheduleTx(t, l.c, now);
      const teamIds = [...new Set(rows.flatMap((r) => [r.m.homeTeamId, r.m.awayTeamId]))];
      const ts = teamIds.length ? await t.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.organisationId, ctx.actor.organisationId), inArray(teams.id, teamIds))) : [];
      const name = (id: string) => ts.find((x) => x.id === id)?.name ?? 'Unknown';
      out.push({
        id: l.c.id,
        name: l.c.name,
        venue: l.venue ? { id: l.c.venueId!, name: l.venue } : null,
        competition: l.competition ? { id: l.c.competitionId!, name: l.competition } : null,
        switchBeforeMinutes: l.c.switchBeforeMinutes,
        intermissionAfterMinutes: l.c.intermissionAfterMinutes,
        pinnedMatchId: l.c.pinnedMatchId,
        pinnedIntermission: l.c.pinnedIntermission,
        connected: !!l.c.lastSeenAt && now - l.c.lastSeenAt.getTime() < CONNECTED_MS,
        lastSeenAt: l.c.lastSeenAt,
        current,
        matches: rows.map((r) => {
          const proj = r.projection as unknown as MatchProjection;
          const adapter = getAdapter(r.m.sport as Sport);
          return {
            id: r.m.id,
            home: name(r.m.homeTeamId),
            away: name(r.m.awayTeamId),
            scheduledAt: r.m.scheduledAt,
            status: r.m.status,
            phase: adapter.phase(r.m.rulesConfig as never, r.phase)?.label ?? r.phase,
            score: r.m.status === 'live' || r.m.status === 'completed' ? proj.score : null,
            hasOutput: outputs.has(r.m.id),
          };
        }),
      });
    }
    return out;
  });
}

async function checkScope(t: Tx, organisationId: string, d: { venueId?: string | null; competitionId?: string | null }) {
  if (d.venueId) {
    const [v] = await t.select({ id: venues.id }).from(venues).where(and(eq(venues.id, d.venueId), eq(venues.organisationId, organisationId)));
    if (!v) throw invalid('Unknown ground', [{ field: 'venueId', message: 'Choose one of your grounds' }]);
  }
  if (d.competitionId) {
    const [c] = await t.select({ id: competitions.id }).from(competitions).where(and(eq(competitions.id, d.competitionId), eq(competitions.organisationId, organisationId)));
    if (!c) throw invalid('Unknown competition', [{ field: 'competitionId', message: 'Choose one of your competitions' }]);
  }
}

/** A new stream link; the OBS link is returned once here (and again on request with Copy OBS link). */
export async function createChannel(ctx: Ctx, input: z.input<typeof channelInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = channelInput.parse(input);
  return tx(ctx, async (t) => {
    await checkScope(t, ctx.actor.organisationId, d);
    const id = crypto.randomUUID();
    const token = channelToken(ctx.config.MEDIA_TOKEN_SECRET, id, 1);
    const [c] = await t
      .insert(streamChannels)
      .values({ id, organisationId: ctx.actor.organisationId, name: d.name, venueId: d.venueId ?? null, competitionId: d.competitionId ?? null, switchBeforeMinutes: d.switchBeforeMinutes ?? 10, intermissionAfterMinutes: d.intermissionAfterMinutes ?? null, publicId: publicId('sl', 12), tokenHash: sha256(token), tokenVersion: 1, createdBy: ctx.actor.userId })
      .returning();
    await audit(t, ctx.actor, 'stream_link.create', 'stream_link', id, { after: { name: d.name, venueId: d.venueId ?? null, competitionId: d.competitionId ?? null } });
    return { id, name: c!.name, ...channelUrls(ctx.config, c!.publicId, token) };
  });
}

export async function updateChannel(ctx: Ctx, id: string, input: Partial<z.input<typeof channelInput>>) {
  assertCan(ctx.actor, 'competition.write');
  const d = channelInput.partial().parse(input);
  return tx(ctx, async (t) => {
    const before = await loadChannel(ctx, t, id);
    await checkScope(t, ctx.actor.organisationId, d);
    const set: Partial<typeof streamChannels.$inferInsert> = { updatedAt: new Date() };
    for (const k of ['name', 'venueId', 'competitionId', 'switchBeforeMinutes', 'intermissionAfterMinutes'] as const) if (d[k] !== undefined) (set as Record<string, unknown>)[k] = d[k];
    await t.update(streamChannels).set(set).where(and(eq(streamChannels.id, id), eq(streamChannels.organisationId, ctx.actor.organisationId)));
    await audit(t, ctx.actor, 'stream_link.update', 'stream_link', id, { before: { name: before.name, venueId: before.venueId, competitionId: before.competitionId, switchBeforeMinutes: before.switchBeforeMinutes, intermissionAfterMinutes: before.intermissionAfterMinutes }, after: d });
    return { ok: true };
  });
}

export async function deleteChannel(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'competition.write');
  return tx(ctx, async (t) => {
    const c = await loadChannel(ctx, t, id);
    await t.delete(streamChannels).where(and(eq(streamChannels.id, id), eq(streamChannels.organisationId, ctx.actor.organisationId)));
    await audit(t, ctx.actor, 'stream_link.delete', 'stream_link', id, { before: { name: c.name } });
    return { ok: true };
  });
}

/** Authorised reveal of the OBS links (never in the list). */
export async function channelLink(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'overlay.operate');
  return tx(ctx, async (t) => {
    const c = await loadChannel(ctx, t, id);
    return { ...channelUrls(ctx.config, c.publicId, channelToken(ctx.config.MEDIA_TOKEN_SECRET, c.id, c.tokenVersion)), width: 1920, height: 1080 };
  });
}

/** New OBS links if the old ones leaked (the stream link and its intermission link); the old ones stop at once. */
export async function rotateChannel(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'overlay.operate');
  return tx(ctx, async (t) => {
    const c = await loadChannel(ctx, t, id);
    const version = c.tokenVersion + 1;
    const token = channelToken(ctx.config.MEDIA_TOKEN_SECRET, c.id, version);
    await t.update(streamChannels).set({ tokenVersion: version, tokenHash: sha256(token), updatedAt: new Date() }).where(and(eq(streamChannels.id, id), eq(streamChannels.organisationId, ctx.actor.organisationId)));
    await audit(t, ctx.actor, 'stream_link.rotate', 'stream_link', id, { after: { version } });
    return channelUrls(ctx.config, c.publicId, token);
  });
}

/** Put a match or the intermission on by hand (null: follow the day automatically again). */
export async function pinChannel(ctx: Ctx, id: string, target: string | 'intermission' | null) {
  assertCan(ctx.actor, 'overlay.operate');
  return tx(ctx, async (t) => {
    const c = await loadChannel(ctx, t, id);
    const intermission = target === 'intermission';
    const matchId = intermission ? null : target;
    if (matchId) {
      const [m] = await t.select({ id: matches.id }).from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
      if (!m) throw notFound('Match');
    }
    await t.update(streamChannels).set({ pinnedMatchId: matchId, pinnedIntermission: intermission, updatedAt: new Date() }).where(and(eq(streamChannels.id, id), eq(streamChannels.organisationId, ctx.actor.organisationId)));
    await audit(t, ctx.actor, intermission ? 'stream_link.pin_intermission' : matchId ? 'stream_link.pin' : 'stream_link.unpin', 'stream_link', id, { before: { matchId: c.pinnedMatchId, intermission: c.pinnedIntermission }, after: { matchId, intermission } });
    return { ok: true };
  });
}

/** The stream link a match is on, if any: whether it is that link's day, OBS has it open, and it is showing this match. */
export async function matchStreamLink(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const { channelId } = await todayScopeTx(t, ctx.actor.organisationId, m);
    if (!channelId) return { link: null };
    const c = await loadChannel(ctx, t, channelId);
    const now = Date.now();
    const day = await linkDayTx(t, c, now);
    const today = m.scheduledAt >= day.from && m.scheduledAt < day.to;
    const { current } = today ? await scheduleTx(t, c, now) : { current: { id: null, reason: 'none' as CurrentReason } };
    return { link: { id: c.id, name: c.name, connected: !!c.lastSeenAt && now - c.lastSeenAt.getTime() < CONNECTED_MS, today, onNow: current.id === m.id && !isIntermission(current.reason), intermission: isIntermission(current.reason) } };
  });
}

// ---------------------------------------------------------------- the OBS page (capability token only)

export interface ChannelScope {
  organisationId: string;
  channelId: string;
}

/** Resolve a stream link token (SECURITY DEFINER lookup: the page has no tenant yet). */
export async function resolveChannelToken(db: Db, token: string): Promise<ChannelScope | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = await db.execute<{ organisation_id: string; id: string }>(sql`select * from resolve_stream_channel(${sha256(token)})`);
  const c = r.rows[0];
  return c ? { organisationId: c.organisation_id, channelId: c.id } : null;
}

/**
 * Which match the link is on now, and the production token of that match's output for the page to show (an
 * authorised reveal: the link's capability covers the outputs of its matches; render-only, like the link itself).
 * The intermission link (`intermission`) always asks for the intermission: drawn with the next match's output.
 */
export async function channelCurrent(db: Db, cfg: AppConfig, scope: ChannelScope, publicIdStr: string, o: { intermission?: boolean } = {}, now = Date.now()) {
  return withTenant(db, { organisationId: scope.organisationId }, async (t) => {
    const [c] = await t.select().from(streamChannels).where(and(eq(streamChannels.id, scope.channelId), eq(streamChannels.organisationId, scope.organisationId)));
    if (!c || c.publicId !== publicIdStr) return null;
    if (!c.lastSeenAt || now - c.lastSeenAt.getTime() > 10_000) await t.update(streamChannels).set({ lastSeenAt: new Date(now) }).where(and(eq(streamChannels.id, c.id), eq(streamChannels.organisationId, scope.organisationId)));
    const { outputs, current } = await scheduleTx(t, c, now, o);
    const out = current.id ? outputs.get(current.id) : undefined;
    // the intermission is its own screen, drawn with the next match's output (its look and today's matches)
    const screen = isIntermission(current.reason) ? ('intermission' as const) : ('match' as const);
    if (!out) return { matchId: null, reason: 'none' as CurrentReason, screen: 'match' as const, overlay: null };
    const [cred] = await t
      .select({ version: overlayCredentials.tokenVersion })
      .from(overlayCredentials)
      .where(and(eq(overlayCredentials.organisationId, scope.organisationId), eq(overlayCredentials.overlayId, out.id), eq(overlayCredentials.purpose, 'production'), isNull(overlayCredentials.revokedAt)))
      .orderBy(sql`${overlayCredentials.tokenVersion} desc`)
      .limit(1);
    if (!cred) return { matchId: current.id, reason: current.reason, screen, overlay: null };
    return { matchId: current.id, reason: current.reason, screen, overlay: { publicId: out.publicId, token: overlayToken(cfg.MEDIA_TOKEN_SECRET, out.id, 'production', cred.version) } };
  });
}
