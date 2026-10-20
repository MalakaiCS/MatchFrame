// Public contact form. A message is validated, rate-limited per connection and sent by email to CONTACT_EMAIL
// with the sender as reply-to. Nothing is stored in the database. Without CONTACT_EMAIL the form reports that it
// is not connected yet instead of pretending to send.
import { z } from 'zod';
import type { AppConfig } from '@bs/config';
import type { Mailer } from './mail';
import { AppError, invalid } from './errors';

export const CONTACT_TOPICS = {
  product: 'Product question',
  setup: 'Setup help',
  billing: 'Pricing or billing',
  partnership: 'Partnership',
  other: 'Something else',
} as const;
export type ContactTopic = keyof typeof CONTACT_TOPICS;

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();

export const contactInput = z.object({
  name: z.string().trim().min(1, 'Please tell us your name').max(80, 'Keep your name under 80 characters'),
  email: z.string().trim().email('Enter an email address we can reply to').max(254),
  topic: z.enum(Object.keys(CONTACT_TOPICS) as [ContactTopic, ...ContactTopic[]], { message: 'Choose what your message is about' }),
  message: z.string().trim().min(10, 'A little more detail helps us answer (at least 10 characters)').max(4000, 'Keep the message under 4,000 characters'),
  organisation: z.string().trim().max(120).optional(),
  sport: z.string().trim().max(40).optional(),
  /** spam trap: a field people never see; anything in it means a bot */
  website: z.string().optional(),
});

export function contactStatus(cfg: Pick<AppConfig, 'CONTACT_EMAIL'>) {
  return { enabled: !!cfg.CONTACT_EMAIL, topics: CONTACT_TOPICS };
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

export async function submitContact(cfg: Pick<AppConfig, 'CONTACT_EMAIL' | 'PRODUCT_NAME'>, mailer: Mailer | undefined, input: unknown, meta: { ip: string; now?: number }) {
  if (!cfg.CONTACT_EMAIL || !mailer) throw new AppError('CONTACT_NOT_CONNECTED', 503, 'The contact form is not connected yet. Please try again later.');
  const r = contactInput.safeParse(input);
  if (!r.success) {
    const fields = r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw invalid(fields[0]?.message ?? 'Check the form and try again', fields);
  }
  const d = r.data;
  if (d.website) return { ok: true }; // a bot filled the hidden field: accept quietly, send nothing
  if (!allowContact(meta.ip || 'unknown', meta.now ?? Date.now())) throw new AppError('RATE_LIMITED', 429, 'That is a lot of messages from one connection. Please try again in an hour.');
  const topic = CONTACT_TOPICS[d.topic];
  const subject = `[${cfg.PRODUCT_NAME} contact] ${topic} from ${oneLine(d.name)}`.slice(0, 160);
  const lines = [
    `Topic: ${topic}`,
    `From: ${oneLine(d.name)} <${d.email}>`,
    d.organisation ? `Organisation: ${oneLine(d.organisation)}` : null,
    d.sport ? `Sport: ${oneLine(d.sport)}` : null,
    '',
    d.message,
    '',
    `Sent from the ${cfg.PRODUCT_NAME} contact form. Reply to this email to answer ${oneLine(d.name)}.`,
  ].filter((l): l is string => l !== null);
  try {
    await mailer.send(cfg.CONTACT_EMAIL, subject, lines.join('\n'), undefined, { replyTo: d.email });
  } catch (e) {
    console.error('[contact] send failed:', e instanceof Error ? e.message : e);
    throw new AppError('CONTACT_SEND_FAILED', 502, 'We could not send your message just now. Please try again in a few minutes.');
  }
  return { ok: true };
}
