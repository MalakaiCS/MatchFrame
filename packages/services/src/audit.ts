import { auditLogs, type Tx } from '@bs/db';
import type { Actor } from './authz';
import { redact } from './crypto';

const SECRET_KEYS = /(key|secret|token|password|pass|credential)/i;

/** Remove secret-looking values before persisting audit before/after snapshots. */
export function safeSnapshot(v: unknown): Record<string, unknown> | null {
  if (v == null || typeof v !== 'object') return null;
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>).map(([k, val]) => [k, SECRET_KEYS.test(k) && !/Id$|Version$/.test(k) ? '[redacted]' : walk(val)]),
      );
    }
    return typeof x === 'string' ? redact(x) : x;
  };
  return walk(v) as Record<string, unknown>;
}

export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  resourceType: string,
  resourceId: string | null,
  opts: { before?: unknown; after?: unknown; reason?: string | null } = {},
) {
  await tx.insert(auditLogs).values({
    organisationId: actor.organisationId,
    actorUserId: actor.userId,
    actorType: actor.kind === 'system' ? 'system' : actor.kind,
    action,
    resourceType,
    resourceId,
    requestId: actor.requestId ?? null,
    before: safeSnapshot(opts.before),
    after: safeSnapshot(opts.after),
    reason: opts.reason ?? null,
  });
}
