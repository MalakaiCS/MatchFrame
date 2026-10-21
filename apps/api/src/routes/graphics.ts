// Themes, templates, overlays and the public renderer capability endpoints.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { assetDerivatives, mediaAssets, withTenant } from '@bs/db';
import type { Readable } from 'node:stream';
import { AppError, gamePlansSvc, layoutsSvc, overlaysSvc, themesSvc, transitionsSvc } from '@bs/services';
import { findTemplate } from '@bs/graphics';
import type { AppBundle } from '../app';
import * as presence from '../presence';
import { snapshotExtras } from '../snapshot-extras';

const id = z.object({ id: z.string().uuid() });
const P = <T extends z.ZodTypeAny>(s: T, v: unknown) => s.parse(v) as z.infer<T>;

export function registerGraphicsRoutes(b: AppBundle) {
  const { app, ctxFor, deps } = b;

  // a transition drawn frame by frame in the browser (PNG with alpha, one after another) → VP9 WebM with alpha for
  // an OBS or vMix stinger; the frames stream straight into FFmpeg
  app.addContentTypeParser('application/vnd.matchframe.png-sequence', (_req, payload, done) => done(null, payload));
  app.post('/api/v1/transitions/encode', async (req, reply) => {
    const r = await transitionsSvc.encodeTransition(await ctxFor(req), req.body as Readable, Number(req.headers['content-length']), req.query as never);
    return reply.header('content-type', 'video/webm').header('content-disposition', `attachment; filename="${r.fileName}"`).header('x-frames', String(r.frames)).header('cache-control', 'no-store').send(r.file);
  });

  app.get('/api/v1/themes', async (req) => themesSvc.listThemes(await ctxFor(req)));
  app.get('/api/v1/theme-profiles', async (req) => themesSvc.listProfiles(await ctxFor(req)));
  app.post('/api/v1/theme-profiles', async (req, reply) => reply.code(201).send(await themesSvc.createProfile(await ctxFor(req), req.body as never)));
  app.patch('/api/v1/theme-profiles/:id', async (req) => themesSvc.updateProfileDraft(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.post('/api/v1/theme-profiles/:id/publish', async (req) => themesSvc.publishProfile(await ctxFor(req), P(id, req.params).id));

  app.get('/api/v1/templates', async (req) => themesSvc.listTemplates(await ctxFor(req)));
  app.post('/api/v1/templates', async (req, reply) => reply.code(201).send(await themesSvc.createTemplate(await ctxFor(req), req.body as never)));
  app.get('/api/v1/templates/:id', async (req) => themesSvc.getTemplate(await ctxFor(req), P(id, req.params).id));
  app.put('/api/v1/templates/:id/draft', async (req) => themesSvc.saveTemplateDraft(await ctxFor(req), P(id, req.params).id, (req.body as { scene: unknown }).scene));
  app.post('/api/v1/templates/:id/publish', async (req) => themesSvc.publishTemplate(await ctxFor(req), P(id, req.params).id));
  app.delete('/api/v1/templates/:id', async (req) => themesSvc.archiveTemplate(await ctxFor(req), P(id, req.params).id));

  app.get('/api/v1/control-room-layouts', async (req) => layoutsSvc.listLayouts(await ctxFor(req)));
  app.post('/api/v1/control-room-layouts', async (req) => layoutsSvc.saveLayout(await ctxFor(req), req.body as never));
  app.delete('/api/v1/control-room-layouts/:id', async (req) => layoutsSvc.deleteLayout(await ctxFor(req), P(id, req.params).id));

  app.get('/api/v1/matches/:id/overlays', async (req) => overlaysSvc.listOverlays(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/matches/:id/overlays', async (req, reply) => reply.code(201).send(await overlaysSvc.createOverlay(await ctxFor(req), P(id, req.params).id, req.body as never)));
  app.get('/api/v1/overlays/:id', async (req) => overlaysSvc.getOverlay(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/overlays/:id/urls', async (req) => overlaysSvc.overlayUrls(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/overlays/:id/commands', async (req) => {
    const ctx = await ctxFor(req);
    const overlayId = P(id, req.params).id;
    const body = req.body as { command?: { type?: string; layer?: string; templateKey?: string } };
    const layer = body?.command?.layer ?? (body?.command?.templateKey ? findTemplate(body.command.templateKey, [])?.layer : undefined);
    if (layer && ['TAKE_IN', 'UPDATE', 'CLEAR_LAYER'].includes(body.command?.type ?? '')) {
      const held = presence.heldByOther(overlayId, layer, ctx.actor.userId);
      if (held) throw new AppError('LAYER_LOCKED', 409, `${held.name} is preparing that layer right now. Wait a moment or ask them to release it.`, undefined, { holder: held });
    }
    return overlaysSvc.overlayCommand(ctx, overlayId, body as never, { source: 'operator' });
  });
  app.get('/api/v1/overlays/:id/presence', async (req) => {
    const ctx = await ctxFor(req);
    const overlayId = P(id, req.params).id;
    await overlaysSvc.getOverlay(ctx, overlayId);
    return presence.snapshot(overlayId);
  });
  app.post('/api/v1/overlays/:id/rotate', async (req) => overlaysSvc.rotateOverlayCredential(await ctxFor(req), P(id, req.params).id, (P(z.object({ purpose: z.enum(['production', 'monitor', 'rehearsal']).default('production') }), req.body ?? {})).purpose));
  app.post('/api/v1/overlays/:id/apply-theme', async (req) => overlaysSvc.applyPendingTheme(await ctxFor(req), P(id, req.params).id));
  app.put('/api/v1/overlays/:id/theme-profile', async (req) => overlaysSvc.setOverlayThemeProfile(await ctxFor(req), P(id, req.params).id, P(z.object({ themeProfileId: z.string().uuid().nullable() }), req.body).themeProfileId));
  app.put('/api/v1/matches/:id/look', async (req) => overlaysSvc.setMatchLook(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.put('/api/v1/competitions/:id/look', async (req) => overlaysSvc.setCompetitionLook(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.put('/api/v1/overlays/:id/format', async (req) => overlaysSvc.setOverlayFormat(await ctxFor(req), P(id, req.params).id, P(z.object({ format: z.enum(['16:9', '9:16', 'venue']) }), req.body).format));
  app.post('/api/v1/overlays/:id/starter-plan', async (req) => gamePlansSvc.applyStarterPlan(await ctxFor(req), P(id, req.params).id));
  app.put('/api/v1/overlays/:id/game-plan', async (req) => overlaysSvc.setOverlayGamePlan(await ctxFor(req), P(id, req.params).id, P(z.object({ gamePlanVersionId: z.string().uuid().nullable() }), req.body).gamePlanVersionId));
  // Operator preview data: same snapshot the production renderer gets, authorised by session.
  app.get('/api/v1/overlays/:id/render-data', async (req) => {
    const ctx = await ctxFor(req);
    const o = await overlaysSvc.getOverlay(ctx, P(id, req.params).id);
    return overlaysSvc.rendererSnapshot(deps.db, deps.config, { organisationId: ctx.actor.organisationId, overlayId: o.overlay.id, matchId: o.overlay.matchId, purpose: 'monitor', tokenVersion: 0 }, snapshotExtras(deps));
  });

  // ------------------------------------------------------------ public capability endpoints (read-only)
  app.get('/api/v1/public/overlay/:publicId/snapshot', async (req, reply) => {
    const { publicId } = P(z.object({ publicId: z.string().max(40) }), req.params);
    const token = String((req.query as { t?: string }).t ?? req.headers['x-overlay-token'] ?? '');
    const scope = await overlaysSvc.resolveRendererToken(deps.db, deps.config, token);
    if (!scope) throw new AppError('INVALID_CAPABILITY', 401, 'This output link is not valid. Ask the operator for the current production URL.');
    const snap = await overlaysSvc.rendererSnapshot(deps.db, deps.config, scope, snapshotExtras(deps));
    const pub = await withTenant(deps.db, { organisationId: scope.organisationId }, async (t) => {
      const { overlays } = await import('@bs/db');
      return (await t.select({ p: overlays.publicId }).from(overlays).where(eq(overlays.id, scope.overlayId)))[0]?.p;
    });
    if (scope.purpose !== 'compositor' && pub !== publicId) throw new AppError('INVALID_CAPABILITY', 401, 'This output link is not valid.');
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    return snap;
  });

  app.get('/api/v1/public/assets/:assetId', async (req, reply) => {
    const { assetId } = P(z.object({ assetId: z.string().uuid() }), req.params);
    const q = P(z.object({ o: z.string().uuid(), e: z.coerce.number().int(), s: z.string().max(64) }), req.query);
    if (!overlaysSvc.verifyAssetSignature(deps.config, q.o, assetId, q.e, q.s)) throw new AppError('FORBIDDEN', 403, 'Asset link expired or invalid');
    const found = await withTenant(deps.db, { organisationId: q.o }, async (t) => {
      const [a] = await t.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.state, 'READY')));
      if (!a) return null;
      const [d] = await t.select().from(assetDerivatives).where(and(eq(assetDerivatives.assetId, assetId), eq(assetDerivatives.purpose, 'broadcast')));
      return d ? { key: d.objectKey, mime: d.mime } : null;
    });
    if (!found || !deps.storage) throw new AppError('NOT_FOUND', 404, 'Asset not found');
    const obj = await deps.storage.get(found.key, req.headers.range as string | undefined);
    reply.header('content-type', found.mime).header('cache-control', 'private, max-age=3600').header('accept-ranges', 'bytes').header('access-control-allow-origin', '*');
    if (obj.contentRange) reply.code(206).header('content-range', obj.contentRange);
    if (obj.contentLength) reply.header('content-length', obj.contentLength);
    return reply.send(obj.body);
  });
}
