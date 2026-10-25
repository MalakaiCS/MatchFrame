// Usage ledger (spec §23): measured quantities with deduplication keys. Rehearsals, previews and monitors
// never create entries. Units: output_seconds (LIVE → end per output session), job_seconds (media worker
// runtime per attempt), bytes (retained storage snapshot per organisation per UTC day).
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { usageLedger, type Db, type Tx } from '@bs/db';
import { assertCan } from './authz';
import { tx, type Ctx } from './context';

export const UNIT_DEFINITIONS = {
  output_seconds: 'Seconds an output session was confirmed LIVE at the media provider (from first active report to stop/failure). Previews, monitors and rehearsals are not counted.',
  job_seconds: 'Wall-clock seconds the media worker spent on one attempt of a job (normalisation, clip extraction, export, compilation).',
  bytes: 'Retained bytes (assets, derivatives, recordings, clips, completed exports) sampled once per UTC day.',
};

export async function recordUsage(t: Tx | Db, e: { organisationId: string; module: string; sessionRef?: string | null; quantity: number; unit: keyof typeof UNIT_DEFINITIONS; start: Date; end: Date; dedupKey: string; details?: Record<string, unknown> }) {
  if (!(e.quantity > 0)) return;
  await t
    .insert(usageLedger)
    .values({ organisationId: e.organisationId, module: e.module, sessionRef: e.sessionRef ?? null, quantity: e.quantity, unit: e.unit, intervalStart: e.start, intervalEnd: e.end, dedupKey: e.dedupKey, details: e.details ?? {} })
    .onConflictDoNothing({ target: usageLedger.dedupKey });
}

/** Daily storage snapshot for every organisation (worker). */
export async function snapshotStorage(db: Db, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const rows = await db.execute<{ id: string; bytes: string }>(sql`
    select o.id, (
      coalesce((select sum(bytes) from media_assets where organisation_id = o.id and state <> 'ARCHIVED'), 0) +
      coalesce((select sum(bytes) from asset_derivatives where organisation_id = o.id), 0) +
      coalesce((select sum(bytes) from recordings where organisation_id = o.id), 0) +
      coalesce((select sum(bytes) from clips where organisation_id = o.id), 0) +
      coalesce((select sum(output_bytes) from export_jobs where organisation_id = o.id and state = 'COMPLETED'), 0))::bigint as bytes
    from organisations o`);
  for (const r of rows.rows) await recordUsage(db, { organisationId: r.id, module: 'storage', quantity: Number(r.bytes), unit: 'bytes', start: new Date(`${day}T00:00:00Z`), end: new Date(`${day}T23:59:59Z`), dedupKey: `storage:${r.id}:${day}` });
}

export async function usageReport(ctx: Ctx, q: { from?: string; to?: string } = {}) {
  assertCan(ctx.actor, 'reports.read');
  return tx(ctx, async (t) => {
    const conds = [eq(usageLedger.organisationId, ctx.actor.organisationId)];
    if (q.from) conds.push(gte(usageLedger.intervalStart, new Date(q.from)));
    if (q.to) conds.push(lte(usageLedger.intervalStart, new Date(q.to)));
    const rows = await t.select({ module: usageLedger.module, unit: usageLedger.unit, total: sql<number>`sum(${usageLedger.quantity})::float8`, entries: sql<number>`count(*)::int` }).from(usageLedger).where(and(...conds)).groupBy(usageLedger.module, usageLedger.unit);
    return { definitions: UNIT_DEFINITIONS, totals: rows };
  });
}
