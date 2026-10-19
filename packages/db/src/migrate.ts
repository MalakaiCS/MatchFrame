// Applies migrations as the admin role, after ensuring the least-privilege application roles exist.
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadDotEnv } from '@bs/config';

loadDotEnv();
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required for migrations');
const appPw = process.env.DB_APP_PASSWORD;
const workerPw = process.env.DB_WORKER_PASSWORD;
if (!appPw || !workerPw) throw new Error('DB_APP_PASSWORD and DB_WORKER_PASSWORD are required');

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
const ensureRole = async (name: string, pw: string, extra: string) => {
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [name]);
  const verb = exists.rowCount ? 'ALTER' : 'CREATE';
  await client.query(`${verb} ROLE ${name} WITH LOGIN ${extra} PASSWORD ${pg.escapeLiteral(pw)}`);
};
// API role: RLS enforced. Worker role: cross-tenant scans (outbox, cues, sessions) — never exposed to HTTP.
await ensureRole('bs_app', appPw, 'NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE');
await ensureRole('bs_worker', workerPw, 'NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE');
await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
const db = drizzle(client);
await migrate(db, { migrationsFolder: path.join(path.dirname(new URL(import.meta.url).pathname), '../drizzle') });
// Tables added by later migrations inherit grants.
await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bs_app, bs_worker');
await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bs_app, bs_worker');
const { rows } = await client.query("select count(*)::int as n from pg_tables where schemaname='public' and rowsecurity");
console.log(`migrations applied; ${rows[0].n} tables with row-level security`);
await client.end();
