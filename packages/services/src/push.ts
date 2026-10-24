// Web Push for reminders: subscriptions are saved per browser; sending needs VAPID keys in the environment.
import { and, eq } from 'drizzle-orm';
import { pushSubscriptions, type Db } from '@bs/db';
import { z } from 'zod';
import webpush from 'web-push';
import type { AppConfig } from '@bs/config';
import { tx, type Ctx } from './context';

export const pushConfigured = (cfg: AppConfig) => !!(cfg.VAPID_PUBLIC_KEY && cfg.VAPID_PRIVATE_KEY);

export const subscriptionInput = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(5).max(100) }),
  userAgent: z.string().max(200).optional(),
});

export async function saveSubscription(ctx: Ctx, input: z.input<typeof subscriptionInput>) {
  const d = subscriptionInput.parse(input);
  if (!ctx.actor.userId) return { ok: false };
  return tx(ctx, async (t) => {
    await t
      .insert(pushSubscriptions)
      .values({ organisationId: ctx.actor.organisationId, userId: ctx.actor.userId!, endpoint: d.endpoint, keys: d.keys, userAgent: d.userAgent ?? null })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { keys: d.keys, userId: ctx.actor.userId!, organisationId: ctx.actor.organisationId } });
    return { ok: true };
  });
}

export async function removeSubscription(ctx: Ctx, endpoint: string) {
  if (!ctx.actor.userId) return { ok: false };
  return tx(ctx, async (t) => {
    await t.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, ctx.actor.userId!)));
    return { ok: true };
  });
}

export async function listMySubscriptions(ctx: Ctx) {
  if (!ctx.actor.userId) return [];
  return tx(ctx, (t) => t.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, userAgent: pushSubscriptions.userAgent, createdAt: pushSubscriptions.createdAt }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, ctx.actor.userId!)));
}

/** A sender bound to the installation's VAPID keys, or undefined when push is not configured. */
export function createPushSender(cfg: AppConfig) {
  if (!pushConfigured(cfg)) return undefined;
  webpush.setVapidDetails(cfg.VAPID_SUBJECT, cfg.VAPID_PUBLIC_KEY!, cfg.VAPID_PRIVATE_KEY!);
  return async (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => {
    await webpush.sendNotification(sub, payload, { TTL: 3600 });
  };
}

export const _db = (db: Db) => db;
