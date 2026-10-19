// Creates and migrates a dedicated test database, then points the db test project at it.
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { loadDotEnv } from '@bs/config';

export default async function setup() {
  loadDotEnv();
  const admin = process.env.DATABASE_ADMIN_URL!;
  const testDb = 'broadcast_studio_test';
  const u = new URL(admin);
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  const exists = await c.query('select 1 from pg_database where datname = $1', [testDb]);
  if (!exists.rowCount) await c.query(`CREATE DATABASE ${testDb}`);
  await c.end();
  const swap = (url: string) => {
    const x = new URL(url);
    x.pathname = `/${testDb}`;
    return x.toString();
  };
  u.pathname = `/${testDb}`;
  process.env.DATABASE_ADMIN_URL = u.toString();
  process.env.DATABASE_URL = swap(process.env.DATABASE_URL!);
  process.env.DATABASE_WORKER_URL = swap(process.env.DATABASE_WORKER_URL!);
  execFileSync('npx', ['tsx', 'packages/db/src/migrate.ts'], { stdio: 'inherit', env: process.env });
}
