// The public contact form against real PostgreSQL (application role): a message is stored with a reference and
// emailed to CONTACT_EMAIL with the sender as reply-to; a failed email is kept and retried by the worker with
// backoff; without an inbox the message still reaches the staff console; field errors, the spam trap and the
// per-connection limit; deletion after a year. Over HTTP: staff read, mark and delete enquiries (logged), and
// people who are not staff cannot.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { contactEnquiries, createDb, platformAuditLogs, platformStaff } from '@bs/db';
import { getConfig } from '@bs/config';
import { contact, type Mailer } from '@bs/services';
import { buildApp, type AppBundle } from '../../apps/api/src/app';
import { registerRoutes } from '../../apps/api/src/routes';
import { Client } from '../http-client';

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const tag = Date.now().toString(36);
const good = { name: 'Ana Silva', email: `ana-${tag}@club.example`, topic: 'setup', message: `How do we add the graphics to OBS for Saturday? ${tag}`, organisation: 'Harbour City FC' };
const capture = () => {
  const sent: { to: string; subject: string; text: string; replyTo?: string }[] = [];
  const mailer: Mailer = { send: async (to, subject, text, _html, opts) => void sent.push({ to, subject, text, replyTo: opts?.replyTo }) };
  return { sent, mailer };
};
const withEmail = { ...config, CONTACT_EMAIL: 'team@example.test' };
const stored = (reference: string) => db.select().from(contactEnquiries).where(eq(contactEnquiries.reference, reference)).then((r) => r[0]!);
const made: string[] = [];

afterAll(async () => {
  if (made.length) await db.delete(contactEnquiries).where(inArray(contactEnquiries.reference, made));
  await pool.end();
});

describe('contact form (service)', () => {
  it('stores the message with a reference and emails the team inbox, the sender as reply-to, on one subject line', async () => {
    const { sent, mailer } = capture();
    const r = await contact.submitContact({ db, config: withEmail, mailer }, { ...good, name: 'Ana\r\nBcc: x@evil.example', plan: 'club' }, { ip: `10.1.${tag}` });
    expect(r).toMatchObject({ ok: true, emailed: true });
    expect(r.reference).toMatch(/^MF-[2-9A-HJ-NP-Z]{6}$/);
    made.push(r.reference!);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'team@example.test', replyTo: good.email });
    expect(sent[0]!.subject).toBe(`[MatchFrame contact] Product or setup question from Ana Bcc: x@evil.example (${r.reference})`);
    expect(sent[0]!.text).toContain('Organisation: Harbour City FC');
    expect(sent[0]!.text).toContain('Plan: club');
    const row = await stored(r.reference!);
    expect(row).toMatchObject({ status: 'new', delivery: 'sent', deliveryAttempts: 1, topic: 'setup', plan: 'club' });
  });

  it('keeps a message whose email failed, and the worker retries it once it is due', async () => {
    const down: Mailer = { send: async () => { throw new Error('SMTP down'); } };
    const t0 = Date.now();
    const r = await contact.submitContact({ db, config: withEmail, mailer: down }, good, { ip: `10.2.${tag}`, now: t0 });
    expect(r).toMatchObject({ ok: true, emailed: false });
    made.push(r.reference!);
    let row = await stored(r.reference!);
    expect(row).toMatchObject({ delivery: 'pending', deliveryAttempts: 1, deliveryError: 'SMTP down' });
    expect(row.nextAttemptAt!.getTime()).toBe(t0 + 60_000);
    // not yet due: nothing sent
    const { sent, mailer } = capture();
    await contact.contactTick({ db, config: withEmail, mailer }, t0 + 30_000);
    expect(sent.filter((m) => m.subject.includes(r.reference!))).toHaveLength(0);
    await contact.contactTick({ db, config: withEmail, mailer }, t0 + 61_000);
    expect(sent.filter((m) => m.subject.includes(r.reference!))).toHaveLength(1);
    row = await stored(r.reference!);
    expect(row).toMatchObject({ delivery: 'sent', deliveryAttempts: 2, deliveryError: null });
  });

  it('without an inbox the message is stored for the staff console (when there is staff to read it)', async () => {
    const anyStaff = (await db.select().from(platformStaff).limit(1)).length > 0;
    const status = await contact.contactStatus({ db, config: { ...config, CONTACT_EMAIL: undefined } });
    expect(status).toMatchObject({ enabled: anyStaff, email: false, retentionDays: 365 });
    if (!anyStaff) {
      await expect(contact.submitContact({ db, config: { ...config, CONTACT_EMAIL: undefined } }, good, { ip: `10.3.${tag}` })).rejects.toMatchObject({ status: 503 });
      return;
    }
    const r = await contact.submitContact({ db, config: { ...config, CONTACT_EMAIL: undefined } }, good, { ip: `10.3.${tag}` });
    made.push(r.reference!);
    expect((await stored(r.reference!)).delivery).toBe('not_configured');
  });

  it('explains what to fix, ignores bots quietly and limits one connection to five an hour', async () => {
    const { sent, mailer } = capture();
    const d = { db, config: withEmail, mailer };
    await expect(contact.submitContact(d, { ...good, email: 'not-an-email' }, { ip: `10.4.${tag}` })).rejects.toMatchObject({ status: 422, message: 'Enter an email address we can reply to' });
    await expect(contact.submitContact(d, { ...good, website: 'http://spam.example' }, { ip: `10.4.${tag}` })).resolves.toEqual({ ok: true, reference: null, emailed: false });
    expect(sent).toHaveLength(0);
    // an older topic name still works
    const legacy = await contact.submitContact(d, { ...good, topic: 'billing' }, { ip: `10.5.${tag}`, now: 1_000 });
    made.push(legacy.reference!);
    expect((await stored(legacy.reference!)).topic).toBe('sales');
    for (let i = 1; i < 5; i++) made.push((await contact.submitContact(d, good, { ip: `10.5.${tag}`, now: 1_000 + i })).reference!);
    await expect(contact.submitContact(d, good, { ip: `10.5.${tag}`, now: 2_000 })).rejects.toMatchObject({ status: 429 });
    made.push((await contact.submitContact(d, good, { ip: `10.5.${tag}`, now: 3_700_000 })).reference!);
  });

  it('deletes messages a year after they arrived', async () => {
    const old = Date.now() - 366 * 86_400_000;
    const { mailer } = capture();
    const r = await contact.submitContact({ db, config: { ...config, CONTACT_EMAIL: 'team@example.test' }, mailer }, good, { ip: `10.6.${tag}`, now: old });
    expect((await stored(r.reference!)).reference).toBe(r.reference);
    const t = await contact.contactTick({ db, config: withEmail, mailer });
    expect(t.removed).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(contactEnquiries).where(eq(contactEnquiries.reference, r.reference!))).toHaveLength(0);
  });
});

describe('contact form (HTTP and the staff console)', () => {
  const origin = new URL(config.PUBLIC_WEB_URL).origin;
  const links: { kind: string; email: string; url: string }[] = [];
  const owner = `owner-${tag}@example.test`;
  let b: AppBundle;
  beforeAll(async () => {
    b = await buildApp({ db, config: { ...config, PUBLIC_API_URL: origin, CONTACT_EMAIL: 'team@example.test', PLATFORM_OWNER_EMAILS: owner }, mailer: { send: async () => undefined }, onEmailLink: (kind, email, url) => links.push({ kind, email, url }) });
    registerRoutes(b);
    await b.app.ready();
  });
  afterAll(async () => {
    await b.app.close();
  });
  let n = 0;
  async function signUp(email: string) {
    const c = new Client(() => b, origin, { 'x-forwarded-for': `10.88.0.${++n}` });
    expect((await c.req('POST', '/api/auth/sign-up/email', { email, password: 'correct-horse-battery-1', name: 'Person' })).status).toBe(200);
    const v = new URL(links.find((l) => l.kind === 'verify' && l.email === email)!.url);
    await c.req('GET', v.pathname + v.search);
    return c;
  }

  it('the public form sends, staff see and mark the message (logged), others cannot', async () => {
    const visitor = new Client(() => b, origin, { 'x-forwarded-for': `10.89.${tag.length}.1` });
    const status = await visitor.req('GET', '/api/v1/public/contact');
    expect(status.json).toMatchObject({ enabled: true, email: true, topics: { setup: 'Product or setup question', sales: 'Sales and pricing' } });
    const bad = await visitor.req('POST', '/api/v1/public/contact', { ...good, name: '' });
    expect(bad.status).toBe(422);
    expect((bad.json.error as { fields: { field: string }[] }).fields[0]!.field).toBe('name');
    const sentR = await visitor.req('POST', '/api/v1/public/contact', { ...good, topic: 'sales', plan: 'league' });
    expect(sentR.status).toBe(200);
    const reference = sentR.json.reference as string;
    made.push(reference);

    const stranger = await signUp(`stranger-${tag}@example.test`);
    expect((await stranger.req('GET', '/api/v1/staff/enquiries')).status).toBe(403);

    const staff = await signUp(owner);
    const list = await staff.req('GET', '/api/v1/staff/enquiries?status=new');
    expect(list.status).toBe(200);
    const item = (list.json.items as { id: string; reference: string; topicLabel: string; plan: string }[]).find((i) => i.reference === reference)!;
    expect(item).toMatchObject({ topicLabel: 'Sales and pricing', plan: 'league' });
    expect(list.json).toMatchObject({ emailConfigured: true, retentionDays: 365 });
    const marked = await staff.req('PATCH', `/api/v1/staff/enquiries/${item.id}`, { status: 'replied' });
    expect(marked.json).toMatchObject({ reference, status: 'replied' });
    const logged = await db.select().from(platformAuditLogs).where(eq(platformAuditLogs.targetId, item.id));
    expect(logged.map((l) => l.action)).toEqual(['enquiry.status']);
    expect((await staff.req('DELETE', `/api/v1/staff/enquiries/${item.id}`)).json).toEqual({ removed: 1 });
    expect((await staff.req('DELETE', `/api/v1/staff/enquiries/${item.id}`)).status).toBe(404);
  });
});
