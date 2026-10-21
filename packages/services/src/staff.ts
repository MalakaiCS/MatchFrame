// Site-wide staff (Owner, Admin, Moderator, Support): the people who run the installation, across every
// organisation. Directories read through staff-only row-level security policies; anything done to an organisation
// runs in that organisation's tenant context (explicit organisation filters, RLS as the backstop) and is written to
// the organisation's own audit log and to the staff log.
import { and, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  auditLogs,
  competitions,
  entitlements,
  matches,
  mediaAssets,
  memberships,
  organisations,
  overlays,
  platformAuditLogs,
  platformStaff,
  sessions,
  shareLinks,
  teams,
  users,
  withTenant,
  withUser,
  type Db,
  type Tx,
} from '@bs/db';
import { canActOnAccount, canManageStaff, isStaffRole, staffCan, STAFF_LABELS, STAFF_ROLES, type StaffAction, type StaffRole } from '@bs/domain';
import { z } from 'zod';
import { safeSnapshot } from './audit';
import { applyManualPlan, PLAN_KEYS, type PlanKey } from './billing';
import type { Deps } from './context';
import { AppError, conflict, invalid, notFound } from './errors';
import { enqueueOutbox } from './outbox';

export interface StaffMember {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
  /** "config": an Owner named in PLATFORM_OWNER_EMAILS (changed there, not in the console) */
  source: 'granted' | 'config';
}

export interface StaffCtx extends Deps {
  staff: StaffMember;
  requestId?: string;
}

const PAGE = 50;
const reason = z.string().trim().min(3, 'Say why (at least 3 characters)').max(500);
const configOwners = (deps: Deps) => new Set(deps.config.PLATFORM_OWNER_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));

function need(ctx: StaffCtx, action: StaffAction) {
  if (!staffCan(ctx.staff.role, action)) throw new AppError('FORBIDDEN', 403, `${STAFF_LABELS[ctx.staff.role]} staff cannot do that`);
}

async function log(db: Db | Tx, ctx: StaffCtx | { staff: Pick<StaffMember, 'userId' | 'role'> }, action: string, targetType: string, targetId: string | null, opts: { organisationId?: string | null; reason?: string | null; detail?: unknown } = {}) {
  await db.insert(platformAuditLogs).values({ actorUserId: ctx.staff.userId, actorRole: ctx.staff.role, action, targetType, targetId, organisationId: opts.organisationId ?? null, reason: opts.reason ?? null, detail: safeSnapshot(opts.detail) ?? {} });
}

/** The organisation's own audit log shows what staff did to it. */
async function orgAudit(t: Tx, ctx: StaffCtx, organisationId: string, action: string, resourceType: string, resourceId: string | null, opts: { after?: unknown; reason?: string | null } = {}) {
  await t.insert(auditLogs).values({ organisationId, actorUserId: ctx.staff.userId, actorType: 'staff', action, resourceType, resourceId, requestId: ctx.requestId ?? null, after: safeSnapshot(opts.after), reason: opts.reason ?? null });
}

/** In the organisation's tenant context, as this staff member. */
const inOrg = <T>(ctx: StaffCtx, organisationId: string, fn: (t: Tx) => Promise<T>) => withTenant(ctx.db, { organisationId, userId: ctx.staff.userId }, fn);
/** Across organisations (staff read policies), as this staff member. */
const across = <T>(ctx: StaffCtx, fn: (t: Tx) => Promise<T>) => withUser(ctx.db, ctx.staff.userId, fn);

// ------------------------------------------------------------------ who is staff

/**
 * The staff role of a signed-in account, or null. Owners named in PLATFORM_OWNER_EMAILS (verified email) are kept
 * in step with the configuration: added when they first sign in, removed when taken out of it.
 */
export async function resolveStaff(deps: Deps, user: { id: string; email: string; name: string; emailVerified: boolean }): Promise<StaffMember | null> {
  const [row] = await deps.db.select().from(platformStaff).where(eq(platformStaff.userId, user.id));
  if (user.emailVerified && configOwners(deps).has(user.email.toLowerCase())) {
    if (!row || row.role !== 'owner' || row.source !== 'config') {
      await deps.db.insert(platformStaff).values({ userId: user.id, role: 'owner', source: 'config' }).onConflictDoUpdate({ target: platformStaff.userId, set: { role: 'owner', source: 'config', updatedAt: new Date() } });
      await log(deps.db, { staff: { userId: user.id, role: 'owner' } }, 'staff.owner_from_config', 'user', user.id, { detail: { before: row?.role ?? null } });
    }
    return { userId: user.id, email: user.email, name: user.name, role: 'owner', source: 'config' };
  }
  if (row?.source === 'config') {
    await deps.db.delete(platformStaff).where(and(eq(platformStaff.userId, user.id), eq(platformStaff.source, 'config')));
    await log(deps.db, { staff: { userId: user.id, role: 'owner' } }, 'staff.owner_removed_from_config', 'user', user.id);
    return null;
  }
  if (!row || !user.emailVerified || !isStaffRole(row.role)) return null;
  return { userId: user.id, email: user.email, name: user.name, role: row.role, source: row.source as 'granted' };
}

// ------------------------------------------------------------------ organisations

export async function listOrganisations(ctx: StaffCtx, q: { search?: string; status?: string; page?: number } = {}) {
  need(ctx, 'directory.read');
  const page = Math.max(0, Number(q.page ?? 0) || 0);
  return across(ctx, async (t) => {
    const conds: SQL[] = [];
    if (q.search?.trim()) {
      const s = `%${q.search.trim()}%`;
      conds.push(or(ilike(organisations.name, s), ilike(organisations.slug, s), sql`exists (select 1 from memberships m join users u on u.id = m.user_id where m.organisation_id = ${organisations.id} and u.email ilike ${s})`)!);
    }
    if (q.status && ['active', 'suspended', 'deleted'].includes(q.status)) conds.push(eq(organisations.status, q.status));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await t
      .select({
        id: organisations.id,
        name: organisations.name,
        slug: organisations.slug,
        status: organisations.status,
        suspendedAt: organisations.suspendedAt,
        createdAt: organisations.createdAt,
        plan: entitlements.plan,
        members: sql<number>`(select count(*)::int from memberships m where m.organisation_id = ${organisations.id} and m.status = 'active')`,
        owners: sql<string | null>`(select string_agg(u.email, ', ' order by u.email) from memberships m join users u on u.id = m.user_id where m.organisation_id = ${organisations.id} and m.role = 'owner' and m.status = 'active')`,
      })
      .from(organisations)
      .leftJoin(entitlements, eq(entitlements.organisationId, organisations.id))
      .where(where)
      .orderBy(organisations.name)
      .limit(PAGE)
      .offset(page * PAGE);
    const [total] = await t.select({ n: count() }).from(organisations).where(where);
    return { items: rows, total: total?.n ?? 0, page, pageSize: PAGE };
  });
}

export async function getOrganisation(ctx: StaffCtx, organisationId: string) {
  need(ctx, 'organisation.view');
  const [o] = await across(ctx, (t) => t.select().from(organisations).where(eq(organisations.id, organisationId)));
  if (!o) throw notFound('Organisation');
  const detail = await inOrg(ctx, organisationId, async (t) => {
    const org = eq(memberships.organisationId, organisationId);
    const members = await t
      .select({ membershipId: memberships.id, userId: users.id, name: users.name, email: users.email, role: memberships.role, status: memberships.status, disabledAt: users.disabledAt, joinedAt: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(org)
      .orderBy(memberships.role, users.name);
    const [ent] = await t.select({ plan: entitlements.plan, limits: entitlements.limits, features: entitlements.features }).from(entitlements).where(eq(entitlements.organisationId, organisationId));
    const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const counts = {
      competitions: await n(t.select({ n: count() }).from(competitions).where(eq(competitions.organisationId, organisationId))),
      matches: await n(t.select({ n: count() }).from(matches).where(eq(matches.organisationId, organisationId))),
      liveMatches: await n(t.select({ n: count() }).from(matches).where(and(eq(matches.organisationId, organisationId), eq(matches.status, 'live')))),
      outputs: await n(t.select({ n: count() }).from(overlays).where(eq(overlays.organisationId, organisationId))),
      storageBytes: Number((await t.select({ n: sql<string>`coalesce(sum(${mediaAssets.bytes}), 0)` }).from(mediaAssets).where(eq(mediaAssets.organisationId, organisationId)))[0]?.n ?? 0),
    };
    const home = sql<string>`(select name from teams where teams.id = ${matches.homeTeamId})`;
    const away = sql<string>`(select name from teams where teams.id = ${matches.awayTeamId})`;
    // public pages: which matches have a public page (the link itself is not shown here)
    const publicPages = await t
      .select({ matchId: matches.id, home, away, scheduledAt: matches.scheduledAt, status: matches.status })
      .from(matches)
      .where(and(eq(matches.organisationId, organisationId), isNotNull(matches.publicToken)))
      .orderBy(desc(matches.scheduledAt))
      .limit(100);
    const links = await t
      .select({ id: shareLinks.id, resourceType: shareLinks.resourceType, publicId: shareLinks.publicId, expiresAt: shareLinks.expiresAt, accessCount: shareLinks.accessCount, createdAt: shareLinks.createdAt })
      .from(shareLinks)
      .where(and(eq(shareLinks.organisationId, organisationId), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, new Date()))))
      .orderBy(desc(shareLinks.createdAt))
      .limit(100);
    const activity = await t
      .select({ id: auditLogs.id, action: auditLogs.action, actorType: auditLogs.actorType, actor: users.email, resourceType: auditLogs.resourceType, reason: auditLogs.reason, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(eq(auditLogs.organisationId, organisationId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(30);
    return { members, entitlements: ent ?? null, counts, publicPages, shareLinks: links, activity };
  });
  // looking at an organisation is recorded too (at most once every 30 minutes per staff member)
  const [recent] = await ctx.db
    .select({ id: platformAuditLogs.id })
    .from(platformAuditLogs)
    .where(and(eq(platformAuditLogs.actorUserId, ctx.staff.userId), eq(platformAuditLogs.action, 'organisation.view'), eq(platformAuditLogs.targetId, organisationId), gt(platformAuditLogs.createdAt, new Date(Date.now() - 30 * 60_000))))
    .limit(1);
  if (!recent) await log(ctx.db, ctx, 'organisation.view', 'organisation', organisationId, { organisationId });
  return {
    organisation: { id: o.id, name: o.name, slug: o.slug, status: o.status, timezone: o.timezone, locale: o.locale, customDomain: o.customDomain, requireTwoFactor: o.requireTwoFactor, suspendedAt: o.suspendedAt, suspendedReason: o.suspendedReason, createdAt: o.createdAt },
    ...detail,
  };
}

export async function suspendOrganisation(ctx: StaffCtx, organisationId: string, input: { reason: string }) {
  need(ctx, 'organisation.suspend');
  const why = reason.parse(input.reason);
  return inOrg(ctx, organisationId, async (t) => {
    const [o] = await t.select().from(organisations).where(eq(organisations.id, organisationId)).for('update');
    if (!o || o.status === 'deleted') throw notFound('Organisation');
    if (o.status === 'suspended') throw conflict('ALREADY_SUSPENDED', 'This organisation is already suspended');
    await t.update(organisations).set({ status: 'suspended', suspendedAt: new Date(), suspendedReason: why, updatedAt: new Date() }).where(eq(organisations.id, organisationId));
    // connected app sessions and graphics outputs of the organisation are dropped (they cannot reconnect)
    await enqueueOutbox(t, { organisationId, topic: 'organisation.suspended', aggregateType: 'organisation', aggregateId: organisationId, payload: {} });
    await orgAudit(t, ctx, organisationId, 'staff.organisation.suspend', 'organisation', organisationId, { reason: why });
    await log(t, ctx, 'organisation.suspend', 'organisation', organisationId, { organisationId, reason: why, detail: { name: o.name } });
    return { status: 'suspended' as const };
  });
}

export async function reactivateOrganisation(ctx: StaffCtx, organisationId: string, input: { reason?: string } = {}) {
  need(ctx, 'organisation.suspend');
  const why = input.reason?.trim() ? reason.parse(input.reason) : null;
  return inOrg(ctx, organisationId, async (t) => {
    const [o] = await t.select().from(organisations).where(eq(organisations.id, organisationId)).for('update');
    if (!o || o.status === 'deleted') throw notFound('Organisation');
    if (o.status !== 'suspended') throw conflict('NOT_SUSPENDED', 'This organisation is not suspended');
    await t.update(organisations).set({ status: 'active', suspendedAt: null, suspendedReason: null, updatedAt: new Date() }).where(eq(organisations.id, organisationId));
    await orgAudit(t, ctx, organisationId, 'staff.organisation.reactivate', 'organisation', organisationId, { reason: why });
    await log(t, ctx, 'organisation.reactivate', 'organisation', organisationId, { organisationId, reason: why, detail: { name: o.name } });
    return { status: 'active' as const };
  });
}

export async function setOrganisationPlan(ctx: StaffCtx, organisationId: string, input: { plan: string; reason: string }) {
  need(ctx, 'organisation.plan');
  const d = z.object({ plan: z.enum(PLAN_KEYS), reason }).parse(input);
  return inOrg(ctx, organisationId, async (t) => {
    const [o] = await t.select().from(organisations).where(eq(organisations.id, organisationId));
    if (!o || o.status === 'deleted') throw notFound('Organisation');
    const [cur] = await t.select({ plan: entitlements.plan }).from(entitlements).where(eq(entitlements.organisationId, organisationId));
    await applyManualPlan(t, organisationId, d.plan as PlanKey, ctx.staff.userId);
    await orgAudit(t, ctx, organisationId, 'staff.billing.plan', 'organisation', organisationId, { after: { plan: d.plan }, reason: d.reason });
    await log(t, ctx, 'organisation.plan', 'organisation', organisationId, { organisationId, reason: d.reason, detail: { before: cur?.plan ?? null, after: d.plan } });
    return { plan: d.plan };
  });
}

// ------------------------------------------------------------------ public content

/** Turn off a match's public page (match centre and its feed). The organisation can share it again later. */
export async function takeDownMatchPage(ctx: StaffCtx, organisationId: string, matchId: string, input: { reason: string }) {
  need(ctx, 'content.takedown');
  const why = reason.parse(input.reason);
  return inOrg(ctx, organisationId, async (t) => {
    const [m] = await t.update(matches).set({ publicToken: null, updatedAt: new Date() }).where(and(eq(matches.id, matchId), eq(matches.organisationId, organisationId), isNotNull(matches.publicToken))).returning({ id: matches.id });
    if (!m) throw notFound('Public match page');
    await orgAudit(t, ctx, organisationId, 'staff.match.unshare', 'match', matchId, { reason: why });
    await log(t, ctx, 'content.match_page_down', 'match', matchId, { organisationId, reason: why });
    return { ok: true };
  });
}

export async function revokeShareLink(ctx: StaffCtx, organisationId: string, shareId: string, input: { reason: string }) {
  need(ctx, 'content.takedown');
  const why = reason.parse(input.reason);
  return inOrg(ctx, organisationId, async (t) => {
    const [s] = await t.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.id, shareId), eq(shareLinks.organisationId, organisationId), isNull(shareLinks.revokedAt))).returning();
    if (!s) throw notFound('Share link');
    await orgAudit(t, ctx, organisationId, 'staff.share.revoke', s.resourceType, s.resourceId, { after: { shareId }, reason: why });
    await log(t, ctx, 'content.share_link_revoked', 'share_link', shareId, { organisationId, reason: why, detail: { resourceType: s.resourceType } });
    return { ok: true };
  });
}

/**
 * Which organisation a reported public link belongs to: a match page (/m/…) or a media share (/watch/… or /embed/…).
 * Nothing secret comes back: the organisation, what the link shows, and the id needed to take it down.
 */
export async function lookupPublicLink(ctx: StaffCtx, input: { url: string }) {
  need(ctx, 'content.takedown');
  const raw = z.string().trim().min(3).max(2000).parse(input.url);
  let path: string;
  try {
    path = new URL(raw, 'http://x').pathname;
  } catch {
    throw invalid('That is not a link', [{ field: 'url', message: 'Paste the whole link' }]);
  }
  const page = /^\/m\/([A-Za-z0-9_-]{8,})\/?$/.exec(path);
  const share = /^\/(?:watch|embed)\/([A-Za-z0-9_-]{4,})\/?$/.exec(path);
  const orgName = async (id: string) => (await across(ctx, (t) => t.select({ name: organisations.name, status: organisations.status }).from(organisations).where(eq(organisations.id, id))))[0];
  if (page) {
    const r = await ctx.db.execute<{ match_id: string; organisation_id: string }>(sql`select * from resolve_match_public_token(${page[1]})`);
    const hit = r.rows[0];
    if (!hit) throw notFound('Public match page');
    const m = await inOrg(ctx, hit.organisation_id, async (t) => {
      const [x] = await t.select({ id: matches.id, homeTeamId: matches.homeTeamId, awayTeamId: matches.awayTeamId, scheduledAt: matches.scheduledAt }).from(matches).where(and(eq(matches.id, hit.match_id), eq(matches.organisationId, hit.organisation_id)));
      const ts = await t.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.organisationId, hit.organisation_id), inArray(teams.id, [x!.homeTeamId, x!.awayTeamId])));
      return { id: x!.id, title: `${ts.find((y) => y.id === x!.homeTeamId)?.name ?? 'Home'} v ${ts.find((y) => y.id === x!.awayTeamId)?.name ?? 'Away'}`, scheduledAt: x!.scheduledAt };
    });
    return { kind: 'match_page' as const, organisation: { id: hit.organisation_id, ...(await orgName(hit.organisation_id)) }, match: m };
  }
  if (share) {
    const r = await ctx.db.execute<{ organisation_id: string; id: string; resource_type: string; expires_at: Date | null; revoked_at: Date | null }>(sql`select * from resolve_share_link(${share[1]})`);
    const hit = r.rows[0];
    if (!hit) throw notFound('Share link');
    return { kind: 'share_link' as const, organisation: { id: hit.organisation_id, ...(await orgName(hit.organisation_id)) }, shareLink: { id: hit.id, resourceType: hit.resource_type, expiresAt: hit.expires_at, revoked: !!hit.revoked_at } };
  }
  throw invalid('Not a public match page or media share link', [{ field: 'url', message: 'Links look like …/m/… , …/watch/… or …/embed/…' }]);
}

// ------------------------------------------------------------------ accounts

const lastActive = sql<Date | null>`(select max(s.updated_at) from sessions s where s.user_id = ${users.id})`;

export async function listUsers(ctx: StaffCtx, q: { search?: string; page?: number } = {}) {
  need(ctx, 'directory.read');
  const page = Math.max(0, Number(q.page ?? 0) || 0);
  return across(ctx, async (t) => {
    const s = q.search?.trim() ? `%${q.search.trim()}%` : null;
    const where = s ? or(ilike(users.email, s), ilike(users.name, s)) : undefined;
    const items = await t
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        twoFactorEnabled: users.twoFactorEnabled,
        disabledAt: users.disabledAt,
        createdAt: users.createdAt,
        staffRole: platformStaff.role,
        organisations: sql<number>`(select count(*)::int from memberships m where m.user_id = ${users.id} and m.status = 'active')`,
        lastActiveAt: lastActive,
      })
      .from(users)
      .leftJoin(platformStaff, eq(platformStaff.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(PAGE)
      .offset(page * PAGE);
    const [total] = await t.select({ n: count() }).from(users).where(where);
    return { items, total: total?.n ?? 0, page, pageSize: PAGE };
  });
}

export async function getUser(ctx: StaffCtx, userId: string) {
  need(ctx, 'user.view');
  return across(ctx, async (t) => {
    const [u] = await t
      .select({ id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified, twoFactorEnabled: users.twoFactorEnabled, disabledAt: users.disabledAt, disabledReason: users.disabledReason, createdAt: users.createdAt, staffRole: platformStaff.role, staffSource: platformStaff.source, lastActiveAt: lastActive })
      .from(users)
      .leftJoin(platformStaff, eq(platformStaff.userId, users.id))
      .where(eq(users.id, userId));
    if (!u) throw notFound('Account');
    const orgs = await t
      .select({ organisationId: organisations.id, name: organisations.name, organisationStatus: organisations.status, role: memberships.role, status: memberships.status })
      .from(memberships)
      .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
      .where(eq(memberships.userId, userId))
      .orderBy(organisations.name);
    const [signedIn] = await t.select({ n: count() }).from(sessions).where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
    return { ...u, organisations: orgs, activeSessions: signedIn?.n ?? 0 };
  });
}

async function targetAccount(ctx: StaffCtx, userId: string) {
  const [u] = await ctx.db.select({ id: users.id, email: users.email, emailVerified: users.emailVerified, disabledAt: users.disabledAt, staffRole: platformStaff.role }).from(users).leftJoin(platformStaff, eq(platformStaff.userId, users.id)).where(eq(users.id, userId));
  if (!u) throw notFound('Account');
  const ok = canActOnAccount(ctx.staff, { userId: u.id, staffRole: isStaffRole(u.staffRole) ? u.staffRole : null });
  if (!ok.ok) throw new AppError('FORBIDDEN', 403, ok.reason);
  return u;
}

/** The account cannot sign in, and every session it has ends now. */
export async function disableUser(ctx: StaffCtx, userId: string, input: { reason: string }) {
  need(ctx, 'user.disable');
  const why = reason.parse(input.reason);
  const u = await targetAccount(ctx, userId);
  if (u.disabledAt) throw conflict('ALREADY_DISABLED', 'This account is already disabled');
  return ctx.db.transaction(async (t) => {
    await t.update(users).set({ disabledAt: new Date(), disabledReason: why, updatedAt: new Date() }).where(eq(users.id, userId));
    const ended = await t.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
    await log(t, ctx, 'user.disable', 'user', userId, { reason: why, detail: { sessionsEnded: ended.length } });
    return { disabled: true, sessionsEnded: ended.length };
  });
}

export async function enableUser(ctx: StaffCtx, userId: string, input: { reason?: string } = {}) {
  need(ctx, 'user.disable');
  const why = input.reason?.trim() ? reason.parse(input.reason) : null;
  const u = await targetAccount(ctx, userId);
  if (!u.disabledAt) throw conflict('NOT_DISABLED', 'This account is not disabled');
  await ctx.db.update(users).set({ disabledAt: null, disabledReason: null, updatedAt: new Date() }).where(eq(users.id, userId));
  await log(ctx.db, ctx, 'user.enable', 'user', userId, { reason: why });
  return { disabled: false };
}

export async function signOutUser(ctx: StaffCtx, userId: string, input: { reason?: string } = {}) {
  need(ctx, 'user.sign_out');
  const why = input.reason?.trim() ? reason.parse(input.reason) : null;
  await targetAccount(ctx, userId);
  return ctx.db.transaction(async (t) => {
    const ended = await t.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
    await log(t, ctx, 'user.sign_out', 'user', userId, { reason: why, detail: { sessionsEnded: ended.length } });
    return { sessionsEnded: ended.length };
  });
}

/** Sends the verification email again (through the sign-in service, `send`). */
export async function resendVerification(ctx: StaffCtx, userId: string, send: (email: string) => Promise<void>) {
  need(ctx, 'user.resend_verification');
  const [u] = await ctx.db.select({ email: users.email, emailVerified: users.emailVerified, disabledAt: users.disabledAt }).from(users).where(eq(users.id, userId));
  if (!u) throw notFound('Account');
  if (u.emailVerified) throw conflict('ALREADY_VERIFIED', 'This email address is already verified');
  if (u.disabledAt) throw conflict('ACCOUNT_DISABLED', 'This account is disabled');
  await send(u.email);
  await log(ctx.db, ctx, 'user.resend_verification', 'user', userId);
  return { sent: true };
}

// ------------------------------------------------------------------ the staff team

export async function listStaff(ctx: StaffCtx) {
  need(ctx, 'directory.read');
  const rows = await ctx.db
    .select({ userId: platformStaff.userId, role: platformStaff.role, source: platformStaff.source, name: users.name, email: users.email, twoFactorEnabled: users.twoFactorEnabled, disabledAt: users.disabledAt, since: platformStaff.createdAt })
    .from(platformStaff)
    .innerJoin(users, eq(users.id, platformStaff.userId));
  return rows.sort((a, b) => STAFF_ROLES.indexOf(a.role as StaffRole) - STAFF_ROLES.indexOf(b.role as StaffRole) || a.name.localeCompare(b.name));
}

const roleInput = z.enum(STAFF_ROLES);

async function changeRole(ctx: StaffCtx, target: { id: string; email: string }, next: StaffRole | null) {
  return ctx.db.transaction(async (t) => {
    // one change at a time, so two Owners cannot remove each other at once
    await t.execute(sql`select pg_advisory_xact_lock(hashtext('platform_staff'))`);
    const [cur] = await t.select().from(platformStaff).where(eq(platformStaff.userId, target.id));
    const current = cur && isStaffRole(cur.role) ? cur.role : null;
    const ok = canManageStaff(ctx.staff, { userId: target.id, current }, next);
    if (!ok.ok) throw new AppError('FORBIDDEN', 403, ok.reason);
    if (cur?.source === 'config') throw conflict('OWNER_FROM_CONFIG', `${target.email} is an Owner through PLATFORM_OWNER_EMAILS; change it there`);
    if (current === next) return { userId: target.id, role: next };
    if (current === 'owner') {
      const [owners] = await t.select({ n: count() }).from(platformStaff).where(eq(platformStaff.role, 'owner'));
      if ((owners?.n ?? 0) <= 1) throw conflict('LAST_OWNER', 'There must be at least one Owner');
    }
    if (next) await t.insert(platformStaff).values({ userId: target.id, role: next, grantedBy: ctx.staff.userId }).onConflictDoUpdate({ target: platformStaff.userId, set: { role: next, grantedBy: ctx.staff.userId, updatedAt: new Date() } });
    else await t.delete(platformStaff).where(eq(platformStaff.userId, target.id));
    await log(t, ctx, next ? (current ? 'staff.change' : 'staff.add') : 'staff.remove', 'user', target.id, { detail: { email: target.email, before: current, after: next } });
    return { userId: target.id, role: next };
  });
}

/** Make an existing, verified account staff (by email), or change the role of someone already staff. */
export async function addStaff(ctx: StaffCtx, input: { email: string; role: string }) {
  need(ctx, 'staff.manage');
  const d = z.object({ email: z.string().trim().toLowerCase().email(), role: roleInput }).parse(input);
  const [u] = await ctx.db.select({ id: users.id, email: users.email, emailVerified: users.emailVerified, disabledAt: users.disabledAt }).from(users).where(eq(sql`lower(${users.email})`, d.email));
  if (!u) throw invalid('No account uses that email. Ask them to sign up first.', [{ field: 'email', message: 'No account with this email' }], 'NO_ACCOUNT');
  if (!u.emailVerified) throw invalid('That account has not verified its email yet', [{ field: 'email', message: 'Not verified yet' }], 'EMAIL_NOT_VERIFIED');
  if (u.disabledAt) throw conflict('ACCOUNT_DISABLED', 'That account is disabled');
  return changeRole(ctx, u, d.role);
}

export async function setStaffRole(ctx: StaffCtx, userId: string, input: { role: string }) {
  need(ctx, 'staff.manage');
  const role = roleInput.parse(input.role);
  const [u] = await ctx.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw notFound('Account');
  return changeRole(ctx, u, role);
}

export async function removeStaff(ctx: StaffCtx, userId: string) {
  need(ctx, 'staff.manage');
  const [u] = await ctx.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw notFound('Account');
  return changeRole(ctx, u, null);
}

// ------------------------------------------------------------------ the staff log

export async function listActivity(ctx: StaffCtx, q: { before?: number; limit?: number } = {}) {
  need(ctx, 'activity.read');
  const limit = Math.min(200, Math.max(1, Number(q.limit ?? 100) || 100));
  return ctx.db
    .select({ id: platformAuditLogs.id, action: platformAuditLogs.action, actorRole: platformAuditLogs.actorRole, actor: users.email, targetType: platformAuditLogs.targetType, targetId: platformAuditLogs.targetId, organisationId: platformAuditLogs.organisationId, reason: platformAuditLogs.reason, detail: platformAuditLogs.detail, createdAt: platformAuditLogs.createdAt })
    .from(platformAuditLogs)
    .leftJoin(users, eq(users.id, platformAuditLogs.actorUserId))
    .where(q.before ? lt(platformAuditLogs.id, Number(q.before)) : undefined)
    .orderBy(desc(platformAuditLogs.id))
    .limit(limit);
}
