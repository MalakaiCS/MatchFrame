// Text messages for sign-in codes. Twilio in production (Messages API over HTTPS); 'mail' in development, where a
// text arrives in the local mail catcher as an email to sms-<digits>@sms.localhost. The mail sink is refused in
// production, like the fake media provider: no configuration means no text-message sign-in, never a pretend one.
import type { AppConfig } from '@bs/config';
import type { Mailer } from './mail';

export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

type SmsConfig = Pick<AppConfig, 'NODE_ENV' | 'SMS_PROVIDER' | 'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_FROM'>;

/** E.164: a plus, a country code and up to 15 digits in all. */
export const isE164 = (n: string) => /^\+[1-9]\d{6,14}$/.test(n);

export function smsProvider(cfg: SmsConfig): 'twilio' | 'mail' | null {
  if (cfg.SMS_PROVIDER === 'twilio') return cfg.TWILIO_ACCOUNT_SID && cfg.TWILIO_AUTH_TOKEN && cfg.TWILIO_FROM ? 'twilio' : null;
  if (cfg.SMS_PROVIDER === 'mail') return cfg.NODE_ENV === 'production' ? null : 'mail';
  return null;
}

export function createSmsSender(cfg: SmsConfig, mailer: Mailer | undefined, fetchImpl: typeof fetch = fetch): SmsSender | null {
  const provider = smsProvider(cfg);
  if (provider === 'mail' && mailer) {
    return { send: (to, text) => mailer.send(`sms-${to.replace(/\D/g, '')}@sms.localhost`, `SMS to ${to}`, text) };
  }
  if (provider === 'twilio') {
    const sid = cfg.TWILIO_ACCOUNT_SID!;
    const from = cfg.TWILIO_FROM!;
    return {
      async send(to, text) {
        const form = new URLSearchParams({ To: to, Body: text, ...(from.startsWith('MG') ? { MessagingServiceSid: from } : { From: from }) });
        const r = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: 'POST',
          headers: { authorization: `Basic ${Buffer.from(`${sid}:${cfg.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: form,
        });
        if (!r.ok) {
          const detail = (await r.json().catch(() => ({}))) as { message?: string; code?: number };
          throw new Error(`Twilio ${r.status}${detail.code ? ` (${detail.code})` : ''}: ${detail.message ?? 'send failed'}`);
        }
      },
    };
  }
  return null;
}
