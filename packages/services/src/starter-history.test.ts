import { describe, expect, it } from 'vitest';
import { STARTER_PLANS } from '@bs/domain';
import { planFingerprint, STARTER_FINGERPRINTS } from './starter-history';

describe('starter flow history', () => {
  it('knows the fingerprint of every current starter flow', () => {
    for (const [sport, plan] of Object.entries(STARTER_PLANS)) {
      const fp = planFingerprint(plan);
      // a starter changed: add this fingerprint to STARTER_FINGERPRINTS so copies of it can be upgraded later
      expect(STARTER_FINGERPRINTS[sport as keyof typeof STARTER_FINGERPRINTS], `${sport} starter fingerprint ${fp}`).toContain(fp);
    }
  });

  it('ignores key order and fills defaults, and rejects what is not a plan', () => {
    const plan = structuredClone(STARTER_PLANS.football!);
    const reordered = Object.fromEntries(Object.entries(plan).reverse());
    expect(planFingerprint(reordered)).toBe(planFingerprint(plan));
    const edited = structuredClone(plan);
    edited.playlists[0]!.items[0]!.offsetMs = 1;
    expect(planFingerprint(edited)).not.toBe(planFingerprint(plan));
    expect(planFingerprint({ sport: 'football' })).toBeNull();
  });
});
