// Plans and billing. The plans and their prices come from the shared pricing catalogue (@bs/domain/pricing), so
// the public pricing page, the plan screen and Stripe always agree.
//
// An organisation's plan has two parts on its billing account:
//  - `plan`: what it pays for (a Stripe subscription) or, without online payment, what its owner chose;
//  - a plan given by site staff (`grantPlan`), which applies instead until `grantEndsAt` (null = permanent). The
//    worker ends it on time and the organisation goes back to `plan`. Starting a new paid subscription ends it too.
// The plan that applies is copied to the organisation's entitlements with its allowances (recorded, not yet
// enforced when a match goes live).
//
// Stripe needs only STRIPE_SECRET_KEY. Prices are found in the Stripe account by lookup key
// (matchframe_<plan>_<interval>) and created there from the catalogue the first time, in the account's own currency
// (or STRIPE_CURRENCY); STRIPE_PRICE_* still pins a price by hand. Checkout is confirmed when the owner comes back
// from Stripe, a webhook (with STRIPE_WEBHOOK_SECRET) applies changes as they happen, and the worker re-reads every
// subscription regularly, so renewals, cancellations and failed payments arrive even without a webhook.
import crypto from 'node:crypto';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { auditLogs, billingAccounts, entitlements, platformAuditLogs, users, withTenant, type Db, type Tx } from '@bs/db';
import { PRICE_PLANS, priceLabel, type BillingInterval, type PaidPlanKey, type PlanKey } from '@bs/domain';
import { z } from 'zod';
import type { AppConfig } from '@bs/config';
import { assertCan } from './authz';
import { audit } from './audit';
import { AppError, conflict, invalid, notFound } from './errors';
import { nowMs, tx, type Ctx } from './context';

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
const SELF_SERVE = ['starter', 'club', 'studio'] as const;
type SelfServePlan = (typeof SELF_SERVE)[number];

/** The plan's allowances as entitlement limits (numbers only; quoted allowances are left as they are). */
function planLimits(plan: Plan): Record<string, number> {
  const out: Record<string, number> = {};
  if (plan.limits.liveMatches != null) out.liveMatches = plan.limits.liveMatches;
  if (plan.limits.members != null) out.members = plan.limits.members;
  return out;
}

type Account = typeof billingAccounts.$inferSelect;

/** A plan given by staff that has not ended yet. */
export const activeGrant = (a: Pick<Account, 'grantPlan' | 'grantEndsAt'> | undefined, now: number) => (a?.grantPlan && (!a.grantEndsAt || a.grantEndsAt.getTime() > now) ? (a.grantPlan as PlanKey) : null);
/** The plan that applies now: a staff plan while it lasts, otherwise the paid or owner-chosen one. */
export const effectivePlan = (a: Account | undefined, now: number): PlanKey => activeGrant(a, now) ?? ((a?.plan as PlanKey | undefined) ?? 'free');

/** Copy the plan that applies now, with its allowances, to the organisation's entitlements. */
async function syncEntitlements(t: Tx, organisationId: string, now: number, updatedBy: string) {
  const [acct] = await t.select().from(billingAccounts).where(eq(billingAccounts.organisationId, organisationId));
  const plan = planOf(effectivePlan(acct, now));
  // the plan's allowances join the organisation's other limits (storage, programmes) rather than replacing them
  const [cur] = await t.select().from(entitlements).where(eq(entitlements.organisationId, organisationId));
  const limits = { ...(cur?.limits ?? {}), ...planLimits(plan) };
  await t
    .insert(entitlements)
    .values({ organisationId, plan: plan.key, features: cur?.features ?? {}, limits, updatedBy })
    .onConflictDoUpdate({ target: entitlements.organisationId, set: { plan: plan.key, limits, updatedBy, updatedAt: new Date(now) } });
  return plan.key;
}

/** An organisation's billing account, created empty (no plan) the first time it is needed. */
async function accountFor(t: Tx, organisationId: string, provider = 'manual') {
  await t.insert(billingAccounts).values({ organisationId, provider, plan: 'free', status: 'none' }).onConflictDoNothing();
  const [a] = await t.select().from(billingAccounts).where(eq(billingAccounts.organisationId, organisationId)).for('update');
  return a!;
}

// ------------------------------------------------------------------ Stripe

/** A price pinned by hand for a plan and billing period (optional: without one, the price is found or created). */
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

/** Online payment is on as soon as there is a Stripe secret key. */
export const billingConfigured = (cfg: AppConfig) => !!cfg.STRIPE_SECRET_KEY;

type Fetch = typeof fetch;
type StripeObject = Record<string, unknown> & { id?: string; error?: { message?: string; code?: string } };

async function stripeCall(cfg: AppConfig, method: 'GET' | 'POST', resource: string, params: Record<string, string | string[]> = {}, fetchImpl: Fetch = fetch): Promise<StripeObject> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) form.append(k, x);
  const url = `https://api.stripe.com/v1/${resource}${method === 'GET' && [...form].length ? `?${form}` : ''}`;
  const res = await fetchImpl(url, { method, headers: { authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}`, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(method === 'POST' ? { body: form.toString() } : {}) });
  const json = (await res.json().catch(() => ({}))) as StripeObject;
  if (!res.ok) throw new AppError('BILLING_PROVIDER', res.status === 404 ? 404 : 502, json.error?.message ?? `Stripe returned ${res.status}`, undefined, json.error?.code ? { stripeCode: json.error.code } : undefined);
  return json;
}

// what was found in the Stripe account, per process: the currency and each plan's price
const found: { currency?: string; prices: Map<string, string> } = { prices: new Map() };
/** For tests: forget what was found in the Stripe account. */
export function resetStripeCache() {
  found.currency = undefined;
  found.prices.clear();
}

/** Currencies Stripe counts in whole units (no cents). */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
export const minorUnits = (amount: number, currency: string) => Math.round(ZERO_DECIMAL.has(currency) ? amount : amount * 100);

/** The currency prices are charged in: STRIPE_CURRENCY, or the Stripe account's own default currency. */
export async function stripeCurrency(cfg: AppConfig, fetchImpl: Fetch = fetch): Promise<string> {
  if (cfg.STRIPE_CURRENCY) return cfg.STRIPE_CURRENCY.toLowerCase();
  if (found.currency) return found.currency;
  const acct = await stripeCall(cfg, 'GET', 'account', {}, fetchImpl);
  const currency = String(acct.default_currency ?? '').toLowerCase();
  if (!currency) throw conflict('BILLING_CURRENCY', 'The Stripe account has no default currency. Set STRIPE_CURRENCY (for example aud).');
  found.currency = currency;
  return currency;
}

export const lookupKey = (plan: SelfServePlan, interval: BillingInterval) => `matchframe_${plan}_${interval}`;
const planFromLookupKey = (key: unknown) => {
  const m = typeof key === 'string' ? /^matchframe_(starter|club|studio)_(monthly|yearly)$/.exec(key) : null;
  return m ? { plan: m[1] as SelfServePlan, interval: m[2] as BillingInterval } : null;
};

/**
 * The Stripe price for a plan and billing period: pinned in the environment, or found by lookup key, or created
 * from the catalogue (in the account's currency) when there is none or the catalogue price has changed.
 */
export async function resolvePrice(cfg: AppConfig, plan: SelfServePlan, interval: BillingInterval, fetchImpl: Fetch = fetch): Promise<string> {
  const pinned = stripePrice(cfg, plan, interval);
  if (pinned) return pinned;
  const key = lookupKey(plan, interval);
  const known = found.prices.get(key);
  if (known) return known;
  const p = PRICE_PLANS.find((x) => x.key === plan)!;
  const currency = await stripeCurrency(cfg, fetchImpl);
  const amount = minorUnits(interval === 'yearly' ? p.yearly! : p.monthly!, currency);
  const list = await stripeCall(cfg, 'GET', 'prices', { 'lookup_keys[]': key, active: 'true', limit: '1' }, fetchImpl);
  const existing = (list.data as { id: string; currency: string; unit_amount: number | null; product: string }[] | undefined)?.[0];
  if (existing && existing.currency === currency && existing.unit_amount === amount) {
    found.prices.set(key, existing.id);
    return existing.id;
  }
  // first use, or the catalogue price changed: a new price takes the lookup key (subscribers keep their old price)
  const created = await stripeCall(
    cfg,
    'POST',
    'prices',
    {
      currency,
      unit_amount: String(amount),
      'recurring[interval]': interval === 'yearly' ? 'year' : 'month',
      lookup_key: key,
      transfer_lookup_key: 'true',
      nickname: `${p.name} ${interval}`,
      'metadata[matchframe_plan]': plan,
      'metadata[interval]': interval,
      ...(existing ? { product: existing.product } : { 'product_data[name]': `MatchFrame ${p.name}`, 'product_data[metadata][matchframe_plan]': plan }),
    },
    fetchImpl,
  );
  found.prices.set(key, String(created.id));
  return String(created.id);
}

/** For the pricing page: whether online payment is on and the currency it charges in (null when unknown). */
export async function publicBilling(cfg: AppConfig, fetchImpl: Fetch = fetch) {
  if (!billingConfigured(cfg)) return { online: false, currency: null };
  try {
    return { online: true, currency: (await stripeCurrency(cfg, fetchImpl)).toUpperCase() };
  } catch {
    return { online: true, currency: null };
  }
}

export async function getBilling(ctx: Ctx) {
  assertCan(ctx.actor, 'org.read');
  const now = nowMs(ctx);
  return tx(ctx, async (t) => {
    const [acct] = await t.select().from(billingAccounts).where(eq(billingAccounts.organisationId, ctx.actor.organisationId));
    const [ent] = await t.select().from(entitlements).where(eq(entitlements.organisationId, ctx.actor.organisationId));
    const grant = activeGrant(acct, now);
    const base = planOf(acct?.plan ?? (grant ? 'free' : ent?.plan));
    const online = billingConfigured(ctx.config);
    const checkout = Object.fromEntries(SELF_SERVE.map((k) => [k, { monthly: online, yearly: online }]));
    return {
      configured: online,
      plan: grant ? PLANS[grant] : base,
      basePlan: base,
      grant: grant ? { plan: PLANS[grant], endsAt: acct!.grantEndsAt, since: acct!.grantedAt } : null,
      status: acct?.status ?? 'none',
      interval: acct?.interval ?? null,
      currentPeriodEnd: acct?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: acct?.cancelAtPeriodEnd ?? false,
      plans: PRICE_PLANS.map((p) => PLANS[p.key]),
      checkout,
      canManage: !!acct?.customerId && online,
    };
  });
}

export const checkoutInput = z.object({ plan: z.enum(SELF_SERVE), interval: z.enum(['monthly', 'yearly']).default('monthly') });

/** Start a Checkout session for a self-serve plan; confirmCheckout (or the webhook) moves the organisation onto it. */
export async function createCheckout(ctx: Ctx, input: z.input<typeof checkoutInput>, fetchImpl: Fetch = fetch) {
  assertCan(ctx.actor, 'org.own');
  if (!billingConfigured(ctx.config)) throw conflict('BILLING_NOT_CONFIGURED', 'Online payment is not set up on this installation');
  const d = checkoutInput.parse(input);
  const price = await resolvePrice(ctx.config, d.plan, d.interval, fetchImpl);
  const { acct, email } = await tx(ctx, async (t) => {
    const [a] = await t.select().from(billingAccounts).where(eq(billingAccounts.organisationId, ctx.actor.organisationId));
    const [u] = ctx.actor.userId ? await t.select({ email: users.email }).from(users).where(eq(users.id, ctx.actor.userId)) : [];
    return { acct: a, email: u?.email };
  });
  const back = `${ctx.config.PUBLIC_WEB_URL}/app/settings?tab=plan`;
  const form: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${back}&billing=success&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}&billing=cancelled`,
    client_reference_id: ctx.actor.organisationId,
    'metadata[organisationId]': ctx.actor.organisationId,
    'metadata[plan]': d.plan,
    'metadata[interval]': d.interval,
    'subscription_data[metadata][organisationId]': ctx.actor.organisationId,
    'subscription_data[metadata][plan]': d.plan,
    'subscription_data[metadata][interval]': d.interval,
  };
  if (acct?.customerId) form.customer = acct.customerId;
  else if (email) form.customer_email = email;
  const session = await stripeCall(ctx.config, 'POST', 'checkout/sessions', form, fetchImpl);
  return { url: String(session.url) };
}

/**
 * The owner is back from Checkout: read the session from Stripe and, once it is complete and belongs to this
 * organisation, put the organisation on the plan it paid for (the webhook may already have done so).
 */
export async function confirmCheckout(ctx: Ctx, sessionId: string, fetchImpl: Fetch = fetch) {
  assertCan(ctx.actor, 'org.own');
  if (!billingConfigured(ctx.config)) throw conflict('BILLING_NOT_CONFIGURED', 'Online payment is not set up on this installation');
  if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(sessionId)) throw invalid('Unknown checkout', [{ field: 'session', message: 'Unknown checkout' }]);
  const s = await stripeCall(ctx.config, 'GET', `checkout/sessions/${sessionId}`, { 'expand[]': 'subscription' }, fetchImpl);
  if (s.client_reference_id !== ctx.actor.organisationId) throw notFound('Checkout');
  if (s.status !== 'complete' || !s.subscription || typeof s.subscription !== 'object') return { status: String(s.status ?? 'open') };
  const plan = await applySubscription(ctx.db, ctx.actor.organisationId, s.subscription as StripeObject, { customerId: String(s.customer ?? ''), newSubscription: true, now: nowMs(ctx) });
  return { status: 'complete', plan };
}

/** Open the Stripe customer portal (cancel, change card, invoices). Creates a portal setup the first time if needed. */
export async function createPortal(ctx: Ctx, fetchImpl: Fetch = fetch) {
  assertCan(ctx.actor, 'org.own');
  if (!billingConfigured(ctx.config)) throw conflict('BILLING_NOT_CONFIGURED', 'Online payment is not set up on this installation');
  const [acct] = await tx(ctx, (t) => t.select().from(billingAccounts).where(eq(billingAccounts.organisationId, ctx.actor.organisationId)));
  if (!acct?.customerId) throw conflict('NO_CUSTOMER', 'This organisation has no billing account yet');
  const params = { customer: acct.customerId, return_url: `${ctx.config.PUBLIC_WEB_URL}/app/settings?tab=plan` };
  try {
    return { url: String((await stripeCall(ctx.config, 'POST', 'billing_portal/sessions', params, fetchImpl)).url) };
  } catch (e) {
    // a Stripe account that never saved a customer portal setup: create one (cancel at period end, card, invoices)
    if (!(e instanceof AppError) || !/configuration/i.test(e.message)) throw e;
    const conf = await stripeCall(
      ctx.config,
      'POST',
      'billing_portal/configurations',
      {
        'business_profile[headline]': 'Manage your MatchFrame plan',
        'features[invoice_history][enabled]': 'true',
        'features[payment_method_update][enabled]': 'true',
        'features[customer_update][enabled]': 'true',
        'features[customer_update][allowed_updates][]': ['email', 'address', 'name', 'tax_id'],
        'features[subscription_cancel][enabled]': 'true',
        'features[subscription_cancel][mode]': 'at_period_end',
        default_return_url: params.return_url,
      },
      fetchImpl,
    );
    return { url: String((await stripeCall(ctx.config, 'POST', 'billing_portal/sessions', { ...params, configuration: String(conf.id) }, fetchImpl)).url) };
  }
}

const STATUS: Record<string, string> = { active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'cancelled', canceled: 'cancelled', incomplete: 'none', incomplete_expired: 'none', paused: 'cancelled' };
/** Subscriptions in these states keep their plan (a failed renewal keeps it while Stripe retries). */
const KEEPS_PLAN = new Set(['active', 'trialing', 'past_due']);

/**
 * Bring an organisation's billing account in line with a Stripe subscription: plan, status, billing period, renewal
 * date and whether it is set to end. A new subscription from Checkout also ends any plan given by staff.
 */
export async function applySubscription(db: Db, organisationId: string, sub: StripeObject, opts: { customerId?: string; eventId?: string; newSubscription?: boolean; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const meta = (sub.metadata as Record<string, string> | undefined) ?? {};
  const item = ((sub.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0] ?? {};
  const price = (item.price as Record<string, unknown> | undefined) ?? {};
  const fromKey = planFromLookupKey(price.lookup_key);
  const status = STATUS[String(sub.status)] ?? 'none';
  // newer Stripe API versions keep the period on the subscription item
  const periodEnd = Number(sub.current_period_end ?? item.current_period_end ?? 0);
  const interval = meta.interval ?? fromKey?.interval ?? ((price.recurring as { interval?: string } | undefined)?.interval === 'year' ? 'yearly' : 'monthly');
  return withTenant(db, { organisationId }, async (t) => {
    const acct = await accountFor(t, organisationId, 'stripe');
    if (opts.eventId && acct.lastEventId === opts.eventId) return effectivePlan(acct, now);
    const plan = (meta.plan ?? fromKey?.plan ?? (acct.plan !== 'free' ? acct.plan : null) ?? 'club') as PlanKey;
    const next = {
      provider: 'stripe',
      customerId: opts.customerId || String(sub.customer ?? '') || acct.customerId,
      subscriptionId: status === 'cancelled' || status === 'none' ? null : String(sub.id),
      plan: KEEPS_PLAN.has(status) ? plan : 'free',
      status,
      interval,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end || !!sub.cancel_at,
      ...(opts.eventId ? { lastEventId: opts.eventId } : {}),
      updatedAt: new Date(now),
    };
    const endGrant = opts.newSubscription && KEEPS_PLAN.has(status) && activeGrant(acct, now);
    await t
      .update(billingAccounts)
      .set({ ...next, ...(endGrant ? { grantPlan: null, grantEndsAt: null, grantedBy: null, grantedAt: null, grantReason: null } : {}) })
      .where(eq(billingAccounts.organisationId, organisationId));
    if (acct.plan !== next.plan || acct.status !== next.status || endGrant)
      await t.insert(auditLogs).values({ organisationId, actorType: 'system', action: 'billing.subscription', resourceType: 'organisation', resourceId: organisationId, before: { plan: acct.plan, status: acct.status }, after: { plan: next.plan, status: next.status, interval, ...(endGrant ? { staffPlanEnded: acct.grantPlan } : {}) } });
    return syncEntitlements(t, organisationId, now, 'billing');
  });
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
export async function handleStripeEvent(db: Db, event: { id: string; type: string; data: { object: Record<string, unknown> } }, cfg?: AppConfig, fetchImpl: Fetch = fetch) {
  const obj = event.data.object as StripeObject;
  const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
  const organisationId = meta.organisationId ?? (obj.client_reference_id as string | undefined);
  if (!organisationId || !/^[0-9a-f-]{36}$/i.test(organisationId)) return { ignored: true };
  if (event.type === 'checkout.session.completed') {
    if (!obj.subscription) return { ignored: true };
    // the session names the subscription; read it for its status and period (or apply what the session says)
    const sub = typeof obj.subscription === 'object' ? (obj.subscription as StripeObject) : cfg?.STRIPE_SECRET_KEY ? await stripeCall(cfg, 'GET', `subscriptions/${String(obj.subscription)}`, {}, fetchImpl) : { id: String(obj.subscription), status: 'active', metadata: meta };
    const plan = await applySubscription(db, organisationId, sub, { customerId: String(obj.customer ?? ''), eventId: event.id, newSubscription: true });
    return { applied: event.type, plan };
  }
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const plan = await applySubscription(db, organisationId, event.type === 'customer.subscription.deleted' ? { ...obj, status: 'canceled' } : obj, { eventId: event.id });
    return { applied: event.type, plan };
  }
  return { ignored: true };
}

/**
 * Worker: re-read every Stripe subscription, so renewals, cancellations and failed payments reach the plan even
 * without a webhook. A subscription Stripe no longer has ends the plan.
 */
export async function syncSubscriptions(deps: { db: Db; config: AppConfig; now?: () => number }, fetchImpl: Fetch = fetch) {
  if (!billingConfigured(deps.config)) return { checked: 0, changed: 0 };
  const rows = await deps.db.select({ organisationId: billingAccounts.organisationId, subscriptionId: billingAccounts.subscriptionId, plan: billingAccounts.plan, status: billingAccounts.status }).from(billingAccounts).where(and(eq(billingAccounts.provider, 'stripe'), isNotNull(billingAccounts.subscriptionId)));
  let changed = 0;
  for (const r of rows) {
    let sub: StripeObject;
    try {
      sub = await stripeCall(deps.config, 'GET', `subscriptions/${r.subscriptionId}`, {}, fetchImpl);
    } catch (e) {
      if (e instanceof AppError && e.status === 404) sub = { id: r.subscriptionId!, status: 'canceled' };
      else continue; // Stripe unreachable: try again next round
    }
    const before = `${r.plan}/${r.status}`;
    await applySubscription(deps.db, r.organisationId, sub, { now: deps.now?.() });
    const [after] = await withTenant(deps.db, { organisationId: r.organisationId }, (t) => t.select({ plan: billingAccounts.plan, status: billingAccounts.status }).from(billingAccounts).where(eq(billingAccounts.organisationId, r.organisationId)));
    if (`${after?.plan}/${after?.status}` !== before) changed++;
  }
  return { checked: rows.length, changed };
}

// ------------------------------------------------------------------ plans set by hand

/** The owner's own choice of plan (no online payment): becomes the organisation's base plan. */
export async function applyManualPlan(t: Tx, organisationId: string, plan: PlanKey, updatedBy: string, now = Date.now()) {
  if (!PLANS[plan]) throw invalid('Unknown plan', [{ field: 'plan', message: 'Unknown plan' }]);
  await accountFor(t, organisationId);
  await t.update(billingAccounts).set({ provider: 'manual', plan, status: plan === 'free' ? 'none' : 'active', updatedAt: new Date(now) }).where(eq(billingAccounts.organisationId, organisationId));
  return syncEntitlements(t, organisationId, now, updatedBy);
}

/**
 * Manual plan change by an organisation owner on an installation without online payment (self-hosted, invoices
 * handled elsewhere). With Stripe set up, plans come from subscriptions, or from site staff in the staff console.
 */
export async function setPlanManually(ctx: Ctx, plan: PlanKey) {
  assertCan(ctx.actor, 'org.own');
  if (billingConfigured(ctx.config)) throw conflict('BILLING_MANAGED', 'Plans are chosen through checkout on this installation. Contact support to change a plan by hand.');
  return tx(ctx, async (t) => {
    await applyManualPlan(t, ctx.actor.organisationId, plan, ctx.actor.userId!, nowMs(ctx));
    await audit(t, ctx.actor, 'billing.plan', 'organisation', ctx.actor.organisationId, { after: { plan } });
    return { ok: true, plan };
  });
}

/** A plan given by site staff until `endsAt` (null = permanent), in place of the paid or owner-chosen plan. */
export async function grantPlan(t: Tx, organisationId: string, g: { plan: PlanKey; endsAt: Date | null; by: string; reason: string; now: number }) {
  if (!PLANS[g.plan]) throw invalid('Unknown plan', [{ field: 'plan', message: 'Unknown plan' }]);
  const before = await accountFor(t, organisationId);
  await t
    .update(billingAccounts)
    .set({ grantPlan: g.plan, grantEndsAt: g.endsAt, grantedBy: g.by, grantedAt: new Date(g.now), grantReason: g.reason, updatedAt: new Date(g.now) })
    .where(eq(billingAccounts.organisationId, organisationId));
  return { before: { plan: effectivePlan(before, g.now), endsAt: activeGrant(before, g.now) ? before.grantEndsAt : null }, plan: await syncEntitlements(t, organisationId, g.now, g.by), basePlan: before.plan as PlanKey };
}

/** End a plan given by staff now: the organisation goes back to its paid or owner-chosen plan. */
export async function endPlanGrant(t: Tx, organisationId: string, by: string, now: number) {
  const before = await accountFor(t, organisationId);
  if (!activeGrant(before, now)) throw conflict('NO_STAFF_PLAN', 'This organisation has no plan given by staff');
  await t.update(billingAccounts).set({ grantPlan: null, grantEndsAt: null, grantedBy: null, grantedAt: null, grantReason: null, updatedAt: new Date(now) }).where(eq(billingAccounts.organisationId, organisationId));
  return { ended: before.grantPlan as PlanKey, plan: await syncEntitlements(t, organisationId, now, by) };
}

/**
 * Worker: end every plan given by staff whose time is up. Each is logged in the organisation's activity log and the
 * staff log as the system ending it.
 */
export async function expirePlanGrants(deps: { db: Db; now?: () => number }) {
  const now = deps.now?.() ?? Date.now();
  const due = await deps.db.select({ organisationId: billingAccounts.organisationId }).from(billingAccounts).where(and(isNotNull(billingAccounts.grantPlan), lte(billingAccounts.grantEndsAt, new Date(now))));
  let ended = 0;
  for (const { organisationId } of due) {
    await withTenant(deps.db, { organisationId }, async (t) => {
      const [a] = await t.select().from(billingAccounts).where(eq(billingAccounts.organisationId, organisationId)).for('update');
      if (!a?.grantPlan || !a.grantEndsAt || a.grantEndsAt.getTime() > now) return; // changed meanwhile
      await t.update(billingAccounts).set({ grantPlan: null, grantEndsAt: null, grantedBy: null, grantedAt: null, grantReason: null, updatedAt: new Date(now) }).where(eq(billingAccounts.organisationId, organisationId));
      const plan = await syncEntitlements(t, organisationId, now, 'system');
      const detail = { ended: a.grantPlan, endsAt: a.grantEndsAt.toISOString(), givenBy: a.grantedBy, now: plan };
      await t.insert(auditLogs).values({ organisationId, actorType: 'system', action: 'billing.staff_plan.ended', resourceType: 'organisation', resourceId: organisationId, before: { plan: a.grantPlan }, after: { plan } });
      await t.insert(platformAuditLogs).values({ actorUserId: null, actorRole: 'system', action: 'organisation.plan.ended', targetType: 'organisation', targetId: organisationId, organisationId, detail });
      ended++;
    });
  }
  return { ended };
}
