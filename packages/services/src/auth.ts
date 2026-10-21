// Better Auth: email/password with verified email, reset tokens, revocable DB sessions, TOTP MFA.
import crypto from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
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
    try {
      await mailer.send(email, kind === 'verify' ? 'Verify your email' : 'Reset your password', m.text, m.html);
    } catch (e) {
      console.error(`[auth] ${kind} email to ${email} failed: ${(e as Error).message}`);
      throw e;
    }
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
    databaseHooks: {
      session: {
        create: {
          // an account disabled by site staff cannot sign in (its existing sessions were ended when it was disabled)
          before: async (session) => {
            const [u] = await db.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, session.userId));
            if (u?.disabledAt) throw new APIError('FORBIDDEN', { message: 'This account has been disabled. Contact support if you think this is a mistake.', code: 'ACCOUNT_DISABLED' });
            return { data: session };
          },
        },
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
    socialProviders: {
      ...(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? { google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET } } : {}),
      ...(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET ? { microsoft: { clientId: config.MICROSOFT_CLIENT_ID, clientSecret: config.MICROSOFT_CLIENT_SECRET, tenantId: config.MICROSOFT_TENANT_ID } } : {}),
    },
    plugins: [twoFactor({ issuer: config.PRODUCT_NAME })],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Which sign-in buttons the login page should show. */
export function authOptions(config: AppConfig) {
  return {
    password: true,
    providers: [...(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? ['google'] : []), ...(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET ? ['microsoft'] : [])],
  };
}
