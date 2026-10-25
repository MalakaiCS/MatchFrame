import { outboxEvents, type Tx } from '@bs/db';

export interface OutboxInput {
  organisationId: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  aggregateSeq?: number | null;
  payload: Record<string, unknown>;
  availableAt?: Date;
}

/** Insert in the same transaction as the state change; the relay publishes only after commit. */
export async function enqueueOutbox(tx: Tx, events: OutboxInput | OutboxInput[]) {
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return [];
  return tx
    .insert(outboxEvents)
    .values(list.map((e) => ({ ...e, aggregateSeq: e.aggregateSeq ?? null, availableAt: e.availableAt ?? new Date() })))
    .returning({ id: outboxEvents.id, position: outboxEvents.position });
}
