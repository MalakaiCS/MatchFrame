import type { AppConfig } from '@bs/config';
import type { Db } from '@bs/db';
import type { Redis } from 'ioredis';
import { automationSvc, library, type RelayOptions } from '@bs/services';
import { startMedia } from './media';

export interface WorkerCtx {
  db: Db;
  config: AppConfig;
  workerId: string;
  redis: Redis;
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
  const stops = [loop('automation', 150, () => automationSvc.automationTick(d)), loop('housekeeping', 250, () => automationSvc.housekeepingTick(d))];
  const media = await startMedia(ctx);
  return {
    stop: async () => {
      for (const s of stops) s();
      await media.stop();
      await automationSvc.releaseLease(ctx.db, ctx.workerId).catch(() => undefined);
    },
  };
}
