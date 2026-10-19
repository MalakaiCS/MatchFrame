// Authoritative match command handler (spec §18.1) and scorer lease (§8.5).
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  factCorrections,
  idempotencyRecords,
  matchFacts,
  matchLineups,
  matchState,
  matches,
  outboxEvents,
  scorerLeases,
  users,
  type Tx,
} from '@bs/db';
import {
  applyCommand,
  commandPayloadSchemas,
  DomainError,
  getAdapter,
  type CommandType,
  type LineupSnapshot,
  type MatchProjection,
  type StoredFact,
} from '@bs/domain';
import type { ClockState } from '@bs/domain';
import { z } from 'zod';
import { assertCan, can } from './authz';
import { audit } from './audit';
import { intentHash } from './crypto';
import { AppError, conflict, forbidden, notFound } from './errors';
import { nowMs, tx, type Ctx } from './context';
import { enqueueOutbox } from './outbox';

export const LEASE_MS = 30_000;

export const commandEnvelope = z.object({
  commandId: z.string().uuid(),
  expectedStateVersion: z.number().int().min(0),
  scorerLeaseVersion: z.number().int().min(0).optional(),
  deviceId: z.string().min(4).max(80),
  type: z.enum(Object.keys(commandPayloadSchemas) as [CommandType, ...CommandType[]]),
  payload: z.unknown(),
  /** set by offline sync: the scorer reviewed this intent after reconnecting */
  offline: z.object({ queuedAt: z.number().int(), reviewed: z.boolean().optional() }).optional(),
});
export type CommandEnvelope = z.infer<typeof commandEnvelope>;

export interface AcceptedMatchEvent {
  eventId: string;
  organisationId: string;
  matchId: string;
  sequence: number;
  stateVersion: number;
  type: string;
  occurredAt: string;
  acceptedAt: string;
  payload: Record<string, unknown>;
}

export interface CommandResponse {
  accepted: true;
  commandId: string;
  event: AcceptedMatchEvent;
  state: { stateVersion: number; sequence: number; phase: string; projection: MatchProjection; clocks: Record<string, ClockState> };
  replayed?: boolean;
}

const factRowToStored = (f: typeof matchFacts.$inferSelect): StoredFact => ({
  id: f.id,
  sequence: f.sequence,
  category: f.category as StoredFact['category'],
  type: f.type,
  side: f.side as StoredFact['side'],
  playerId: f.playerId,
  payload: f.payload,
  periodId: f.periodId,
  clockMs: f.clockMs,
  occurredAt: f.occurredAt.getTime(),
  revision: f.revision,
  voided: f.voided,
});

function matchStatusFor(adapter: ReturnType<typeof getAdapter>, cfg: never, phase: string, current: string): string {
  const kind = adapter.phase(cfg, phase)?.kind;
  if (phase === 'postponed') return 'postponed';
  if (phase === 'cancelled') return 'cancelled';
  if (phase === 'abandoned') return 'abandoned';
  if (kind === 'final') return 'completed';
  if (kind === 'play' || kind === 'break') return 'live';
  if (kind === 'pre' && current === 'postponed') return 'scheduled';
  return current === 'archived' ? current : kind === 'pre' ? 'scheduled' : current;
}

/** Strip concurrency metadata: the semantic intent is (type, payload). */
const hashOf = (env: CommandEnvelope) => intentHash(env.type, env.payload);

export async function handleMatchCommand(ctx: Ctx, matchId: string, input: unknown, source: 'scorer' | 'producer' | 'offline_sync' | 'api' | 'rehearsal' = 'scorer'): Promise<CommandResponse> {
  const env = commandEnvelope.parse(input);
  const now = nowMs(ctx);
  const hash = hashOf(env);
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'match.score', { matchId: m.id, competitionId: m.competitionId }, 'You are not assigned to score this match');

    // 1. serialise on the match row (compare-and-swap on state_version below)
    const [state] = await t.select().from(matchState).where(eq(matchState.matchId, matchId)).for('update');
    if (!state) throw notFound('Match state');

    // 2. idempotency (checked after the lock so a concurrent duplicate sees the committed original)
    const scope = `match:${matchId}`;
    const [prior] = await t
      .select()
      .from(idempotencyRecords)
      .where(and(eq(idempotencyRecords.organisationId, ctx.actor.organisationId), eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.key, env.commandId)));
    if (prior) {
      if (prior.intentHash !== hash || prior.commandType !== env.type) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This command ID was already used for a different command');
      }
      return { ...(prior.response as unknown as CommandResponse), replayed: true };
    }

    // 3. optimistic version
    if (env.expectedStateVersion !== state.stateVersion) {
      throw new AppError('STATE_VERSION_CONFLICT', 409, 'The match changed since this command was prepared', undefined, {
        currentVersion: state.stateVersion,
        currentSequence: state.sequence,
      });
    }

    // 4. scorer authority (fenced lease)
    const [lease] = await t.select().from(scorerLeases).where(eq(scorerLeases.matchId, matchId)).for('update');
    const leaseOk =
      lease &&
      lease.holderUserId === ctx.actor.userId &&
      lease.holderDeviceId === env.deviceId &&
      lease.leaseVersion === env.scorerLeaseVersion &&
      lease.expiresAt &&
      lease.expiresAt.getTime() > now;
    if (!leaseOk && ctx.actor.kind !== 'system') {
      const heldByOther = lease?.holderUserId && lease.expiresAt && lease.expiresAt.getTime() > now && (lease.holderUserId !== ctx.actor.userId || lease.holderDeviceId !== env.deviceId);
      throw new AppError(heldByOther ? 'LEASE_HELD_BY_OTHER' : 'LEASE_REQUIRED', 409, heldByOther ? 'Another scorer currently controls this match' : 'Scoring authority expired. Renew the scorer lease and review pending actions.', undefined, {
        leaseVersion: lease?.leaseVersion ?? 0,
        takenOverFrom: lease?.takenOverFrom ?? null,
      });
    }

    // 5. rules
    const adapter = getAdapter(m.sport);
    const cfg = m.rulesConfig as never;
    const needsLog = env.type === 'VOID_FACT' || env.type === 'CORRECT_FACT';
    const log = needsLog ? (await t.select().from(matchFacts).where(eq(matchFacts.matchId, matchId)).orderBy(asc(matchFacts.sequence))).map(factRowToStored) : [];
    const [lineupRow] = await t.select().from(matchLineups).where(eq(matchLineups.matchId, matchId));
    let result;
    try {
      result = applyCommand(
        adapter,
        cfg,
        { projection: state.projection as unknown as MatchProjection, clocks: state.clocks as unknown as Record<string, ClockState>, sequence: state.sequence },
        log,
        env.type,
        env.payload,
        now,
        (lineupRow?.snapshot as unknown as LineupSnapshot) ?? null,
      );
    } catch (e) {
      if (e instanceof DomainError) throw new AppError(e.code, e.status, e.message, e.field ? [{ field: e.field, message: e.message }] : undefined);
      throw e;
    }

    const freshness = ctx.config.LIVE_EVENT_FRESHNESS_MS;
    const newVersion = state.stateVersion + 1;
    const acceptedAt = new Date(now);
    let event: AcceptedMatchEvent;
    const outbox: Parameters<typeof enqueueOutbox>[1] = [];
    const base = { organisationId: ctx.actor.organisationId, aggregateType: 'match', aggregateId: matchId, aggregateSeq: newVersion };

    if (result.kind === 'append') {
      const e = result.entry;
      const historical = now - e.occurredAt > freshness;
      const teamId = e.side === 'home' ? m.homeTeamId : e.side === 'away' ? m.awayTeamId : null;
      const [row] = await t
        .insert(matchFacts)
        .values({
          organisationId: ctx.actor.organisationId,
          matchId,
          sequence: e.sequence,
          category: e.category,
          type: e.type,
          side: e.side ?? null,
          teamId,
          playerId: e.playerId ?? null,
          payload: e.payload,
          periodId: e.periodId,
          clockMs: e.clockMs ?? null,
          occurredAt: new Date(e.occurredAt),
          acceptedAt,
          source: env.offline ? 'offline_sync' : source,
          actorUserId: ctx.actor.userId,
          deviceId: env.deviceId,
          commandId: env.commandId,
          revision: 1,
          historical,
        })
        .returning();
      event = {
        eventId: row!.id,
        organisationId: ctx.actor.organisationId,
        matchId,
        sequence: e.sequence,
        stateVersion: newVersion,
        type: e.category === 'event' ? e.type : e.category === 'phase' ? 'phase_change' : 'score_adjustment',
        occurredAt: new Date(e.occurredAt).toISOString(),
        acceptedAt: acceptedAt.toISOString(),
        payload: { ...e.payload, side: e.side, playerId: e.playerId, teamId, periodId: e.periodId, clockMs: e.clockMs, category: e.category, historical, revision: 1 },
      };
      if (e.category === 'event') outbox.push({ ...base, topic: 'match.fact.accepted', payload: event as never });
      if (e.category === 'adjustment') {
        outbox.push({ ...base, topic: 'match.score.adjusted', payload: event as never });
        await audit(t, ctx.actor, 'match.score_adjust', 'match', matchId, { before: e.payload.from as object, after: e.payload.to as object, reason: String(e.payload.reason ?? '') });
      }
      if (result.phaseChanged) {
        outbox.push({ ...base, topic: 'match.phase.changed', payload: { ...event, from: result.phaseChanged.from, to: result.phaseChanged.to } as never });
        await audit(t, ctx.actor, 'match.phase', 'match', matchId, { before: { phase: result.phaseChanged.from }, after: { phase: result.phaseChanged.to } });
      }
    } else if (result.kind === 'correction') {
      const before = log.find((f) => f.id === result.factId)!;
      await t.update(matchFacts).set({ voided: !!result.updated.voided, side: result.updated.side ?? null, playerId: result.updated.playerId ?? null, payload: result.updated.payload, revision: result.updated.revision, teamId: result.updated.side === 'home' ? m.homeTeamId : result.updated.side === 'away' ? m.awayTeamId : null }).where(eq(matchFacts.id, result.factId));
      const [corr] = await t
        .insert(factCorrections)
        .values({
          organisationId: ctx.actor.organisationId,
          matchId,
          factId: result.factId,
          kind: result.correction,
          fromRevision: before.revision,
          toRevision: result.updated.revision,
          before: before as never,
          after: result.updated as never,
          reason: result.reason,
          actorUserId: ctx.actor.userId,
          commandId: env.commandId,
        })
        .returning();
      event = {
        eventId: corr!.id,
        organisationId: ctx.actor.organisationId,
        matchId,
        sequence: state.sequence,
        stateVersion: newVersion,
        type: result.correction === 'void' ? 'fact_voided' : 'fact_corrected',
        occurredAt: acceptedAt.toISOString(),
        acceptedAt: acceptedAt.toISOString(),
        payload: { factId: result.factId, factType: before.type, fromRevision: before.revision, toRevision: result.updated.revision, reason: result.reason, after: result.updated as never },
      };
      outbox.push({ ...base, topic: 'match.fact.corrected', payload: event as never });
      await audit(t, ctx.actor, result.correction === 'void' ? 'match_fact.void' : 'match_fact.correct', 'match_fact', result.factId, { before, after: result.updated, reason: result.reason });
    } else {
      const p = env.payload as { action: string; clockId: string; ms?: number; reason?: string };
      event = {
        eventId: env.commandId,
        organisationId: ctx.actor.organisationId,
        matchId,
        sequence: state.sequence,
        stateVersion: newVersion,
        type: 'clock_action',
        occurredAt: acceptedAt.toISOString(),
        acceptedAt: acceptedAt.toISOString(),
        payload: { clockId: result.clockId, action: p.action, clock: result.state.clocks[result.clockId] as never },
      };
      if (p.action === 'set') await audit(t, ctx.actor, 'match.clock_correct', 'match', matchId, { before: state.clocks[result.clockId as keyof typeof state.clocks] as object, after: { ms: p.ms }, reason: p.reason });
    }

    const clocksChanged = JSON.stringify(result.state.clocks) !== JSON.stringify(state.clocks);
    const newStatus = matchStatusFor(adapter, cfg, result.state.projection.phase, m.status);
    await t
      .update(matchState)
      .set({ stateVersion: newVersion, sequence: result.state.sequence, phase: result.state.projection.phase, projection: result.state.projection as never, clocks: result.state.clocks as never, updatedAt: acceptedAt })
      .where(and(eq(matchState.matchId, matchId), eq(matchState.stateVersion, state.stateVersion)));
    if (newStatus !== m.status) await t.update(matches).set({ status: newStatus, updatedAt: acceptedAt }).where(eq(matches.id, matchId));

    const snapshot = { stateVersion: newVersion, sequence: result.state.sequence, phase: result.state.projection.phase, projection: result.state.projection, clocks: result.state.clocks };
    if (clocksChanged) outbox.push({ ...base, topic: 'clock.anchor.updated', payload: { matchId, stateVersion: newVersion, clocks: result.state.clocks as never, serverNow: now } });
    outbox.push({ ...base, topic: 'match.state.updated', payload: { matchId, ...snapshot, status: newStatus, serverNow: now } as never });
    await enqueueOutbox(t, outbox);

    const response: CommandResponse = { accepted: true, commandId: env.commandId, event: event!, state: snapshot };
    await t.insert(idempotencyRecords).values({
      organisationId: ctx.actor.organisationId,
      scope,
      key: env.commandId,
      intentHash: hash,
      commandType: env.type,
      response: response as never,
      statusCode: 200,
    });
    return response;
  });
}

// ------------------------------------------------------------------ state & history

export async function getMatchState(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'competition.read', { matchId, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const [s] = await t.select().from(matchState).where(eq(matchState.matchId, matchId));
    const adapter = getAdapter(m.sport);
    const now = nowMs(ctx);
    return {
      matchId,
      sport: m.sport,
      status: m.status,
      stateVersion: s!.stateVersion,
      sequence: s!.sequence,
      phase: s!.phase,
      projection: s!.projection,
      clocks: s!.clocks,
      display: adapter.display(m.rulesConfig as never, s!.projection as never, s!.clocks as never, now),
      allowedTransitions: adapter.allowedTransitions(m.rulesConfig as never, s!.projection as never),
      serverNow: now,
    };
  });
}

export async function listFacts(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'competition.read', { matchId, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const facts = await t
      .select({ f: matchFacts, actorName: users.name })
      .from(matchFacts)
      .leftJoin(users, eq(users.id, matchFacts.actorUserId))
      .where(eq(matchFacts.matchId, matchId))
      .orderBy(asc(matchFacts.sequence));
    const corrections = await t.select().from(factCorrections).where(eq(factCorrections.matchId, matchId)).orderBy(asc(factCorrections.createdAt));
    return facts.map(({ f, actorName }) => ({ ...f, actorName, corrections: corrections.filter((c) => c.factId === f.id) }));
  });
}

/** Sequence-based resume: realtime events after a known state version, or a snapshot instruction. */
export async function listMatchEvents(ctx: Ctx, matchId: string, afterVersion: number) {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'competition.read', { matchId, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const rows = await t
      .select({ topic: outboxEvents.topic, seq: outboxEvents.aggregateSeq, payload: outboxEvents.payload, position: outboxEvents.position })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.aggregateType, 'match'), eq(outboxEvents.aggregateId, matchId), gt(outboxEvents.aggregateSeq, afterVersion)))
      .orderBy(asc(outboxEvents.position))
      .limit(501);
    if (rows.length > 500) return { snapshotRequired: true as const, events: [] };
    return { snapshotRequired: false as const, events: rows.map((r) => ({ topic: r.topic, stateVersion: r.seq, payload: r.payload })) };
  });
}

// ------------------------------------------------------------------ scorer lease

async function leaseResponse(t: Tx, matchId: string) {
  const [l] = await t.select({ l: scorerLeases, name: users.name }).from(scorerLeases).leftJoin(users, eq(users.id, scorerLeases.holderUserId)).where(eq(scorerLeases.matchId, matchId));
  return l ? { holderUserId: l.l.holderUserId, holderName: l.name, holderDeviceId: l.l.holderDeviceId, leaseVersion: l.l.leaseVersion, expiresAt: l.l.expiresAt, takenOverFrom: l.l.takenOverFrom, takeoverReason: l.l.takeoverReason } : null;
}

async function loadForLease(ctx: Ctx, t: Tx, matchId: string) {
  const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
  if (!m) throw notFound('Match');
  assertCan(ctx.actor, 'match.score', { matchId, competitionId: m.competitionId }, 'You are not assigned to score this match');
  const [lease] = await t.select().from(scorerLeases).where(eq(scorerLeases.matchId, matchId)).for('update');
  return { m, lease: lease! };
}

export const leaseInput = z.object({
  action: z.enum(['acquire', 'renew', 'release', 'takeover']),
  deviceId: z.string().min(4).max(80),
  leaseVersion: z.number().int().optional(),
  reason: z.string().trim().max(300).optional(),
});

export async function scorerLease(ctx: Ctx, matchId: string, input: z.input<typeof leaseInput>) {
  const d = leaseInput.parse(input);
  const now = nowMs(ctx);
  return tx(ctx, async (t) => {
    const { lease } = await loadForLease(ctx, t, matchId);
    const active = lease.holderUserId && lease.expiresAt && lease.expiresAt.getTime() > now;
    const mine = lease.holderUserId === ctx.actor.userId && lease.holderDeviceId === d.deviceId;
    const exp = new Date(now + LEASE_MS);
    let changed = false;
    switch (d.action) {
      case 'acquire':
        // Another user's live lease blocks; the same user moving to a new tab/device takes over and fences the old one.
        if (active && !mine && lease.holderUserId !== ctx.actor.userId) throw new AppError('LEASE_HELD_BY_OTHER', 409, 'Another scorer currently controls this match', undefined, { lease: await leaseResponse(t, matchId) });
        // re-acquire by the same device after expiry or refresh bumps the fence so stale tabs lose authority
        await t.update(scorerLeases).set({ holderUserId: ctx.actor.userId, holderDeviceId: d.deviceId, leaseVersion: sql`${scorerLeases.leaseVersion} + 1`, expiresAt: exp, takenOverFrom: null, takeoverReason: null, updatedAt: new Date(now) }).where(eq(scorerLeases.matchId, matchId));
        changed = true;
        break;
      case 'renew':
        if (!mine || d.leaseVersion !== lease.leaseVersion) throw new AppError('LEASE_LOST', 409, 'Scoring authority was taken over or expired', undefined, { lease: await leaseResponse(t, matchId) });
        if (!active) throw new AppError('LEASE_EXPIRED', 409, 'Scoring authority expired; acquire it again and review pending actions', undefined, { lease: await leaseResponse(t, matchId) });
        await t.update(scorerLeases).set({ expiresAt: exp, updatedAt: new Date(now) }).where(eq(scorerLeases.matchId, matchId));
        break;
      case 'release':
        if (mine && d.leaseVersion === lease.leaseVersion) {
          await t.update(scorerLeases).set({ holderUserId: null, holderDeviceId: null, expiresAt: null, leaseVersion: sql`${scorerLeases.leaseVersion} + 1`, updatedAt: new Date(now) }).where(eq(scorerLeases.matchId, matchId));
          changed = true;
        }
        break;
      case 'takeover': {
        const producer = can(ctx.actor, 'competition.write') || can(ctx.actor, 'overlay.operate', { matchId });
        if (!producer) throw forbidden('Only a producer can take over scoring');
        if (!d.reason) throw new AppError('REASON_REQUIRED', 422, 'Give a reason for taking over', [{ field: 'reason', message: 'Required' }]);
        await t
          .update(scorerLeases)
          .set({ holderUserId: ctx.actor.userId, holderDeviceId: d.deviceId, leaseVersion: sql`${scorerLeases.leaseVersion} + 1`, expiresAt: exp, takenOverFrom: lease.holderUserId, takeoverReason: d.reason, updatedAt: new Date(now) })
          .where(eq(scorerLeases.matchId, matchId));
        await audit(t, ctx.actor, 'scorer_lease.takeover', 'scorer_lease', matchId, { before: { holder: lease.holderUserId, version: lease.leaseVersion }, reason: d.reason });
        changed = true;
        break;
      }
    }
    const res = await leaseResponse(t, matchId);
    if (changed) await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'scorer.lease.changed', aggregateType: 'match_lease', aggregateId: matchId, payload: { matchId, lease: res as never } });
    return res;
  });
}
