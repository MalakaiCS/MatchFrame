import type { AppConfig } from '@bs/config';
import type { Db } from '@bs/db';
import type { Redis } from 'ioredis';
import type { RelayOptions } from '@bs/services';

export interface WorkerCtx {
  db: Db;
  config: AppConfig;
  workerId: string;
  redis: Redis;
}

export function buildSubscribers(_ctx: WorkerCtx): RelayOptions['subscribers'] {
  return [];
}

export async function startBackground(_ctx: WorkerCtx) {
  return { stop: async () => undefined };
}
