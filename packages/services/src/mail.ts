import nodemailer from 'nodemailer';
import type { AppConfig } from '@bs/config';

export interface Mailer {
  send(to: string, subject: string, text: string, html?: string): Promise<void>;
}

export function createMailer(cfg: AppConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined,
  });
  return {
    async send(to, subject, text, html) {
      await transport.sendMail({ from: cfg.MAIL_FROM, to, subject, text, html });
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
