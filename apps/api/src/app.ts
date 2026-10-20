import crypto from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { fromNodeHeaders } from 'better-auth/node';
import { eq, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { AppConfig } from '@bs/config';
import { organisations, users, type Db } from '@bs/db';
import type { MediaProvider } from '@bs/media';
import {
  AppError,
  createAuth,
  metrics,
  redact,
  resolveActor,
  orgs,
  type Actor,
  type Auth,
  type Ctx,
  type JobQueues,
  type Mailer,
  type Storage,
} from '@bs/services';
import { resolveApiKey } from './api-keys';

export interface ApiDeps {
  db: Db;
  config: AppConfig;
  mailer: Mailer;
  storage?: Storage;
  queues?: JobQueues;
  media?: MediaProvider;
  redisPing?: () => Promise<boolean>;
  onEmailLink?: (kind: 'verify' | 'reset', email: string, url: string) => void;
}

export interface SessionInfo {
  user: { id: string; email: string; name: string; emailVerified: boolean };
  session: { id: string; activeOrganisationId?: string | null; expiresAt: Date };
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionInfo?: SessionInfo | null;
    actorCache?: Actor | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function errorBody(code: string, message: string, requestId: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, requestId, ...extra } };
}

export async function buildApp(deps: ApiDeps) {
  const { config } = deps;
  const auth: Auth = createAuth({ db: deps.db, config, mailer: deps.mailer, onEmailLink: deps.onEmailLink });
  const trusted = new Set(config.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean));
  trusted.add(new URL(config.PUBLIC_WEB_URL).origin);

  const app = Fastify({
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: true,
    genReqId: (req) => (req.headers['x-request-id'] as string)?.slice(0, 64) || crypto.randomUUID(),
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // URL secrets (overlay tokens, share tokens, bootstrap tokens) never reach logs.
      serializers: {
        req: (req) => ({ method: req.method, url: redact(req.url), requestId: req.id }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  await app.register(cookie);
  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  // JSON is parsed from the raw string so signed webhooks (Stripe) can verify the exact bytes they received.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    if (!(body as string).length) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (e) {
      done(e as Error, undefined);
    }
  });
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unmatched';
    metrics.inc('bs_http_requests_total', { route, method: req.method, status: reply.statusCode });
    metrics.observe('bs_http_request_duration_seconds', { route, method: req.method }, reply.elapsedTime / 1000);
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  // Origin check for cookie-authenticated writes (CSRF). Token-authenticated and webhook routes are exempt.
  app.addHook('preHandler', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (req.url.startsWith('/api/v1/webhooks/') || req.url.startsWith('/api/v1/public/')) return;
    if (req.headers.authorization?.startsWith('Bearer ')) return;
    if (!req.headers.cookie) return;
    const origin = (req.headers.origin as string | undefined) ?? (req.headers.referer ? new URL(req.headers.referer as string).origin : undefined);
    if (!origin || !trusted.has(origin)) {
      return reply.code(403).send(errorBody('ORIGIN_REJECTED', 'Request origin is not allowed', req.id));
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(errorBody(err.code, err.message, req.id, { fields: err.fields, ...(err.extra ?? {}) }));
    }
    if (err instanceof ZodError) {
      const fields = err.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message }));
      return reply.code(400).send(errorBody('VALIDATION_FAILED', fields[0]?.message ?? 'Invalid request', req.id, { fields }));
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send(errorBody(e.code ?? 'BAD_REQUEST', e.statusCode === 413 ? 'Request body is too large' : 'The request could not be processed', req.id));
    }
    req.log.error({ err: { message: redact(String(e.message)), code: e.code } }, 'unhandled error');
    metrics.reportError(config.ERROR_REPORT_URL, { message: (err as Error).message, stack: (err as Error).stack, route: req.routeOptions?.url, requestId: req.id });
    return reply.code(500).send(errorBody('INTERNAL', `Something failed on our side. Retry, and quote reference ${req.id} if it persists.`, req.id));
  });

  // ---------------------------------------------------------------- Better Auth
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    config: { rawBody: true },
    async handler(req, reply) {
      const url = new URL(req.url, config.PUBLIC_API_URL);
      const headers = fromNodeHeaders(req.headers);
      const body = req.method === 'POST' && req.body !== undefined ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined;
      const res = await auth.handler(new Request(url, { method: req.method, headers, body }));
      reply.status(res.status);
      res.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        reply.header(key, value);
      });
      const cookies = res.headers.getSetCookie?.() ?? [];
      if (cookies.length) reply.header('set-cookie', cookies);
      const text = await res.text();
      return reply.send(text || null);
    },
  });

  const TWO_FACTOR_EXEMPT = /^\/api\/v1\/(me(\/|$|\?)|organisations\/(current|switch)|auth-options|status)/;
  const twoFactorCache = new Map<string, { v: boolean; at: number }>();
  async function orgRequiresTwoFactor(orgId: string) {
    const c = twoFactorCache.get(orgId);
    if (c && Date.now() - c.at < 30_000) return c.v;
    const [o] = await deps.db.select({ r: organisations.requireTwoFactor }).from(organisations).where(eq(organisations.id, orgId));
    const v = !!o?.r;
    twoFactorCache.set(orgId, { v, at: Date.now() });
    return v;
  }

  async function loadSession(req: FastifyRequest): Promise<SessionInfo | null> {
    if (req.sessionInfo !== undefined) return req.sessionInfo;
    const s = (await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null)) as SessionInfo | null;
    req.sessionInfo = s && s.user ? s : null;
    return req.sessionInfo;
  }

  /** Authenticated actor in the active organisation (session or scoped API key). */
  async function actorFor(req: FastifyRequest): Promise<Actor> {
    if (req.actorCache) return req.actorCache;
    const authz = req.headers.authorization;
    if (authz?.startsWith('Bearer bsk_')) {
      const a = await resolveApiKey(deps.db, authz.slice(7), req.id);
      if (!a) throw new AppError('UNAUTHENTICATED', 401, 'Invalid or expired API key');
      req.actorCache = a;
      return a;
    }
    const s = await loadSession(req);
    if (!s) throw new AppError('UNAUTHENTICATED', 401, 'Sign in to continue');
    if (!s.user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 403, 'Verify your email address to continue');
    let orgId = s.session.activeOrganisationId ?? null;
    if (!orgId) {
      const mine = await orgs.listMyOrganisations(deps.db, s.user.id);
      if (mine.length === 1) orgId = await orgs.switchOrganisation(deps.db, s.user.id, s.session.id, mine[0]!.id).then((o) => o.id);
      else throw new AppError(mine.length ? 'ORGANISATION_REQUIRED' : 'NO_ORGANISATION', 409, mine.length ? 'Choose an organisation' : 'Create or join an organisation first');
    }
    const actor = await resolveActor(deps.db, s.user.id, orgId!, req.id);
    if (!actor) throw new AppError('NOT_A_MEMBER', 403, 'Your access to this organisation has ended');
    // Organisations may require two-step sign-in: everything but the account routes waits until it is on.
    if (await orgRequiresTwoFactor(orgId!)) {
      const [u] = await deps.db.select({ tf: users.twoFactorEnabled }).from(users).where(eq(users.id, s.user.id));
      if (!u?.tf && !TWO_FACTOR_EXEMPT.test(req.url)) throw new AppError('TWO_FACTOR_REQUIRED', 403, 'This organisation requires two-step sign-in. Turn it on under Settings → Account to continue.');
    }
    req.actorCache = actor;
    return actor;
  }

  const ctxFor = async (req: FastifyRequest): Promise<Ctx> => ({
    db: deps.db,
    config,
    mailer: deps.mailer,
    storage: deps.storage,
    queues: deps.queues,
    media: deps.media,
    actor: await actorFor(req),
  });

  // ---------------------------------------------------------------- health
  app.get('/api/v1/health/live', async () => ({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await deps.db.execute(sql`select 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'unavailable';
    }
    checks.redis = deps.redisPing ? ((await deps.redisPing().catch(() => false)) ? 'ok' : 'unavailable') : 'not_configured';
    checks.media = !config.STREAMING_ENABLED ? 'disabled' : deps.media ? (deps.media.demo ? 'demo' : 'configured') : 'not_configured';
    const ok = checks.database === 'ok' && checks.redis !== 'unavailable';
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ready' : 'degraded', checks });
  });
  app.get('/api/v1/time', async () => ({ serverNow: Date.now() }));

  return { app, auth, ctxFor, actorFor, loadSession, deps };
}

export type AppBundle = Awaited<ReturnType<typeof buildApp>>;
export type Reply = FastifyReply;
