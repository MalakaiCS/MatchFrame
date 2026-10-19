// Worker: outbox relay, automation, scheduler, reconciliation and housekeeping (bs_worker role).
import { getConfig } from '@bs/config';
import { createDb } from '@bs/db';
import { Redis } from 'ioredis';
import { createRelay, type OutboxRow } from '@bs/services';
import { buildSubscribers, startBackground } from './subscribers';

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_WORKER_URL, { max: 15, application_name: 'bs-worker' });
const pub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const ctx = { db, config, workerId, redis: pub };
const relay = createRelay({
  db,
  databaseUrl: config.DATABASE_WORKER_URL,
  publish: async (e: OutboxRow) => {
    await pub.publish('bs:events', JSON.stringify(e));
  },
  subscribers: buildSubscribers(ctx),
});
await relay.start();
const bg = await startBackground(ctx);
console.log(`[worker] ${workerId} started`);

const shutdown = async () => {
  await relay.stop();
  await bg.stop();
  pub.disconnect();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
