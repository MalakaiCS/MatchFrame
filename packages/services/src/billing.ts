// Plans and billing. Plans and their limits are defined here; Stripe is the payment adapter (Checkout for
// upgrades, the customer portal for changes, webhooks for truth). Without Stripe keys everything stays on the
// free plan and the billing page explains why.
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { billingAccounts, entitlements, type Db } from '@bs/db';
import { z } from 'zod';
import type { AppConfig } from '@bs/config';
import { assertCan } from './authz';
import { audit } from './audit';
import { AppError, conflict, invalid } from './errors';
import { tx, type Ctx } from './context';

export type PlanKey = 'free' | 'club' | 'league';
export interface Plan {
  key: PlanKey;
  name: string;
  priceLabel: string;
  limits: { liveMatches: number; outputsPerMatch: number; storageGb: number; members: number; webhooks: number };
  features: string[];
}
export const PLANS: Record<PlanKey, Plan> = {
  free: { key: 'free', name: 'Starter', priceLabel: 'Free', limits: { liveMatches: 1, outputsPerMatch: 1, storageGb: 2, members: 5, webhooks: 1 }, features: ['One live match at a time', 'All graphics and looks', 'Scorer app', 'OBS link'] },
  club: { key: 'club', name: 'Club', priceLabel: 'per month', limits: { liveMatches: 3, outputsPerMatch: 3, storageGb: 25, members: 25, webhooks: 5 }, features: ['Three live matches at once', 'Vertical and venue outputs', 'Sponsor delivery reports', 'Webhooks and reminders'] },
  league: { key: 'league', name: 'League', priceLabel: 'per month', limits: { liveMatches: 12, outputsPerMatch: 6, storageGb: 200, members: 200, webhooks: 20 }, features: ['Twelve live matches at once', 'White-label domain and branding', 'Priority support', 'Everything in Club'] },
};

export const billingConfigured = (cfg: AppConfig) => !!(cfg.STRIPE_SECRET_KEY && cfg.STRIPE_WEBHOOK_SECRET && cfg.STRIPE_PRICE_CLUB && cfg.STRIPE_PRICE_LEAGUE);

export async function getBilling(ctx: Ctx) {
  assertCan(ctx.actor, 'org.read');
  return tx(ctx, async (t) => {
    const [acct] = await t.select().from(billingAccounts).where(eq(billingAccounts.organisationId, ctx.actor.organisationId));
    const [ent] = await t.select().from(entitlements).where(eq(entitlements.organisationId, ctx.actor.organisationId));
    const plan = (acct?.plan as PlanKey | undefined) ?? (ent?.plan as PlanKey | undefined) ?? 'free';
    return { configured: billingConfigured(ctx.config), plan: PLANS[plan] ?? PLANS.free, status: acct?.status ?? 'none', currentPeriodEnd: acct?.currentPeriodEnd ?? null, plans: Object.values(PLANS), canManage: !!acct?.customerId };
  });
}

async function stripe(cfg: AppConfig, path: string, form: Record<string, string>, fetchImpl: typeof fetch = fetch) {
  const body = new URLSearchParams(form).toString();
  const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
  const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new AppError('BILLING_PROVIDER', 502, json.error?.message ?? `Stripe returned ${res.status}`);
  return json;
}

export const checkoutInput = z.object({ plan: z.enum(['club', 'league']) });

/** Start a Checkout session for a paid plan; the webhook moves the organisation onto the plan. */
export async function createCheckout(ctx: Ctx, input: z.input<typeof checkoutInput>, fetchImpl: typeof fetch = fetch) {
  assertCan(ctx.actor, 'org.own');
  if (!billingConfigured(ctx.config)) throw conflict('BILLING_NOT_CONFIGURED', 'Billing is not set up on this installation');
  const d = checkoutInput.parse(input);
  const price = d.plan === 'club' ? ctx.config.STRIPE_PRICE_CLUB! : ctx.config.STRIPE_PRICE_LEAGUE!;
  const [acct] = await ctx.db.select().from(billingAccounts).where(eq(billingAccounts.organisationId, ctx.actor.organisationId));
  const form: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${ctx.config.PUBLIC_WEB_URL}/app/settings?billing=success`,
    cancel_url: `${ctx.config.PUBLIC_WEB_URL}/app/settings?billing=cancelled`,
    client_reference_id: ctx.actor.organisationId,
    'metadata[organisationId]': ctx.actor.organisationId,
    'metadata[plan]': d.plan,
    'subscription_data[metadata][organisationId]': ctx.actor.organisationId,
    'subscription_data[metadata][plan]': d.plan,
  };
  if (acct?.customerId) form.customer = acct.customerId;
  const session = await stripe(ctx.config, 'checkout/sessions', form, fetchImpl);
  return { url: String(session.url) };
}

export async function createPortal(ctx: Ctx, fetchImpl: typeof fetch = fetch) {
  assertCan(ctx.actor, 'org.own');
  const [acct] = await ctx.db.select().from(billingAccounts).where(eq(billingAccounts.organisationId, ctx.actor.organisationId));
  if (!acct?.customerId) throw conflict('NO_CUSTOMER', 'This organisation has no billing account yet');
  const s = await stripe(ctx.config, 'billing_portal/sessions', { customer: acct.customerId, return_url: `${ctx.config.PUBLIC_WEB_URL}/app/settings` }, fetchImpl);
  return { url: String(s.url) };
}

/** Stripe-Signature: t=<ts>,v1=<hmac sha256 of "<ts>.<payload>">; tolerance guards against replay. */
export function verifyStripeSignature(payload: string, header: string | undefined, secret: string, toleranceS = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const ts = Number(parts.t);
  const v1 = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!ts || !v1.length) return false;
  if (Math.abs(now / 1000 - ts) > toleranceS) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return v1.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

/** Apply a verified Stripe event. Idempotent on event id. */
export async function handleStripeEvent(db: Db, event: { id: string; type: string; data: { object: Record<string, unknown> } }) {
  const obj = event.data.object;
  const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
  const organisationId = meta.organisationId ?? (obj.client_reference_id as string | undefined);
  if (!organisationId) return { ignored: true };
  const [acct] = await db.select().from(billingAccounts).where(eq(billingAccounts.organisationId, organisationId));
  if (acct?.lastEventId === event.id) return { duplicate: true };
  const statusMap: Record<string, string> = { active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'past_due', canceled: 'cancelled', incomplete: 'none', incomplete_expired: 'none' };
  let next: Partial<typeof billingAccounts.$inferInsert> = { lastEventId: event.id, updatedAt: new Date() };
  if (event.type === 'checkout.session.completed') {
    next = { ...next, customerId: String(obj.customer ?? acct?.customerId ?? ''), subscriptionId: obj.subscription ? String(obj.subscription) : acct?.subscriptionId ?? null, plan: (meta.plan as PlanKey) ?? acct?.plan ?? 'club', status: 'active' };
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const status = statusMap[String(obj.status)] ?? 'none';
    const plan = (meta.plan as PlanKey | undefined) ?? (acct?.plan as PlanKey | undefined) ?? 'club';
    next = { ...next, subscriptionId: String(obj.id), customerId: String(obj.customer ?? acct?.customerId ?? ''), plan: status === 'cancelled' || status === 'none' ? 'free' : plan, status, currentPeriodEnd: obj.current_period_end ? new Date(Number(obj.current_period_end) * 1000) : null };
  } else if (event.type === 'customer.subscription.deleted') {
    next = { ...next, plan: 'free', status: 'cancelled', subscriptionId: null };
  } else return { ignored: true };
  await db
    .insert(billingAccounts)
    .values({ organisationId, provider: 'stripe', ...next, plan: next.plan ?? 'free', status: next.status ?? 'none' })
    .onConflictDoUpdate({ target: billingAccounts.organisationId, set: next });
  const plan = PLANS[(next.plan as PlanKey) ?? 'free'] ?? PLANS.free;
  await db
    .insert(entitlements)
    .values({ organisationId, plan: plan.key, features: Object.fromEntries(plan.features.map((f) => [f, true])), limits: plan.limits, updatedBy: 'billing' })
    .onConflictDoUpdate({ target: entitlements.organisationId, set: { plan: plan.key, limits: plan.limits, updatedBy: 'billing', updatedAt: new Date() } });
  return { applied: event.type, plan: plan.key };
}

/** Manual plan change by an installation owner without Stripe (self-hosted, invoices handled elsewhere). */
export async function setPlanManually(ctx: Ctx, plan: PlanKey) {
  assertCan(ctx.actor, 'org.own');
  if (!PLANS[plan]) throw invalid('Unknown plan', [{ field: 'plan', message: 'Unknown plan' }]);
  return tx(ctx, async (t) => {
    await t.insert(billingAccounts).values({ organisationId: ctx.actor.organisationId, provider: 'manual', plan, status: 'active' }).onConflictDoUpdate({ target: billingAccounts.organisationId, set: { provider: 'manual', plan, status: 'active', updatedAt: new Date() } });
    const p = PLANS[plan];
    await t.insert(entitlements).values({ organisationId: ctx.actor.organisationId, plan, features: Object.fromEntries(p.features.map((f) => [f, true])), limits: p.limits, updatedBy: ctx.actor.userId }).onConflictDoUpdate({ target: entitlements.organisationId, set: { plan, limits: p.limits, updatedBy: ctx.actor.userId, updatedAt: new Date() } });
    await audit(t, ctx.actor, 'billing.plan', 'organisation', ctx.actor.organisationId, { after: { plan } });
    return { ok: true, plan };
  });
}
