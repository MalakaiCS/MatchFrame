// BullMQ delivery. Queues carry pointers to durable rows; database uniqueness decides effects.
import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

export const QUEUE = {
  control: 'bs-control', // small, latency-sensitive: session start/stop, reconcile, highlight mapping
  media: 'bs-media', // expensive FFmpeg work, separate concurrency
  webhooks: 'bs-webhooks',
} as const;

export type ControlJob =
  | { kind: 'session.start'; organisationId: string; broadcastSessionId: string; scheduleVersion: number }
  | { kind: 'session.stop'; organisationId: string; broadcastSessionId: string; reason: string }
  | { kind: 'session.reconcile'; organisationId: string; broadcastSessionId: string }
  | { kind: 'provider.webhook'; eventId: string }
  | { kind: 'highlight.map'; organisationId: string; highlightRequestId: string };

export type MediaJob = { kind: 'export'; organisationId: string; exportJobId: string };

export interface JobQueues {
  control: Queue;
  media: Queue;
  webhooks: Queue;
  connection: Redis;
  addControl(job: ControlJob, opts?: JobsOptions & { jobId?: string }): Promise<void>;
  addMedia(job: MediaJob, opts?: JobsOptions & { jobId?: string }): Promise<void>;
  close(): Promise<void>;
}

export function redisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

export function createQueues(redisUrl: string): JobQueues {
  const connection = redisConnection(redisUrl);
  const defaults: JobsOptions = { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 };
  const control = new Queue(QUEUE.control, { connection, defaultJobOptions: defaults });
  const media = new Queue(QUEUE.media, { connection, defaultJobOptions: { ...defaults, attempts: 3 } });
  const webhooks = new Queue(QUEUE.webhooks, { connection, defaultJobOptions: { ...defaults, attempts: 8 } });
  return {
    control,
    media,
    webhooks,
    connection,
    async addControl(job, opts) {
      await control.add(job.kind, job, opts);
    },
    async addMedia(job, opts) {
      await media.add(job.kind, job, opts);
    },
    async close() {
      await Promise.all([control.close(), media.close(), webhooks.close()]);
      connection.disconnect();
    },
  };
}
