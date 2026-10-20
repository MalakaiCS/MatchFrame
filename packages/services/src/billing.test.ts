import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { monthsFreeYearly, PRICE_PLANS } from '@bs/domain';
import type { AppConfig } from '@bs/config';
import { billingConfigured, stripePrice, verifyStripeSignature, PLANS } from './billing';

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
  it('maps each plan and billing period to its Stripe price, and needs at least one to take payments', () => {
    const cfg = { STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', STRIPE_PRICE_STARTER_YEARLY: 'price_sy', STRIPE_PRICE_CLUB: 'price_legacy_club' } as unknown as AppConfig;
    expect(stripePrice(cfg, 'starter', 'yearly')).toBe('price_sy');
    expect(stripePrice(cfg, 'starter', 'monthly')).toBeUndefined();
    expect(stripePrice(cfg, 'club', 'monthly')).toBe('price_legacy_club');
    expect(stripePrice({ ...cfg, STRIPE_PRICE_CLUB_MONTHLY: 'price_cm' } as AppConfig, 'club', 'monthly')).toBe('price_cm');
    expect(billingConfigured(cfg)).toBe(true);
    expect(billingConfigured({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' } as unknown as AppConfig)).toBe(false);
  });
});
