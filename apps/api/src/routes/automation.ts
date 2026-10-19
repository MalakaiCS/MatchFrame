// Game plans, rehearsal, automation log/manual triggers, sponsors and sponsor reports.
import crypto from 'node:crypto';
import { z } from 'zod';
import { AppError, assertCan, assetsSvc, automationSvc, gamePlansSvc, overlaysSvc, sponsorsSvc } from '@bs/services';
import { BUILTIN_TEMPLATES } from '@bs/graphics';
import { gamePlanSchema, simulateRehearsal, syntheticTimeline, getAdapter, type GamePlan } from '@bs/domain';
import type { AppBundle } from '../app';

const id = z.object({ id: z.string().uuid() });
const P = <T extends z.ZodTypeAny>(s: T, v: unknown) => s.parse(v) as z.infer<T>;

export function registerAutomationRoutes(b: AppBundle) {
  const { app, ctxFor, deps } = b;
  const auto = { db: deps.db, config: deps.config, workerId: 'api' };

  app.get('/api/v1/game-plans', async (req) => gamePlansSvc.listGamePlans(await ctxFor(req)));
  app.post('/api/v1/game-plans', async (req, reply) => reply.code(201).send(await gamePlansSvc.createGamePlan(await ctxFor(req), req.body as never)));
  app.get('/api/v1/game-plans/:id', async (req) => gamePlansSvc.getGamePlan(await ctxFor(req), P(id, req.params).id));
  app.put('/api/v1/game-plans/:id/draft', async (req) => gamePlansSvc.updateGamePlanDraft(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.post('/api/v1/game-plans/:id/publish', async (req) => gamePlansSvc.publishGamePlan(await ctxFor(req), P(id, req.params).id));

  /**
   * Rehearsal: replays a synthetic or supplied timeline through the production decision functions in
   * memory. It writes nothing — no overlay state, sponsor decisions/evidence, streams or usage.
   */
  app.post('/api/v1/game-plans/:id/rehearse', async (req) => {
    const ctx = await ctxFor(req);
    const g = await gamePlansSvc.getGamePlan(ctx, P(id, req.params).id);
    const body = P(z.object({ timeline: z.array(z.any()).max(500).optional() }), req.body ?? {});
    const parsed = gamePlanSchema.safeParse(g.draft);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 422, 'Fix the game plan errors before rehearsing');
    const plan: GamePlan = parsed.data;
    const sport = g.sport as 'football' | 'basketball';
    const rules = getAdapter(sport).defaultConfig;
    const r = simulateRehearsal(plan, rules, body.timeline ?? syntheticTimeline(sport), { templateLayers: g.templateLayers });
    return { ...r, validation: g.validation, isRehearsal: true };
  });
  app.get('/api/v1/template-catalog', async () => BUILTIN_TEMPLATES.map((t) => ({ key: t.key, name: t.name, layer: t.layer, category: t.category, sports: t.sports, holdMs: t.holdMs })));

  app.get('/api/v1/overlays/:id/automation', async (req) => automationSvc.automationLog(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/overlays/:id/playlists/:playlistId/trigger', async (req) => {
    const ctx = await ctxFor(req);
    const { id: overlayId, playlistId } = P(z.object({ id: z.string().uuid(), playlistId: z.string().max(40) }), req.params);
    await overlaysSvc.getOverlay(ctx, overlayId);
    assertCan(ctx.actor, 'overlay.operate', { overlayId });
    return automationSvc.triggerManualPlaylist(ctx, auto, overlayId, playlistId, P(z.object({ requestId: z.string().uuid().default(() => crypto.randomUUID()) }), req.body ?? {}).requestId);
  });

  app.get('/api/v1/assets', async (req) => {
    const q = P(z.object({ kind: z.string().max(20).optional(), search: z.string().max(80).optional() }), req.query ?? {});
    return assetsSvc.listAssets(await ctxFor(req), q);
  });
  app.get('/api/v1/sponsors', async (req) => sponsorsSvc.listSponsorData(await ctxFor(req)));
  app.post('/api/v1/brands', async (req, reply) => reply.code(201).send(await sponsorsSvc.createBrand(await ctxFor(req), req.body as never)));
  app.post('/api/v1/creatives', async (req, reply) => reply.code(201).send(await sponsorsSvc.addCreative(await ctxFor(req), req.body as never)));
  app.post('/api/v1/creatives/:id/approval', async (req) => sponsorsSvc.setCreativeApproval(await ctxFor(req), P(id, req.params).id, P(z.object({ status: z.enum(['approved', 'rejected', 'pending']) }), req.body).status));
  app.post('/api/v1/campaigns', async (req, reply) => reply.code(201).send(await sponsorsSvc.saveCampaign(await ctxFor(req), req.body as never)));
  app.put('/api/v1/campaigns/:id', async (req) => sponsorsSvc.saveCampaign(await ctxFor(req), req.body as never, P(id, req.params).id));
  app.get('/api/v1/matches/:id/sponsor-eligibility', async (req) => sponsorsSvc.eligibilityPreview(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/reports/sponsors', async (req) => sponsorsSvc.sponsorReport(await ctxFor(req), req.query as never));
  app.get('/api/v1/reports/sponsors.csv', async (req, reply) => {
    const r = await sponsorsSvc.sponsorReport(await ctxFor(req), req.query as never);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="sponsor-delivery.csv"').send(sponsorsSvc.sponsorReportCsv(r));
  });
}
