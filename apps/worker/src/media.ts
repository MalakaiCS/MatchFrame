// Media orchestration in the worker: control-queue jobs, periodic reconciliation, schedules and orphan cleanup.
import { Worker } from 'bullmq';
import { createQueues, mediaControl, QUEUE, redisConnection, streamsSvc, systemActor, type ControlJob, type Ctx } from '@bs/services';
import type { WorkerCtx } from './subscribers';

export async function startMedia(ctx: WorkerCtx) {
  const media = mediaControl.createMediaProvider(ctx.config);
  const d = { db: ctx.db, config: ctx.config, media };
  const queues = createQueues(ctx.config.REDIS_URL);
  const sys = (organisationId: string): Ctx => ({ db: ctx.db, config: ctx.config, media, queues, actor: systemActor(organisationId) });

  const worker = new Worker<ControlJob>(
    QUEUE.control,
    async (job) => {
      const j = job.data;
      if (j.kind === 'session.start') return mediaControl.startSessionJob(d, j.organisationId, j.broadcastSessionId);
      if (j.kind === 'session.stop') return mediaControl.stopSessionJob(d, j.organisationId, j.broadcastSessionId);
      if (j.kind === 'session.reconcile') return mediaControl.reconcileSession(d, j.organisationId, j.broadcastSessionId);
      if (j.kind === 'provider.webhook') return mediaControl.handleWebhook(d, j.event);
      return 'ignored';
    },
    { connection: redisConnection(ctx.config.REDIS_URL), concurrency: 4 },
  );
  worker.on('failed', (job, err) => console.error(`[media] job ${job?.name} failed: ${err.message}`));

  await mediaControl.reconcileOrphans(d).then((n) => n && console.log(`[media] stopped ${n} orphaned provider outputs`)).catch((e) => console.warn('[media] orphan check skipped:', (e as Error).message));

  let stopped = false;
  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, fn: () => Promise<unknown>) => {
    const run = async () => {
      if (stopped) return;
      await fn().catch((e) => console.error('[media] loop failed', (e as Error).message));
      if (!stopped) timers.push(setTimeout(run, ms));
    };
    timers.push(setTimeout(run, ms));
  };
  every(3000, () => mediaControl.reconcileActive(d));
  every(10_000, () =>
    mediaControl.scanSchedules(
      d,
      (org, matchId, scheduleVersion) => streamsSvc.startSession(sys(org), matchId, { scheduleVersion, scheduled: true }),
      (org, matchId) => streamsSvc.stopSession(sys(org), matchId, 'post-roll elapsed'),
    ),
  );
  return {
    stop: async () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      await worker.close();
      await queues.close();
    },
  };
}
