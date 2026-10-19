import type { AppConfig } from '@bs/config';
import { memberships, permissionGrants, withTenant, type Db, type Tx } from '@bs/db';
import { and, eq } from 'drizzle-orm';
import type { Actor, Grant } from './authz';
import type { Mailer } from './mail';
import type { Storage } from './storage';
import type { JobQueues } from './queues';
import type { MediaProvider } from '@bs/media';

export interface Deps {
  db: Db;
  config: AppConfig;
  mailer?: Mailer;
  storage?: Storage;
  queues?: JobQueues;
  media?: MediaProvider;
  now?: () => number;
}

export interface Ctx extends Deps {
  actor: Actor;
}

export const nowMs = (d: Deps) => (d.now ? d.now() : Date.now());

/** Run in the actor's tenant context (RLS + explicit org filters in queries). */
export function tx<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(ctx.db, { organisationId: ctx.actor.organisationId, userId: ctx.actor.userId }, fn);
}

/** Load the actor for a user within an organisation; null when not an active member. */
export async function resolveActor(db: Db, userId: string, organisationId: string, requestId?: string): Promise<Actor | null> {
  return withTenant(db, { organisationId, userId }, async (t) => {
    const [m] = await t
      .select()
      .from(memberships)
      .where(and(eq(memberships.organisationId, organisationId), eq(memberships.userId, userId), eq(memberships.status, 'active')));
    if (!m) return null;
    const grants = await t.select().from(permissionGrants).where(eq(permissionGrants.membershipId, m.id));
    return {
      kind: 'user',
      userId,
      organisationId,
      membershipId: m.id,
      role: m.role,
      accessVersion: m.accessVersion,
      grants: grants.map((g) => ({ action: g.action, scopeType: g.scopeType as Grant['scopeType'], scopeId: g.scopeId, expiresAt: g.expiresAt })),
      requestId,
    } satisfies Actor;
  });
}
