import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string, opts: { max?: number; application_name?: string } = {}) {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10, application_name: opts.application_name ?? 'broadcast-studio' });
  pool.on('error', (e) => console.error('pg pool error', e.message));
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export interface TenantContext {
  organisationId: string;
  userId?: string | null;
}

/**
 * Run `fn` in a transaction with the tenant context set transaction-locally (safe under pooling).
 * RLS policies for the bs_app role read app.org_id / app.user_id.
 */
export async function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${ctx.organisationId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`);
    return fn(tx);
  });
}

/** User-scoped (no tenant) transaction: lets RLS expose the user's own memberships/organisations. */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', '', true), set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const c = (e as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string }) ?? {};
  const code = c.code ?? c.cause?.code;
  const name = c.constraint ?? c.cause?.constraint;
  return code === '23505' && (!constraint || name === constraint);
}

export function pgErrorCode(e: unknown): string | undefined {
  const c = e as { cause?: { code?: string }; code?: string };
  return c?.code ?? c?.cause?.code;
}
