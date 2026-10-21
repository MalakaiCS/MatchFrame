// Plans and billing. The plans and their prices come from the shared pricing catalogue (@bs/domain/pricing), so
// the public pricing page and the plan screen always agree. Stripe is the payment adapter (Checkout for a new
// subscription, the customer portal for changes, webhooks for truth), with one Stripe price per plan and billing
// period. Without Stripe the owner sets the plan by hand. Plan allowances are recorded on the organisation's
// entitlements; they are not yet enforced when a match goes live.
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { billingAccounts, entitlements, type Db, type Tx } from '@bs/db';
import { PRICE_PLANS, priceLabel, type BillingInterval, type PaidPlanKey, type PlanKey } from '@bs/domain';
import { z } from 'zod';
import type { AppConfig } from '@bs/config';
import { assertCan } from './authz';
import { audit } from './audit';
import { AppError, conflict, invalid } from './errors';
import { tx, type Ctx } from './context';

export type { PlanKey };
export interface Plan {
  key: PlanKey;
  name: string;
  priceLabel: string;
  audience: string;
  popular: boolean;
  /** online checkout available for this plan (quoted plans go through a conversation) */
  selfServe: boolean;
  /** null: agreed in the quote; members = staff accounts */
  limits: { liveMatches: number | null; members: number | null };
  features: string[];
}

const NO_PLAN: Plan = { key: 'free', name: 'No plan yet', priceLabel: 'Choose a plan to subscribe', audience: '', popular: false, selfServe: false, limits: { liveMatches: null, members: null }, features: [] };

export const PLANS: Record<PlanKey, Plan> = {
  free: NO_PLAN,
  ...(Object.fromEntries(
    PRICE_PLANS.map((p) => [p.key, { key: p.key, name: p.name, priceLabel: priceLabel(p), audience: p.audience, popular: !!p.popular, selfServe: p.selfServe, limits: { liveMatches: p.limits.liveMatches, members: p.limits.staffAccounts }, features: p.features }]),
  ) as Record<PaidPlanKey, Plan>),
};
export const PLAN_KEYS = Object.keys(PLANS) as [PlanKey, ...PlanKey[]];
const planOf = (key: string | null | undefined) => PLANS[(key ?? 'free') as PlanKey] ?? NO_PLAN;

/** The plan's allowances as entitlement limits (numbers only; quoted allowances are left as they are). */
function planLimits(plan: Plan): Record<string, number> {
  const out: Record<string, number> = {};
  if (plan.limits.liveMatches != null) out.liveMatches = plan.limits.liveMatches;
  if (plan.limits.members != null) out.members = plan.limits.members;
  return out;
}

/** The Stripe price for a plan and billing period, from the environment. */
export function stripePrice(cfg: AppConfig, plan: PaidPlanKey, interval: BillingInterval): string | undefined {
  const table: Record<string, string | undefined> = {
    'starter:monthly': cfg.STRIPE_PRICE_STARTER_MONTHLY,
    'starter:yearly': cfg.STRIPE_PRICE_STARTER_YEARLY,
    'club:monthly': cfg.STRIPE_PRICE_CLUB_MONTHLY ?? cfg.STRIPE_PRICE_CLUB,
    'club:yearly': cfg.STRIPE_PRICE_CLUB_YEARLY,
    'studio:monthly': cfg.STRIPE_PRICE_STUDIO_MONTHLY,
    'studio:yearly': cfg.STRIPE_PRICE_STUDIO_YEARLY,
  };
  return table[`${plan}:${interval}`] || undefined;
}

const selfServePlans = () => PRICE_PLANS.filter((p) => p.selfServe).map((p) => p.key);
export const billingConfigured = (cfg: AppConfig) => !!(cfg.STRIPE_SECRET_KEY && cfg.STRIPE_WEBHOOK_SECRET && selfServePlans().some((k) => stripePrice(cfg, k, 'monthly') || stripePrice(cfg, k, 'yearly')));

export async function getBilling(ctx: Ctx) {
  assertCan(ctx.actor, 'org.read');
  return tx(ctx, async (t) => {
    const [acct] = await t.select().from(billingAccounts).where(eq(billingAccounts.organisationId, ctx.actor.organisationId));
    const [ent] = await t.select().from(entitlements).where(eq(entitlements.organisationId, ctx.actor.organisationId));
    const plan = planOf(acct?.plan ?? ent?.plan);
    const checkout = Object.fromEntries(selfServePlans().map((k) => [k, { monthly: !!stripePrice(ctx.config, k, 'monthly'), yearly: !!stripePrice(ctx.config, k, 'yearly') }]));
    return { configured: billingConfigured(ctx.config), plan, status: acct?.status ?? 'none', currentPeriodEnd: acct?.currentPeriodEnd ?? null, plans: PRICE_PLANS.map((p) => PLANS[p.key]), checkout, canManage: !!acct?.customerId };
  });
}

async function stripe(cfg: AppConfig, path: string, form: Record<string, string>, fetchImpl: typeof fetch = fetch) {
  const body = new URLSearchParams(form).toString();
  const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
  const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new AppError('BILLING_PROVIDER', 502, json.error?.message ?? `Stripe returned ${res.status}`);
  return json;
}

export const checkoutInput = z.object({ plan: z.enum(['starter', 'club', 'studio']), interval: z.enum(['monthly', 'yearly']).default('monthly') });

/** Start a Checkout session for a self-serve plan; the webhook moves the organisation onto the plan. */
export async function createCheckout(ctx: Ctx, input: z.input<typeof checkoutInput>, fetchImpl: typeof fetch = fetch) {
  assertCan(ctx.actor, 'org.own');
  if (!billingConfigured(ctx.config)) throw conflict('BILLING_NOT_CONFIGURED', 'Billing is not set up on this installation');
  const d = checkoutInput.parse(input);
  const price = stripePrice(ctx.config, d.plan, d.interval);
  if (!price) throw conflict('PRICE_NOT_CONFIGURED', `${PLANS[d.plan].name} is not available ${d.interval === 'yearly' ? 'yearly' : 'monthly'} on this installation yet`);
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
    'metadata[interval]': d.interval,
    'subscription_data[metadata][organisationId]': ctx.actor.organisationId,
    'subscription_data[metadata][plan]': d.plan,
    'subscription_data[metadata][interval]': d.interval,
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
  const plan = planOf(next.plan);
  // the plan's allowances join the organisation's other limits (storage, programmes) rather than replacing them
  const [cur] = await db.select().from(entitlements).where(eq(entitlements.organisationId, organisationId));
  const limits = { ...(cur?.limits ?? {}), ...planLimits(plan) };
  await db
    .insert(entitlements)
    .values({ organisationId, plan: plan.key, features: cur?.features ?? {}, limits, updatedBy: 'billing' })
    .onConflictDoUpdate({ target: entitlements.organisationId, set: { plan: plan.key, limits, updatedBy: 'billing', updatedAt: new Date() } });
  return { applied: event.type, plan: plan.key };
}

/** A plan set by hand (no Stripe subscription): the organisation's billing account and its plan's allowances. */
export async function applyManualPlan(t: Tx, organisationId: string, plan: PlanKey, updatedBy: string) {
  if (!PLANS[plan]) throw invalid('Unknown plan', [{ field: 'plan', message: 'Unknown plan' }]);
  await t.insert(billingAccounts).values({ organisationId, provider: 'manual', plan, status: 'active' }).onConflictDoUpdate({ target: billingAccounts.organisationId, set: { provider: 'manual', plan, status: 'active', updatedAt: new Date() } });
  const [cur] = await t.select().from(entitlements).where(eq(entitlements.organisationId, organisationId));
  const limits = { ...(cur?.limits ?? {}), ...planLimits(PLANS[plan]) };
  await t.insert(entitlements).values({ organisationId, plan, features: cur?.features ?? {}, limits, updatedBy }).onConflictDoUpdate({ target: entitlements.organisationId, set: { plan, limits, updatedBy, updatedAt: new Date() } });
}

/**
 * Manual plan change by an organisation owner on an installation without Stripe (self-hosted, invoices handled
 * elsewhere). With Stripe set up, plans come from subscriptions, or from site staff (Admin) in the staff console.
 */
export async function setPlanManually(ctx: Ctx, plan: PlanKey) {
  assertCan(ctx.actor, 'org.own');
  if (billingConfigured(ctx.config)) throw conflict('BILLING_MANAGED', 'Plans are chosen through checkout on this installation. Contact support to change a plan by hand.');
  return tx(ctx, async (t) => {
    await applyManualPlan(t, ctx.actor.organisationId, plan, ctx.actor.userId!);
    await audit(t, ctx.actor, 'billing.plan', 'organisation', ctx.actor.organisationId, { after: { plan } });
    return { ok: true, plan };
  });
}
