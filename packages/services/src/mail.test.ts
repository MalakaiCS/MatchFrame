import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@bs/config';
import { createMailer, resendApiKey } from './mail';

const cfg = (over: Partial<AppConfig>) =>
  ({ SMTP_HOST: '127.0.0.1', SMTP_PORT: 1025, SMTP_SECURE: false, MAIL_FROM: 'Studio <no-reply@example.com>', ...over }) as AppConfig;

describe('mailer', () => {
  it('uses the Resend HTTPS API with the SMTP password when SMTP_HOST is Resend', () => {
    expect(resendApiKey(cfg({ SMTP_HOST: 'smtp.resend.com', SMTP_PASSWORD: 're_abc' }))).toBe('re_abc');
    expect(resendApiKey(cfg({ RESEND_API_KEY: 're_explicit' }))).toBe('re_explicit');
    expect(resendApiKey(cfg({ SMTP_HOST: 'smtp.example.com', SMTP_PASSWORD: 're_abc' }))).toBeUndefined();
    expect(resendApiKey(cfg({ SMTP_HOST: 'smtp.resend.com', SMTP_PASSWORD: 'not-a-key' }))).toBeUndefined();
  });

  it('posts the message to Resend and surfaces its error', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 200;
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(status === 200 ? '{"id":"1"}' : '{"message":"The example.com domain is not verified."}', { status });
    }) as unknown as typeof fetch;
    const mailer = createMailer(cfg({ RESEND_API_KEY: 're_key' }), fake);
    await mailer.send('a@b.test', 'Hi', 'text', '<p>html</p>');
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ from: 'Studio <no-reply@example.com>', to: ['a@b.test'], subject: 'Hi', text: 'text', html: '<p>html</p>' });
    status = 403;
    await expect(mailer.send('a@b.test', 'Hi', 'text')).rejects.toThrow(/HTTP 403.*not verified/);
  });
});
