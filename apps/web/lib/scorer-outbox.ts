'use client';
// Durable scorer outbox (IndexedDB). An intent is persisted BEFORE it is shown as queued; its commandId
// (idempotency key) never changes across retries, refreshes or reviewed rebases.
import { openDB, type IDBPDatabase } from 'idb';

export type IntentStatus = 'queued' | 'sending' | 'needs_review' | 'rejected';
export interface Intent {
  commandId: string;
  matchId: string;
  type: 'ADD_FACT' | 'VOID_FACT' | 'CORRECT_FACT' | 'SET_PHASE' | 'CLOCK_ACTION' | 'ADJUST_SCORE' | 'SET_KNOCKOUT';
  payload: Record<string, unknown>;
  createdAt: number;
  /** created while disconnected (or when the send failed on the network) → requires review on reconnect */
  offline: boolean;
  /** state version the scorer was looking at when they made the decision */
  basedOnVersion: number;
  status: IntentStatus;
  error?: { code: string; message: string } | null;
  attempts: number;
  label: string;
}

export interface CachedMatch {
  matchId: string;
  detail: unknown;
  state: unknown;
  cachedAt: number;
}

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB('bs-scorer', 1, {
    upgrade(d) {
      const s = d.createObjectStore('intents', { keyPath: 'commandId' });
      s.createIndex('byMatch', 'matchId');
      d.createObjectStore('matches', { keyPath: 'matchId' });
      d.createObjectStore('meta');
    },
  });
  return dbp;
}

export async function putIntent(i: Intent) {
  await (await db()).put('intents', i);
}
export async function getIntents(matchId: string): Promise<Intent[]> {
  const all = (await (await db()).getAllFromIndex('intents', 'byMatch', matchId)) as Intent[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}
export async function deleteIntent(commandId: string) {
  await (await db()).delete('intents', commandId);
}
export async function cacheMatch(m: CachedMatch) {
  await (await db()).put('matches', m);
}
export async function getCachedMatch(matchId: string): Promise<CachedMatch | undefined> {
  return (await db()).get('matches', matchId) as Promise<CachedMatch | undefined>;
}
export async function cacheList(list: unknown) {
  await (await db()).put('meta', { list, at: Date.now() }, 'assigned');
}
export async function getCachedList(): Promise<{ list: unknown; at: number } | undefined> {
  return (await db()).get('meta', 'assigned');
}
export async function deviceId(): Promise<string> {
  const d = await db();
  let id = (await d.get('meta', 'deviceId')) as string | undefined;
  if (!id) {
    id = `scorer-${crypto.randomUUID()}`;
    await d.put('meta', id, 'deviceId');
  }
  return id;
}
