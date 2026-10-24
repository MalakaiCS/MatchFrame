// Better Auth: every way into MatchFrame, on revocable database sessions.
//  - email and password (verified email), with TOTP two-step sign-in and backup codes;
//  - a six-digit code by email (also creates the account for a new address: proving the inbox verifies it);
//  - a six-digit code by text message, to a mobile number already verified on the account (SMS_PROVIDER);
//  - passkeys (the device's own lock), registered from Settings;
//  - Google, Apple, Microsoft and Facebook, each once its client id and secret are configured.
// Two-step sign-in is not skipped by the shortcuts: an account with it on that signs in with an email or text code,
// or through Google/Apple/Microsoft/Facebook, is asked for its authenticator code as well (passkeys already prove
// possession of a device and count as the second step).
import crypto from 'node:crypto';
import { passkey } from '@better-auth/passkey';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { deleteSessionCookie, expireCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';
import { emailOTP, phoneNumber, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '@bs/config';
import { accounts, passkeys, sessions, twoFactors, users, verifications, type Db } from '@bs/db';
import { emailLayout, type Mailer } from './mail';
import { createSmsSender, isE164, type SmsSender } from './sms';

export interface AuthDeps {
  db: Db;
  config: AppConfig;
  mailer: Mailer;
  /** test hook: receives every outbound auth link */
  onEmailLink?: (kind: 'verify' | 'reset', email: string, url: string) => void;
  /** test hook: receives every sign-in code (email or text) */
  onCode?: (kind: 'email' | 'sms', to: string, code: string) => void;
  /** text-message sender (defaults to SMS_PROVIDER) */
  sms?: SmsSender | null;
}

const CODE_MINUTES = 10;
const SMS_CODE_MINUTES = 5;

/** The social sign-in providers that are configured, in the order the buttons appear. */
export function configuredProviders(config: AppConfig) {
  return [
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? 'google' : null,
    config.APPLE_CLIENT_ID && config.APPLE_CLIENT_SECRET ? 'apple' : null,
    config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET ? 'microsoft' : null,
    config.FACEBOOK_CLIENT_ID && config.FACEBOOK_CLIENT_SECRET ? 'facebook' : null,
  ].filter((p): p is 'google' | 'apple' | 'microsoft' | 'facebook' => !!p);
}

const hmac = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

/**
 * After an email-code, text-code or social sign-in: an account with two-step sign-in on gets the same challenge as
 * a password sign-in (the two-factor plugin's own cookie and records, so its verify endpoints finish the sign-in),
 * unless this browser was trusted at a previous two-step sign-in.
 */
function secondStep(webUrl: string): BetterAuthPlugin {
  return {
    id: 'matchframe-second-step',
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === '/sign-in/email-otp' || ctx.path === '/phone-number/verify' || ctx.path === '/callback/:id',
          handler: createAuthMiddleware(async (ctx) => {
            const data = ctx.context.newSession;
            if (!data || !(data.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) return;
            // a trusted browser (the "trust this device" choice at a two-step sign-in) goes straight in, as for passwords
            const trustCookie = ctx.context.createAuthCookie('trust_device', { maxAge: 30 * 86_400 });
            const trusted = await ctx.getSignedCookie(trustCookie.name, ctx.context.secret);
            if (trusted) {
              const [token, id] = trusted.split('!');
              if (token && id && token === hmac(ctx.context.secret, `${data.user.id}!${id}`)) {
                const v = await ctx.context.internalAdapter.findVerificationValue(id);
                if (v && v.value === data.user.id && v.expiresAt > new Date()) return;
              }
              expireCookie(ctx, trustCookie);
            }
            deleteSessionCookie(ctx, true);
            await ctx.context.internalAdapter.deleteSession(data.session.token);
            ctx.context.setNewSession(null);
            const maxAge = 600;
            const cookie = ctx.context.createAuthCookie('two_factor', { maxAge });
            const identifier = `2fa-${generateRandomString(20)}`;
            const expiresAt = new Date(Date.now() + maxAge * 1000);
            await ctx.context.internalAdapter.createVerificationValue({ value: data.user.id, identifier, expiresAt });
            await ctx.context.internalAdapter.createVerificationValue({ value: '0', identifier: `2fa-attempts-${identifier}`, expiresAt });
            await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
            // social sign-in comes back by redirect: on to the code step of the login page instead of the app
            if (ctx.path === '/callback/:id') throw ctx.redirect(`${webUrl}/login?step=two-factor`);
            return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
          }),
        },
      ],
    },
  };
}

export function createAuth({ db, config, mailer, onEmailLink, onCode, sms }: AuthDeps) {
  const webUrl = config.PUBLIC_WEB_URL.replace(/\/$/, '');
  const texts = sms === undefined ? createSmsSender(config, mailer) : sms;
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

  /** A sign-in code by email, with a link that opens the login page with the code filled in (it still needs a click). */
  const sendEmailCode = async (email: string, otp: string, type: string) => {
    onCode?.('email', email, otp);
    if (config.AUTH_LOG_EMAIL_LINKS) console.log(`[auth] ${type} code for ${email}: ${otp}`);
    const url = `${webUrl}/login?method=email&email=${encodeURIComponent(email)}&code=${otp}`;
    const purpose = type === 'forget-password' ? 'reset your password' : type === 'email-verification' ? 'verify your email' : `sign in to ${config.PRODUCT_NAME}`;
    const m = emailLayout(
      config,
      `Your code: ${otp}`,
      `Enter ${otp} to ${purpose}. The code works once, for ${CODE_MINUTES} minutes. If you did not ask for it, ignore this email: nobody can sign in without it.`,
      type === 'sign-in' ? { label: 'Open the sign-in page', url } : undefined,
    );
    await mailer.send(email, `${otp} is your ${config.PRODUCT_NAME} code`, m.text, m.html);
  };

  const rpUrl = new URL(webUrl);

  return betterAuth({
    appName: config.PRODUCT_NAME,
    baseURL: config.PUBLIC_API_URL,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [...config.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean), ...(config.APPLE_CLIENT_ID ? ['https://appleid.apple.com'] : [])],
    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
      schema: { users, sessions, accounts, verifications, twoFactors, passkeys },
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
    account: {
      // a Google or Apple sign-in with the same verified email joins the existing account; other providers are linked
      // from Settings once signed in
      accountLinking: { enabled: true, trustedProviders: ['google', 'apple'] },
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
        '/email-otp/send-verification-otp': { window: 300, max: 5 },
        '/sign-in/email-otp': { window: 60, max: 10 },
        '/phone-number/send-otp': { window: 300, max: 3 },
        '/phone-number/verify': { window: 60, max: 10 },
        '/passkey/verify-authentication': { window: 60, max: 20 },
      },
    },
    advanced: {
      useSecureCookies: config.PUBLIC_WEB_URL.startsWith('https://'),
      cookiePrefix: 'bs',
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
      database: { generateId: () => crypto.randomUUID() },
    },
    socialProviders: {
      ...(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? { google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET, prompt: 'select_account' as const } } : {}),
      ...(config.APPLE_CLIENT_ID && config.APPLE_CLIENT_SECRET ? { apple: { clientId: config.APPLE_CLIENT_ID, clientSecret: config.APPLE_CLIENT_SECRET } } : {}),
      ...(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET ? { microsoft: { clientId: config.MICROSOFT_CLIENT_ID, clientSecret: config.MICROSOFT_CLIENT_SECRET, tenantId: config.MICROSOFT_TENANT_ID } } : {}),
      ...(config.FACEBOOK_CLIENT_ID && config.FACEBOOK_CLIENT_SECRET ? { facebook: { clientId: config.FACEBOOK_CLIENT_ID, clientSecret: config.FACEBOOK_CLIENT_SECRET } } : {}),
    },
    plugins: [
      // allowPasswordless: accounts that sign in with codes, passkeys or a provider can turn it on too
      twoFactor({ issuer: config.PRODUCT_NAME, allowPasswordless: true }),
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_MINUTES * 60,
        allowedAttempts: 5,
        sendVerificationOTP: async ({ email, otp, type }) => sendEmailCode(email, otp, type),
      }),
      phoneNumber({
        otpLength: 6,
        expiresIn: SMS_CODE_MINUTES * 60,
        allowedAttempts: 3,
        phoneNumberValidator: (n) => isE164(n),
        // texts go only to a number already verified on an account, or to a signed-in person adding their own number;
        // anything else is accepted without sending, so nobody learns which numbers are registered or runs up texts
        sendOTP: async ({ phoneNumber: to, code }, ctx) => {
          if (!texts) throw new APIError('NOT_IMPLEMENTED', { message: 'Text-message codes are not set up on this installation' });
          const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.phoneNumber, to));
          const signedIn = owner ? null : ctx ? await getSessionFromCtx(ctx as never).catch(() => null) : null;
          if (!owner && !signedIn) return;
          onCode?.('sms', to, code);
          if (config.AUTH_LOG_EMAIL_LINKS) console.log(`[auth] text code for ${to}: ${code}`);
          await texts.send(to, `${code} is your ${config.PRODUCT_NAME} code. It works once, for ${SMS_CODE_MINUTES} minutes. Never share it.`);
        },
      }),
      passkey({ rpID: config.PASSKEY_RP_ID || rpUrl.hostname, rpName: config.PRODUCT_NAME, origin: rpUrl.origin }),
      secondStep(webUrl),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Which sign-in options the login page should show (`sms`: the sender the API was given, else SMS_PROVIDER). */
export function authOptions(config: AppConfig, sms?: SmsSender | null) {
  return {
    password: true,
    emailCode: true,
    sms: sms === undefined ? !!createSmsSender(config, { send: async () => undefined }) : !!sms,
    passkey: true,
    providers: configuredProviders(config),
  };
}

/** Take the mobile number off an account (no more text-message sign-in for it). */
export async function clearPhoneNumber(db: Db, userId: string) {
  await db.update(users).set({ phoneNumber: null, phoneNumberVerified: false, updatedAt: new Date() }).where(eq(users.id, userId));
}
