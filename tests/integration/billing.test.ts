// Plans and payments against real PostgreSQL (application role and worker role, row-level security on).
// Over HTTP: a plan set by site staff always has an end (days, months, a date or Permanent), shows in the console
// and in the organisation's plan screen, can be ended now, and is ended by the worker on time (logged both sides).
// Against a fake Stripe (no network): with only a secret key, prices are found or created by lookup key in the
// account's currency, Checkout is started with the organisation's details and confirmed on return (ending a plan
// given by staff), webhooks and the worker's sync apply renewals, cancellations and deleted subscriptions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, billingAccounts, createDb, entitlements, platformAuditLogs, withTenant } from '@bs/db';
import { getConfig, type AppConfig } from '@bs/config';
import { billing, resolveActor, type Ctx } from '@bs/services';
import { buildApp, type AppBundle } from '../../apps/api/src/app';
import { registerRoutes } from '../../apps/api/src/routes';
import { Client } from '../http-client';

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const worker = createDb(config.DATABASE_WORKER_URL ?? config.DATABASE_URL);
const links: { kind: string; email: string; url: string }[] = [];
const origin = new URL(config.PUBLIC_WEB_URL).origin;
const tag = Date.now().toString(36);
const mail = (who: string) => `${who}-${tag}@example.test`;
const password = 'correct-horse-battery-1';
const DAY = 86_400_000;
let b: AppBundle;

beforeAll(async () => {
  b = await buildApp({
    db,
    config: { ...config, PUBLIC_API_URL: origin, PLATFORM_OWNER_EMAILS: mail('boss'), STRIPE_SECRET_KEY: undefined },
    mailer: { send: async () => undefined },
    onEmailLink: (kind, email, url) => links.push({ kind, email, url }),
  });
  registerRoutes(b);
  await b.app.ready();
});
afterAll(async () => {
  await b.app.close();
  await pool.end();
  await worker.pool.end();
});

let n = 0;
async function signUp(who: string) {
  const c = new Client(() => b, origin, { 'x-forwarded-for': `10.78.0.${++n}` });
  const email = mail(who);
  expect((await c.req('POST', '/api/auth/sign-up/email', { email, password, name: who })).status).toBe(200);
  const v = new URL(links.find((l) => l.kind === 'verify' && l.email === email)!.url);
  await c.req('GET', v.pathname + v.search);
  const me = await c.req('GET', '/api/v1/me');
  return { c, email, id: (me.json.user as { id: string }).id };
}
async function orgFor(who: Awaited<ReturnType<typeof signUp>>, name: string) {
  const r = await who.c.req('POST', '/api/v1/organisations', { name: `${name} ${tag}`, timezone: 'Australia/Brisbane' });
  return r.json.id as string;
}

/** A fake Stripe: answers by method and path, records every call (form bodies decoded). */
function fakeStripe(routes: Record<string, (q: URLSearchParams) => { status?: number; json: unknown }>) {
  const calls: { method: string; path: string; params: URLSearchParams; auth: string | null }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const params = method === 'GET' ? u.searchParams : new URLSearchParams(String(init?.body ?? ''));
    calls.push({ method, path: u.pathname.replace('/v1/', ''), params, auth: new Headers(init?.headers).get('authorization') });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && new RegExp(`^${p}$`).test(u.pathname.replace('/v1/', ''));
    });
    const r = key ? routes[key]!(params) : { status: 404, json: { error: { message: 'No such resource', code: 'resource_missing' } } };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('plans given by site staff', () => {
  let boss: Awaited<ReturnType<typeof signUp>>;
  let owner: Awaited<ReturnType<typeof signUp>>;
  let orgId = '';

  it('every change needs a duration; days, months, a date and Permanent all work', async () => {
    boss = await signUp('boss');
    owner = await signUp('owner');
    orgId = await orgFor(owner, 'Coastal Sport');
    const url = `/api/v1/staff/organisations/${orgId}/plan`;
    // a new organisation has no plan of its own yet
    expect((await boss.c.req('GET', `/api/v1/staff/organisations/${orgId}`)).json).toMatchObject({ billing: { basePlan: 'free', staffPlan: null } });
    const missing = await boss.c.req('PUT', url, { plan: 'club', reason: 'Season sponsor' });
    expect(missing.status).toBe(400);
    const past = await boss.c.req('PUT', url, { plan: 'club', reason: 'Season sponsor', duration: 'date', until: '2020-01-01T00:00:00Z' });
    expect(past.status).toBe(422);
    expect(JSON.stringify(past.json)).toContain('in the future');

    const t0 = Date.now();
    const week = await boss.c.req('PUT', url, { plan: 'club', reason: 'Trial for the cup', duration: '7d' });
    expect(week.json).toMatchObject({ plan: 'club', afterEnd: 'free' });
    const ends = new Date(week.json.endsAt as string).getTime();
    expect(ends - t0).toBeGreaterThan(7 * DAY - 60_000);
    expect(ends - t0).toBeLessThan(7 * DAY + 60_000);

    // the console shows it with when it ends and who gave it; the organisation's plan screen too
    const d = await boss.c.req('GET', `/api/v1/staff/organisations/${orgId}`);
    expect(d.json).toMatchObject({ entitlements: { plan: 'club' }, billing: { basePlan: 'free', staffPlan: { plan: 'club', reason: 'Trial for the cup', by: { email: boss.email } } } });
    const list = await boss.c.req('GET', `/api/v1/staff/organisations?search=${encodeURIComponent(`Coastal Sport ${tag}`)}`);
    expect((list.json.items as { id: string; staffPlan: string; planEndsAt: string }[]).find((o) => o.id === orgId)).toMatchObject({ staffPlan: 'club' });
    const mine = await owner.c.req('GET', '/api/v1/billing');
    expect(mine.json).toMatchObject({ plan: { key: 'club' }, basePlan: { key: 'free' }, grant: { plan: { key: 'club' } } });
    expect(new Date((mine.json.grant as { endsAt: string }).endsAt).getTime()).toBe(ends);

    const month = await boss.c.req('PUT', url, { plan: 'studio', reason: 'Finals month', duration: '1m' });
    const m = new Date(month.json.endsAt as string);
    const expected = new Date(t0);
    expected.setUTCMonth(expected.getUTCMonth() + 1);
    expect(Math.abs(m.getTime() - expected.getTime())).toBeLessThan(4 * DAY); // a calendar month, not 30 days
    const until = new Date(Date.now() + 45 * DAY).toISOString();
    expect((await boss.c.req('PUT', url, { plan: 'starter', reason: 'Invoice pending', duration: 'date', until })).json).toMatchObject({ plan: 'starter', endsAt: until });
    expect((await boss.c.req('PUT', url, { plan: 'club', reason: 'Founding club', duration: 'permanent' })).json).toMatchObject({ plan: 'club', endsAt: null });

    // logged in the staff log and the organisation's activity, with the length and the end
    const [entry] = await db.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, 'organisation.plan'), eq(platformAuditLogs.targetId, orgId))).orderBy(platformAuditLogs.id).limit(1);
    expect(entry?.detail).toMatchObject({ after: 'club', duration: '7 days', afterEnd: 'free' });
    const acts = await withTenant(worker.db, { organisationId: orgId }, (t) => t.select().from(auditLogs).where(and(eq(auditLogs.organisationId, orgId), eq(auditLogs.action, 'staff.billing.plan'))));
    expect(acts.length).toBe(4);
  });

  it('ended now by staff: the organisation goes back to its own plan', async () => {
    const r = await boss.c.req('POST', `/api/v1/staff/organisations/${orgId}/plan/end`, { reason: 'Moved to a paid plan' });
    expect(r.json).toEqual({ plan: 'free', ended: 'club' });
    expect((await owner.c.req('GET', '/api/v1/billing')).json).toMatchObject({ plan: { key: 'free' }, grant: null });
    expect((await boss.c.req('POST', `/api/v1/staff/organisations/${orgId}/plan/end`, { reason: 'again' })).json.error?.code).toBe('NO_STAFF_PLAN');
    // the owner's own plan (no online payment here) stays underneath a staff plan, and returns after it
    expect((await owner.c.req('POST', '/api/v1/billing/plan', { plan: 'starter' })).json).toMatchObject({ plan: 'starter' });
    await boss.c.req('PUT', `/api/v1/staff/organisations/${orgId}/plan`, { plan: 'studio', reason: 'Tournament week', duration: '1d' });
    expect((await owner.c.req('GET', '/api/v1/billing')).json).toMatchObject({ plan: { key: 'studio' }, basePlan: { key: 'starter' } });
  });

  it('the worker ends it on time and logs it as the system', async () => {
    expect((await billing.expirePlanGrants({ db: worker.db })).ended).toBe(0); // not yet
    const r = await billing.expirePlanGrants({ db: worker.db, now: () => Date.now() + DAY + 60_000 });
    expect(r.ended).toBeGreaterThanOrEqual(1);
    const [ent] = await withTenant(worker.db, { organisationId: orgId }, (t) => t.select().from(entitlements).where(eq(entitlements.organisationId, orgId)));
    expect(ent?.plan).toBe('starter');
    expect((await owner.c.req('GET', '/api/v1/billing')).json).toMatchObject({ plan: { key: 'starter' }, grant: null });
    const [sys] = await db.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, 'organisation.plan.ended'), eq(platformAuditLogs.targetId, orgId)));
    expect(sys).toMatchObject({ actorRole: 'system', actorUserId: null, detail: expect.objectContaining({ ended: 'studio', now: 'starter' }) });
    const [act] = await withTenant(worker.db, { organisationId: orgId }, (t) => t.select().from(auditLogs).where(and(eq(auditLogs.organisationId, orgId), eq(auditLogs.action, 'billing.staff_plan.ended'))));
    expect(act?.actorType).toBe('system');
  });
});

describe('payments with only a Stripe secret key (fake Stripe)', () => {
  const stripeCfg = { ...config, STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: undefined, STRIPE_CURRENCY: undefined } as AppConfig;
  let ctx: Ctx;
  let orgId = '';
  let owner: Awaited<ReturnType<typeof signUp>>;

  beforeAll(async () => {
    billing.resetStripeCache();
    owner = await signUp('payer');
    orgId = await orgFor(owner, 'Harbour Media');
    const actor = (await resolveActor(db, owner.id, orgId))!;
    ctx = { db, config: stripeCfg, actor };
  });

  it('finds no price, so creates one from the catalogue in the account currency, once', async () => {
    const s = fakeStripe({
      'GET account': () => ({ json: { id: 'acct_1', default_currency: 'aud' } }),
      'GET prices': () => ({ json: { data: [] } }),
      'POST prices': (p) => ({ json: { id: `price_${p.get('lookup_key')}`, currency: p.get('currency'), unit_amount: Number(p.get('unit_amount')) } }),
    });
    expect(await billing.resolvePrice(stripeCfg, 'club', 'yearly', s.fetchImpl)).toBe('price_matchframe_club_yearly');
    const created = s.calls.find((c) => c.method === 'POST')!;
    expect(Object.fromEntries(created.params)).toMatchObject({ currency: 'aud', unit_amount: '79000', 'recurring[interval]': 'year', lookup_key: 'matchframe_club_yearly', transfer_lookup_key: 'true', 'product_data[name]': 'MatchFrame Club' });
    expect(created.auth).toBe('Bearer sk_test_fake');
    await billing.resolvePrice(stripeCfg, 'club', 'yearly', s.fetchImpl);
    expect(s.calls.filter((c) => c.method === 'POST')).toHaveLength(1); // remembered
    expect(await billing.publicBilling(stripeCfg, s.fetchImpl)).toEqual({ online: true, currency: 'AUD' });
  });

  it('reuses a matching price, and replaces one whose amount no longer matches the catalogue', async () => {
    billing.resetStripeCache();
    const ok = fakeStripe({ 'GET account': () => ({ json: { default_currency: 'aud' } }), 'GET prices': () => ({ json: { data: [{ id: 'price_old_ok', currency: 'aud', unit_amount: 2900, product: 'prod_s' }] } }) });
    expect(await billing.resolvePrice(stripeCfg, 'starter', 'monthly', ok.fetchImpl)).toBe('price_old_ok');
    expect(ok.calls.some((c) => c.method === 'POST')).toBe(false);
    billing.resetStripeCache();
    const stale = fakeStripe({
      'GET account': () => ({ json: { default_currency: 'aud' } }),
      'GET prices': () => ({ json: { data: [{ id: 'price_old', currency: 'aud', unit_amount: 1900, product: 'prod_s' }] } }),
      'POST prices': () => ({ json: { id: 'price_new' } }),
    });
    expect(await billing.resolvePrice(stripeCfg, 'starter', 'monthly', stale.fetchImpl)).toBe('price_new');
    expect(Object.fromEntries(stale.calls.find((c) => c.method === 'POST')!.params)).toMatchObject({ product: 'prod_s', unit_amount: '2900' });
  });

  it('starts Checkout for the organisation and confirms it on return; a staff plan gives way to the paid one', async () => {
    // a staff trial first
    await withTenant(db, { organisationId: orgId, userId: owner.id }, (t) => billing.grantPlan(t, orgId, { plan: 'studio', endsAt: new Date(Date.now() + 14 * DAY), by: owner.id, reason: 'trial', now: Date.now() }));
    const periodEnd = Math.floor(Date.now() / 1000) + 365 * 86400;
    const sub = { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { organisationId: orgId, plan: 'club', interval: 'yearly' }, items: { data: [{ current_period_end: periodEnd, price: { lookup_key: 'matchframe_club_yearly', recurring: { interval: 'year' } } }] } };
    const s = fakeStripe({
      'GET account': () => ({ json: { default_currency: 'aud' } }),
      'GET prices': () => ({ json: { data: [{ id: 'price_cy', currency: 'aud', unit_amount: 79000, product: 'prod_c' }] } }),
      'POST checkout/sessions': () => ({ json: { id: 'cs_test_abcdefgh123', url: 'https://checkout.stripe.test/c/pay' } }),
      'GET checkout/sessions/cs_test_abcdefgh123': () => ({ json: { id: 'cs_test_abcdefgh123', status: 'complete', client_reference_id: orgId, customer: 'cus_1', subscription: sub } }),
    });
    billing.resetStripeCache();
    expect(await billing.createCheckout(ctx, { plan: 'club', interval: 'yearly' }, s.fetchImpl)).toEqual({ url: 'https://checkout.stripe.test/c/pay' });
    const session = Object.fromEntries(s.calls.find((c) => c.path === 'checkout/sessions')!.params);
    expect(session).toMatchObject({ mode: 'subscription', 'line_items[0][price]': 'price_cy', client_reference_id: orgId, customer_email: owner.email, 'subscription_data[metadata][plan]': 'club', 'subscription_data[metadata][interval]': 'yearly' });
    expect(session.success_url).toContain('/app/settings?tab=plan&billing=success&session={CHECKOUT_SESSION_ID}');

    // someone else's session is refused
    const other = fakeStripe({ 'GET checkout/sessions/cs_test_someoneelse': () => ({ json: { id: 'x', status: 'complete', client_reference_id: '00000000-0000-4000-8000-000000000000', subscription: sub } }) });
    await expect(billing.confirmCheckout(ctx, 'cs_test_someoneelse', other.fetchImpl)).rejects.toMatchObject({ status: 404 });

    expect(await billing.confirmCheckout(ctx, 'cs_test_abcdefgh123', s.fetchImpl)).toEqual({ status: 'complete', plan: 'club' });
    const g = await billing.getBilling(ctx);
    expect(g).toMatchObject({ configured: true, plan: { key: 'club' }, grant: null, status: 'active', interval: 'yearly', cancelAtPeriodEnd: false, canManage: true });
    expect(new Date(g.currentPeriodEnd!).getTime()).toBe(periodEnd * 1000);
  });

  it('webhook events update the plan in the organisation’s tenant context, once per event', async () => {
    const event = (id: string, type: string, object: Record<string, unknown>) => ({ id, type, data: { object } });
    const base = { id: 'sub_1', customer: 'cus_1', metadata: { organisationId: orgId, plan: 'club', interval: 'yearly' } };
    expect(await billing.handleStripeEvent(db, event('evt_1', 'customer.subscription.updated', { ...base, status: 'active', cancel_at_period_end: true }))).toEqual({ applied: 'customer.subscription.updated', plan: 'club' });
    expect(await billing.getBilling(ctx)).toMatchObject({ cancelAtPeriodEnd: true, plan: { key: 'club' } });
    expect(await billing.handleStripeEvent(db, event('evt_2', 'customer.subscription.updated', { ...base, status: 'past_due' }))).toMatchObject({ plan: 'club' }); // kept while Stripe retries
    expect(await billing.handleStripeEvent(db, event('evt_3', 'customer.subscription.deleted', { ...base, status: 'canceled' }))).toMatchObject({ plan: 'free' });
    expect(await billing.handleStripeEvent(db, event('evt_3', 'customer.subscription.deleted', { ...base, status: 'canceled' }))).toMatchObject({ plan: 'free' }); // duplicate
    expect(await billing.getBilling(ctx)).toMatchObject({ plan: { key: 'free' }, status: 'cancelled' });
    expect(await billing.handleStripeEvent(db, event('evt_4', 'invoice.paid', base))).toEqual({ ignored: true });
  });

  it('the worker re-reads subscriptions: a renewal arrives, and one Stripe no longer has ends the plan', async () => {
    await billing.applySubscription(db, orgId, { id: 'sub_2', status: 'active', customer: 'cus_1', metadata: { plan: 'studio', interval: 'monthly' } });
    const renewed = Math.floor(Date.now() / 1000) + 31 * 86400;
    const live = fakeStripe({ 'GET subscriptions/sub_2': () => ({ json: { id: 'sub_2', status: 'active', customer: 'cus_1', metadata: { plan: 'studio', interval: 'monthly' }, current_period_end: renewed } }) });
    const r1 = await billing.syncSubscriptions({ db: worker.db, config: stripeCfg }, live.fetchImpl);
    expect(r1.checked).toBeGreaterThanOrEqual(1);
    expect(new Date((await billing.getBilling(ctx)).currentPeriodEnd!).getTime()).toBe(renewed * 1000);
    const gone = fakeStripe({});
    await billing.syncSubscriptions({ db: worker.db, config: stripeCfg }, gone.fetchImpl);
    const [acct] = await withTenant(worker.db, { organisationId: orgId }, (t) => t.select().from(billingAccounts).where(eq(billingAccounts.organisationId, orgId)));
    expect(acct).toMatchObject({ plan: 'free', status: 'cancelled', subscriptionId: null });
  });

  it('without a secret key there is no online payment and owners choose the plan themselves', async () => {
    const off = { ...ctx, config: { ...config, STRIPE_SECRET_KEY: undefined } as AppConfig };
    expect((await billing.getBilling(off)).configured).toBe(false);
    await expect(billing.createCheckout(off, { plan: 'club' })).rejects.toMatchObject({ code: 'BILLING_NOT_CONFIGURED' });
    expect(await billing.publicBilling(off.config)).toEqual({ online: false, currency: null });
  });
});
