// pnpm db:seed — creates demo data once. Owner passwords are random and printed only here.
import { getConfig } from '@bs/config';
import { createDb, users } from '@bs/db';
import { eq } from 'drizzle-orm';
import { seedDemo } from './seed';
import { seedHooks } from './seed-hooks';

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const a = process.env.SEED_OWNER_EMAIL ?? 'owner@studio.localhost';
const b = process.env.SEED_OWNER_B_EMAIL ?? 'owner-b@studio.localhost';
const exists = await db.select().from(users).where(eq(users.email, a));
if (exists.length && !process.argv.includes('--force')) {
  console.log(`Seed already applied (${a} exists). Use --force to add another copy.`);
  await pool.end();
  process.exit(0);
}
const res = await seedDemo(db, config, { ownerEmailA: a, ownerEmailB: b, hooks: seedHooks(config) });
console.log('\nDemo data created. Sign in with these one-time generated credentials (change them after first login):');
for (const o of res.organisations) console.log(`  ${o.name.padEnd(30)} ${o.owner.email}  password: ${o.owner.password}`);
await pool.end();
