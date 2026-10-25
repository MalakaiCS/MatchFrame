// Per-worker env for db tests: same rewrite as the global setup (globalSetup env does not propagate).
import { loadDotEnv } from '@bs/config';

loadDotEnv();
for (const k of ['DATABASE_ADMIN_URL', 'DATABASE_URL', 'DATABASE_WORKER_URL'] as const) {
  const u = new URL(process.env[k]!);
  u.pathname = '/broadcast_studio_test';
  process.env[k] = u.toString();
}
process.env.AUTH_LOG_EMAIL_LINKS = 'false';
