// Streaming operations: inputs, outputs, destinations, sessions, input preview, HLS gateway and provider webhooks.
import { z } from 'zod';
import { AppError, streamsSvc } from '@bs/services';
import type { AppBundle } from '../app';

const id = z.object({ id: z.string().uuid() });
const P = <T extends z.ZodTypeAny>(s: T, v: unknown) => s.parse(v) as z.infer<T>;

export function registerStreamRoutes(b: AppBundle) {
  const { app, ctxFor, deps } = b;

  app.get('/api/v1/inputs', async (req) => streamsSvc.listInputs(await ctxFor(req)));
  app.post('/api/v1/inputs', async (req, reply) => reply.code(201).send(await streamsSvc.createInput(await ctxFor(req), req.body as never)));
  app.post('/api/v1/inputs/:id/reveal', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return streamsSvc.revealInputKey(await ctxFor(req), P(id, req.params).id);
  });
  app.post('/api/v1/inputs/:id/rotate', async (req) => streamsSvc.rotateInputKey(await ctxFor(req), P(id, req.params).id));

  app.get('/api/v1/streams', async (req) => streamsSvc.streamsOverview(await ctxFor(req)));
  app.get('/api/v1/matches/:id/streams', async (req) => streamsSvc.matchStreams(await ctxFor(req), P(id, req.params).id));
  app.put('/api/v1/matches/:id/outputs', async (req) => streamsSvc.saveOutput(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.post('/api/v1/outputs/:id/destinations', async (req, reply) => reply.code(201).send(await streamsSvc.addDestination(await ctxFor(req), P(id, req.params).id, req.body as never)));
  app.delete('/api/v1/destinations/:id', async (req) => streamsSvc.removeDestination(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/destinations/:id/enabled', async (req) => streamsSvc.setDestinationEnabled(await ctxFor(req), P(id, req.params).id, P(z.object({ enabled: z.boolean() }), req.body).enabled));
  app.post('/api/v1/matches/:id/session/start', async (req) => {
    const r = await streamsSvc.startSession(await ctxFor(req), P(id, req.params).id, P(z.object({ outputIds: z.array(z.string().uuid()).optional() }), req.body ?? {}));
    return { sessionId: r.session.id, state: r.session.state, created: r.created };
  });
  app.post('/api/v1/matches/:id/session/stop', async (req) => streamsSvc.stopSession(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/matches/:id/input-preview', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return streamsSvc.inputPreviewToken(await ctxFor(req), P(id, req.params).id);
  });

  // HLS gateway: every playlist and segment request is authorised (not only the manifest).
  app.get('/api/v1/hls/:id/:file', async (req, reply) => {
    const { id: osId, file } = P(z.object({ id: z.string().uuid(), file: z.string().max(80) }), req.params);
    const key = await streamsSvc.hlsObjectKey(await ctxFor(req), osId, file);
    if (!deps.storage) throw new AppError('NOT_FOUND', 404, 'Stream not found');
    const obj = await deps.storage.get(key).catch(() => null);
    if (!obj) throw new AppError('NOT_FOUND', 404, file.endsWith('.m3u8') ? 'The stream has not produced a playlist yet' : 'Segment not found');
    reply.header('content-type', file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t').header('cache-control', file.endsWith('.m3u8') ? 'no-store' : 'private, max-age=60');
    return reply.send(obj.body);
  });

  // Provider webhooks: signature verified here, processed idempotently by the worker (dedup by event id).
  app.post('/api/v1/webhooks/media', async (req, reply) => {
    if (!deps.media) throw new AppError('MEDIA_NOT_CONFIGURED', 503, 'Media provider not configured');
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    let ev;
    try {
      ev = await deps.media.verifyWebhook(raw, req.headers.authorization);
    } catch {
      throw new AppError('INVALID_SIGNATURE', 401, 'Webhook signature invalid');
    }
    await deps.queues?.addControl({ kind: 'provider.webhook', eventId: ev.id, event: ev }, { jobId: `wh-${ev.id}` });
    return reply.code(202).send({ accepted: true });
  });
}
