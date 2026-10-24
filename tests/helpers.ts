// Shared integration-test helpers: real PostgreSQL, application roles, no superuser shortcuts.
import crypto from 'node:crypto';
import { createDb, users } from '@bs/db';
import { getConfig } from '@bs/config';
import { orgs, resolveActor, type Actor, type Ctx, type Deps } from '@bs/services';

export function testDeps(): Deps & { close: () => Promise<void>; adminDb: ReturnType<typeof createDb>['db'] } {
  const config = getConfig();
  const app = createDb(config.DATABASE_URL, { max: 20 });
  const admin = createDb(config.DATABASE_ADMIN_URL!, { max: 4 });
  return {
    db: app.db,
    adminDb: admin.db,
    config,
    async close() {
      await app.pool.end();
      await admin.pool.end();
    },
  };
}

export async function makeUser(deps: { adminDb: ReturnType<typeof createDb>['db'] }, name = 'Test User') {
  const id = crypto.randomUUID();
  const email = `${id.slice(0, 8)}@example.test`;
  await deps.adminDb.insert(users).values({ id, name, email, emailVerified: true });
  return { id, email, name, emailVerified: true };
}

export async function makeOrg(deps: Deps & { adminDb: ReturnType<typeof createDb>['db'] }, name = 'Org') {
  const owner = await makeUser(deps, `${name} Owner`);
  const { organisation } = await orgs.createOrganisation(deps, owner.id, { name, timezone: 'Australia/Brisbane' });
  const actor = (await resolveActor(deps.db, owner.id, organisation.id))!;
  return { org: organisation, owner, actor, ctx: { ...deps, actor } as Ctx };
}

export async function actorFor(deps: Deps, userId: string, orgId: string): Promise<Actor> {
  const a = await resolveActor(deps.db, userId, orgId);
  if (!a) throw new Error('not a member');
  return a;
}
