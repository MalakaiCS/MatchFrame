import type { AppConfig } from '@bs/config';
import type { Db } from '@bs/db';
import type { Redis } from 'ioredis';
import { airtime, automationSvc, backups, createMailer, createStorage, demo, library, push as pushSvc, reminders, webhooksSvc, type Mailer, type RelayOptions, type Storage } from '@bs/services';
import { startMedia } from './media';

export interface WorkerCtx {
  db: Db;
  config: AppConfig;
  workerId: string;
  redis: Redis;
  mailer?: Mailer;
  storage?: Storage;
}

/** Outbox subscribers run before Redis publication; each effect is idempotent (execution keys, unique rows). */
export function buildSubscribers(ctx: WorkerCtx): RelayOptions['subscribers'] {
  const d = { db: ctx.db, config: ctx.config, workerId: ctx.workerId };
  return [
    {
      name: 'automation.facts',
      topics: ['match.fact.accepted'],
      handle: async (e) => {
        await automationSvc.onFactAccepted(d, e.organisationId, e.aggregateId, String(e.payload.eventId));
      },
    },
    {
      name: 'automation.phases',
      topics: ['match.phase.changed'],
      handle: async (e) => {
        const p = e.payload as { to: string; sequence: number; occurredAt: string };
        await automationSvc.onPhaseChanged(d, e.organisationId, e.aggregateId, p.to, p.sequence, Date.parse(p.occurredAt));
      },
    },
    {
      name: 'automation.corrections',
      topics: ['match.fact.corrected'],
      handle: async (e) => {
        const p = e.payload as { payload: { factId: string; toRevision: number } };
        await automationSvc.onFactCorrected(d, e.organisationId, p.payload.factId, p.payload.toRevision);
      },
    },
    {
      name: 'highlights.request',
      topics: ['match.fact.accepted'],
      handle: async (e) => {
        await library.requestHighlights(ctx.db, e.organisationId, String(e.payload.eventId));
      },
    },
    {
      name: 'highlights.stale',
      topics: ['match.fact.corrected'],
      handle: async (e) => {
        const p = e.payload as { payload: { factId: string; toRevision: number } };
        await library.markFactStale(ctx.db, e.organisationId, p.payload.factId, p.payload.toRevision);
      },
    },
    {
      name: 'webhooks.fanout',
      topics: ['match.fact.accepted', 'match.phase.changed', 'match.lineup.updated', 'match.rescheduled'],
      handle: async (e) => {
        await webhooksSvc.enqueueWebhookDeliveries(ctx.db, e);
      },
    },
    {
      name: 'airtime.meter',
      topics: ['overlay.state.updated'],
      handle: async (e) => {
        await airtime.meterOverlayState(ctx.db, e);
      },
    },
    {
      name: 'automation.overlay',
      topics: ['overlay.command.accepted'],
      handle: async (e) => {
        const p = e.payload as { type: string; cancelAutomation?: boolean; source?: string };
        if (p.source === 'automation') return;
        await automationSvc.onOverlayCommand(d, e.organisationId, e.aggregateId, p);
      },
    },
  ];
}

function loop(name: string, everyMs: number, fn: () => Promise<unknown>) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const run = async () => {
    if (stopped) return;
    try {
      await fn();
    } catch (e) {
      console.error(`[worker] ${name} failed`, e instanceof Error ? e.message : e);
    }
    if (!stopped) timer = setTimeout(run, everyMs);
  };
  timer = setTimeout(run, everyMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export async function startBackground(ctx: WorkerCtx) {
  const d = { db: ctx.db, config: ctx.config, workerId: ctx.workerId };
  const mailer = ctx.mailer ?? createMailer(ctx.config);
  const storage = ctx.storage ?? createStorage(ctx.config);
  const push = pushSvc.createPushSender(ctx.config);
  const stops = [
    loop('automation', 150, () => automationSvc.automationTick(d)),
    loop('housekeeping', 250, () => automationSvc.housekeepingTick(d)),
    loop('webhooks', 2000, () => webhooksSvc.deliverWebhooks(ctx.db, ctx.config)),
    loop('reminders', 60_000, () => reminders.reminderTick({ db: ctx.db, config: ctx.config, mailer, push })),
    loop('demo', 1000, () => demo.demoTick(d)),
    loop('airtime', 30_000, () => airtime.closeExpiredAirtime(ctx.db)),
    loop('backups', 5 * 60_000, () => backups.backupTick({ db: ctx.db, config: ctx.config, storage })),
  ];
  const media = ctx.config.STREAMING_ENABLED ? await startMedia(ctx) : { stop: async () => undefined };
  return {
    stop: async () => {
      for (const s of stops) s();
      await media.stop();
      await automationSvc.releaseLease(ctx.db, ctx.workerId).catch(() => undefined);
    },
  };
}
