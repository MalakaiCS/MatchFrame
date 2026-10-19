// Transactional outbox relay: at-least-once delivery to in-process subscribers (idempotent effects)
// and Redis pub/sub for realtime. Runs only in the worker process with the bs_worker role.
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { outboxEvents, type Db } from '@bs/db';
import pg from 'pg';

export interface OutboxRow {
  id: string;
  position: number;
  organisationId: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  aggregateSeq: number | null;
  schemaVersion: number;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
}

export type Subscriber = (e: OutboxRow) => Promise<void>;

export interface RelayOptions {
  db: Db;
  databaseUrl: string;
  publish: (e: OutboxRow) => Promise<void>;
  subscribers: { name: string; topics: string[] | '*'; handle: Subscriber }[];
  batchSize?: number;
  maxAttempts?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export function createRelay(o: RelayOptions) {
  const maxAttempts = o.maxAttempts ?? 10;
  const log = o.log ?? ((m, e) => console.log(`[relay] ${m}`, e ?? ''));
  let running = false;
  let wake: (() => void) | null = null;
  let listener: pg.Client | null = null;
  const stats = { dispatched: 0, failed: 0, lastLagMs: 0 };

  async function tick(): Promise<number> {
    return o.db.transaction(async (t) => {
      const rows = (await t
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.state, 'pending'), lte(outboxEvents.availableAt, new Date())))
        .orderBy(asc(outboxEvents.position))
        .limit(o.batchSize ?? 100)
        .for('update', { skipLocked: true })) as unknown as OutboxRow[];
      const blocked = new Set<string>();
      const done: string[] = [];
      for (const r of rows) {
        const agg = `${r.aggregateType}:${r.aggregateId}`;
        if (blocked.has(agg)) continue; // keep per-aggregate order behind a failed event
        try {
          for (const s of o.subscribers) if (s.topics === '*' || s.topics.includes(r.topic)) await s.handle(r);
          await o.publish(r);
          done.push(r.id);
          stats.lastLagMs = Date.now() - new Date(r.createdAt).getTime();
        } catch (e) {
          blocked.add(agg);
          stats.failed++;
          const attempts = r.attempts + 1;
          const dead = attempts >= maxAttempts;
          await t
            .update(outboxEvents)
            .set({ attempts, lastError: String((e as Error).message).slice(0, 500), state: dead ? 'dead' : 'pending', availableAt: new Date(Date.now() + Math.min(60_000, 500 * 2 ** attempts)) })
            .where(eq(outboxEvents.id, r.id));
          log(dead ? 'dead-lettered' : 'retry scheduled', { topic: r.topic, id: r.id, attempts, error: (e as Error).message });
        }
      }
      if (done.length) {
        await t.update(outboxEvents).set({ state: 'dispatched', dispatchedAt: new Date() }).where(inArray(outboxEvents.id, done));
        stats.dispatched += done.length;
      }
      return rows.length;
    });
  }

  async function loop() {
    while (running) {
      let n = 0;
      try {
        n = await tick();
      } catch (e) {
        log('tick failed', { error: (e as Error).message });
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (n === 0) await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 250); // polling fallback for missed notifications
      });
    }
  }

  return {
    stats,
    async start() {
      running = true;
      listener = new pg.Client({ connectionString: o.databaseUrl });
      await listener.connect();
      listener.on('notification', () => wake?.());
      listener.on('error', (e) => log('listener error', { error: e.message }));
      await listener.query('LISTEN outbox');
      void loop();
    },
    async stop() {
      running = false;
      wake?.();
      await listener?.end().catch(() => undefined);
    },
    tick,
    /** operator tool: re-queue dead-lettered events */
    async retryDead(ids?: string[]) {
      return o.db
        .update(outboxEvents)
        .set({ state: 'pending', attempts: 0, availableAt: new Date() })
        .where(ids?.length ? and(eq(outboxEvents.state, 'dead'), inArray(outboxEvents.id, ids)) : eq(outboxEvents.state, 'dead'))
        .returning({ id: outboxEvents.id });
    },
    async lag() {
      const r = await o.db.execute<{ pending: number; oldest_ms: number | null; dead: number }>(
        sql`select count(*) filter (where state='pending')::int as pending, extract(epoch from now() - min(created_at) filter (where state='pending'))*1000 as oldest_ms, count(*) filter (where state='dead')::int as dead from outbox_events`,
      );
      return r.rows[0];
    },
  };
}
