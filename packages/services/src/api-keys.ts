// Scoped API keys: bsk_<prefix>_<secret>. Only the hash is stored; scopes become grants on an operator-level actor
// so a key can never act as an unrestricted owner/admin.
import { and, desc, eq, sql } from 'drizzle-orm';
import { apiKeys, type Db } from '@bs/db';
import { z } from 'zod';
import { assertCan, type Actor, type Grant } from './authz';
import { audit } from './audit';
import { randomToken, safeEqual, sha256 } from './crypto';
import { notFound } from './errors';
import { tx, type Ctx } from './context';

export const apiKeyInput = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(z.object({ action: z.enum(['match.score', 'competition.read', 'overlay.operate', 'media.read', 'reports.read']), resourceType: z.enum(['organisation', 'competition', 'match']).default('organisation'), resourceId: z.string().uuid().optional() }))
    .min(1)
    .max(20),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

export async function createApiKey(ctx: Ctx, input: z.input<typeof apiKeyInput>) {
  assertCan(ctx.actor, 'org.manage');
  const d = apiKeyInput.parse(input);
  const prefix = randomToken(6).replace(/[-_]/g, 'x').slice(0, 8);
  const secret = randomToken(24);
  return tx(ctx, async (t) => {
    const [k] = await t
      .insert(apiKeys)
      .values({ organisationId: ctx.actor.organisationId, name: d.name, prefix, keyHash: sha256(secret), scopes: d.scopes, expiresAt: new Date(Date.now() + d.expiresInDays * 86_400_000), createdBy: ctx.actor.userId })
      .returning();
    await audit(t, ctx.actor, 'api_key.create', 'api_key', k!.id, { after: { name: d.name, scopes: d.scopes } });
    // The full key is shown once.
    return { id: k!.id, name: k!.name, prefix, scopes: k!.scopes, expiresAt: k!.expiresAt, key: `bsk_${prefix}_${secret}` };
  });
}

export async function listApiKeys(ctx: Ctx) {
  assertCan(ctx.actor, 'org.manage');
  return tx(ctx, (t) =>
    t.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes, expiresAt: apiKeys.expiresAt, revokedAt: apiKeys.revokedAt, lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt }).from(apiKeys).where(eq(apiKeys.organisationId, ctx.actor.organisationId)).orderBy(desc(apiKeys.createdAt)),
  );
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'org.manage');
  return tx(ctx, async (t) => {
    const r = await t.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.organisationId, ctx.actor.organisationId))).returning();
    if (!r.length) throw notFound('API key');
    await audit(t, ctx.actor, 'api_key.revoke', 'api_key', id);
    return { ok: true };
  });
}

export async function resolveApiKey(db: Db, raw: string, requestId?: string): Promise<Actor | null> {
  const m = /^bsk_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{20,})$/.exec(raw);
  if (!m) return null;
  const r = await db.execute<{ organisation_id: string; id: string; key_hash: string; scopes: { action: string; resourceType?: string; resourceId?: string }[]; expires_at: Date | null; revoked_at: Date | null }>(
    sql`select * from resolve_api_key(${m[1]!})`,
  );
  const k = r.rows[0];
  if (!k || k.revoked_at || (k.expires_at && new Date(k.expires_at).getTime() < Date.now()) || !safeEqual(k.key_hash, sha256(m[2]!))) return null;
  const grants: Grant[] = k.scopes.map((s) => ({ action: s.action, scopeType: (s.resourceType ?? 'organisation') as Grant['scopeType'], scopeId: s.resourceId ?? null }));
  return { kind: 'api_key', userId: null, organisationId: k.organisation_id, membershipId: null, role: 'operator', grants, accessVersion: 0, requestId };
}
