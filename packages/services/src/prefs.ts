import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { notifications, userPreferences, type Db } from '@bs/db';
import { z } from 'zod';
import { tx, type Ctx } from './context';

const prefsSchema = z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length < 20_000, 'Preferences too large');

export async function getPrefs(db: Db, userId: string) {
  const [r] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return { prefs: (r?.prefs ?? {}) as Record<string, unknown> };
}

export async function mergePrefs(db: Db, userId: string, patch: unknown) {
  const p = prefsSchema.parse(patch);
  const cur = await getPrefs(db, userId);
  const next = { ...cur.prefs, ...p };
  await db.insert(userPreferences).values({ userId, prefs: next }).onConflictDoUpdate({ target: userPreferences.userId, set: { prefs: next, updatedAt: new Date() } });
  return { prefs: next };
}

export async function listNotifications(ctx: Ctx) {
  return tx(ctx, (t) =>
    t
      .select({ id: notifications.id, title: notifications.title, body: notifications.body, severity: notifications.severity, link: notifications.link, createdAt: notifications.createdAt })
      .from(notifications)
      .where(and(eq(notifications.organisationId, ctx.actor.organisationId), isNull(notifications.readAt), or(isNull(notifications.userId), ctx.actor.userId ? eq(notifications.userId, ctx.actor.userId) : isNull(notifications.userId))))
      .orderBy(desc(notifications.createdAt))
      .limit(30),
  );
}

export async function markNotificationRead(ctx: Ctx, id: string) {
  return tx(ctx, (t) => t.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.organisationId, ctx.actor.organisationId))));
}
