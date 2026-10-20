import { describe, expect, it } from 'vitest';
import { configSchema, roleDatabaseUrls, withDerivedDefaults } from './index';

const base = {
  PUBLIC_WEB_URL: 'https://studio.example.org',
  DATABASE_URL: 'postgres://a',
  DATABASE_WORKER_URL: 'postgres://b',
  REDIS_URL: 'redis://c',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'https://s3.example.org',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  ENCRYPTION_KEY: 'e'.repeat(44),
  MEDIA_TOKEN_SECRET: 'm'.repeat(32),
};

describe('config', () => {
  it('single-origin deployments only need PUBLIC_WEB_URL', () => {
    const env = withDerivedDefaults(base);
    expect(env.PUBLIC_API_URL).toBe(base.PUBLIC_WEB_URL);
    expect(env.PUBLIC_REALTIME_URL).toBe(base.PUBLIC_WEB_URL);
  });

  it('takes the public address from Railway or Render when PUBLIC_WEB_URL is unset', () => {
    const { PUBLIC_WEB_URL: _, ...rest } = base;
    expect(withDerivedDefaults({ ...rest, RAILWAY_PUBLIC_DOMAIN: 'app.up.railway.app' }).PUBLIC_WEB_URL).toBe('https://app.up.railway.app');
    expect(withDerivedDefaults({ ...rest, RENDER_EXTERNAL_URL: 'https://app.onrender.com' }).PUBLIC_WEB_URL).toBe('https://app.onrender.com');
  });

  it('graphics-only needs no LiveKit settings; streaming does', () => {
    const graphics = configSchema.safeParse(withDerivedDefaults({ ...base, STREAMING_ENABLED: 'false' }));
    expect(graphics.success).toBe(true);
    expect(graphics.data?.STREAMING_ENABLED).toBe(false);
    const streaming = configSchema.safeParse(withDerivedDefaults(base));
    expect(streaming.success).toBe(false);
    expect(streaming.error?.issues.map((i) => i.path.join('.'))).toEqual(['LIVEKIT_API_SECRET']);
    expect(configSchema.safeParse(withDerivedDefaults({ ...base, LIVEKIT_API_SECRET: 'secret' })).success).toBe(true);
  });

  it('derives the role connection URLs from DATABASE_ADMIN_URL when they are unset or have no password', () => {
    const admin = 'postgres://postgres:adminpw@db.internal:5432/railway';
    const derived = withDerivedDefaults({ ...base, DATABASE_URL: '', DATABASE_WORKER_URL: undefined, DATABASE_ADMIN_URL: admin });
    const app = new URL(derived.DATABASE_URL!);
    const worker = new URL(derived.DATABASE_WORKER_URL!);
    expect([app.username, app.host, app.pathname]).toEqual(['bs_app', 'db.internal:5432', '/railway']);
    expect(worker.username).toBe('bs_worker');
    expect(app.password).not.toBe('');
    expect(app.password).not.toBe(worker.password);
    expect(app.password).not.toContain('adminpw');
    // stable across restarts, and the migration sets the same password
    expect(withDerivedDefaults({ ...base, DATABASE_URL: '', DATABASE_ADMIN_URL: admin }).DATABASE_URL).toBe(derived.DATABASE_URL);
    expect(roleDatabaseUrls({ DATABASE_ADMIN_URL: admin })!.app.password).toBe(decodeURIComponent(app.password));
    // an empty password inside the URL (unresolved ${{DB_APP_PASSWORD}}) is filled the same way
    expect(withDerivedDefaults({ ...base, DATABASE_ADMIN_URL: admin, DATABASE_URL: 'postgres://bs_app:@db.internal:5432/railway' }).DATABASE_URL).toBe(derived.DATABASE_URL);
  });

  it('keeps explicit role passwords and URLs', () => {
    const env = { ...base, DATABASE_ADMIN_URL: 'postgres://o:p@h/d', DATABASE_URL: 'postgres://bs_app:s3cret@h/d', DATABASE_WORKER_URL: '', DB_WORKER_PASSWORD: 'w/pw' };
    const derived = withDerivedDefaults(env);
    expect(derived.DATABASE_URL).toBe('postgres://bs_app:s3cret@h/d');
    expect(roleDatabaseUrls(env)!.worker.password).toBe('w/pw');
    expect(new URL(derived.DATABASE_WORKER_URL!).username).toBe('bs_worker');
  });
});
