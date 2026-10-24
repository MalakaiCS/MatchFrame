// Operational metrics without a dependency: counters and gauges in memory, rendered in the Prometheus text
// format, plus the pieces of a public status summary.
import { and, eq, gte, sql } from 'drizzle-orm';
import { matches, outboxEvents, rendererSessions, workerLeases, type Db } from '@bs/db';

const counters = new Map<string, number>();
const histos = new Map<string, { sum: number; count: number; buckets: Map<number, number> }>();
const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const started = Date.now();

const key = (name: string, labels: Record<string, string | number>) => `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(',')}}`;

export function inc(name: string, labels: Record<string, string | number> = {}, by = 1) {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
}
export function observe(name: string, labels: Record<string, string | number>, seconds: number) {
  const k = key(name, labels);
  const h = histos.get(k) ?? { sum: 0, count: 0, buckets: new Map(BUCKETS.map((b) => [b, 0])) };
  h.sum += seconds;
  h.count++;
  for (const b of BUCKETS) if (seconds <= b) h.buckets.set(b, (h.buckets.get(b) ?? 0) + 1);
  histos.set(k, h);
}

let lagMs = 0;
if (typeof setInterval === 'function') {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    lagMs = Math.max(0, now - last - 1000);
    last = now;
  }, 1000).unref?.();
}

/** Prometheus exposition: request counters/latency, process gauges and a few domain gauges. */
export async function renderMetrics(db?: Db): Promise<string> {
  const lines: string[] = [];
  lines.push('# TYPE bs_http_requests_total counter');
  for (const [k, v] of counters) if (k.startsWith('bs_http_requests_total')) lines.push(`${k} ${v}`);
  lines.push('# TYPE bs_http_request_duration_seconds histogram');
  for (const [k, h] of histos) {
    const base = k.slice(0, k.indexOf('{'));
    const labels = k.slice(k.indexOf('{') + 1, -1);
    let cum = 0;
    for (const b of BUCKETS) {
      cum = h.buckets.get(b) ?? 0;
      lines.push(`${base}_bucket{${labels},le="${b}"} ${cum}`);
    }
    lines.push(`${base}_bucket{${labels},le="+Inf"} ${h.count}`);
    lines.push(`${base}_sum{${labels}} ${h.sum.toFixed(4)}`);
    lines.push(`${base}_count{${labels}} ${h.count}`);
  }
  for (const [k, v] of counters) if (!k.startsWith('bs_http_requests_total')) lines.push(`${k} ${v}`);
  const mem = process.memoryUsage();
  lines.push('# TYPE bs_process_resident_memory_bytes gauge', `bs_process_resident_memory_bytes ${mem.rss}`);
  lines.push('# TYPE bs_process_heap_used_bytes gauge', `bs_process_heap_used_bytes ${mem.heapUsed}`);
  lines.push('# TYPE bs_process_uptime_seconds gauge', `bs_process_uptime_seconds ${Math.round((Date.now() - started) / 1000)}`);
  lines.push('# TYPE bs_event_loop_lag_ms gauge', `bs_event_loop_lag_ms ${lagMs}`);
  if (db) {
    try {
      const g = await domainGauges(db);
      lines.push('# TYPE bs_live_matches gauge', `bs_live_matches ${g.liveMatches}`);
      lines.push('# TYPE bs_connected_renderers gauge', `bs_connected_renderers ${g.renderers}`);
      lines.push('# TYPE bs_outbox_pending gauge', `bs_outbox_pending ${g.outboxPending}`);
      lines.push('# TYPE bs_worker_alive gauge', `bs_worker_alive ${g.workerAlive ? 1 : 0}`);
    } catch {
      lines.push('# domain gauges unavailable');
    }
  }
  return lines.join('\n') + '\n';
}

export async function domainGauges(db: Db) {
  const [live] = await db.select({ n: sql<number>`count(*)` }).from(matches).where(eq(matches.status, 'live'));
  const [rend] = await db.select({ n: sql<number>`count(*)` }).from(rendererSessions).where(and(gte(rendererSessions.lastSeenAt, new Date(Date.now() - 60_000))));
  const [ob] = await db.select({ n: sql<number>`count(*)` }).from(outboxEvents).where(sql`${outboxEvents.dispatchedAt} is null`);
  const [lease] = await db.select({ n: sql<number>`count(*)` }).from(workerLeases).where(gte(workerLeases.expiresAt, new Date()));
  return { liveMatches: Number(live?.n ?? 0), renderers: Number(rend?.n ?? 0), outboxPending: Number(ob?.n ?? 0), workerAlive: Number(lease?.n ?? 0) > 0 };
}

// ---------------------------------------------------------------- error reporting (generic webhook)
const errorQueue: { at: string; message: string; stack?: string; route?: string; requestId?: string }[] = [];
let flushing = false;
export function reportError(url: string | undefined, e: { message: string; stack?: string; route?: string; requestId?: string }, fetchImpl: typeof fetch = fetch) {
  if (!url) return;
  errorQueue.push({ at: new Date().toISOString(), ...e });
  if (errorQueue.length > 50) errorQueue.splice(0, errorQueue.length - 50);
  if (flushing) return;
  flushing = true;
  setTimeout(async () => {
    const batch = errorQueue.splice(0, errorQueue.length);
    flushing = false;
    try {
      await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'broadcast-studio', errors: batch }) });
    } catch {
      // reporting is best-effort
    }
  }, 2000).unref?.();
}
