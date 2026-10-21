// Fingerprints of every starter flow MatchFrame has shipped, so a plan that is still an untouched copy of an older
// one can be brought up to the current one (gameplans.upgradeStarterPlans). When a starter in
// packages/domain/src/starter-plans.ts changes, add the new version's fingerprint here (starter-history.test.ts
// prints it); never remove one, or plans copied from that version stop being recognised.
import { createHash } from 'node:crypto';
import { gamePlanSchema, type Sport } from '@bs/domain';

export const STARTER_FINGERPRINTS: Partial<Record<Sport, string[]>> = {
  football: [
    '127283154f9449ceda044f9aae1d9f0d', // M4: background and header from "Pre-match" or "Players entering"
    'e0cf7c023aa2e25b37b348d60633d973', // broadcast match flow
    '0e6a0c1011ad6f197d5e9c7f76104994', // timed line-ups, half-time cycle, thank-you board
    'fc67f368d6fde27470bd18ba1285cf8e', // background and header from match creation
    '60b90f740e725e21d4197763afb5ddd0', // scorebug at "About to start"
  ],
  basketball: ['2a72efc1183f22c928818f24e5c8a135'],
  netball: ['cf62a84825b609243d794e2884bc75ba'],
  rugby_league: ['3c33e86754195214e7d6e227630f86ba'],
  afl: ['f9139044bd932f100515c999d6798186'],
  hockey: ['3d6975e875876a18ac1f94fa33dd9439'],
};

const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;

/** Fingerprint of a plan definition as publishing stores it (defaults filled in, key order ignored); null if it is not a valid plan. */
export function planFingerprint(definition: unknown): string | null {
  const r = gamePlanSchema.safeParse(definition);
  return r.success ? createHash('sha256').update(JSON.stringify(stable(r.data))).digest('hex').slice(0, 32) : null;
}
