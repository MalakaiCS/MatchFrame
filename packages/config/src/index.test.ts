import { describe, expect, it } from 'vitest';
import { configSchema, withDerivedDefaults } from './index';

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
});
