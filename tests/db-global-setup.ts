// Creates a fresh, migrated test database for every run, then points the db test project at it. Starting empty
// keeps the run independent of earlier ones: leftovers from previous runs (live outputs with their scorebug up, for
// one) would otherwise pile up and slow the automation sweeps under test until their leases expire.
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
  await c.query(`DROP DATABASE IF EXISTS ${testDb} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${testDb}`);
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
