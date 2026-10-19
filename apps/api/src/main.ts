import { getConfig } from '@bs/config';
import { createDb } from '@bs/db';
import { createFakeProvider, createLiveKitProvider, type MediaProvider } from '@bs/media';
import { createMailer, createQueues, createStorage } from '@bs/services';
import { buildApp } from './app';
import { registerRoutes } from './routes';
import { attachRealtime } from './realtime';
import { rendererHooks } from './renderer-hooks';

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_URL, { max: 20, application_name: 'bs-api' });
const storage = createStorage(config);
const queues = createQueues(config.REDIS_URL);
const media: MediaProvider =
  config.MEDIA_PROVIDER === 'fake'
    ? createFakeProvider()
    : createLiveKitProvider({ httpUrl: config.INTERNAL_LIVEKIT_HTTP, apiKey: config.LIVEKIT_API_KEY, apiSecret: config.LIVEKIT_API_SECRET, rtmpBaseUrl: config.PUBLIC_RTMP_URL });

const bundle = await buildApp({
  db,
  config,
  mailer: createMailer(config),
  storage,
  queues,
  media,
  redisPing: async () => (await queues.connection.ping()) === 'PONG',
});
registerRoutes(bundle);
await storage.ensureBucket().catch((e) => bundle.app.log.warn({ err: e.message }, 'object storage not reachable yet'));
await bundle.app.ready();
const rt = attachRealtime(bundle.app.server, bundle, { redisUrl: config.REDIS_URL, renderer: rendererHooks(bundle) });
await bundle.app.listen({ host: '127.0.0.1', port: config.API_PORT });

const shutdown = async () => {
  bundle.app.log.info('shutting down');
  await rt.close();
  await bundle.app.close();
  await queues.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
