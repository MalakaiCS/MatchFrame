// Platform routes: webhooks, on-air reports, demo matches, backups, billing, web push, hotkeys, OBS scene
// collections, the public match centre, sign-in options, white-label branding, metrics and status.
import crypto from 'node:crypto';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, activity, airtime, authOptions, automationSvc, backups, billing, contact, demo, hotkeys, imports, importsExtra, metrics, notes, obs, orgs, publicMatch, push, webhooksSvc, overlaysSvc } from '@bs/services';
import type { AppBundle } from '../app';

const id = z.object({ id: z.string().uuid() });
const P = <T extends z.ZodTypeAny>(s: T, v: unknown) => s.parse(v) as z.infer<T>;

export function registerPlatformRoutes(b: AppBundle) {
  const { app, ctxFor, loadSession, deps } = b;
  const auto = { db: deps.db, config: deps.config, workerId: 'api' };

  // ---------------------------------------------------------------- sign-in options and white-label branding (public)
  app.get('/api/v1/auth-options', async () => authOptions(deps.config, deps.sms));
  app.get('/api/v1/public/branding', async (req, reply) => {
    const q = P(z.object({ host: z.string().max(253).optional() }), req.query ?? {});
    const b2 = await orgs.brandingForHost(deps.db, q.host ?? (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host);
    reply.header('cache-control', 'public, max-age=60');
    return b2 ? { ...b2, logoUrl: b2.logoAssetId ? overlaysSvc.signedAssetUrl(deps.config, b2.organisationId, b2.logoAssetId, 3600) : null, logoAssetId: undefined, organisationId: undefined } : { productName: deps.config.PRODUCT_NAME, logoUrl: null, primaryColor: null, accentColor: null, supportEmail: null, hideVendor: false };
  });

  // ---------------------------------------------------------------- public contact form (stored; emailed to CONTACT_EMAIL when set)
  app.get('/api/v1/public/contact', async () => contact.contactStatus({ db: deps.db, config: deps.config, mailer: deps.mailer }));
  app.post('/api/v1/public/contact', async (req) => contact.submitContact({ db: deps.db, config: deps.config, mailer: deps.mailer }, req.body, { ip: req.ip }));

  // ---------------------------------------------------------------- outbound webhooks
  app.get('/api/v1/webhook-endpoints', async (req) => webhooksSvc.listWebhooks(await ctxFor(req)));
  app.post('/api/v1/webhook-endpoints', async (req, reply) => reply.code(201).send(await webhooksSvc.createWebhook(await ctxFor(req), req.body as never)));
  app.patch('/api/v1/webhook-endpoints/:id', async (req) => webhooksSvc.updateWebhook(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.delete('/api/v1/webhook-endpoints/:id', async (req) => webhooksSvc.deleteWebhook(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/webhook-endpoints/:id/test', async (req) => webhooksSvc.testWebhook(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/webhook-endpoints/:id/deliveries', async (req) => webhooksSvc.listDeliveries(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/webhook-events', async () => webhooksSvc.WEBHOOK_EVENTS);

  // ---------------------------------------------------------------- graphics on-air reports
  const airtimeQuery = z.object({ from: z.string().optional(), to: z.string().optional(), competitionId: z.string().uuid().optional(), matchId: z.string().uuid().optional() });
  app.get('/api/v1/reports/airtime', async (req) => airtime.airtimeReport(await ctxFor(req), P(airtimeQuery, req.query ?? {})));
  app.get('/api/v1/reports/airtime.csv', async (req, reply) => {
    const r = await airtime.airtimeReport(await ctxFor(req), P(airtimeQuery, req.query ?? {}));
    const esc = (v: string | number) => {
      const s = String(v);
      return /^[=+\-@]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['section,key,count,seconds'];
    for (const [section, rows] of [['template', r.byTemplate], ['match', r.byMatch], ['sponsor_creative', r.bySponsorCreative], ['source', r.bySource]] as const) for (const row of rows) lines.push([section, esc(row.key), row.count, row.seconds].join(','));
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="airtime.csv"');
    return lines.join('\n') + '\n';
  });
  app.get('/api/v1/matches/:id/airtime', async (req) => airtime.matchAirtime(await ctxFor(req), P(id, req.params).id));

  // ---------------------------------------------------------------- demo matches
  app.get('/api/v1/demo', async (req) => demo.listDemos(await ctxFor(req)));
  app.post('/api/v1/demo', async (req, reply) => reply.code(201).send(await demo.startDemo(await ctxFor(req), req.body as never)));
  app.post('/api/v1/demo/:id/:action', async (req) => {
    const p = P(z.object({ id: z.string().uuid(), action: z.enum(['pause', 'resume', 'stop']) }), req.params);
    return demo.controlDemo(await ctxFor(req), p.id, p.action);
  });

  // ---------------------------------------------------------------- backups (installation owners)
  app.get('/api/v1/admin/backups', async (req) => backups.listBackups(await ctxFor(req)));
  app.post('/api/v1/admin/backups/run', async (req) => backups.requestBackup(await ctxFor(req)));

  // ---------------------------------------------------------------- billing
  app.get('/api/v1/billing', async (req) => billing.getBilling(await ctxFor(req)));
  app.post('/api/v1/billing/checkout', async (req) => billing.createCheckout(await ctxFor(req), req.body as never));
  app.post('/api/v1/billing/portal', async (req) => billing.createPortal(await ctxFor(req)));
  app.post('/api/v1/billing/plan', async (req) => billing.setPlanManually(await ctxFor(req), P(z.object({ plan: z.enum(billing.PLAN_KEYS) }), req.body).plan));
  app.post('/api/v1/webhooks/stripe', { config: { rawBody: true } }, async (req, reply) => {
    const secret = deps.config.STRIPE_WEBHOOK_SECRET;
    if (!secret) return reply.code(404).send({ error: 'billing not configured' });
    const raw = (req as typeof req & { rawBody?: string }).rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    if (!billing.verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, secret)) return reply.code(400).send({ error: 'bad signature' });
    const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
    return billing.handleStripeEvent(deps.db, event);
  });

  // ---------------------------------------------------------------- web push
  app.get('/api/v1/push/public-key', async () => ({ configured: push.pushConfigured(deps.config), publicKey: deps.config.VAPID_PUBLIC_KEY ?? null }));
  app.get('/api/v1/me/push-subscriptions', async (req) => push.listMySubscriptions(await ctxFor(req)));
  app.post('/api/v1/me/push-subscriptions', async (req) => push.saveSubscription(await ctxFor(req), req.body as never));
  app.delete('/api/v1/me/push-subscriptions', async (req) => push.removeSubscription(await ctxFor(req), P(z.object({ endpoint: z.string().url() }), req.body).endpoint));

  // ---------------------------------------------------------------- hotkeys (Stream Deck) and OBS
  app.get('/api/v1/hotkeys/:id', async (req) => hotkeys.listHotkeys(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/hotkeys/:id/:action', async (req) => {
    const p = P(z.object({ id: z.string().uuid(), action: z.string().min(1).max(120) }), req.params);
    const body = (req.body ?? {}) as { variables?: Record<string, unknown>; durationMs?: number | null };
    return hotkeys.fireHotkey(await ctxFor(req), p.id, { action: decodeURIComponent(p.action), variables: body.variables, durationMs: body.durationMs }, auto);
  });
  app.get('/api/v1/matches/:id/obs-scene-collection.json', async (req, reply) => {
    const c = await obs.obsSceneCollection(await ctxFor(req), P(id, req.params).id);
    reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="broadcast-studio-${P(id, req.params).id.slice(0, 8)}.json"`);
    return JSON.stringify(c, null, 2);
  });

  // ---------------------------------------------------------------- public match centre
  app.post('/api/v1/matches/:id/share', async (req) => publicMatch.shareMatch(await ctxFor(req), P(id, req.params).id, P(z.object({ action: z.enum(['create', 'rotate', 'disable']).default('create') }), req.body ?? {}).action));
  const publicMatchHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = P(z.object({ token: z.string().min(16).max(80) }), req.params);
    const m = await publicMatch.publicMatchByToken(deps.db, token, (orgId, assetId) => (assetId ? overlaysSvc.signedAssetUrl(deps.config, orgId, assetId, 3600) : null));
    if (!m) throw new AppError('NOT_FOUND', 404, 'This match link is not available');
    reply.header('cache-control', 'public, max-age=3');
    return m;
  };
  app.get('/api/v1/public/match/:token', publicMatchHandler);
  app.get('/api/v1/public/match/:token/feed.json', publicMatchHandler);

  // ---------------------------------------------------------------- metrics and status
  app.get('/metrics', async (req, reply) => {
    const token = deps.config.METRICS_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) return reply.code(401).send('unauthorised');
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return metrics.renderMetrics(deps.db);
  });
  app.get('/api/v1/status', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await deps.db.execute(`select 1` as never);
      checks.database = 'ok';
    } catch {
      checks.database = 'unavailable';
    }
    checks.redis = deps.redisPing ? ((await deps.redisPing().catch(() => false)) ? 'ok' : 'unavailable') : 'not_configured';
    checks.storage = deps.storage ? 'configured' : 'not_configured';
    checks.mail = deps.mailer ? 'configured' : 'not_configured';
    checks.streaming = deps.config.STREAMING_ENABLED ? 'enabled' : 'graphics_only';
    let gauges: Awaited<ReturnType<typeof metrics.domainGauges>> | null = null;
    try {
      gauges = await metrics.domainGauges(deps.db);
    } catch {
      gauges = null;
    }
    checks.worker = gauges ? (gauges.workerAlive ? 'ok' : 'no_lease') : 'unknown';
    const ok = checks.database === 'ok' && checks.redis !== 'unavailable';
    reply.header('cache-control', 'no-store');
    // which build is running (Railway and Render set the commit), and work waiting for the worker: a growing
    // queue with the worker "no_lease" means automation is not reaching the outputs
    const version = (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? '').slice(0, 7) || null;
    return { status: ok ? 'ok' : 'degraded', version, checks, outboxPending: gauges?.outboxPending ?? null, liveMatches: gauges?.liveMatches ?? null, connectedRenderers: gauges?.renderers ?? null, generatedAt: new Date().toISOString(), requestId: crypto.randomUUID() };
  });
  // ---------------------------------------------------------------- run sheet, activity, approvals, imports
  app.get('/api/v1/matches/:id/notes', async (req) => notes.listNotes(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/matches/:id/notes', async (req, reply) => reply.code(201).send(await notes.addNote(await ctxFor(req), P(id, req.params).id, req.body as never)));
  app.patch('/api/v1/matches/:id/notes/:noteId', async (req) => {
    const p = P(z.object({ id: z.string().uuid(), noteId: z.string().uuid() }), req.params);
    return notes.updateNote(await ctxFor(req), p.id, p.noteId, req.body as never);
  });
  app.delete('/api/v1/matches/:id/notes/:noteId', async (req) => {
    const p = P(z.object({ id: z.string().uuid(), noteId: z.string().uuid() }), req.params);
    return notes.deleteNote(await ctxFor(req), p.id, p.noteId);
  });
  app.get('/api/v1/matches/:id/activity', async (req) => activity.matchActivity(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/overlays/:id/awaiting', async (req) => automationSvc.awaitingCues(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/overlays/:id/cues/:cueId/:decision', async (req) => {
    const p = P(z.object({ id: z.string().uuid(), cueId: z.string().uuid(), decision: z.enum(['approve', 'skip']) }), req.params);
    const ctx = await ctxFor(req);
    await overlaysSvc.getOverlay(ctx, p.id);
    return automationSvc.decideCue(ctx, p.id, p.cueId, p.decision);
  });
  app.post('/api/v1/imports/fixtures/ical', async (req) => {
    const body = P(z.object({ ics: z.string().min(10).max(2_000_000), competition: z.string(), season: z.string(), timezone: z.string(), separator: z.string().max(10).optional(), options: z.record(z.string(), z.unknown()) }), req.body);
    const conv = importsExtra.icalToFixtureCsv(body.ics, body);
    const preview = conv.rows ? await imports.dryRunFixtureImport(await ctxFor(req), conv.csv, body.options as never) : null;
    return { csv: conv.csv, rows: conv.rows, skipped: conv.skipped, preview };
  });
  app.post('/api/v1/imports/fixtures/sheet', async (req) => {
    const body = P(z.object({ url: z.string().url(), options: z.record(z.string(), z.unknown()) }), req.body);
    const ctx = await ctxFor(req);
    const csv = await importsExtra.fetchCsvFromUrl(body.url);
    const preview = await imports.dryRunFixtureImport(ctx, csv, body.options as never);
    return { csv, preview };
  });
  void loadSession;
}
