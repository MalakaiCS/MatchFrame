import nodemailer from 'nodemailer';
import type { AppConfig } from '@bs/config';

export interface Mailer {
  send(to: string, subject: string, text: string, html?: string, opts?: { replyTo?: string }): Promise<void>;
}

/** The Resend API key to send with over HTTPS: RESEND_API_KEY, else the SMTP password when SMTP_HOST is Resend. */
export function resendApiKey(cfg: Pick<AppConfig, 'RESEND_API_KEY' | 'SMTP_HOST' | 'SMTP_PASSWORD'>) {
  if (cfg.RESEND_API_KEY) return cfg.RESEND_API_KEY;
  return /(^|\.)resend\.com$/i.test(cfg.SMTP_HOST) && cfg.SMTP_PASSWORD?.startsWith('re_') ? cfg.SMTP_PASSWORD : undefined;
}

export function createMailer(cfg: AppConfig, fetchImpl: typeof fetch = fetch): Mailer {
  const apiKey = resendApiKey(cfg);
  if (apiKey) {
    return {
      async send(to, subject, text, html, opts) {
        const r = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: cfg.MAIL_FROM, to: [to], subject, text, html, ...(opts?.replyTo ? { reply_to: opts.replyTo } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) {
          const detail = await r.text().catch(() => '');
          throw new Error(`Resend rejected the email (HTTP ${r.status}): ${detail.slice(0, 300)}`);
        }
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined,
    connectionTimeout: 15_000,
  });
  return {
    async send(to, subject, text, html, opts) {
      await transport.sendMail({ from: cfg.MAIL_FROM, to, subject, text, html, replyTo: opts?.replyTo });
    },
  };
}

export function emailLayout(cfg: AppConfig, title: string, body: string, action?: { label: string; url: string }) {
  const btn = action
    ? `<p><a href="${action.url}" style="display:inline-block;background:#3EA6FF;color:#0B1220;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">${action.label}</a></p><p style="color:#667">Or open: ${action.url}</p>`
    : '';
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111"><h2>${title}</h2><p>${body}</p>${btn}<p style="color:#889;font-size:12px">${cfg.PRODUCT_NAME}</p></div>`;
  const text = `${title}\n\n${body}\n\n${action ? `${action.label}: ${action.url}\n` : ''}`;
  return { html, text };
}
