import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { monthsFreeYearly, PRICE_PLANS } from '@bs/domain';
import type { AppConfig } from '@bs/config';
import { activeGrant, billingConfigured, effectivePlan, lookupKey, minorUnits, stripePrice, verifyStripeSignature, PLANS } from './billing';

describe('billing', () => {
  it('verifies a Stripe signature and rejects replays and tampering', () => {
    const secret = 'whsec_test';
    const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    expect(verifyStripeSignature(payload, `t=${ts},v1=${sig}`, secret)).toBe(true);
    expect(verifyStripeSignature(payload + ' ', `t=${ts},v1=${sig}`, secret)).toBe(false);
    expect(verifyStripeSignature(payload, `t=${ts - 1000},v1=${sig}`, secret)).toBe(false);
    expect(verifyStripeSignature(payload, undefined, secret)).toBe(false);
  });
  it('offers the published plans, prices and allowances', () => {
    expect(PRICE_PLANS.map((p) => PLANS[p.key].priceLabel)).toEqual(['$29/month or $290/year', '$79/month or $790/year', '$199/month or $1,990/year', 'From $499/month']);
    expect(PRICE_PLANS.map((p) => [p.key, PLANS[p.key].limits.liveMatches, PLANS[p.key].limits.members])).toEqual([['starter', 1, 3], ['club', 2, 10], ['studio', 5, 25], ['league', null, null]]);
    expect(PRICE_PLANS.filter((p) => p.monthly != null).map(monthsFreeYearly)).toEqual([2, 2, 2]);
    expect(PLANS.league.selfServe).toBe(false);
    expect(PLANS.club.popular).toBe(true);
    expect(PLANS.free.name).toBe('No plan yet');
  });
  it('takes payments with only a secret key; a price can still be pinned per plan and period', () => {
    const cfg = { STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', STRIPE_PRICE_STARTER_YEARLY: 'price_sy', STRIPE_PRICE_CLUB: 'price_legacy_club' } as unknown as AppConfig;
    expect(stripePrice(cfg, 'starter', 'yearly')).toBe('price_sy');
    expect(stripePrice(cfg, 'starter', 'monthly')).toBeUndefined();
    expect(stripePrice(cfg, 'club', 'monthly')).toBe('price_legacy_club');
    expect(stripePrice({ ...cfg, STRIPE_PRICE_CLUB_MONTHLY: 'price_cm' } as AppConfig, 'club', 'monthly')).toBe('price_cm');
    expect(billingConfigured(cfg)).toBe(true);
    expect(billingConfigured({ STRIPE_SECRET_KEY: 'sk' } as unknown as AppConfig)).toBe(true);
    expect(billingConfigured({ STRIPE_WEBHOOK_SECRET: 'wh' } as unknown as AppConfig)).toBe(false);
    expect(lookupKey('club', 'yearly')).toBe('matchframe_club_yearly');
  });
  it('counts amounts in cents, except in currencies without them', () => {
    expect(minorUnits(79, 'aud')).toBe(7900);
    expect(minorUnits(1990, 'usd')).toBe(199000);
    expect(minorUnits(29, 'jpy')).toBe(29);
  });
  it('a plan given by staff applies until it ends, then the paid or chosen plan does', () => {
    const now = Date.parse('2026-10-24T00:00:00Z');
    const acct = { plan: 'starter', grantPlan: 'studio', grantEndsAt: new Date(now + 1000) } as Parameters<typeof effectivePlan>[0];
    expect(effectivePlan(acct, now)).toBe('studio');
    expect(effectivePlan(acct, now + 1000)).toBe('starter');
    expect(activeGrant({ grantPlan: 'club', grantEndsAt: null }, now)).toBe('club'); // permanent
    expect(effectivePlan(undefined, now)).toBe('free');
  });
});
