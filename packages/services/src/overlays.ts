// Overlays: per-output graphics state, capability URLs, the shared command handler and renderer snapshots.
import type { Sport } from '@bs/domain';
import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { competitions, gamePlanVersions, gamePlans, matchLineups, matchState, matches, mediaAssets, overlayCommands, overlayCredentials, overlayState, overlays, rendererSessions, themeProfiles, themeProfileVersions, venues, withTenant, type Db, type Tx, matchFacts, teams as teamsTable } from '@bs/db';
import { getAdapter, type LineupSnapshot, type MatchProjection } from '@bs/domain';
import {
  OverlayCommandError,
  emptyState,
  playerIndex,
  pruneExpired,
  reduceOverlay,
  type Cue,
  type OverlayCommand,
  type OverlayPublicState,
  type RenderData,
  type TemplateDef,
} from '@bs/graphics';
import { z } from 'zod';
import type { AppConfig } from '@bs/config';
import { assertCan, can, type Actor } from './authz';
import { audit } from './audit';
import { hmac, publicId, sha256, signToken, verifyToken } from './crypto';
import { AppError, conflict, invalid, notFound } from './errors';
import { nowMs, tx, type Ctx } from './context';
import { enqueueOutbox } from './outbox';
import { renderSeasonTx } from './season-data';
import { effectiveTheme, lookChoice, publishedCustomTemplates, resolveLook } from './themes';

export type Purpose = 'production' | 'monitor' | 'rehearsal';
interface SnapTeam {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  primaryColor: string;
  secondaryColor: string;
  logoAssetId?: string | null;
}
const PURPOSES: Purpose[] = ['production', 'monitor', 'rehearsal'];

/** Capability token: HMAC over (overlay, purpose, version). Re-derivable for authorised display; rotation bumps the version. */
export function overlayToken(secret: string, overlayId: string, purpose: Purpose, version: number) {
  return hmac(secret, `overlay:${overlayId}:${purpose}:${version}`).slice(0, 43);
}

export function overlayUrl(cfg: AppConfig, publicIdStr: string, token: string, purpose: Purpose) {
  const base = `${cfg.PUBLIC_WEB_URL}/overlay/${publicIdStr}?t=${token}`;
  return purpose === 'monitor' ? `${base}&mode=monitor` : purpose === 'rehearsal' ? `${base}&mode=rehearsal` : base;
}

export async function loadOverlay(ctx: Ctx, t: Tx, id: string) {
  const [row] = await t.select({ o: overlays, m: matches }).from(overlays).innerJoin(matches, eq(matches.id, overlays.matchId)).where(and(eq(overlays.id, id), eq(overlays.organisationId, ctx.actor.organisationId)));
  if (!row) throw notFound('Overlay');
  return row;
}

// ------------------------------------------------------------------ CRUD

export const overlayInput = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['graphics', 'programme']).default('graphics'),
  themeProfileId: z.string().uuid().nullable().optional(),
});

/** The newest published version of the organisation's most recently published plan for a sport, if any. */
export async function latestPublishedPlan(t: Tx, organisationId: string, sport: string): Promise<string | null> {
  const [v] = await t
    .select({ id: gamePlanVersions.id })
    .from(gamePlanVersions)
    .innerJoin(gamePlans, and(eq(gamePlans.id, gamePlanVersions.gamePlanId), eq(gamePlans.organisationId, gamePlanVersions.organisationId)))
    .where(and(eq(gamePlanVersions.organisationId, organisationId), eq(gamePlanVersions.sport, sport), eq(gamePlans.status, 'active'), eq(gamePlanVersions.version, gamePlans.currentVersion)))
    .orderBy(desc(gamePlanVersions.publishedAt))
    .limit(1);
  return v?.id ?? null;
}

/** Tell automation an output has a plan: it catches up with the match's current phase (after commit). */
export async function enqueuePlanAttached(t: Tx, organisationId: string, overlayId: string, matchId: string, gamePlanVersionId: string) {
  await enqueueOutbox(t, { organisationId, topic: 'overlay.plan.attached', aggregateType: 'overlay', aggregateId: overlayId, payload: { matchId, gamePlanVersionId } });
}

/**
 * `defaultPlan` (the output every match gets when it is created): with no plan on the match or the competition,
 * use the organisation's latest published plan for the sport, so automation runs without a set-up step; with none
 * at all, `starterPlan` publishes the sport's starter flow (match creation passes it).
 */
export async function createOverlay(ctx: Ctx, matchId: string, input: z.input<typeof overlayInput>, t0?: Tx, opts: { defaultPlan?: boolean; starterPlan?: (t: Tx, sport: string) => Promise<string | null> } = {}) {
  assertCan(ctx.actor, 'theme.use');
  const d = overlayInput.parse(input);
  const run = async (t: Tx) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'overlay.operate', { matchId: m.id, competitionId: m.competitionId });
    const [comp] = await t.select().from(competitions).where(eq(competitions.id, m.competitionId));
    const profileId = d.themeProfileId ?? comp?.themeProfileId ?? null;
    let profileVersionId: string | null = null;
    let themeVersionId: string | null = null;
    if (profileId) {
      const [pv] = await t.select().from(themeProfileVersions).where(and(eq(themeProfileVersions.profileId, profileId), eq(themeProfileVersions.organisationId, ctx.actor.organisationId))).orderBy(desc(themeProfileVersions.version)).limit(1);
      if (pv) {
        profileVersionId = pv.id;
        themeVersionId = pv.themeVersionId;
      }
    }
    let gamePlanVersionId = m.gamePlanVersionId ?? comp?.gamePlanVersionId ?? null;
    if (!gamePlanVersionId && opts.defaultPlan) gamePlanVersionId = (await latestPublishedPlan(t, ctx.actor.organisationId, m.sport)) ?? (await opts.starterPlan?.(t, m.sport)) ?? null;
    const [o] = await t
      .insert(overlays)
      .values({ organisationId: ctx.actor.organisationId, matchId, name: d.name, kind: d.kind, themeProfileVersionId: profileVersionId, themeVersionId, gamePlanVersionId, publicId: publicId('ov', 12) })
      .returning();
    await t.insert(overlayState).values({ overlayId: o!.id, organisationId: ctx.actor.organisationId, layers: {} });
    if (gamePlanVersionId) await enqueuePlanAttached(t, ctx.actor.organisationId, o!.id, matchId, gamePlanVersionId);
    for (const purpose of PURPOSES) {
      const token = overlayToken(ctx.config.MEDIA_TOKEN_SECRET, o!.id, purpose, 1);
      await t.insert(overlayCredentials).values({ organisationId: ctx.actor.organisationId, overlayId: o!.id, purpose, tokenHash: sha256(token), tokenVersion: 1 });
    }
    await audit(t, ctx.actor, 'overlay.create', 'overlay', o!.id, { after: { name: d.name, kind: d.kind, matchId } });
    return o!;
  };
  return t0 ? run(t0) : tx(ctx, run);
}

export async function listOverlays(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'competition.read', { matchId, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const rows = await t.select({ o: overlays, s: overlayState }).from(overlays).innerJoin(overlayState, eq(overlayState.overlayId, overlays.id)).where(eq(overlays.matchId, matchId)).orderBy(asc(overlays.createdAt));
    const renderers = rows.length ? await t.select().from(rendererSessions).where(and(inArray(rendererSessions.overlayId, rows.map((r) => r.o.id)), isNull(rendererSessions.disconnectedAt))) : [];
    const profiles = await t.select({ v: themeProfileVersions, p: themeProfiles }).from(themeProfileVersions).innerJoin(themeProfiles, eq(themeProfiles.id, themeProfileVersions.profileId)).where(eq(themeProfileVersions.organisationId, ctx.actor.organisationId));
    const pv = (id: string | null) => (id ? profiles.find((x) => x.v.id === id) : undefined);
    return rows.map((r) => ({
      id: r.o.id,
      name: r.o.name,
      kind: r.o.kind,
      publicId: r.o.publicId,
      gamePlanVersionId: r.o.gamePlanVersionId,
      format: (r.o.format as '16:9' | '9:16' | 'venue' | null) ?? '16:9',
      theme: pv(r.o.themeProfileVersionId) ? { id: pv(r.o.themeProfileVersionId)!.p.id, profile: pv(r.o.themeProfileVersionId)!.p.name, version: pv(r.o.themeProfileVersionId)!.v.version } : null,
      pendingTheme: pv(r.o.pendingThemeProfileVersionId) ? { id: r.o.pendingThemeProfileVersionId, version: pv(r.o.pendingThemeProfileVersionId)!.v.version } : null,
      state: { revision: r.s.revision, displayedRevision: r.s.displayedRevision, displayedAt: r.s.displayedAt, mode: r.s.mode, inhibited: r.s.inhibited, scorebugVisible: r.s.scorebugVisible, onAir: Object.keys(r.s.layers ?? {}) },
      renderers: renderers.filter((x) => x.overlayId === r.o.id).map((x) => ({ purpose: x.purpose, displayedRevision: x.displayedRevision, lastSeenAt: x.lastSeenAt, reporting: x.isReportingAuthority })),
    }));
  });
}

/** Authorised reveal of capability URLs (never in list payloads). */
export async function overlayUrls(ctx: Ctx, overlayId: string) {
  return tx(ctx, async (t) => {
    const { o, m } = await loadOverlay(ctx, t, overlayId);
    assertCan(ctx.actor, 'overlay.operate', { matchId: m.id, competitionId: m.competitionId, overlayId });
    const creds = await t.select().from(overlayCredentials).where(and(eq(overlayCredentials.overlayId, overlayId), isNull(overlayCredentials.revokedAt)));
    const url = (p: Purpose) => {
      const c = creds.filter((x) => x.purpose === p).sort((a, b) => b.tokenVersion - a.tokenVersion)[0];
      return c ? overlayUrl(ctx.config, o.publicId, overlayToken(ctx.config.MEDIA_TOKEN_SECRET, overlayId, p, c.tokenVersion), p) : null;
    };
    return { production: url('production'), monitor: url('monitor'), rehearsal: url('rehearsal'), width: 1920, height: 1080 };
  });
}

export async function rotateOverlayCredential(ctx: Ctx, overlayId: string, purpose: Purpose = 'production') {
  return tx(ctx, async (t) => {
    const { m } = await loadOverlay(ctx, t, overlayId);
    assertCan(ctx.actor, 'overlay.operate', { matchId: m.id, competitionId: m.competitionId, overlayId });
    const cur = await t.select().from(overlayCredentials).where(and(eq(overlayCredentials.overlayId, overlayId), eq(overlayCredentials.purpose, purpose))).orderBy(desc(overlayCredentials.tokenVersion)).limit(1);
    const version = (cur[0]?.tokenVersion ?? 0) + 1;
    await t.update(overlayCredentials).set({ revokedAt: new Date() }).where(and(eq(overlayCredentials.overlayId, overlayId), eq(overlayCredentials.purpose, purpose), isNull(overlayCredentials.revokedAt)));
    const token = overlayToken(ctx.config.MEDIA_TOKEN_SECRET, overlayId, purpose, version);
    await t.insert(overlayCredentials).values({ organisationId: ctx.actor.organisationId, overlayId, purpose, tokenHash: sha256(token), tokenVersion: version });
    await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'overlay.credentials.rotated', aggregateType: 'overlay', aggregateId: overlayId, payload: { purpose, version } });
    await audit(t, ctx.actor, 'overlay.rotate_credential', 'overlay', overlayId, { after: { purpose, version } });
    return { version };
  });
}

/** Explicit apply of a newly published theme profile version to a (possibly live) overlay. */
export async function applyPendingTheme(ctx: Ctx, overlayId: string) {
  return tx(ctx, async (t) => {
    const { o, m } = await loadOverlay(ctx, t, overlayId);
    assertCan(ctx.actor, 'overlay.operate', { matchId: m.id, competitionId: m.competitionId, overlayId });
    if (!o.pendingThemeProfileVersionId) throw conflict('NOTHING_PENDING', 'No newer theme version to apply');
    const [pv] = await t.select().from(themeProfileVersions).where(eq(themeProfileVersions.id, o.pendingThemeProfileVersionId));
    await t.update(overlays).set({ themeProfileVersionId: pv!.id, themeVersionId: pv!.themeVersionId, pendingThemeProfileVersionId: null, updatedAt: new Date() }).where(eq(overlays.id, overlayId));
    const [s] = await t.update(overlayState).set({ revision: sql`${overlayState.revision} + 1`, updatedAt: new Date() }).where(eq(overlayState.overlayId, overlayId)).returning();
    await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'overlay.state.updated', aggregateType: 'overlay', aggregateId: overlayId, payload: { ...publicState(s!, { ...o, themeProfileVersionId: pv!.id, themeVersionId: pv!.themeVersionId }), themeChanged: true } });
    await audit(t, ctx.actor, 'overlay.apply_theme', 'overlay', overlayId, { before: { themeProfileVersionId: o.themeProfileVersionId }, after: { themeProfileVersionId: pv!.id } });
    return { ok: true, version: pv!.version };
  });
}

/** Pin an output to the latest published version of a look (the match-day "choose a look" action). */
export async function setOverlayThemeProfile(ctx: Ctx, overlayId: string, profileId: string | null) {
  return tx(ctx, async (t) => {
    const { o, m } = await loadOverlay(ctx, t, overlayId);
    assertCan(ctx.actor, 'overlay.operate', { matchId: m.id, competitionId: m.competitionId, overlayId });
    let pv: typeof themeProfileVersions.$inferSelect | undefined;
    if (profileId) {
      [pv] = await t.select().from(themeProfileVersions).where(and(eq(themeProfileVersions.profileId, profileId), eq(themeProfileVersions.organisationId, ctx.actor.organisationId))).orderBy(desc(themeProfileVersions.version)).limit(1);
      if (!pv) throw conflict('NOT_PUBLISHED', 'Publish this look before using it on a match');
    }
    const next = { themeProfileVersionId: pv?.id ?? null, themeVersionId: pv?.themeVersionId ?? null };
    await t.update(overlays).set({ ...next, pendingThemeProfileVersionId: null, updatedAt: new Date() }).where(eq(overlays.id, overlayId));
    const [s] = await t.update(overlayState).set({ revision: sql`${overlayState.revision} + 1`, updatedAt: new Date() }).where(eq(overlayState.overlayId, overlayId)).returning();
    await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'overlay.state.updated', aggregateType: 'overlay', aggregateId: overlayId, payload: { ...publicState(s!, next), themeChanged: true } });
    await audit(t, ctx.actor, 'overlay.theme_profile', 'overlay', overlayId, { before: { themeProfileVersionId: o.themeProfileVersionId }, after: next });
    return { ok: true, version: pv?.version ?? null };
  });
}

/** A match's graphics outputs that show the same look as its main output (the first one), and that look. */
async function outputsOnMainLook(t: Tx, organisationId: string, matchId: string) {
  const rows = await t
    .select({ id: overlays.id, profileId: themeProfileVersions.profileId })
    .from(overlays)
    .leftJoin(themeProfileVersions, eq(themeProfileVersions.id, overlays.themeProfileVersionId))
    .where(and(eq(overlays.matchId, matchId), eq(overlays.organisationId, organisationId), eq(overlays.kind, 'graphics'), eq(overlays.status, 'active')))
    .orderBy(asc(overlays.createdAt));
  const look = rows[0]?.profileId ?? null;
  return { look, ids: rows.filter((r) => (r.profileId ?? null) === look).map((r) => r.id) };
}

export const matchLookInput = z.union([lookChoice, z.object({ follow: z.literal('competition') })]);

/**
 * The match's look, from the match-day picker: a look of the organisation's, a built-in look, or "the same as the
 * tournament". It goes on the main output and on every other output showing the same look; an output given a
 * different look on the OBS link tab keeps it.
 */
export async function setMatchLook(ctx: Ctx, matchId: string, input: z.input<typeof matchLookInput>) {
  const choice = matchLookInput.parse(input);
  const { profileId, ids } = await tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'overlay.operate', { matchId, competitionId: m.competitionId });
    const [comp] = await t.select().from(competitions).where(and(eq(competitions.id, m.competitionId), eq(competitions.organisationId, ctx.actor.organisationId)));
    const id = 'follow' in choice ? (comp?.themeProfileId ?? null) : await resolveLook(ctx, t, choice);
    return { profileId: id, ids: (await outputsOnMainLook(t, ctx.actor.organisationId, matchId)).ids };
  });
  for (const o of ids) await setOverlayThemeProfile(ctx, o, profileId);
  return { themeProfileId: profileId, outputs: ids.length };
}

/**
 * The tournament's look, from the competition page: new fixtures start with it, and upcoming matches that showed
 * the tournament's previous look (or no look of their own) change to it now. Matches given their own look, and
 * matches under way or finished, keep theirs.
 */
export const competitionLookInput = z.union([lookChoice, z.object({ themeProfileId: z.null() })]);

export async function setCompetitionLook(ctx: Ctx, competitionId: string, input: z.input<typeof competitionLookInput>) {
  assertCan(ctx.actor, 'competition.write');
  const choice = competitionLookInput.parse(input);
  const { profileId, outputs } = await tx(ctx, async (t) => {
    const [c] = await t.select().from(competitions).where(and(eq(competitions.id, competitionId), eq(competitions.organisationId, ctx.actor.organisationId))).for('update');
    if (!c) throw notFound('Competition');
    const id = 'themeKey' in choice || choice.themeProfileId ? await resolveLook(ctx, t, choice as z.infer<typeof lookChoice>) : null;
    await t.update(competitions).set({ themeProfileId: id, updatedAt: new Date() }).where(eq(competitions.id, competitionId));
    await audit(t, ctx.actor, 'competition.look', 'competition', competitionId, { before: { themeProfileId: c.themeProfileId }, after: { themeProfileId: id } });
    const upcoming = await t.select({ id: matches.id }).from(matches).where(and(eq(matches.competitionId, competitionId), eq(matches.organisationId, ctx.actor.organisationId), eq(matches.status, 'scheduled')));
    const out: string[] = [];
    for (const m of upcoming) {
      const o = await outputsOnMainLook(t, ctx.actor.organisationId, m.id);
      if (o.look === null || o.look === c.themeProfileId) out.push(...o.ids);
    }
    return { profileId: id, outputs: out };
  });
  for (const o of outputs) await setOverlayThemeProfile(ctx, o, profileId);
  return { themeProfileId: profileId, outputs: outputs.length };
}

/** Output format: broadcast 16:9, vertical 9:16 for a social stream, or the venue screen layout. */
export async function setOverlayFormat(ctx: Ctx, overlayId: string, format: '16:9' | '9:16' | 'venue') {
  return tx(ctx, async (t) => {
    const { o, m } = await loadOverlay(ctx, t, overlayId);
    assertCan(ctx.actor, 'overlay.operate', { matchId: m.id, competitionId: m.competitionId, overlayId });
    await t.update(overlays).set({ format, updatedAt: new Date() }).where(eq(overlays.id, overlayId));
    const [s] = await t.update(overlayState).set({ revision: sql`${overlayState.revision} + 1`, updatedAt: new Date() }).where(eq(overlayState.overlayId, overlayId)).returning();
    await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'overlay.state.updated', aggregateType: 'overlay', aggregateId: overlayId, payload: { ...publicState(s!, o), themeChanged: true } });
    await audit(t, ctx.actor, 'overlay.format', 'overlay', overlayId, { before: { format: o.format }, after: { format } });
    return { ok: true, format };
  });
}

export async function setOverlayGamePlan(ctx: Ctx, overlayId: string, gamePlanVersionId: string | null) {
  return tx(ctx, async (t) => {
    const { m } = await loadOverlay(ctx, t, overlayId);
    assertCan(ctx.actor, 'competition.write', { matchId: m.id, competitionId: m.competitionId });
    await t.update(overlays).set({ gamePlanVersionId, updatedAt: new Date() }).where(eq(overlays.id, overlayId));
    if (gamePlanVersionId) await enqueuePlanAttached(t, ctx.actor.organisationId, overlayId, m.id, gamePlanVersionId);
    await audit(t, ctx.actor, 'overlay.game_plan', 'overlay', overlayId, { after: { gamePlanVersionId } });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ commands

export function publicState(s: typeof overlayState.$inferSelect, o: { themeProfileVersionId: string | null; themeVersionId: string | null }): OverlayPublicState {
  return {
    revision: s.revision,
    mode: s.mode as 'auto' | 'manual',
    inhibited: s.inhibited,
    scorebugVisible: s.scorebugVisible,
    layers: (s.layers ?? {}) as OverlayPublicState['layers'],
    themeProfileVersionId: o.themeProfileVersionId,
    themeVersionId: o.themeVersionId,
    slots: (s.slots ?? {}) as OverlayPublicState['slots'],
  };
}

export const commandInput = z.object({
  commandId: z.string().uuid(),
  command: z.object({ type: z.enum(['TAKE_IN', 'UPDATE', 'TAKE_OUT', 'CLEAR_LAYER', 'CLEAR_OUTPUT', 'SHOW_SCOREBUG', 'HIDE_SCOREBUG', 'SET_MODE', 'RESUME']) }).passthrough(),
  /** client's current displayed/known revision, informational */
  knownRevision: z.number().int().optional(),
});

export interface CommandOpts {
  source?: 'operator' | 'automation' | 'system';
  runId?: string | null;
  priority?: number | null;
  /** worker fencing: the command applies only if this fence still owns automation */
  fence?: { resource: string; owner: string; fence: number } | null;
}

export interface OverlayCommandResult {
  accepted: boolean;
  revision: number;
  state: OverlayPublicState;
  added: Cue | null;
  removed: Cue[];
  replayed?: boolean;
}

/** The single command path for operators and automation (lock → idempotency → reducer → outbox). */
export async function applyOverlayCommandTx(ctx: Ctx, t: Tx, overlayId: string, input: z.input<typeof commandInput>, opts: CommandOpts = {}): Promise<OverlayCommandResult> {
  const d = commandInput.parse(input);
  const source = opts.source ?? 'operator';
  const { o, m } = await loadOverlay(ctx, t, overlayId);
  if (source === 'operator') {
    const safety = ['CLEAR_OUTPUT', 'SET_MODE', 'RESUME', 'HIDE_SCOREBUG'].includes(d.command.type);
    assertCan(ctx.actor, 'overlay.operate', { matchId: m.id, competitionId: m.competitionId, overlayId }, safety ? 'You are not assigned to operate this overlay' : undefined);
  }
  const [row] = await t.select().from(overlayState).where(eq(overlayState.overlayId, overlayId)).for('update');
  if (!row) throw notFound('Overlay state');
  const [prior] = await t.select().from(overlayCommands).where(and(eq(overlayCommands.overlayId, overlayId), eq(overlayCommands.commandId, d.commandId)));
  if (prior) {
    if (prior.type !== d.command.type) throw conflict('IDEMPOTENCY_KEY_REUSED', 'This command ID was already used for a different command');
    return { accepted: prior.status === 'accepted', revision: prior.resultRevision ?? row.revision, state: publicState(row, o), added: null, removed: [], replayed: true };
  }
  if (opts.fence) {
    const ok = await t.execute(sql`select 1 from worker_leases where resource = ${opts.fence.resource} and owner = ${opts.fence.owner} and fence = ${opts.fence.fence} and expires_at > now()`);
    if (!ok.rows.length) throw new AppError('FENCED', 409, 'Automation ownership was lost; command refused');
  }
  const now = nowMs(ctx);
  const custom = await customDefs(t, ctx.actor.organisationId);
  let r;
  try {
    r = reduceOverlay(publicState(row, o), d.command as OverlayCommand, { now, source, cueId: crypto.randomUUID(), custom, runId: opts.runId, priority: opts.priority });
  } catch (e) {
    if (e instanceof OverlayCommandError) {
      await t.insert(overlayCommands).values({ organisationId: ctx.actor.organisationId, overlayId, commandId: d.commandId, type: d.command.type, payload: d.command, source, actorUserId: ctx.actor.userId, status: 'rejected', reason: e.message });
      throw new AppError(e.code, e.status, e.message);
    }
    throw e;
  }
  const [u] = await t
    .update(overlayState)
    .set({ revision: r.state.revision, mode: r.state.mode, inhibited: r.state.inhibited, scorebugVisible: r.state.scorebugVisible, layers: r.state.layers as never, updatedAt: new Date(now) })
    .where(and(eq(overlayState.overlayId, overlayId), eq(overlayState.revision, row.revision)))
    .returning();
  if (!u) throw conflict('CONCURRENT_UPDATE', 'Overlay changed concurrently; retry');
  await t.insert(overlayCommands).values({ organisationId: ctx.actor.organisationId, overlayId, commandId: d.commandId, type: d.command.type, payload: d.command, source, actorUserId: ctx.actor.userId, status: 'accepted', resultRevision: r.state.revision });
  const st = publicState(u, o);
  await enqueueOutbox(t, [
    { organisationId: ctx.actor.organisationId, topic: 'overlay.command.accepted', aggregateType: 'overlay', aggregateId: overlayId, aggregateSeq: st.revision, payload: { commandId: d.commandId, type: d.command.type, revision: st.revision, source, added: r.added?.cueId ?? null, removed: r.removed.map((c) => c.cueId), cancelAutomation: r.cancelAutomation } },
    { organisationId: ctx.actor.organisationId, topic: 'overlay.state.updated', aggregateType: 'overlay', aggregateId: overlayId, aggregateSeq: st.revision, payload: { ...st, serverNow: now } as never },
  ]);
  if (source === 'operator' && ['TAKE_IN', 'TAKE_OUT', 'CLEAR_OUTPUT', 'SET_MODE', 'RESUME', 'CLEAR_LAYER'].includes(d.command.type)) {
    await audit(t, ctx.actor, `overlay.${d.command.type.toLowerCase()}`, 'overlay', overlayId, { after: { revision: st.revision, ...(d.command.type === 'TAKE_IN' ? { template: (d.command as { templateKey?: string }).templateKey } : {}), ...(d.command.type === 'SET_MODE' ? { mode: (d.command as { mode?: string }).mode } : {}) } });
  }
  return { accepted: true, revision: st.revision, state: st, added: r.added, removed: r.removed };
}

export async function overlayCommand(ctx: Ctx, overlayId: string, input: z.input<typeof commandInput>, opts: CommandOpts = {}) {
  return tx(ctx, (t) => applyOverlayCommandTx(ctx, t, overlayId, input, opts));
}

export async function getOverlay(ctx: Ctx, overlayId: string) {
  return tx(ctx, async (t) => {
    const { o, m } = await loadOverlay(ctx, t, overlayId);
    assertCan(ctx.actor, 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId], overlayId });
    const [s] = await t.select().from(overlayState).where(eq(overlayState.overlayId, overlayId));
    const renderers = await t.select().from(rendererSessions).where(and(eq(rendererSessions.overlayId, overlayId), isNull(rendererSessions.disconnectedAt)));
    const history = await t.select().from(overlayCommands).where(eq(overlayCommands.overlayId, overlayId)).orderBy(desc(overlayCommands.createdAt)).limit(50);
    return {
      overlay: { id: o.id, name: o.name, kind: o.kind, matchId: o.matchId, publicId: o.publicId, gamePlanVersionId: o.gamePlanVersionId, pendingThemeProfileVersionId: o.pendingThemeProfileVersionId },
      state: publicState(s!, o),
      displayedRevision: s!.displayedRevision,
      displayedAt: s!.displayedAt,
      renderers: renderers.map((r) => ({ id: r.id, purpose: r.purpose, displayedRevision: r.displayedRevision, lastSeenAt: r.lastSeenAt, reporting: r.isReportingAuthority })),
      history: history.map((h) => ({ id: h.id, type: h.type, source: h.source, status: h.status, reason: h.reason, revision: h.resultRevision, createdAt: h.createdAt })),
      canOperate: can(ctx.actor, 'overlay.operate', { matchId: m.id, competitionId: m.competitionId, overlayId }),
    };
  });
}

export async function customDefs(t: Tx, organisationId: string): Promise<TemplateDef[]> {
  const list = await publishedCustomTemplates(t, organisationId);
  return list.map(({ key, scene }) => {
    const s = scene as { name: string; category: TemplateDef['category']; sports: TemplateDef['sports']; layer: TemplateDef['layer']; variables: TemplateDef['variables']; entranceMs: number; holdMs: number | null; exitMs: number };
    return { key, name: s.name, category: s.category, sports: s.sports, layer: s.layer, variables: s.variables, requiredData: [], entranceMs: s.entranceMs, holdMs: s.holdMs, exitMs: s.exitMs, sponsorSlots: [], bounds: { x: 0, y: 0, w: 1, h: 1 } };
  });
}

// ------------------------------------------------------------------ renderer capability path

export interface RendererScope {
  organisationId: string;
  overlayId: string;
  matchId: string;
  purpose: Purpose | 'compositor';
  tokenVersion: number;
}

/** Resolve a production/monitor/rehearsal URL token (SECURITY DEFINER lookup), or a programme bootstrap token. */
export async function resolveRendererToken(db: Db, cfg: AppConfig, token: string): Promise<RendererScope | null> {
  if (token.includes('.')) {
    const claims = verifyToken<{ k: string; org: string; ov: string; m: string }>(cfg.MEDIA_TOKEN_SECRET, token);
    if (!claims || claims.k !== 'compositor') return null;
    return { organisationId: claims.org, overlayId: claims.ov, matchId: claims.m, purpose: 'compositor', tokenVersion: 0 };
  }
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = await db.execute<{ organisation_id: string; overlay_id: string; purpose: Purpose; token_version: number; revoked: boolean }>(sql`select * from resolve_overlay_credential(${sha256(token)})`);
  const c = r.rows[0];
  if (!c || c.revoked) return null;
  const m = await withTenant(db, { organisationId: c.organisation_id }, (t) => t.select({ matchId: overlays.matchId }).from(overlays).where(eq(overlays.id, c.overlay_id)));
  if (!m[0]) return null;
  return { organisationId: c.organisation_id, overlayId: c.overlay_id, matchId: m[0].matchId, purpose: c.purpose, tokenVersion: c.token_version };
}

/** Short-lived bootstrap for the cloud programme template (egress Chrome). */
export function compositorToken(cfg: AppConfig, scope: { organisationId: string; overlayId: string; matchId: string }, ttlSeconds = 6 * 3600) {
  return signToken(cfg.MEDIA_TOKEN_SECRET, { k: 'compositor', org: scope.organisationId, ov: scope.overlayId, m: scope.matchId }, ttlSeconds);
}

/** Signed, overlay-scoped asset URL (only approved resources of the published graphic). */
export function signedAssetUrl(cfg: AppConfig, organisationId: string, assetId: string, ttlSeconds = 12 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(cfg.MEDIA_TOKEN_SECRET, `asset:${organisationId}:${assetId}:${exp}`);
  return `${cfg.PUBLIC_API_URL}/api/v1/public/assets/${assetId}?o=${organisationId}&e=${exp}&s=${sig}`;
}

export function verifyAssetSignature(cfg: AppConfig, organisationId: string, assetId: string, exp: number, sig: string) {
  return exp > Date.now() / 1000 && hmac(cfg.MEDIA_TOKEN_SECRET, `asset:${organisationId}:${assetId}:${exp}`) === sig;
}

/** Explicit render snapshot for one overlay: public display data only (no roster directory, no private fields). */
export async function rendererSnapshot(db: Db, cfg: AppConfig, scope: RendererScope, extra?: (t: Tx, data: RenderData, state: OverlayPublicState, scope: RendererScope) => Promise<void>) {
  return withTenant(db, { organisationId: scope.organisationId }, async (t) => {
    const [o] = await t.select().from(overlays).where(eq(overlays.id, scope.overlayId));
    const [s] = await t.select().from(overlayState).where(eq(overlayState.overlayId, scope.overlayId));
    const [m] = await t.select().from(matches).where(eq(matches.id, o!.matchId));
    const [st] = await t.select().from(matchState).where(eq(matchState.matchId, m!.id));
    const [lu] = await t.select().from(matchLineups).where(eq(matchLineups.matchId, m!.id));
    const [comp] = await t.select().from(competitions).where(eq(competitions.id, m!.competitionId));
    const [venue] = m!.venueId ? await t.select().from(venues).where(eq(venues.id, m!.venueId)) : [undefined];
    const theme = await effectiveTheme(t, o!.themeProfileVersionId, o!.themeVersionId);
    const custom = await publishedCustomTemplates(t, scope.organisationId);
    const teams = lu!.teams as unknown as { home: SnapTeam; away: SnapTeam };
    const lineup = lu!.snapshot as unknown as LineupSnapshot;
    // approved resources: team logos, lineup photos, competition logo, theme logo, published template images
    const assetIds = new Set<string>();
    for (const x of [teams.home.logoAssetId, teams.away.logoAssetId, comp?.logoAssetId, theme.logoAssetId, theme.fontAssetId]) if (x) assetIds.add(x);
    // other teams' logos for tables, fixtures and the ticker; top scorers' photos
    const otherTeams = await t.select({ logoAssetId: teamsTable.logoAssetId }).from(teamsTable).where(and(eq(teamsTable.organisationId, scope.organisationId), eq(teamsTable.sport, m!.sport)));
    for (const x of otherTeams) if (x.logoAssetId) assetIds.add(x.logoAssetId);
    for (const p of [...lineup.home, ...lineup.away]) if (p.photoAssetId) assetIds.add(p.photoAssetId);
    for (const c of custom) for (const a of c.assetIds) assetIds.add(a);
    const ready = assetIds.size ? await t.select({ id: mediaAssets.id }).from(mediaAssets).where(and(inArray(mediaAssets.id, [...assetIds]), eq(mediaAssets.state, 'READY'))) : [];
    const assets: Record<string, string> = {};
    for (const a of ready) assets[a.id] = signedAssetUrl(cfg, scope.organisationId, a.id);
    const url = (id?: string | null) => (id && assets[id]) || null;
    const adapter = getAdapter(m!.sport);
    const statRows = adapter.capabilities(m!.rulesConfig as never).statRows;
    const now = Date.now();
    const pruned = pruneExpired(publicState(s!, o!), now, []);
    // accepted scoring, discipline and change events for the summary board
    const eventDefs = adapter.eventTypes(m!.rulesConfig as never);
    const factRows = await t.select().from(matchFacts).where(and(eq(matchFacts.matchId, m!.id), eq(matchFacts.category, 'event'), eq(matchFacts.voided, false))).orderBy(asc(matchFacts.sequence));
    const mainClock = (st!.clocks as Record<string, { direction?: string }>).main;
    const minuteOf = (clockMs: number | null) => (clockMs == null ? null : mainClock?.direction === 'down' ? `${Math.floor(clockMs / 60000)}:${String(Math.floor((clockMs % 60000) / 1000)).padStart(2, '0')}` : `${Math.floor(clockMs / 60000) + 1}'`);
    const events = factRows
      .map((f) => {
        const def = eventDefs.find((e) => e.type === f.type);
        const group: 'score' | 'discipline' | 'change' | 'other' = def?.group === 'score' || def?.group === 'discipline' || def?.group === 'change' ? def.group : 'other';
        return { id: f.id, type: f.type, group, side: (f.side as 'home' | 'away' | null) ?? null, playerId: f.playerId, minute: minuteOf(f.clockMs), periodId: f.periodId, payload: f.payload };
      })
      .filter((e) => e.group !== 'other')
      .slice(-80);
    const season = await renderSeasonTx(t, scope.organisationId, m!, url);
    const extraPhotos = season.season?.topScorers.map((x) => x.playerId) ?? [];
    void extraPhotos;
    const data: RenderData = {
      match: {
        id: m!.id,
        sport: m!.sport as Sport,
        rulesConfig: m!.rulesConfig,
        competition: { name: comp!.name, shortName: comp!.shortName, logoUrl: url(comp!.logoAssetId) },
        venue: venue?.name ?? null,
        scheduledAt: m!.scheduledAt.toISOString(),
        timezone: m!.timezone,
        teams: { home: { ...teams.home, logoUrl: url(teams.home.logoAssetId) }, away: { ...teams.away, logoUrl: url(teams.away.logoAssetId) } },
        lineup,
        projection: st!.projection as unknown as MatchProjection,
        clocks: st!.clocks as never,
        stateVersion: st!.stateVersion,
        statRows,
        round: m!.round,
        attendance: m!.attendance,
        weather: (m!.weather as RenderData['match']['weather']) ?? null,
        officials: (m!.officials as { role: string; name: string }[]) ?? [],
        events,
      },
      players: playerIndex(lineup, url),
      assets,
      creatives: {},
      theme: { ...theme.config, logoUrl: url(theme.logoAssetId), fontUrl: url(theme.fontAssetId) },
      customTemplates: custom.map((c) => ({ key: c.key, scene: c.scene })),
      format: (o!.format as RenderData['format']) ?? '16:9',
      season: season.season,
      preview: season.preview,
    };
    if (extra) await extra(t, data, pruned.state, scope);
    return { overlay: { id: o!.id, name: o!.name, purpose: scope.purpose, matchId: m!.id }, state: pruned.state, data, serverNow: now };
  });
}

/** Renderer acknowledgement: the revision actually displayed (production/compositor renderers only). */
export async function rendererDisplayed(db: Db, scope: RendererScope, rendererSessionId: string, revision: number) {
  if (!Number.isInteger(revision) || revision < 0) return;
  await withTenant(db, { organisationId: scope.organisationId }, async (t) => {
    await t.update(rendererSessions).set({ displayedRevision: revision, lastSeenAt: new Date() }).where(and(eq(rendererSessions.id, rendererSessionId), eq(rendererSessions.overlayId, scope.overlayId)));
    if (scope.purpose !== 'production' && scope.purpose !== 'compositor') return;
    const [s] = await t
      .update(overlayState)
      .set({ displayedRevision: sql`greatest(${overlayState.displayedRevision}, ${revision})`, displayedAt: new Date() })
      .where(and(eq(overlayState.overlayId, scope.overlayId), sql`${overlayState.revision} >= ${revision}`))
      .returning();
    if (s) await enqueueOutbox(t, { organisationId: scope.organisationId, topic: 'renderer.revision.displayed', aggregateType: 'overlay', aggregateId: scope.overlayId, payload: { revision, purpose: scope.purpose, rendererSessionId, at: Date.now() } });
  });
}

export async function rendererConnected(db: Db, scope: RendererScope, instanceId: string) {
  return withTenant(db, { organisationId: scope.organisationId }, async (t) => {
    const [r] = await t.insert(rendererSessions).values({ organisationId: scope.organisationId, overlayId: scope.overlayId, purpose: scope.purpose, instanceId }).returning();
    // Reporting authority: the compositor for cloud programmes, else the first connected production renderer.
    if (scope.purpose === 'compositor' || scope.purpose === 'production') {
      const current = await t.select().from(rendererSessions).where(and(eq(rendererSessions.overlayId, scope.overlayId), eq(rendererSessions.isReportingAuthority, true), isNull(rendererSessions.disconnectedAt)));
      const takeOver = scope.purpose === 'compositor' && current.some((c) => c.purpose !== 'compositor');
      if (!current.length || takeOver) {
        if (takeOver) await t.update(rendererSessions).set({ isReportingAuthority: false }).where(and(eq(rendererSessions.overlayId, scope.overlayId), eq(rendererSessions.isReportingAuthority, true)));
        await t.update(rendererSessions).set({ isReportingAuthority: true }).where(eq(rendererSessions.id, r!.id));
        r!.isReportingAuthority = true;
      }
    }
    return r!;
  });
}

export async function rendererDisconnected(db: Db, scope: RendererScope, rendererSessionId: string) {
  await withTenant(db, { organisationId: scope.organisationId }, async (t) => {
    await t.update(rendererSessions).set({ disconnectedAt: new Date(), isReportingAuthority: false }).where(eq(rendererSessions.id, rendererSessionId));
  });
}

export type { Actor };
export { invalid, emptyState };

/**
 * Worker-side state mutation outside the command reducer (sponsor slot rotation, expiry sweep). Fenced like
 * automation commands; returns null when nothing changed.
 */
export async function mutateOverlayStateTx(t: Tx, organisationId: string, overlayId: string, fence: CommandOpts['fence'], fn: (s: OverlayPublicState, now: number) => OverlayPublicState | null, now = Date.now()) {
  const [row] = await t.select().from(overlayState).where(eq(overlayState.overlayId, overlayId)).for('update');
  const [o] = await t.select().from(overlays).where(eq(overlays.id, overlayId));
  if (!row || !o) return null;
  if (fence) {
    const ok = await t.execute(sql`select 1 from worker_leases where resource = ${fence.resource} and owner = ${fence.owner} and fence = ${fence.fence} and expires_at > now()`);
    if (!ok.rows.length) throw new AppError('FENCED', 409, 'Automation ownership was lost; mutation refused');
  }
  const next = fn(publicState(row, o), now);
  if (!next) return null;
  const revision = row.revision + 1;
  const [u] = await t
    .update(overlayState)
    .set({ revision, layers: next.layers as never, slots: (next.slots ?? {}) as never, scorebugVisible: next.scorebugVisible, updatedAt: new Date(now) })
    .where(and(eq(overlayState.overlayId, overlayId), eq(overlayState.revision, row.revision)))
    .returning();
  if (!u) return null;
  const st = publicState(u, o);
  await enqueueOutbox(t, { organisationId, topic: 'overlay.state.updated', aggregateType: 'overlay', aggregateId: overlayId, aggregateSeq: revision, payload: { ...st, serverNow: now } as never });
  return st;
}
