import crypto from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  auditLogs,
  entitlements,
  invitations,
  memberships,
  organisations,
  permissionGrants,
  sessions,
  users,
  withTenant,
  withUser,
  ROLES,
  type Db,
  type Role,
} from '@bs/db';
import { z } from 'zod';
import { assertCan, type Actor } from './authz';
import { audit } from './audit';
import { randomToken, sha256 } from './crypto';
import { AppError, conflict, forbidden, invalid, notFound } from './errors';
import { tx, type Ctx, type Deps } from './context';
import { emailLayout } from './mail';
import { enqueueOutbox } from './outbox';
import { isValidTimeZone } from '@bs/domain';

export const DEFAULT_FEATURES = { graphics: true, automation: true, streaming: true, highlights: true, storage: true };
export const DEFAULT_LIMITS = { maxConcurrentProgrammes: 1, storageGb: 100, maxDestinationsPerOutput: 3, maxUploadMb: 500 };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'org';

export const createOrgInput = z.object({
  name: z.string().trim().min(2).max(80),
  timezone: z.string().refine(isValidTimeZone, 'Unknown timezone').default('Australia/Brisbane'),
  locale: z.string().default('en-AU'),
});

export async function createOrganisation(deps: Deps, userId: string, input: z.input<typeof createOrgInput>) {
  const data = createOrgInput.parse(input);
  const id = crypto.randomUUID();
  const base = slugify(data.name);
  return withTenant(deps.db, { organisationId: id, userId }, async (t) => {
    // Other tenants' slugs are invisible under RLS, so always add a short unique suffix.
    const slug = `${base}-${id.slice(0, 6)}`;
    const [o] = await t.insert(organisations).values({ id, name: data.name, slug, timezone: data.timezone, locale: data.locale, createdBy: userId }).returning();
    const [m] = await t.insert(memberships).values({ organisationId: id, userId, role: 'owner' }).returning();
    await t.insert(entitlements).values({ organisationId: id, features: DEFAULT_FEATURES, limits: { ...DEFAULT_LIMITS, maxConcurrentProgrammes: deps.config.MAX_CONCURRENT_PROGRAMMES } });
    await t.insert(auditLogs).values({ organisationId: id, actorUserId: userId, action: 'organisation.create', resourceType: 'organisation', resourceId: id, after: { name: data.name } });
    return { organisation: o!, membership: m! };
  });
}

export async function listMyOrganisations(db: Db, userId: string) {
  return withUser(db, userId, async (t) =>
    t
      .select({ id: organisations.id, name: organisations.name, slug: organisations.slug, role: memberships.role, timezone: organisations.timezone, locale: organisations.locale })
      .from(memberships)
      .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active'), eq(organisations.status, 'active')))
      .orderBy(organisations.name),
  );
}

/** Explicit context switch: verified membership, then stored on the session row. */
export async function switchOrganisation(db: Db, userId: string, sessionId: string, organisationId: string) {
  const orgs = await listMyOrganisations(db, userId);
  if (!orgs.some((o) => o.id === organisationId)) throw notFound('Organisation');
  await db.update(sessions).set({ activeOrganisationId: organisationId, updatedAt: new Date() }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  return orgs.find((o) => o.id === organisationId)!;
}

export async function getOrganisation(ctx: Ctx) {
  return tx(ctx, async (t) => {
    const [o] = await t.select().from(organisations).where(eq(organisations.id, ctx.actor.organisationId));
    const [e] = await t.select().from(entitlements).where(eq(entitlements.organisationId, ctx.actor.organisationId));
    return { ...o!, entitlements: e ?? null };
  });
}

export const updateOrgInput = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().refine(isValidTimeZone, 'Unknown timezone').optional(),
  locale: z.string().max(20).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  onboarding: z.record(z.string(), z.unknown()).optional(),
});

export async function updateOrganisation(ctx: Ctx, input: z.input<typeof updateOrgInput>) {
  const data = updateOrgInput.parse(input);
  if (data.onboarding && Object.keys(data).length === 1) assertCan(ctx.actor, 'competition.write');
  else assertCan(ctx.actor, 'org.manage');
  return tx(ctx, async (t) => {
    const [before] = await t.select().from(organisations).where(eq(organisations.id, ctx.actor.organisationId));
    const [o] = await t
      .update(organisations)
      .set({ ...data, onboarding: data.onboarding ? { ...(before!.onboarding ?? {}), ...data.onboarding } : undefined, updatedAt: new Date() })
      .where(eq(organisations.id, ctx.actor.organisationId))
      .returning();
    await audit(t, ctx.actor, 'organisation.update', 'organisation', o!.id, { before: { name: before!.name, timezone: before!.timezone }, after: data });
    return o!;
  });
}

// ------------------------------------------------------------------ members

export async function listMembers(ctx: Ctx) {
  assertCan(ctx.actor, 'org.read');
  return tx(ctx, async (t) => {
    const rows = await t
      .select({ id: memberships.id, userId: memberships.userId, role: memberships.role, status: memberships.status, name: users.name, email: users.email, createdAt: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organisationId, ctx.actor.organisationId))
      .orderBy(memberships.createdAt);
    const grants = await t.select().from(permissionGrants).where(eq(permissionGrants.organisationId, ctx.actor.organisationId));
    const full = ctx.actor.role === 'owner' || ctx.actor.role === 'admin';
    return rows.map((r) => ({ ...r, email: full || r.userId === ctx.actor.userId ? r.email : null, grants: grants.filter((g) => g.membershipId === r.id) }));
  });
}

const roleSchema = z.enum(ROLES);

async function bumpAccess(ctx: Ctx, t: Parameters<Parameters<typeof tx>[1]>[0], membershipId: string, userId: string) {
  await t.update(memberships).set({ accessVersion: sql`${memberships.accessVersion} + 1`, updatedAt: new Date() }).where(eq(memberships.id, membershipId));
  // Realtime layer disconnects this user's sockets for the organisation on receipt.
  await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'access.revoked', aggregateType: 'membership', aggregateId: membershipId, payload: { userId } });
}

export async function changeMemberRole(ctx: Ctx, membershipId: string, role: Role) {
  assertCan(ctx.actor, 'org.manage');
  roleSchema.parse(role);
  if (role === 'owner' && ctx.actor.role !== 'owner') throw forbidden('Only an owner can grant ownership');
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Member');
    if (m.role === 'owner' && ctx.actor.role !== 'owner') throw forbidden('Only an owner can change another owner');
    try {
      await t.update(memberships).set({ role }).where(eq(memberships.id, m.id));
    } catch (e) {
      if (String((e as { cause?: { message?: string } }).cause?.message ?? e).includes('at least one owner')) throw conflict('LAST_OWNER', 'An organisation must keep at least one owner');
      throw e;
    }
    await bumpAccess(ctx, t, m.id, m.userId);
    await audit(t, ctx.actor, 'member.role_change', 'membership', m.id, { before: { role: m.role }, after: { role } });
    return { ...m, role };
  });
}

export async function revokeMember(ctx: Ctx, membershipId: string) {
  assertCan(ctx.actor, 'org.manage');
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Member');
    if (m.role === 'owner' && ctx.actor.role !== 'owner') throw forbidden('Only an owner can remove an owner');
    try {
      await t.update(memberships).set({ status: 'revoked' }).where(eq(memberships.id, m.id));
    } catch (e) {
      if (String((e as { cause?: { message?: string } }).cause?.message ?? e).includes('at least one owner')) throw conflict('LAST_OWNER', 'An organisation must keep at least one owner');
      throw e;
    }
    await bumpAccess(ctx, t, m.id, m.userId);
    await audit(t, ctx.actor, 'member.revoke', 'membership', m.id, { before: { role: m.role, status: m.status } });
    return { ok: true };
  });
}

export const grantInput = z.object({
  action: z.string().min(1).max(40),
  scopeType: z.enum(['organisation', 'competition', 'team', 'match', 'overlay', 'output']),
  scopeId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function setMemberGrants(ctx: Ctx, membershipId: string, grants: z.input<typeof grantInput>[]) {
  assertCan(ctx.actor, 'org.manage');
  const parsed = grants.map((g) => grantInput.parse(g));
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Member');
    await t.delete(permissionGrants).where(eq(permissionGrants.membershipId, m.id));
    if (parsed.length) {
      await t.insert(permissionGrants).values(
        parsed.map((g) => ({ organisationId: ctx.actor.organisationId, membershipId: m.id, action: g.action, scopeType: g.scopeType, scopeId: g.scopeId ?? null, expiresAt: g.expiresAt ? new Date(g.expiresAt) : null })),
      );
    }
    await bumpAccess(ctx, t, m.id, m.userId);
    await audit(t, ctx.actor, 'member.grants', 'membership', m.id, { after: { grants: parsed } });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ invitations

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['admin', 'producer', 'operator', 'scorer', 'club_manager', 'viewer']),
  scopeType: z.enum(['competition', 'team', 'match']).nullable().optional(),
  scopeId: z.string().uuid().nullable().optional(),
});

export async function createInvitation(ctx: Ctx, input: z.input<typeof inviteInput>) {
  assertCan(ctx.actor, 'org.manage');
  const data = inviteInput.parse(input);
  if ((data.scopeType && !data.scopeId) || (!data.scopeType && data.scopeId)) throw invalid('Scope type and scope must be provided together');
  if (['scorer', 'operator', 'club_manager'].includes(data.role) && !data.scopeType) {
    throw invalid('Assign a scope (match, competition or team) for this role', [{ field: 'scopeType', message: 'Required for this role' }]);
  }
  const token = randomToken();
  const inv = await tx(ctx, async (t) => {
    const [row] = await t
      .insert(invitations)
      .values({
        organisationId: ctx.actor.organisationId,
        email: data.email,
        role: data.role,
        scopeType: data.scopeType ?? null,
        scopeId: data.scopeId ?? null,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        invitedBy: ctx.actor.userId,
      })
      .returning();
    await audit(t, ctx.actor, 'invitation.create', 'invitation', row!.id, { after: { email: data.email, role: data.role, scopeType: data.scopeType, scopeId: data.scopeId } });
    return row!;
  });
  const url = `${ctx.config.PUBLIC_WEB_URL}/invite/${token}`;
  if (ctx.mailer) {
    const m = emailLayout(ctx.config, 'You have been invited', `You have been invited to join as ${data.role.replace('_', ' ')}. The invitation expires in 7 days.`, { label: 'Accept invitation', url });
    await ctx.mailer.send(data.email, `Invitation to ${ctx.config.PRODUCT_NAME}`, m.text, m.html).catch((e) => console.error('invite mail failed', e.message));
  }
  if (ctx.config.AUTH_LOG_EMAIL_LINKS) console.log(`[invite] ${data.email}: ${url}`);
  return { invitation: { ...inv, tokenHash: undefined }, acceptUrl: ctx.config.AUTH_LOG_EMAIL_LINKS ? url : undefined, _token: token };
}

export async function listInvitations(ctx: Ctx) {
  assertCan(ctx.actor, 'org.manage');
  return tx(ctx, (t) =>
    t
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, scopeType: invitations.scopeType, scopeId: invitations.scopeId, expiresAt: invitations.expiresAt, acceptedAt: invitations.acceptedAt, revokedAt: invitations.revokedAt })
      .from(invitations)
      .where(and(eq(invitations.organisationId, ctx.actor.organisationId), isNull(invitations.acceptedAt)))
      .orderBy(desc(invitations.createdAt)),
  );
}

export async function revokeInvitation(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'org.manage');
  return tx(ctx, async (t) => {
    const r = await t.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.id, id), eq(invitations.organisationId, ctx.actor.organisationId))).returning();
    if (!r.length) throw notFound('Invitation');
    await audit(t, ctx.actor, 'invitation.revoke', 'invitation', id);
    return { ok: true };
  });
}

/** Accept with the token from the email; the signed-in user's verified email must match. */
export async function acceptInvitation(deps: Deps, user: { id: string; email: string; emailVerified: boolean }, token: string) {
  const hash = sha256(token);
  const found = await deps.db.execute<{ organisation_id: string; id: string; email: string; role: Role; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }>(
    sql`select * from resolve_invitation(${hash})`,
  );
  const inv = found.rows[0];
  if (!inv || inv.revoked_at || inv.accepted_at || new Date(inv.expires_at).getTime() < Date.now()) {
    throw new AppError('INVITATION_INVALID', 410, 'This invitation is invalid, expired or has already been used');
  }
  if (!user.emailVerified) throw forbidden('Verify your email before accepting an invitation');
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw forbidden('This invitation was sent to a different email address');
  return withTenant(deps.db, { organisationId: inv.organisation_id, userId: user.id }, async (t) => {
    const [full] = await t.select().from(invitations).where(eq(invitations.id, inv.id));
    const [existing] = await t.select().from(memberships).where(and(eq(memberships.organisationId, inv.organisation_id), eq(memberships.userId, user.id)));
    let m = existing;
    if (existing) {
      [m] = await t.update(memberships).set({ status: 'active', role: existing.status === 'active' ? existing.role : inv.role, accessVersion: sql`${memberships.accessVersion} + 1` }).where(eq(memberships.id, existing.id)).returning();
    } else {
      [m] = await t.insert(memberships).values({ organisationId: inv.organisation_id, userId: user.id, role: inv.role }).returning();
    }
    if (full!.scopeType && full!.scopeId) {
      const actions: Record<string, string[]> = {
        scorer: ['match.score'],
        operator: ['overlay.operate', 'stream.manage', 'sponsor.trigger'],
        club_manager: ['team_assets.write', 'media.edit'],
        viewer: ['competition.read', 'media.read'],
        producer: [],
        admin: [],
      };
      const list = actions[inv.role] ?? [];
      if (list.length) {
        await t.insert(permissionGrants).values(list.map((action) => ({ organisationId: inv.organisation_id, membershipId: m!.id, action, scopeType: full!.scopeType!, scopeId: full!.scopeId })));
      }
    }
    await t.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await t.insert(auditLogs).values({ organisationId: inv.organisation_id, actorUserId: user.id, action: 'invitation.accept', resourceType: 'membership', resourceId: m!.id, after: { role: inv.role } });
    return { organisationId: inv.organisation_id, membershipId: m!.id, role: m!.role };
  });
}

export async function listAudit(ctx: Ctx, opts: { limit?: number; resourceType?: string; resourceId?: string } = {}) {
  const full = ctx.actor.role === 'owner' || ctx.actor.role === 'admin';
  const production = ctx.actor.role === 'producer';
  if (!full && !production && !ctx.actor.userId) throw forbidden();
  return tx(ctx, async (t) => {
    const conds = [eq(auditLogs.organisationId, ctx.actor.organisationId)];
    if (!full && !production) conds.push(eq(auditLogs.actorUserId, ctx.actor.userId!)); // own actions only
    if (production) conds.push(inArray(auditLogs.resourceType, ['match', 'match_fact', 'overlay', 'output_session', 'broadcast_session', 'stream_output', 'destination', 'input', 'clip', 'recording', 'scorer_lease', 'game_plan', 'theme_profile']));
    if (opts.resourceType) conds.push(eq(auditLogs.resourceType, opts.resourceType));
    if (opts.resourceId) conds.push(eq(auditLogs.resourceId, opts.resourceId));
    return t.select().from(auditLogs).where(and(...conds)).orderBy(desc(auditLogs.id)).limit(Math.min(opts.limit ?? 100, 500));
  });
}

export async function setEntitlements(ctx: Ctx, input: { plan?: string; features?: Partial<typeof DEFAULT_FEATURES>; limits?: Partial<typeof DEFAULT_LIMITS> }) {
  assertCan(ctx.actor, 'org.own');
  return tx(ctx, async (t) => {
    const [cur] = await t.select().from(entitlements).where(eq(entitlements.organisationId, ctx.actor.organisationId));
    const limits = { ...(cur?.limits ?? DEFAULT_LIMITS), ...(input.limits ?? {}) };
    // Installation-level ceilings cannot be raised by tenants.
    limits.maxConcurrentProgrammes = Math.min(limits.maxConcurrentProgrammes ?? 1, ctx.config.MAX_CONCURRENT_PROGRAMMES);
    limits.maxDestinationsPerOutput = Math.min(limits.maxDestinationsPerOutput ?? 3, ctx.config.MAX_DESTINATIONS_PER_OUTPUT);
    const features = { ...(cur?.features ?? DEFAULT_FEATURES), ...(input.features ?? {}) };
    const [row] = await t
      .insert(entitlements)
      .values({ organisationId: ctx.actor.organisationId, plan: input.plan ?? cur?.plan ?? 'self-hosted', features, limits, updatedBy: ctx.actor.userId })
      .onConflictDoUpdate({ target: entitlements.organisationId, set: { plan: input.plan ?? cur?.plan ?? 'self-hosted', features, limits, updatedBy: ctx.actor.userId, updatedAt: new Date() } })
      .returning();
    await audit(t, ctx.actor, 'entitlements.update', 'organisation', ctx.actor.organisationId, { before: cur ?? undefined, after: row });
    await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'entitlements.updated', aggregateType: 'organisation', aggregateId: ctx.actor.organisationId, payload: { features, limits } });
    return row!;
  });
}

export async function requireFeature(ctx: Ctx, feature: keyof typeof DEFAULT_FEATURES) {
  const [e] = await tx(ctx, (t) => t.select().from(entitlements).where(eq(entitlements.organisationId, ctx.actor.organisationId)));
  if (e && e.features[feature] === false) throw new AppError('FEATURE_DISABLED', 403, `The ${feature} module is not enabled for this organisation`);
  return e;
}

export type { Actor };
