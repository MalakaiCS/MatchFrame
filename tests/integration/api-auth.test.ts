import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '@bs/db';
import { getConfig } from '@bs/config';
import { buildApp, type AppBundle } from '../../apps/api/src/app';
import { registerRoutes } from '../../apps/api/src/routes';

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const links: { kind: string; email: string; url: string }[] = [];
let b: AppBundle;
const origin = new URL(config.PUBLIC_WEB_URL).origin;

class Client {
  cookies = new Map<string, string>();
  constructor(private bundle: () => AppBundle) {}
  private header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await this.bundle().app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { origin, ...(this.cookies.size ? { cookie: this.header() } : {}), ...extraHeaders },
    });
    const sc = res.headers['set-cookie'];
    for (const c of Array.isArray(sc) ? sc : sc ? [sc] : []) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = pair!.split('=');
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
      if (expired || v === '') this.cookies.delete(k!.trim());
      else this.cookies.set(k!.trim(), v!);
    }
    let json: unknown = null;
    try {
      json = res.json();
    } catch {
      json = res.body;
    }
    return { status: res.statusCode, json: json as Record<string, unknown> & { error?: { code: string } }, headers: res.headers };
  }
}

beforeAll(async () => {
  b = await buildApp({
    db,
    config: { ...config, PUBLIC_API_URL: origin },
    mailer: { send: async () => undefined },
    onEmailLink: (kind, email, url) => links.push({ kind, email, url }),
  });
  registerRoutes(b);
  await b.app.ready();
});
afterAll(async () => {
  await b.app.close();
  await pool.end();
});

const email = `owner-${Date.now()}@example.test`;
const password = 'correct-horse-battery-1';

describe('session lifecycle (A01)', () => {
  const c = new Client(() => b);

  it('registers, requires verification, verifies, and logs in', async () => {
    const r = await c.req('POST', '/api/auth/sign-up/email', { email, password, name: 'Olivia Owner' });
    expect(r.status).toBe(200);
    expect(c.cookies.size).toBe(0); // no session before verification
    const login = await c.req('POST', '/api/auth/sign-in/email', { email, password });
    expect(login.status).toBe(403);
    const v = links.find((l) => l.kind === 'verify' && l.email === email)!;
    expect(v).toBeTruthy();
    // tampered token is rejected
    const bad = await c.req('GET', new URL(v.url).pathname + '?token=not-a-real-token');
    expect(bad.status).toBeGreaterThanOrEqual(300);
    expect(c.cookies.size).toBe(0);
    const u = new URL(v.url);
    const ok = await c.req('GET', u.pathname + u.search);
    expect([200, 302]).toContain(ok.status);
    expect(c.cookies.size).toBeGreaterThan(0); // auto sign-in after verification
    const me = await c.req('GET', '/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ user: { email, emailVerified: true }, organisations: [] });
  });

  it('creates an organisation, which becomes active', async () => {
    const r = await c.req('POST', '/api/v1/organisations', { name: 'Harbour Media', timezone: 'Australia/Brisbane' });
    expect(r.status).toBe(201);
    const me = await c.req('GET', '/api/v1/me');
    expect(me.json).toMatchObject({ role: 'owner', activeOrganisation: { name: 'Harbour Media' } });
  });

  it('rejects cookie-authenticated writes from a foreign origin (CSRF)', async () => {
    const r = await c.req('POST', '/api/v1/competitions', { name: 'X', sport: 'football', defaultTimezone: 'UTC' }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe('ORIGIN_REJECTED');
  });

  it('validates input with field-level errors and a request id', async () => {
    const r = await c.req('POST', '/api/v1/competitions', { name: '', sport: 'cricket', defaultTimezone: 'Mars/Base' });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((r.json.error as { fields: unknown[]; requestId: string }).fields.length).toBeGreaterThan(0);
    expect((r.json.error as { requestId: string }).requestId).toBeTruthy();
  });

  it('resets the password, invalidating old sessions; expired/invalid tokens fail', async () => {
    const other = new Client(() => b);
    const l2 = await other.req('POST', '/api/auth/sign-in/email', { email, password });
    expect(l2.status).toBe(200);
    expect((await other.req('GET', '/api/v1/me')).status).toBe(200);
    const anon = new Client(() => b);
    const rq = await anon.req('POST', '/api/auth/request-password-reset', { email, redirectTo: `${origin}/reset-password` });
    expect(rq.status).toBe(200);
    const link = links.filter((l) => l.kind === 'reset' && l.email === email).pop()!;
    const token = new URL(link.url).pathname.split('/').pop()!;
    const badReset = await anon.req('POST', '/api/auth/reset-password', { newPassword: 'another-secret-pass-2', token: 'invalid-token' });
    expect(badReset.status).toBe(400);
    const reset = await anon.req('POST', '/api/auth/reset-password', { newPassword: 'another-secret-pass-2', token });
    expect(reset.status).toBe(200);
    // a reset token is single-use
    const reuse = await anon.req('POST', '/api/auth/reset-password', { newPassword: 'third-secret-pass-3', token });
    expect(reuse.status).toBe(400);
    // documented behaviour: all existing sessions are revoked on password reset
    expect((await other.req('GET', '/api/v1/me')).status).toBe(401);
    expect((await c.req('GET', '/api/v1/me')).status).toBe(401);
    expect((await anon.req('POST', '/api/auth/sign-in/email', { email, password })).status).toBe(401);
    expect((await c.req('POST', '/api/auth/sign-in/email', { email, password: 'another-secret-pass-2' })).status).toBe(200);
  });

  it('logs out and the session stops working', async () => {
    expect((await c.req('GET', '/api/v1/me')).status).toBe(200);
    const out = await c.req('POST', '/api/auth/sign-out', {});
    expect(out.status).toBe(200);
    expect((await c.req('GET', '/api/v1/me')).status).toBe(401);
  });

  it('serves liveness and readiness without secrets', async () => {
    const live = await b.app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(live.json()).toEqual({ status: 'ok' });
    const ready = await b.app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(ready.body).not.toMatch(/password|secret|postgres:\/\//i);
  });
});
