// Better Auth: email/password with verified email, reset tokens, revocable DB sessions, TOTP MFA.
import crypto from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import type { AppConfig } from '@bs/config';
import { accounts, sessions, twoFactors, users, verifications, type Db } from '@bs/db';
import { emailLayout, type Mailer } from './mail';

export interface AuthDeps {
  db: Db;
  config: AppConfig;
  mailer: Mailer;
  /** test hook: receives every outbound auth link */
  onEmailLink?: (kind: 'verify' | 'reset', email: string, url: string) => void;
}

export function createAuth({ db, config, mailer, onEmailLink }: AuthDeps) {
  const deliver = async (kind: 'verify' | 'reset', email: string, url: string) => {
    onEmailLink?.(kind, email, url);
    if (config.AUTH_LOG_EMAIL_LINKS) console.log(`[auth] ${kind} link for ${email}: ${url}`);
    const m =
      kind === 'verify'
        ? emailLayout(config, 'Verify your email', `Confirm this address to finish creating your ${config.PRODUCT_NAME} account.`, { label: 'Verify email', url })
        : emailLayout(config, 'Reset your password', 'Use this link within 1 hour to choose a new password. If you did not ask for this, ignore this email.', { label: 'Reset password', url });
    await mailer.send(email, kind === 'verify' ? 'Verify your email' : 'Reset your password', m.text, m.html);
  };

  return betterAuth({
    appName: config.PRODUCT_NAME,
    baseURL: config.PUBLIC_API_URL,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: config.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
      schema: { users, sessions, accounts, verifications, twoFactors },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => deliver('reset', user.email, url),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 3600,
      sendVerificationEmail: async ({ user, url }) => deliver('verify', user.email, url),
    },
    session: {
      expiresIn: config.SESSION_MAX_AGE_DAYS * 24 * 3600,
      updateAge: 24 * 3600,
      additionalFields: {
        activeOrganisationId: { type: 'string', required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: config.PUBLIC_WEB_URL.startsWith('https://'),
      cookiePrefix: 'bs',
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
      database: { generateId: () => crypto.randomUUID() },
    },
    plugins: [twoFactor({ issuer: config.PRODUCT_NAME })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
