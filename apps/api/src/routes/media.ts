// Media library: uploads, recordings, highlights, clips, exports, compilations, shares and public share access.
import type { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, highlightsSvc, library, usageSvc, type Storage } from '@bs/services';
import type { AppBundle } from '../app';

const id = z.object({ id: z.string().uuid() });
/** the file types an upload's file is sent as (checked against the upload by the service) */
const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'application/font-woff', 'application/x-font-ttf', 'application/octet-stream'];
const P = <T extends z.ZodTypeAny>(s: T, v: unknown) => s.parse(v) as z.infer<T>;

/** Stream an object with HTTP range support (video seeking) and no-store caching for private media. */
async function streamObject(storage: Storage | undefined, req: FastifyRequest, reply: FastifyReply, m: library.MediaRef, opts: { download?: boolean; publicShare?: boolean } = {}) {
  if (!storage) throw new AppError('STORAGE_UNAVAILABLE', 503, 'Object storage is not configured');
  const obj = await storage.get(m.key, req.headers.range as string | undefined).catch(() => null);
  if (!obj) throw new AppError('NOT_FOUND', 404, 'Media not found');
  reply.header('content-type', m.mime).header('accept-ranges', 'bytes').header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff');
  if (opts.download) reply.header('content-disposition', `attachment; filename="${m.filename}"`);
  if (opts.publicShare) reply.header('referrer-policy', 'no-referrer');
  if (obj.contentRange) reply.code(206).header('content-range', obj.contentRange);
  if (obj.contentLength) reply.header('content-length', obj.contentLength);
  return reply.send(obj.body);
}

export function registerMediaRoutes(b: AppBundle) {
  const { app, ctxFor, deps } = b;

  app.get('/api/v1/usage', async (req) => library.usageSummary(await ctxFor(req)));
  app.get('/api/v1/usage/ledger', async (req) => usageSvc.usageReport(await ctxFor(req), req.query as never));
  app.post('/api/v1/assets/uploads', async (req, reply) => reply.code(201).send(await library.createUpload(await ctxFor(req), req.body as never)));
  // the file itself, through the API from the app's origin (the stream goes straight to storage)
  app.addContentTypeParser(UPLOAD_TYPES, (_req, payload, done) => done(null, payload));
  app.put('/api/v1/assets/:id/content', async (req) => {
    const length = Number(req.headers['content-length']);
    if (!Number.isInteger(length) || length <= 0) throw new AppError('LENGTH_REQUIRED', 411, 'Send the file with its size (Content-Length)');
    return library.receiveUpload(await ctxFor(req), P(id, req.params).id, req.body as Readable, String(req.headers['content-type'] ?? ''), length);
  });
  app.post('/api/v1/assets/:id/complete', async (req) => library.completeUpload(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/assets/:id/preview', async (req, reply) => streamObject(deps.storage, req, reply, await library.assetPreview(await ctxFor(req), P(id, req.params).id, (req.query as { purpose?: string }).purpose === 'broadcast' ? 'broadcast' : 'thumbnail')));
  app.post('/api/v1/assets/:id/archive', async (req) => library.archiveAsset(await ctxFor(req), P(id, req.params).id));

  app.get('/api/v1/recordings', async (req) => library.listRecordings(await ctxFor(req), P(z.object({ matchId: z.string().uuid().optional() }), req.query).matchId));
  app.post('/api/v1/recordings/:id/pin', async (req) => library.setPinned(await ctxFor(req), 'recording', P(id, req.params).id, P(z.object({ pinned: z.boolean() }), req.body).pinned));
  app.get('/api/v1/recordings/:id/media', async (req, reply) => streamObject(deps.storage, req, reply, await library.mediaFor(await ctxFor(req), 'recording', P(id, req.params).id)));

  app.get('/api/v1/matches/:id/highlights', async (req) => library.listHighlightRequests(await ctxFor(req), P(id, req.params).id));

  // the highlights generator: a video of the match, uploaded in parts, synced to the kick-offs, and packages made from it
  app.get('/api/v1/matches/:id/videos', async (req) => highlightsSvc.listMatchVideos(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/matches/:id/videos', async (req, reply) => reply.code(201).send(await highlightsSvc.createMatchVideo(await ctxFor(req), P(id, req.params).id, req.body as never)));
  app.put('/api/v1/match-videos/:id/parts/:part', async (req) => {
    const prm = P(z.object({ id: z.string().uuid(), part: z.coerce.number().int().min(1).max(10_000) }), req.params);
    const length = Number(req.headers['content-length']);
    if (!Number.isInteger(length) || length <= 0) throw new AppError('LENGTH_REQUIRED', 411, 'Send each part with its size (Content-Length)');
    return highlightsSvc.uploadMatchVideoPart(await ctxFor(req), prm.id, prm.part, req.body as Readable, length);
  });
  app.post('/api/v1/match-videos/:id/complete', async (req) => highlightsSvc.completeMatchVideo(await ctxFor(req), P(id, req.params).id));
  app.put('/api/v1/match-videos/:id/sync', async (req) => highlightsSvc.setMatchVideoSync(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.delete('/api/v1/match-videos/:id', async (req) => highlightsSvc.deleteMatchVideo(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/match-videos/:id/preview', async (req, reply) => streamObject(deps.storage, req, reply, await highlightsSvc.matchVideoMedia(await ctxFor(req), P(id, req.params).id, 'preview')));
  app.get('/api/v1/match-videos/:id/thumbnail', async (req, reply) => streamObject(deps.storage, req, reply, await highlightsSvc.matchVideoMedia(await ctxFor(req), P(id, req.params).id, 'thumbnail')));
  app.get('/api/v1/matches/:id/highlights/source', async (req) => highlightsSvc.highlightsSource(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/matches/:id/highlight-packages', async (req) => highlightsSvc.listHighlights(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/matches/:id/highlight-packages', async (req, reply) => reply.code(201).send(await highlightsSvc.createHighlights(await ctxFor(req), P(id, req.params).id, req.body as never)));
  app.put('/api/v1/exports/:id/graphics', async (req) => highlightsSvc.receiveHighlightGraphics(await ctxFor(req), P(id, req.params).id, req.body as Readable, Number(req.headers['content-length'])));
  app.get('/api/v1/clips', async (req) => library.listClips(await ctxFor(req), P(z.object({ matchId: z.string().uuid().optional() }), req.query)));
  app.post('/api/v1/clips', async (req, reply) => reply.code(201).send(await library.createManualClip(await ctxFor(req), req.body as never)));
  app.get('/api/v1/clips/:id/media', async (req, reply) => streamObject(deps.storage, req, reply, await library.mediaFor(await ctxFor(req), 'clip', P(id, req.params).id)));
  app.get('/api/v1/clips/:id/thumbnail', async (req, reply) => streamObject(deps.storage, req, reply, await library.mediaFor(await ctxFor(req), 'clip_thumb', P(id, req.params).id)));
  app.post('/api/v1/clips/:id/exports', async (req, reply) => reply.code(201).send(await library.exportClip(await ctxFor(req), P(id, req.params).id, req.body as never)));
  app.post('/api/v1/compilations', async (req, reply) => reply.code(201).send(await library.createCompilation(await ctxFor(req), req.body as never)));

  app.get('/api/v1/exports', async (req) => library.listJobs(await ctxFor(req), P(z.object({ kind: z.string().max(30).optional() }), req.query)));
  app.post('/api/v1/exports/:id/cancel', async (req) => library.cancelJob(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/exports/:id/retry', async (req) => library.retryJob(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/exports/:id/download', async (req, reply) => streamObject(deps.storage, req, reply, await library.mediaFor(await ctxFor(req), 'export', P(id, req.params).id), { download: true }));

  app.get('/api/v1/shares', async (req) => library.listShares(await ctxFor(req), P(z.object({ resourceId: z.string().uuid().optional() }), req.query).resourceId));
  app.post('/api/v1/shares', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.code(201).send(await library.createShare(await ctxFor(req), req.body as never));
  });
  app.post('/api/v1/shares/:id/revoke', async (req) => library.revokeShare(await ctxFor(req), P(id, req.params).id));

  // public share access: token checked on every request, including each media byte-range request
  const shareParams = z.object({ publicId: z.string().max(40) });
  const tokenOf = (req: FastifyRequest) => String((req.query as { t?: string }).t ?? req.headers['x-share-token'] ?? '');
  app.get('/api/v1/public/share/:publicId', async (req, reply) => {
    const s = await library.resolveShare(deps.db, P(shareParams, req.params).publicId, tokenOf(req), { countAccess: true });
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    return { title: s.title, resourceType: s.resourceType, expiresAt: s.expiresAt, mime: s.media.mime };
  });
  app.get('/api/v1/public/share/:publicId/media', async (req, reply) => {
    const s = await library.resolveShare(deps.db, P(shareParams, req.params).publicId, tokenOf(req));
    return streamObject(deps.storage, req, reply, s.media, { publicShare: true });
  });
  app.get('/api/v1/public/share/:publicId/thumbnail', async (req, reply) => {
    const s = await library.resolveShare(deps.db, P(shareParams, req.params).publicId, tokenOf(req), { media: 'thumbnail' });
    return streamObject(deps.storage, req, reply, s.media, { publicShare: true });
  });
}
