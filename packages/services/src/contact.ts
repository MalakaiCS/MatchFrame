// Public contact form. A message is validated, rate-limited per connection and stored (contact_enquiries) with a
// reference for the sender; the site's staff read it in the staff console. When CONTACT_EMAIL is set it is also
// emailed there (reply-to: the sender): straight away, and if that fails the worker retries with backoff. Success
// means the message was stored. The form is open only when someone can read what arrives: an inbox in
// CONTACT_EMAIL, or at least one member of the site staff. Messages are deleted a year after they arrive.
import crypto from 'node:crypto';
import { and, asc, count, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppConfig } from '@bs/config';
import { contactEnquiries, platformStaff, type Db } from '@bs/db';
import type { Mailer } from './mail';
import { AppError, invalid } from './errors';

export const CONTACT_TOPICS = {
  setup: 'Product or setup question',
  sales: 'Sales and pricing',
  support: 'Help with an account or a match',
  partnership: 'Partnerships',
  other: 'Something else',
} as const;
export type ContactTopic = keyof typeof CONTACT_TOPICS;
/** Older topic names, still accepted from links and cached pages. */
const LEGACY_TOPIC: Record<string, ContactTopic> = { product: 'setup', billing: 'sales' };
export const CONTACT_PLANS = ['starter', 'club', 'studio', 'league'] as const;

/** Kept this long, then deleted by the worker. */
export const CONTACT_RETENTION_DAYS = 365;
const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 3600_000, 3 * 3600_000];

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();

export const contactInput = z.object({
  name: z.string().trim().min(1, 'Please tell us your name').max(80, 'Keep your name under 80 characters'),
  email: z.string().trim().email('Enter an email address we can reply to').max(254),
  topic: z.preprocess((v) => (typeof v === 'string' && LEGACY_TOPIC[v]) || v, z.enum(Object.keys(CONTACT_TOPICS) as [ContactTopic, ...ContactTopic[]], { message: 'Choose what your message is about' })),
  message: z.string().trim().min(10, 'A little more detail helps us answer (at least 10 characters)').max(4000, 'Keep the message under 4,000 characters'),
  organisation: z.string().trim().max(120).optional(),
  sport: z.string().trim().max(40).optional(),
  plan: z.enum(CONTACT_PLANS).optional().catch(undefined),
  /** spam trap: a field people never see; anything in it means a bot */
  website: z.string().optional(),
});

type ContactDeps = { db: Db; config: Pick<AppConfig, 'CONTACT_EMAIL' | 'PRODUCT_NAME'>; mailer?: Mailer };

let staffCache: { at: number; any: boolean } | null = null;
/** Whether at least one site staff member exists to read enquiries in the console (cached for a minute). */
async function hasStaff(db: Db, now = Date.now()) {
  if (staffCache && now - staffCache.at < 60_000) return staffCache.any;
  const [r] = await db.select({ n: count() }).from(platformStaff);
  staffCache = { at: now, any: (r?.n ?? 0) > 0 };
  return staffCache.any;
}

/** Whether the form is open, where messages go, and the topics. */
export async function contactStatus(d: ContactDeps) {
  const email = !!d.config.CONTACT_EMAIL;
  const staff = await hasStaff(d.db).catch(() => false);
  return { enabled: email || staff, email, topics: CONTACT_TOPICS, retentionDays: CONTACT_RETENTION_DAYS };
}

const WINDOW_MS = 3600_000;
const PER_CONNECTION = 5;
const hits = new Map<string, number[]>();

/** At most five messages per connection per hour (in-process; the API is one process per deployment). */
export function allowContact(key: string, now: number) {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_CONNECTION) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return true;
}

/** MF- and six characters without look-alikes (no 0/O, 1/I/L). */
function newReference() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(6);
  return `MF-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

type Enquiry = typeof contactEnquiries.$inferSelect;

function emailFor(cfg: ContactDeps['config'], e: Pick<Enquiry, 'reference' | 'name' | 'email' | 'topic' | 'organisation' | 'sport' | 'plan' | 'message'>) {
  const topic = CONTACT_TOPICS[e.topic as ContactTopic] ?? e.topic;
  const subject = `[${cfg.PRODUCT_NAME} contact] ${topic} from ${oneLine(e.name)} (${e.reference})`.slice(0, 160);
  const lines = [
    `Reference: ${e.reference}`,
    `Topic: ${topic}`,
    `From: ${oneLine(e.name)} <${e.email}>`,
    e.organisation ? `Organisation: ${oneLine(e.organisation)}` : null,
    e.sport ? `Sport: ${oneLine(e.sport)}` : null,
    e.plan ? `Plan: ${e.plan}` : null,
    '',
    e.message,
    '',
    `Sent from the ${cfg.PRODUCT_NAME} contact form. Reply to this email to answer ${oneLine(e.name)}; the message is also in the staff console under Enquiries.`,
  ].filter((l): l is string => l !== null);
  return { subject, text: lines.join('\n') };
}

/** One delivery attempt; records the outcome on the row. */
async function deliver(d: ContactDeps, e: Enquiry, now: number) {
  if (!d.config.CONTACT_EMAIL || !d.mailer) return false;
  const m = emailFor(d.config, e);
  try {
    await d.mailer.send(d.config.CONTACT_EMAIL, m.subject, m.text, undefined, { replyTo: e.email });
    await d.db.update(contactEnquiries).set({ delivery: 'sent', deliveryAttempts: e.deliveryAttempts + 1, deliveredAt: new Date(now), deliveryError: null, nextAttemptAt: null, updatedAt: new Date(now) }).where(eq(contactEnquiries.id, e.id));
    return true;
  } catch (err) {
    const attempts = e.deliveryAttempts + 1;
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error(`[contact] email for ${e.reference} failed (attempt ${attempts}): ${message}`);
    const done = attempts >= MAX_ATTEMPTS;
    await d.db
      .update(contactEnquiries)
      .set({ delivery: done ? 'failed' : 'pending', deliveryAttempts: attempts, deliveryError: message, nextAttemptAt: done ? null : new Date(now + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!), updatedAt: new Date(now) })
      .where(eq(contactEnquiries.id, e.id));
    return false;
  }
}

/**
 * Store a message and try the email once. Resolves with the reference once the message is stored, whether or not
 * the email went (the worker keeps trying); rejects when it could not be stored, so the sender can try again.
 */
export async function submitContact(d: ContactDeps, input: unknown, meta: { ip: string; now?: number }) {
  const now = meta.now ?? Date.now();
  const r = contactInput.safeParse(input);
  if (!r.success) {
    const fields = r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw invalid(fields[0]?.message ?? 'Check the form and try again', fields);
  }
  const v = r.data;
  if (v.website) return { ok: true as const, reference: null, emailed: false }; // a bot filled the hidden field: keep nothing
  const status = await contactStatus(d);
  if (!status.enabled) throw new AppError('CONTACT_NOT_CONNECTED', 503, 'The contact form is not connected yet. Please try again later.');
  if (!allowContact(meta.ip || 'unknown', now)) throw new AppError('RATE_LIMITED', 429, 'That is a lot of messages from one connection. Please try again in an hour.');
  let row: Enquiry | undefined;
  try {
    [row] = await d.db
      .insert(contactEnquiries)
      .values({
        reference: newReference(),
        name: v.name,
        email: v.email,
        topic: v.topic,
        organisation: v.organisation || null,
        sport: v.sport || null,
        plan: v.plan ?? null,
        message: v.message,
        delivery: status.email ? 'pending' : 'not_configured',
        // the worker waits a minute before retrying, so it does not race the attempt below
        nextAttemptAt: status.email ? new Date(now + 60_000) : null,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .returning();
  } catch (err) {
    console.error('[contact] could not store a message:', err instanceof Error ? err.message : err);
    throw new AppError('CONTACT_NOT_STORED', 503, 'We could not receive your message just now. Your text is still in the form; please try again in a minute.');
  }
  const emailed = status.email ? await deliver(d, row!, now) : false;
  return { ok: true as const, reference: row!.reference, emailed };
}

/** Worker: retry emails that are due, and delete messages past the retention period. */
export async function contactTick(d: ContactDeps, now = Date.now()) {
  let sent = 0;
  if (d.config.CONTACT_EMAIL && d.mailer) {
    const due = await d.db
      .select()
      .from(contactEnquiries)
      .where(and(eq(contactEnquiries.delivery, 'pending'), or(lte(contactEnquiries.nextAttemptAt, new Date(now)), sql`${contactEnquiries.nextAttemptAt} is null`)))
      .orderBy(asc(contactEnquiries.createdAt))
      .limit(10);
    for (const e of due) if (await deliver(d, e, now)) sent++;
  }
  const removed = await d.db.delete(contactEnquiries).where(lt(contactEnquiries.createdAt, new Date(now - CONTACT_RETENTION_DAYS * 86_400_000))).returning({ id: contactEnquiries.id });
  return { sent, removed: removed.length };
}

// ------------------------------------------------------------------ staff console (called through staffSvc, which checks the role and logs)

export const ENQUIRY_STATUSES = ['new', 'replied', 'closed'] as const;

export async function listEnquiries(db: Db, q: { status?: string; page?: number } = {}) {
  const page = Math.max(0, Number(q.page ?? 0) || 0);
  const where = q.status && (ENQUIRY_STATUSES as readonly string[]).includes(q.status) ? eq(contactEnquiries.status, q.status) : undefined;
  const rows = await db.select().from(contactEnquiries).where(where).orderBy(desc(contactEnquiries.createdAt)).limit(50).offset(page * 50);
  const counts = await db.select({ status: contactEnquiries.status, n: count() }).from(contactEnquiries).groupBy(contactEnquiries.status);
  return {
    items: rows.map((r) => ({ ...r, topicLabel: CONTACT_TOPICS[r.topic as ContactTopic] ?? r.topic })),
    counts: Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0])),
    page,
  };
}

export async function setEnquiryStatus(db: Db, id: string, status: string, userId: string) {
  if (!(ENQUIRY_STATUSES as readonly string[]).includes(status)) throw invalid('Choose New, Replied or Closed', [{ field: 'status', message: 'Unknown status' }]);
  const [row] = await db.update(contactEnquiries).set({ status, handledBy: status === 'new' ? null : userId, handledAt: status === 'new' ? null : new Date(), updatedAt: new Date() }).where(eq(contactEnquiries.id, id)).returning({ id: contactEnquiries.id, reference: contactEnquiries.reference, status: contactEnquiries.status });
  if (!row) throw new AppError('NOT_FOUND', 404, 'That message no longer exists');
  return row;
}

export async function deleteEnquiries(db: Db, ids: string[]) {
  if (!ids.length) return { removed: 0 };
  const removed = await db.delete(contactEnquiries).where(inArray(contactEnquiries.id, ids)).returning({ reference: contactEnquiries.reference });
  return { removed: removed.length, references: removed.map((r) => r.reference) };
}
