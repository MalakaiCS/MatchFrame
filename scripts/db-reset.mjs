#!/usr/bin/env node
// DEVELOPMENT ONLY: drops and recreates the local database, then migrates. Refuses in production.
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { loadEnv } from './env.mjs';

const env = loadEnv('.env');
if (process.env.NODE_ENV === 'production') throw new Error('db:reset is disabled in production');
const u = new URL(env.DATABASE_ADMIN_URL);
const db = u.pathname.slice(1);
u.pathname = '/postgres';
const c = new pg.Client({ connectionString: u.toString() });
await c.connect();
await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [db]);
await c.query(`DROP DATABASE IF EXISTS ${db}`);
await c.query(`CREATE DATABASE ${db}`);
await c.end();
execFileSync('pnpm', ['db:migrate'], { stdio: 'inherit' });
console.log(`Reset ${db}. Run pnpm db:seed next.`);
