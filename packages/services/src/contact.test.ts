import { describe, expect, it } from 'vitest';
import { contactStatus, submitContact } from './contact';
import type { Mailer } from './mail';

const cfg = { CONTACT_EMAIL: 'team@example.com', PRODUCT_NAME: 'MatchFrame' };
const capture = () => {
  const sent: { to: string; subject: string; text: string; replyTo?: string }[] = [];
  const mailer: Mailer = { send: async (to, subject, text, _html, opts) => void sent.push({ to, subject, text, replyTo: opts?.replyTo }) };
  return { sent, mailer };
};
const good = { name: 'Ana Silva', email: 'ana@club.example', topic: 'setup', message: 'How do we add the graphics to OBS for Saturday?', organisation: 'Harbour City FC' };

describe('public contact form', () => {
  it('says whether it is connected, and refuses to pretend when it is not', async () => {
    expect(contactStatus(cfg).enabled).toBe(true);
    expect(contactStatus({ CONTACT_EMAIL: undefined }).enabled).toBe(false);
    const { mailer } = capture();
    await expect(submitContact({ ...cfg, CONTACT_EMAIL: undefined }, mailer, good, { ip: '10.0.0.1' })).rejects.toMatchObject({ status: 503 });
  });

  it('sends one email to the configured inbox with the sender as reply-to, on one subject line', async () => {
    const { sent, mailer } = capture();
    await expect(submitContact(cfg, mailer, { ...good, name: 'Ana\r\nBcc: x@evil.example' }, { ip: '10.0.0.2' })).resolves.toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'team@example.com', replyTo: 'ana@club.example' });
    expect(sent[0]!.subject).toBe('[MatchFrame contact] Setup help from Ana Bcc: x@evil.example');
    expect(sent[0]!.text).toContain('Organisation: Harbour City FC');
    expect(sent[0]!.text).toContain('How do we add the graphics to OBS for Saturday?');
  });

  it('explains what to fix, ignores bots quietly and limits one connection to five an hour', async () => {
    const { sent, mailer } = capture();
    await expect(submitContact(cfg, mailer, { ...good, email: 'not-an-email' }, { ip: '10.0.0.3' })).rejects.toMatchObject({ status: 422, message: 'Enter an email address we can reply to' });
    await expect(submitContact(cfg, mailer, { ...good, website: 'http://spam.example' }, { ip: '10.0.0.3' })).resolves.toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    for (let i = 0; i < 5; i++) await submitContact(cfg, mailer, good, { ip: '10.0.0.4', now: 1_000 + i });
    await expect(submitContact(cfg, mailer, good, { ip: '10.0.0.4', now: 2_000 })).rejects.toMatchObject({ status: 429 });
    await expect(submitContact(cfg, mailer, good, { ip: '10.0.0.4', now: 3_700_000 })).resolves.toEqual({ ok: true });
  });

  it('reports a failed send instead of claiming success', async () => {
    const mailer: Mailer = { send: async () => { throw new Error('SMTP down'); } };
    await expect(submitContact(cfg, mailer, good, { ip: '10.0.0.5' })).rejects.toMatchObject({ status: 502 });
  });
});
