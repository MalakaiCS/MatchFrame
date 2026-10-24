// Every way to sign in, over HTTP against real PostgreSQL: a code by email (which also creates the account for a
// new address), a code by text message to a number verified on the account (and nothing sent to other numbers),
// two-step sign-in still asked for after an email or text code, the social providers once configured (Google's
// sign-in address; Apple's form post reaches Better Auth), passkey options, and what the login page is told.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, users } from '@bs/db';
import { getConfig } from '@bs/config';
import { buildApp, type AppBundle } from '../../apps/api/src/app';
import { registerRoutes } from '../../apps/api/src/routes';
import { Client } from '../http-client';

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const origin = new URL(config.PUBLIC_WEB_URL).origin;
const tag = Date.now().toString(36);
const mail = (who: string) => `${who}-${tag}@example.test`;
const password = 'correct-horse-battery-1';
const codes: { kind: 'email' | 'sms'; to: string; code: string }[] = [];
const links: { kind: string; email: string; url: string }[] = [];
const texts: { to: string; text: string }[] = [];
const lastCode = (kind: 'email' | 'sms', to: string) => [...codes].reverse().find((c) => c.kind === kind && c.to === to)?.code;
let b: AppBundle;
let n = 0;
const client = () => new Client(() => b, origin, { 'x-forwarded-for': `10.66.${n >> 8}.${++n & 255}` });

/** RFC 6238 code for a base32 secret, as an authenticator app shows it. */
function totp(secret: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((x) => parseInt(x, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

beforeAll(async () => {
  b = await buildApp({
    db,
    config: { ...config, PUBLIC_API_URL: origin, GOOGLE_CLIENT_ID: 'test-google-client', GOOGLE_CLIENT_SECRET: 'test-google-secret', APPLE_CLIENT_ID: 'tv.matchframe.test', APPLE_CLIENT_SECRET: 'test-apple-secret' },
    mailer: { send: async () => undefined },
    onEmailLink: (kind, email, url) => links.push({ kind, email, url }),
    onCode: (kind, to, code) => codes.push({ kind, to, code }),
    sms: { send: async (to, text) => void texts.push({ to, text }) },
  });
  registerRoutes(b);
  await b.app.ready();
});
afterAll(async () => {
  await b.app.close();
  await pool.end();
});

async function passwordAccount(who: string) {
  const c = client();
  const email = mail(who);
  expect((await c.req('POST', '/api/auth/sign-up/email', { email, password, name: who })).status).toBe(200);
  const v = new URL(links.find((l) => l.kind === 'verify' && l.email === email)!.url);
  await c.req('GET', v.pathname + v.search);
  expect((await c.req('GET', '/api/v1/me')).status).toBe(200);
  return { c, email };
}

describe('sign-in methods', () => {
  it('the login page is told which ways in are set up', async () => {
    const r = await client().req('GET', '/api/v1/auth-options');
    expect(r.json).toEqual({ password: true, emailCode: true, sms: true, passkey: true, providers: ['google', 'apple'] });
  });

  it('a code by email signs a new address up (verified, with the name given) and signs it in', async () => {
    const c = client();
    const email = mail('codey');
    expect((await c.req('POST', '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
    const code = lastCode('email', email)!;
    expect(code).toMatch(/^\d{6}$/);
    expect((await c.req('POST', '/api/auth/sign-in/email-otp', { email, otp: code === '000000' ? '111111' : '000000' })).status).toBe(400);
    const ok = await c.req('POST', '/api/auth/sign-in/email-otp', { email, otp: code, name: 'Codey Ito' });
    expect(ok.status).toBe(200);
    const me = await c.req('GET', '/api/v1/me');
    expect(me.json.user).toMatchObject({ email, name: 'Codey Ito', emailVerified: true });
    // a code works once
    expect((await client().req('POST', '/api/auth/sign-in/email-otp', { email, otp: code })).status).toBe(400);
  });

  it('a code by email signs in an existing password account too', async () => {
    const { email } = await passwordAccount('mixed');
    const c = client();
    await c.req('POST', '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
    expect((await c.req('POST', '/api/auth/sign-in/email-otp', { email, otp: lastCode('email', email) })).status).toBe(200);
    expect(((await c.req('GET', '/api/v1/me')).json.user as { email: string }).email).toBe(email);
  });

  it('text-message codes: a signed-in person adds their number; then it signs them in; other numbers get nothing', async () => {
    const { c, email } = await passwordAccount('texter');
    const phone = `+6140${String(Date.now()).slice(-7)}`;
    expect((await c.req('POST', '/api/auth/phone-number/send-otp', { phoneNumber: phone })).status).toBe(200);
    expect(texts.at(-1)).toMatchObject({ to: phone });
    expect(texts.at(-1)!.text).toMatch(/^\d{6} is your MatchFrame code/);
    const added = await c.req('POST', '/api/auth/phone-number/verify', { phoneNumber: phone, code: lastCode('sms', phone), updatePhoneNumber: true });
    expect(added.status).toBe(200);
    expect(((await c.req('GET', '/api/v1/me')).json.user as { phoneNumber: string }).phoneNumber).toBe(phone);

    const out = client();
    const before = texts.length;
    expect((await out.req('POST', '/api/auth/phone-number/send-otp', { phoneNumber: phone })).status).toBe(200);
    expect(texts.length).toBe(before + 1);
    expect((await out.req('POST', '/api/auth/phone-number/verify', { phoneNumber: phone, code: lastCode('sms', phone) })).status).toBe(200);
    expect(((await out.req('GET', '/api/v1/me')).json.user as { email: string }).email).toBe(email);

    // a number on no account: accepted, nothing sent, no way in
    const stranger = client();
    const unknown = `+6149${String(Date.now()).slice(-7)}`;
    const n0 = texts.length;
    expect((await stranger.req('POST', '/api/auth/phone-number/send-otp', { phoneNumber: unknown })).status).toBe(200);
    expect(texts.length).toBe(n0);
    expect((await stranger.req('POST', '/api/auth/phone-number/verify', { phoneNumber: unknown, code: '123456' })).status).toBeGreaterThanOrEqual(400);
    expect((await stranger.req('GET', '/api/v1/me')).status).toBe(401);
    // not a phone number
    expect((await stranger.req('POST', '/api/auth/phone-number/send-otp', { phoneNumber: '0400 000 000' })).status).toBe(400);
  });

  it('two-step sign-in is still asked for after an email code', async () => {
    const { c, email } = await passwordAccount('guarded');
    const en = await c.req('POST', '/api/auth/two-factor/enable', { password });
    const secret = new URL(en.json.totpURI as string).searchParams.get('secret')!;
    expect((await c.req('POST', '/api/auth/two-factor/verify-totp', { code: totp(secret) })).status).toBe(200);
    expect((await db.select({ tf: users.twoFactorEnabled }).from(users).where(eq(users.email, email)))[0]!.tf).toBe(true);

    const d = client();
    await d.req('POST', '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
    const r = await d.req('POST', '/api/auth/sign-in/email-otp', { email, otp: lastCode('email', email) });
    expect(r.json).toMatchObject({ twoFactorRedirect: true });
    expect((await d.req('GET', '/api/v1/me')).status).toBe(401);
    // the authenticator code finishes it (the next time window, so it differs from the one used to enable)
    const finished = await d.req('POST', '/api/auth/two-factor/verify-totp', { code: totp(secret, Date.now() + 30_000) });
    expect(finished.status).toBe(200);
    expect(((await d.req('GET', '/api/v1/me')).json.user as { email: string }).email).toBe(email);
  });

  it('social providers: Google sends people to its sign-in page; Apple posts back to a route that accepts it', async () => {
    const c = client();
    const g = await c.req('POST', '/api/auth/sign-in/social', { provider: 'google', callbackURL: '/app', errorCallbackURL: '/login?error=social' });
    expect(g.status).toBe(200);
    const url = new URL(g.json.url as string);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('test-google-client');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    // Apple's form post gets past the API's own origin check and body parsing to Better Auth, which turns it into a
    // same-site GET of the callback (where an unknown state then fails)
    const res = await b.app.inject({ method: 'POST', url: '/api/auth/callback/apple', payload: 'state=nope&code=nope', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://appleid.apple.com', cookie: 'x=1' } });
    expect([302, 303]).toContain(res.statusCode);
    expect(String(res.headers.location)).toMatch(/\/api\/auth\/callback\/apple\?code=nope&state=nope$/);
    const after = await b.app.inject({ method: 'GET', url: '/api/auth/callback/apple?code=nope&state=nope' });
    expect(String(after.headers.location)).toMatch(/error/);
  });

  it('passkeys: sign-in options for anyone, registration only when signed in', async () => {
    const opts = await client().req('GET', '/api/auth/passkey/generate-authenticate-options');
    expect(opts.status).toBe(200);
    expect(opts.json.challenge).toEqual(expect.any(String));
    expect(opts.json.rpId).toBe(new URL(config.PUBLIC_WEB_URL).hostname);
    expect((await client().req('GET', '/api/auth/passkey/generate-register-options')).status).toBe(401);
    const { c } = await passwordAccount('keyholder');
    const reg = await c.req('GET', '/api/auth/passkey/generate-register-options');
    expect(reg.status).toBe(200);
    expect((reg.json.rp as { name: string }).name).toBe('MatchFrame');
  });
});
