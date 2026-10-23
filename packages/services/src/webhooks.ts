// Outbound webhooks: an organisation registers HTTPS endpoints for match events; the worker turns outbox events
// into signed deliveries and retries with backoff. Secrets are encrypted at rest and shown once at creation.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { webhookDeliveries, webhookEndpoints, type Db } from '@bs/db';
import { z } from 'zod';
import type { AppConfig } from '@bs/config';
import { assertCan } from './authz';
import { audit } from './audit';
import { decryptSecret, encryptSecret, hmac, randomToken } from './crypto';
import { invalid, notFound } from './errors';
import { tx, type Ctx } from './context';
import { isPrivateAddress } from './streams';
import type { OutboxRow } from './relay';
import { parsePatch } from './patch';

/** Public event names, in the words a club's website developer expects. */
export const WEBHOOK_EVENTS = ['match.started', 'match.score', 'match.event', 'match.phase', 'match.final', 'match.lineup', 'match.rescheduled', 'webhook.test'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const endpointInput = z.object({
  url: z.string().url().max(500).refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)/.test(u), 'Webhook URLs must use https'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  enabled: z.boolean().default(true),
});

async function assertReachableHost(url: string) {
  const host = new URL(url).hostname;
  if (/^(localhost|127\.|0\.0\.0\.0)/.test(host)) return; // local development only; blocked by the https rule in production
  const addrs = await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw invalid('The webhook host could not be resolved', [{ field: 'url', message: 'Unknown host' }]);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw invalid('Private, loopback and link-local hosts are not allowed', [{ field: 'url', message: 'Private address' }]);
}

export async function listWebhooks(ctx: Ctx) {
  assertCan(ctx.actor, 'org.manage');
  return tx(ctx, async (t) => {
    const rows = await t.select().from(webhookEndpoints).where(eq(webhookEndpoints.organisationId, ctx.actor.organisationId)).orderBy(asc(webhookEndpoints.createdAt));
    const out = [];
    for (const r of rows) {
      const [last] = await t.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, r.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(1);
      const [counts] = await t
        .select({ delivered: sql<number>`count(*) filter (where ${webhookDeliveries.state} = 'delivered')`, failed: sql<number>`count(*) filter (where ${webhookDeliveries.state} in ('failed','dead'))`, pending: sql<number>`count(*) filter (where ${webhookDeliveries.state} = 'pending')` })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, r.id));
      out.push({ id: r.id, url: r.url, events: r.events, enabled: r.enabled, createdAt: r.createdAt, last: last ? { state: last.state, status: last.lastStatus, error: last.lastError, at: last.updatedAt, event: last.eventType } : null, counts: { delivered: Number(counts?.delivered ?? 0), failed: Number(counts?.failed ?? 0), pending: Number(counts?.pending ?? 0) } });
    }
    return out;
  });
}

export async function createWebhook(ctx: Ctx, input: z.input<typeof endpointInput>) {
  assertCan(ctx.actor, 'org.manage');
  const d = endpointInput.parse(input);
  await assertReachableHost(d.url);
  const secret = `whsec_${randomToken(24)}`;
  return tx(ctx, async (t) => {
    const [r] = await t.insert(webhookEndpoints).values({ organisationId: ctx.actor.organisationId, url: d.url, events: d.events, enabled: d.enabled, secretEnc: encryptSecret(secret, ctx.config.ENCRYPTION_KEY) }).returning();
    await audit(t, ctx.actor, 'webhook.create', 'webhook', r!.id, { after: { url: d.url, events: d.events } });
    // the signing secret is shown once
    return { id: r!.id, url: r!.url, events: r!.events, enabled: r!.enabled, secret };
  });
}

export async function updateWebhook(ctx: Ctx, id: string, input: Partial<z.input<typeof endpointInput>>) {
  assertCan(ctx.actor, 'org.manage');
  const d = parsePatch(endpointInput.partial(), input);
  if (d.url) await assertReachableHost(d.url);
  return tx(ctx, async (t) => {
    const [r] = await t.update(webhookEndpoints).set({ ...d, updatedAt: new Date() }).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organisationId, ctx.actor.organisationId))).returning();
    if (!r) throw notFound('Webhook');
    await audit(t, ctx.actor, 'webhook.update', 'webhook', id, { after: d });
    return { id: r.id, url: r.url, events: r.events, enabled: r.enabled };
  });
}

export async function deleteWebhook(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'org.manage');
  return tx(ctx, async (t) => {
    const r = await t.delete(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organisationId, ctx.actor.organisationId))).returning();
    if (!r.length) throw notFound('Webhook');
    await audit(t, ctx.actor, 'webhook.delete', 'webhook', id);
    return { ok: true };
  });
}

/** Queue a test delivery so the developer can see the signature and payload shape. */
export async function testWebhook(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'org.manage');
  return tx(ctx, async (t) => {
    const [r] = await t.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organisationId, ctx.actor.organisationId)));
    if (!r) throw notFound('Webhook');
    await t.insert(webhookDeliveries).values({ organisationId: ctx.actor.organisationId, endpointId: r.id, eventId: crypto.randomUUID(), eventType: 'webhook.test', payload: { event: 'webhook.test', sentAt: new Date().toISOString(), organisationId: ctx.actor.organisationId, data: { message: 'If you can read this, the webhook is wired up.' } }, state: 'pending', nextAttemptAt: new Date() });
    return { ok: true };
  });
}

export async function listDeliveries(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'org.manage');
  return tx(ctx, (t) =>
    t
      .select({ id: webhookDeliveries.id, eventType: webhookDeliveries.eventType, state: webhookDeliveries.state, attempts: webhookDeliveries.attempts, lastStatus: webhookDeliveries.lastStatus, lastError: webhookDeliveries.lastError, nextAttemptAt: webhookDeliveries.nextAttemptAt, createdAt: webhookDeliveries.createdAt })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.endpointId, id), eq(webhookDeliveries.organisationId, ctx.actor.organisationId)))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50),
  );
}

// ---------------------------------------------------------------- worker side

/** Outbox topic → public events and the body a subscriber receives (no secrets, no private player data). */
export function webhookEventsFor(e: OutboxRow): { event: WebhookEvent; data: Record<string, unknown> }[] {
  const p = e.payload as Record<string, unknown>;
  switch (e.topic) {
    case 'match.fact.accepted': {
      const ev = (p.event as Record<string, unknown> | undefined) ?? p;
      const type = String(ev.type ?? p.type ?? '');
      const out: { event: WebhookEvent; data: Record<string, unknown> }[] = [{ event: 'match.event', data: { matchId: e.aggregateId, type, side: ev.side ?? null, playerId: ev.playerId ?? null, clockMs: ev.clockMs ?? null, periodId: ev.periodId ?? null, payload: ev.payload ?? {}, score: p.score ?? null } }];
      if (/^(goal|own_goal|penalty_scored|try|penalty_try|conversion|penalty_goal|field_goal|behind|rushed_behind|score)$/.test(type)) out.push({ event: 'match.score', data: out[0]!.data });
      return out;
    }
    case 'match.phase.changed': {
      const to = String(p.to ?? '');
      const out: { event: WebhookEvent; data: Record<string, unknown> }[] = [{ event: 'match.phase', data: { matchId: e.aggregateId, phase: to, occurredAt: p.occurredAt ?? null } }];
      if (to === 'full_time') out.push({ event: 'match.final', data: { matchId: e.aggregateId, phase: to, score: p.score ?? null } });
      if (to === 'first_half' || to === 'p1') out.push({ event: 'match.started', data: { matchId: e.aggregateId, phase: to } });
      return out;
    }
    case 'match.lineup.updated':
      return [{ event: 'match.lineup', data: { matchId: e.aggregateId, version: p.version ?? null } }];
    case 'match.rescheduled':
      return [{ event: 'match.rescheduled', data: { matchId: e.aggregateId, scheduledAt: p.scheduledAt ?? null } }];
    default:
      return [];
  }
}

/** Outbox subscriber: fan one event out to every enabled endpoint that asked for it (idempotent per event). */
export async function enqueueWebhookDeliveries(db: Db, e: OutboxRow) {
  const events = webhookEventsFor(e);
  if (!events.length) return;
  const endpoints = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.organisationId, e.organisationId), eq(webhookEndpoints.enabled, true)));
  for (const ep of endpoints) {
    for (const ev of events) {
      if (!ep.events.includes(ev.event)) continue;
      const eventId = crypto.createHash('sha256').update(`${e.id}:${ev.event}`).digest('hex').slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
      await db
        .insert(webhookDeliveries)
        .values({ organisationId: e.organisationId, endpointId: ep.id, eventId, eventType: ev.event, payload: { event: ev.event, sentAt: new Date().toISOString(), organisationId: e.organisationId, data: ev.data }, state: 'pending', nextAttemptAt: new Date() })
        .onConflictDoNothing();
    }
  }
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];

/** Standard signature: `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<body>">`, verifiable with the shown secret. */
export function signWebhook(secret: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

/** Worker loop: send due deliveries, retry with backoff, give up after the schedule runs out. */
export async function deliverWebhooks(db: Db, cfg: AppConfig, fetchImpl: typeof fetch = fetch) {
  const due = await db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.state, 'pending'), lte(webhookDeliveries.nextAttemptAt, new Date()))).orderBy(asc(webhookDeliveries.nextAttemptAt)).limit(25);
  for (const d of due) {
    const [ep] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId));
    if (!ep || !ep.enabled) {
      await db.update(webhookDeliveries).set({ state: 'dead', lastError: 'endpoint disabled or removed', updatedAt: new Date() }).where(eq(webhookDeliveries.id, d.id));
      continue;
    }
    const body = JSON.stringify({ ...d.payload, deliveryId: d.id, attempt: d.attempts + 1 });
    let status: number | null = null;
    let error: string | null = null;
    try {
      const secret = decryptSecret(ep.secretEnc, cfg.ENCRYPTION_KEY);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      const res = await fetchImpl(ep.url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'BroadcastStudio-Webhooks/1', 'x-bs-event': d.eventType, 'x-bs-delivery': d.id, 'x-bs-signature': signWebhook(secret, body) }, body, signal: ac.signal, redirect: 'manual' });
      clearTimeout(timer);
      status = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 200) : 'request failed';
    }
    const attempts = d.attempts + 1;
    if (!error) await db.update(webhookDeliveries).set({ state: 'delivered', attempts, lastStatus: status, lastError: null, updatedAt: new Date() }).where(eq(webhookDeliveries.id, d.id));
    else {
      const wait = BACKOFF_MS[attempts - 1];
      await db.update(webhookDeliveries).set({ state: wait ? 'pending' : 'dead', attempts, lastStatus: status, lastError: error, nextAttemptAt: new Date(Date.now() + (wait ?? 0)), updatedAt: new Date() }).where(eq(webhookDeliveries.id, d.id));
    }
  }
  return due.length;
}

export const _test = { hmac };
