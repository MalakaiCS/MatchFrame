// Socket.IO realtime: explicit authorised rooms per tenant+resource. Sockets are a delivery channel only;
// clients recover via /events?afterVersion or snapshots (sequence/gap detection).
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq } from 'drizzle-orm';
import { matches, overlays, withTenant } from '@bs/db';
import { can, resolveActor, type Actor } from '@bs/services';
import type { AppBundle } from './app';
import * as presence from './presence';

export const EVENTS_CHANNEL = 'bs:events';

export interface RelayedEvent {
  id: string;
  position: number;
  organisationId: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  aggregateSeq: number | null;
  schemaVersion: number;
  payload: Record<string, unknown>;
}

export interface RendererHooks {
  /** resolve a production/monitor/rehearsal overlay token → scope; null when invalid/revoked */
  authenticate(token: string): Promise<{ organisationId: string; overlayId: string; matchId: string; purpose: string; tokenVersion: number } | null>;
  onConnect?(socket: Socket, scope: { organisationId: string; overlayId: string; purpose: string }, instanceId: string): Promise<void>;
  onDisplayed?(socket: Socket, payload: unknown): Promise<void>;
  onExposure?(socket: Socket, payload: unknown): Promise<void>;
  onDisconnect?(socket: Socket): Promise<void>;
}

const matchRoom = (org: string, m: string) => `org:${org}:match:${m}`;
const overlayRoom = (org: string, o: string) => `org:${org}:overlay:${o}`;
const opsRoom = (org: string) => `org:${org}:ops`;
const orgRoom = (org: string) => `org:${org}`;
const publicOrgRoom = (org: string) => `public:org:${org}`;
const userRoom = (org: string, u: string) => `org:${org}:user:${u}`;
const publicMatchRoom = (m: string) => `public:match:${m}`;
const publicOverlayRoom = (o: string) => `public:overlay:${o}`;

/** Fields safe for public renderer rooms (no member/actor details). */
function publicMatchPayload(topic: string, p: Record<string, unknown>) {
  if (topic === 'match.state.updated' || topic === 'clock.anchor.updated') return p;
  if (topic === 'match.fact.accepted' || topic === 'match.fact.corrected') {
    const { eventId, sequence, stateVersion, type, occurredAt, acceptedAt, payload } = p as Record<string, unknown>;
    return { eventId, sequence, stateVersion, type, occurredAt, acceptedAt, payload };
  }
  if (topic === 'match.lineup.updated') return p;
  return null;
}

export function attachRealtime(server: HttpServer, b: AppBundle, opts: { redisUrl?: string; renderer?: RendererHooks }) {
  const { deps } = b;
  const origins = deps.config.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  const io = new Server(server, {
    path: '/socket.io',
    cors: { origin: (origin, cb) => cb(null, !origin || origins.includes(origin)), credentials: true },
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: false },
    serveClient: false,
  });

  // ---------------------------------------------------------------- authenticated users
  const users = io.of('/app');
  users.use(async (socket, next) => {
    try {
      const s = (await b.auth.api.getSession({ headers: fromNodeHeaders(socket.request.headers) })) as { user: { id: string; name?: string; emailVerified: boolean }; session: { activeOrganisationId?: string } } | null;
      if (!s?.user?.emailVerified || !s.session.activeOrganisationId) return next(new Error('UNAUTHENTICATED'));
      const actor = await resolveActor(deps.db, s.user.id, s.session.activeOrganisationId);
      if (!actor) return next(new Error('NOT_A_MEMBER'));
      socket.data.actor = actor;
      socket.data.name = s.user.name ?? 'Operator';
      socket.join(userRoom(actor.organisationId, s.user.id));
      socket.join(orgRoom(actor.organisationId));
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  users.on('connection', (socket) => {
    const actor = socket.data.actor as Actor;
    socket.on('subscribe', async (msg: { kind: 'match' | 'overlay' | 'ops'; id?: string }, ack?: (r: unknown) => void) => {
      try {
        // refresh actor so revoked/changed access is enforced at subscribe time
        const fresh = await resolveActor(deps.db, actor.userId!, actor.organisationId);
        if (!fresh || fresh.accessVersion !== actor.accessVersion) {
          socket.disconnect(true);
          return;
        }
        if (msg.kind === 'ops') {
          if (!can(fresh, 'overlay.operate') && !can(fresh, 'stream.manage') && !can(fresh, 'competition.write')) return ack?.({ ok: false, code: 'FORBIDDEN' });
          socket.join(opsRoom(fresh.organisationId));
          return ack?.({ ok: true });
        }
        if (!msg.id || !/^[0-9a-f-]{36}$/.test(msg.id)) return ack?.({ ok: false, code: 'BAD_REQUEST' });
        const allowed = await withTenant(deps.db, { organisationId: fresh.organisationId, userId: fresh.userId }, async (t) => {
          if (msg.kind === 'match') {
            const [m] = await t.select().from(matches).where(and(eq(matches.id, msg.id!), eq(matches.organisationId, fresh.organisationId)));
            return m ? can(fresh, 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] }) : false;
          }
          const [o] = await t.select({ o: overlays, m: matches }).from(overlays).innerJoin(matches, eq(matches.id, overlays.matchId)).where(and(eq(overlays.id, msg.id!), eq(overlays.organisationId, fresh.organisationId)));
          return o ? can(fresh, 'overlay.operate', { matchId: o.m.id, competitionId: o.m.competitionId, overlayId: o.o.id }) || can(fresh, 'competition.read', { matchId: o.m.id }) : false;
        });
        if (!allowed) return ack?.({ ok: false, code: 'NOT_FOUND' }); // do not reveal existence
        socket.join(msg.kind === 'match' ? matchRoom(fresh.organisationId, msg.id) : overlayRoom(fresh.organisationId, msg.id));
        if (msg.kind === 'overlay' && fresh.userId) {
          presence.join(msg.id, socket.id, { userId: fresh.userId, name: String(socket.data.name ?? 'Operator') });
          users.to(overlayRoom(fresh.organisationId, msg.id)).emit('presence', { overlayId: msg.id, ...presence.snapshot(msg.id) });
        }
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, code: 'ERROR' });
      }
    });
    socket.on('unsubscribe', (msg: { kind: string; id: string }) => {
      if (msg.kind === 'match') socket.leave(matchRoom(actor.organisationId, msg.id));
      if (msg.kind === 'overlay') {
        socket.leave(overlayRoom(actor.organisationId, msg.id));
        presence.leave(msg.id, socket.id);
        users.to(overlayRoom(actor.organisationId, msg.id)).emit('presence', { overlayId: msg.id, ...presence.snapshot(msg.id) });
      }
    });
    socket.on('disconnect', () => {
      for (const overlayId of presence.leaveAll(socket.id)) users.to(overlayRoom(actor.organisationId, overlayId)).emit('presence', { overlayId, ...presence.snapshot(overlayId) });
    });
    // layer locks: "I am preparing a lower third" — others see it and the command path refuses a clash
    socket.on('lock', (msg: { overlayId: string; layer: string; release?: boolean }, ack?: (r: unknown) => void) => {
      if (!actor.userId || !msg?.overlayId || !msg.layer) return ack?.({ ok: false });
      if (msg.release) presence.unlock(msg.overlayId, msg.layer, actor.userId);
      const r = msg.release ? { ok: true as const } : presence.lock(msg.overlayId, msg.layer, { userId: actor.userId, name: String(socket.data.name ?? 'Operator') });
      users.to(overlayRoom(actor.organisationId, msg.overlayId)).emit('presence', { overlayId: msg.overlayId, ...presence.snapshot(msg.overlayId) });
      ack?.(r);
    });
    socket.on('time', (_: unknown, ack?: (r: unknown) => void) => ack?.({ serverNow: Date.now() }));
  });

  // ---------------------------------------------------------------- renderers (scoped capability, read-only)
  const renderers = io.of('/render');
  renderers.use(async (socket, next) => {
    const token = String(socket.handshake.auth?.token ?? '');
    const scope = opts.renderer && token ? await opts.renderer.authenticate(token).catch(() => null) : null;
    if (!scope) return next(new Error('INVALID_CAPABILITY'));
    socket.data.scope = scope;
    socket.data.instanceId = String(socket.handshake.auth?.instanceId ?? socket.id).slice(0, 80);
    next();
  });
  renderers.on('connection', async (socket) => {
    const scope = socket.data.scope as { organisationId: string; overlayId: string; matchId: string; purpose: string };
    socket.join(publicOverlayRoom(scope.overlayId));
    socket.join(publicMatchRoom(scope.matchId));
    socket.join(publicOrgRoom(scope.organisationId));
    await opts.renderer?.onConnect?.(socket, scope, socket.data.instanceId).catch(() => undefined);
    socket.on('displayed', (p) => void opts.renderer?.onDisplayed?.(socket, p).catch(() => undefined));
    socket.on('exposure', (p) => void opts.renderer?.onExposure?.(socket, p).catch(() => undefined));
    socket.on('time', (_: unknown, ack?: (r: unknown) => void) => ack?.({ serverNow: Date.now() }));
    socket.on('disconnect', () => void opts.renderer?.onDisconnect?.(socket).catch(() => undefined));
  });

  // ---------------------------------------------------------------- fan-out from the outbox relay
  let sub: Redis | null = null;
  const route = (e: RelayedEvent) => {
    const org = e.organisationId;
    const env = { topic: e.topic, position: e.position, seq: e.aggregateSeq, schemaVersion: e.schemaVersion, payload: e.payload };
    if (e.topic === 'organisation.suspended') {
      // suspended by site staff: nobody stays connected (reconnecting is refused while it is suspended)
      users.in(orgRoom(org)).disconnectSockets(true);
      renderers.in(publicOrgRoom(org)).disconnectSockets(true);
      return;
    }
    if (e.topic === 'access.revoked') {
      const userId = String(e.payload.userId);
      users.in(userRoom(org, userId)).disconnectSockets(true);
      return;
    }
    if (e.aggregateType === 'match' || e.aggregateType === 'match_lease') {
      users.to(matchRoom(org, e.aggregateId)).emit('event', env);
      const pub = publicMatchPayload(e.topic, e.payload);
      if (pub) renderers.to(publicMatchRoom(e.aggregateId)).emit('event', { ...env, payload: pub });
      return;
    }
    if (e.aggregateType === 'overlay') {
      users.to(overlayRoom(org, e.aggregateId)).emit('event', env);
      if (e.topic === 'overlay.state.updated' || e.topic === 'overlay.credentials.rotated') renderers.to(publicOverlayRoom(e.aggregateId)).emit('event', env);
      if (e.topic === 'overlay.credentials.rotated') {
        // drop renderer sockets whose token version is now stale; they reconnect and are re-authenticated
        void renderers.in(publicOverlayRoom(e.aggregateId)).fetchSockets().then((ss) => ss.forEach((s) => s.disconnect(true)));
      }
      return;
    }
    users.to(opsRoom(org)).emit('event', env);
  };

  if (opts.redisUrl) {
    sub = new Redis(opts.redisUrl, { maxRetriesPerRequest: null });
    sub.subscribe(EVENTS_CHANNEL).catch((e) => b.app.log.error({ err: e.message }, 'redis subscribe failed'));
    sub.on('message', (_ch, raw) => {
      try {
        route(JSON.parse(raw) as RelayedEvent);
      } catch (e) {
        b.app.log.warn({ err: (e as Error).message }, 'bad relayed event');
      }
    });
  }

  return {
    io,
    route,
    async close() {
      await sub?.quit().catch(() => undefined);
      await new Promise<void>((r) => io.close(() => r()));
    },
  };
}
