// A demo match that scores itself: the worker walks the sport's rehearsal timeline through the real scoring
// service (system actor, no lease), so the scorebug, graphics, automation and reports behave exactly as on a
// real match day. Demo matches are flagged and excluded from tables and sponsor reports.
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { competitions, demoRuns, matchLineups, matchState, matches, seasons, teams, type Db } from '@bs/db';
import { getAdapter, syntheticTimeline, type LineupSnapshot, type MatchProjection, type Sport } from '@bs/domain';
import { z } from 'zod';
import type { AppConfig } from '@bs/config';
import { assertCan, type Actor } from './authz';
import { audit } from './audit';
import { conflict, invalid, notFound } from './errors';
import { tx, type Ctx } from './context';
import { createMatchTx } from './matches';
import { handleMatchCommand } from './scoring';

export const demoInput = z.object({ competitionId: z.string().uuid(), speed: z.number().int().min(1).max(20).default(2) });

/** Create (or reuse) a demo match in the competition and start the runner. */
export async function startDemo(ctx: Ctx, input: z.input<typeof demoInput>) {
  assertCan(ctx.actor, 'competition.write');
  const d = demoInput.parse(input);
  return tx(ctx, async (t) => {
    const [comp] = await t.select().from(competitions).where(and(eq(competitions.id, d.competitionId), eq(competitions.organisationId, ctx.actor.organisationId)));
    if (!comp) throw notFound('Competition');
    const [season] = await t.select().from(seasons).where(and(eq(seasons.competitionId, comp.id), eq(seasons.status, 'active'))).orderBy(asc(seasons.createdAt)).limit(1);
    if (!season) throw invalid('Create a season for this competition first', [{ field: 'competitionId', message: 'No active season' }]);
    const ts = await t.select().from(teams).where(and(eq(teams.organisationId, ctx.actor.organisationId), eq(teams.sport, comp.sport), eq(teams.status, 'active'))).limit(2);
    if (ts.length < 2) throw invalid(`Two ${comp.sport.replace('_', ' ')} teams are needed for a demo`, [{ field: 'competitionId', message: 'Not enough teams' }]);
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: comp.defaultTimezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + 60_000)).replace(',', '');
    const m = await createMatchTx(ctx, t, { competitionId: comp.id, seasonId: season.id, homeTeamId: ts[0]!.id, awayTeamId: ts[1]!.id, round: 'Demo', kickoffLocal: local, timezone: comp.defaultTimezone, isDemo: true });
    await t.insert(demoRuns).values({ matchId: m.id, organisationId: ctx.actor.organisationId, status: 'running', step: 0, speed: d.speed, nextAt: new Date(Date.now() + 3000), startedBy: ctx.actor.userId });
    await audit(t, ctx.actor, 'demo.start', 'match', m.id, { after: { speed: d.speed } });
    return { matchId: m.id, steps: syntheticTimeline(comp.sport as Sport).length };
  });
}

export async function controlDemo(ctx: Ctx, matchId: string, action: 'pause' | 'resume' | 'stop') {
  assertCan(ctx.actor, 'competition.write');
  return tx(ctx, async (t) => {
    const [r] = await t.select().from(demoRuns).where(and(eq(demoRuns.matchId, matchId), eq(demoRuns.organisationId, ctx.actor.organisationId)));
    if (!r) throw notFound('Demo');
    if (r.status === 'finished' && action !== 'stop') throw conflict('DEMO_FINISHED', 'This demo has finished');
    const status = action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'stopped';
    await t.update(demoRuns).set({ status, nextAt: new Date(), updatedAt: new Date() }).where(eq(demoRuns.matchId, matchId));
    return { ok: true, status };
  });
}

export async function listDemos(ctx: Ctx) {
  assertCan(ctx.actor, 'competition.read');
  return tx(ctx, (t) => t.select().from(demoRuns).where(eq(demoRuns.organisationId, ctx.actor.organisationId)).orderBy(asc(demoRuns.startedAt)));
}

const systemActor = (organisationId: string): Actor => ({ kind: 'system', userId: null, organisationId, membershipId: null, role: 'system', grants: [], accessVersion: 0 });

/** Worker loop (every second): advance every running demo whose next step is due. */
export async function demoTick(d: { db: Db; config: AppConfig }) {
  const due = await d.db.select().from(demoRuns).where(and(eq(demoRuns.status, 'running'), lte(demoRuns.nextAt, new Date()))).limit(10);
  for (const run of due) {
    try {
      await advance(d, run);
    } catch (e) {
      await d.db.update(demoRuns).set({ status: 'stopped', updatedAt: new Date() }).where(eq(demoRuns.matchId, run.matchId));
      console.error('[demo] stopped', run.matchId, e instanceof Error ? e.message : e);
    }
  }
  return due.length;
}

async function advance(d: { db: Db; config: AppConfig }, run: typeof demoRuns.$inferSelect) {
  const [m] = await d.db.select().from(matches).where(eq(matches.id, run.matchId));
  if (!m || ['completed', 'abandoned', 'cancelled'].includes(m.status)) {
    await d.db.update(demoRuns).set({ status: 'finished', updatedAt: new Date() }).where(eq(demoRuns.matchId, run.matchId));
    return;
  }
  const timeline = syntheticTimeline(m.sport as Sport);
  const entry = timeline[run.step];
  if (!entry) {
    await d.db.update(demoRuns).set({ status: 'finished', updatedAt: new Date() }).where(eq(demoRuns.matchId, run.matchId));
    return;
  }
  const ctx: Ctx = { db: d.db, config: d.config, actor: systemActor(m.organisationId) };
  const [st] = await d.db.select().from(matchState).where(eq(matchState.matchId, m.id));
  const [lu] = await d.db.select().from(matchLineups).where(eq(matchLineups.matchId, m.id));
  const lineup = lu?.snapshot as unknown as LineupSnapshot | undefined;
  const proj = st!.projection as unknown as MatchProjection;
  const adapter = getAdapter(m.sport);
  const envelope = (type: string, payload: Record<string, unknown>) => ({ commandId: crypto.randomUUID(), expectedStateVersion: st!.stateVersion, deviceId: 'demo-runner', type, payload });
  if (entry.kind === 'phase') {
    const allowed = adapter.allowedTransitions(m.rulesConfig as never, proj);
    if (allowed.includes(entry.phase!)) await handleMatchCommand(ctx, m.id, envelope('SET_PHASE', { to: entry.phase }), 'api');
  } else if (entry.kind === 'event') {
    const side = entry.side ?? 'home';
    const def = adapter.eventTypes(m.rulesConfig as never).find((e) => e.type === entry.type);
    const pool = (lineup?.[side] ?? []).filter((p) => p.starter);
    const player = def && def.playerField !== 'none' && pool.length ? pool[(run.step * 7) % pool.length]!.playerId : null;
    const payload: Record<string, unknown> = { ...(entry.payload ?? {}) };
    if (entry.type === 'substitution' || entry.type === 'interchange') {
      const bench = (lineup?.[side] ?? []).filter((p) => !p.starter);
      if (pool.length && bench.length) Object.assign(payload, { playerOutId: pool[(run.step * 3) % pool.length]!.playerId, playerInId: bench[run.step % bench.length]!.playerId });
    }
    try {
      await handleMatchCommand(ctx, m.id, envelope('ADD_FACT', { type: entry.type, side, playerId: player, payload, occurredAt: Date.now() }), 'api');
    } catch (e) {
      // an event the rules refuse at this moment (e.g. no timeouts left) is simply skipped
      console.warn('[demo] skipped', entry.type, e instanceof Error ? e.message : e);
    }
  }
  const next = timeline[run.step + 1];
  const waitMs = next ? Math.max(1500, (next.t - entry.t) / run.speed) : 0;
  await d.db.update(demoRuns).set({ step: run.step + 1, status: next ? 'running' : 'finished', nextAt: new Date(Date.now() + waitMs), updatedAt: new Date() }).where(eq(demoRuns.matchId, run.matchId));
}

export const _demo = { inArray };
