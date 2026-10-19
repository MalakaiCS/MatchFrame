// Media worker: FFmpeg jobs (asset normalisation, clip extraction, exports, compilations) with bounded
// concurrency, plus highlight mapping, recording size finalisation and retention (bs_worker role).
import { Worker } from 'bullmq';
import { getConfig } from '@bs/config';
import { createDb } from '@bs/db';
import { createQueues, createStorage, library, mediaJobs, QUEUE, redisConnection, type MediaJob } from '@bs/services';

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_WORKER_URL, { max: 8, application_name: 'bs-media-worker' });
const storage = createStorage(config);
const queues = createQueues(config.REDIS_URL);
const d = { db, storage, workerId: `media-${process.pid}` };
const concurrency = Number(process.env.MEDIA_JOB_CONCURRENCY ?? 1);

const worker = new Worker<MediaJob>(QUEUE.media, async (job) => mediaJobs.processJob(d, job.data.exportJobId), { connection: redisConnection(config.REDIS_URL), concurrency, lockDuration: 120_000 });
worker.on('failed', (job, err) => console.error(`[media-worker] job ${job?.id} failed: ${err.message}`));

let stopped = false;
const timers: NodeJS.Timeout[] = [];
const every = (name: string, ms: number, fn: () => Promise<unknown>) => {
  const run = async () => {
    if (stopped) return;
    await fn().catch((e) => console.error(`[media-worker] ${name} failed`, (e as Error).message));
    if (!stopped) timers.push(setTimeout(run, ms));
  };
  timers.push(setTimeout(run, ms));
};
every('highlights', 2000, () => library.processHighlights(db, storage, queues));
every('recording-sizes', 30_000, () => mediaJobs.finaliseRecordingSizes(d));
every('retention', 3600_000, () => library.runRetention(db, storage));
// jobs whose queue message was lost (Redis restart) are re-enqueued from the durable table
every('requeue', 60_000, async () => {
  const { exportJobs } = await import('@bs/db');
  const { and, eq, lte } = await import('drizzle-orm');
  const stale = await db.select({ id: exportJobs.id, org: exportJobs.organisationId }).from(exportJobs).where(and(eq(exportJobs.state, 'QUEUED'), lte(exportJobs.updatedAt, new Date(Date.now() - 120_000))));
  for (const j of stale) await queues.addMedia({ kind: 'export', organisationId: j.org, exportJobId: j.id }, { jobId: `${j.id}:requeue:${Math.floor(Date.now() / 600_000)}` });
});
console.log(`[media-worker] started (concurrency ${concurrency})`);

const shutdown = async () => {
  stopped = true;
  for (const t of timers) clearTimeout(t);
  await worker.close();
  await queues.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
