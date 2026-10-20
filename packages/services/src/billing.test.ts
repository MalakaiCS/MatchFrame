import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { verifyStripeSignature, PLANS } from './billing';

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
  it('defines rising limits per plan', () => {
    expect(PLANS.free.limits.liveMatches).toBeLessThan(PLANS.club.limits.liveMatches);
    expect(PLANS.club.limits.liveMatches).toBeLessThan(PLANS.league.limits.liveMatches);
  });
});
