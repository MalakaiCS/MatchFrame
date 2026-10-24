// Applies migrations as the admin role, after ensuring the least-privilege application roles exist.
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadDotEnv, roleDatabaseUrls } from '@bs/config';

loadDotEnv();
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required for migrations');
// The role passwords are the ones the app connects with (explicit, inside the URLs, or derived from the admin password).
const roles = roleDatabaseUrls(process.env)!;
const appPw = roles.app.password;
const workerPw = roles.worker.password;

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
// Every table a migration creates gets the application roles' grants as it is created, including on a brand-new
// database where all migrations run at once (set before migrating; a migration's own REVOKEs still apply after).
await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bs_app, bs_worker');
await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bs_app, bs_worker');
const db = drizzle(client);
await migrate(db, { migrationsFolder: path.join(path.dirname(new URL(import.meta.url).pathname), '../drizzle') });
const { rows } = await client.query("select count(*)::int as n from pg_tables where schemaname='public' and rowsecurity");
console.log(`migrations applied; ${rows[0].n} tables with row-level security`);
await client.end();
