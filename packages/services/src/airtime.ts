// Graphics on-air metering: every change of an output's state opens and closes airtime rows per cue, so a match
// report can say how long each graphic (and each sponsor creative) was on screen. Derived data: rebuilt from
// overlay state updates, never from the renderer.
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { brands, creativeSets, creatives, graphicAirtime, matches, overlays, teams, type Db, type Tx } from '@bs/db';
import type { OverlayPublicState } from '@bs/graphics';
import { assertCan } from './authz';
import { tx, type Ctx } from './context';
import type { OutboxRow } from './relay';

/** Outbox subscriber for overlay.state.updated: open rows for new cues, close rows for cues that left. */
export async function meterOverlayState(db: Db, e: OutboxRow) {
  const state = e.payload as unknown as OverlayPublicState & { layers: OverlayPublicState['layers'] };
  if (!state?.layers) return;
  const overlayId = e.aggregateId;
  const [o] = await db.select({ matchId: overlays.matchId, organisationId: overlays.organisationId }).from(overlays).where(eq(overlays.id, overlayId));
  if (!o) return;
  const now = new Date();
  const open = await db.select().from(graphicAirtime).where(and(eq(graphicAirtime.overlayId, overlayId), isNull(graphicAirtime.endedAt)));
  const live = new Map<string, { cueId: string; templateKey: string; layer: string; source: string; startedAt: number; outAt?: number | null; durationMs: number | null; sponsor?: { creativeId: string } | null }>();
  for (const [layer, cue] of Object.entries(state.layers)) {
    if (!cue) continue;
    const c = cue as unknown as { cueId: string; templateKey: string; startedAt: number; outAt?: number | null; durationMs: number | null; source: string; sponsor?: { creativeId: string } | null };
    if (layer === 'scoreboard' && !state.scorebugVisible && !c.outAt) continue;
    live.set(`${c.cueId}:${c.startedAt}`, { ...c, layer });
  }
  for (const row of open) {
    const key = `${row.cueId}:${row.startedAt.getTime()}`;
    const cue = live.get(key);
    const stillOn = cue && !cue.outAt && (cue.durationMs == null || cue.startedAt + cue.durationMs > now.getTime());
    if (stillOn) {
      live.delete(key);
      continue;
    }
    const endedAtMs = cue?.outAt ?? (cue?.durationMs != null ? Math.min(now.getTime(), cue.startedAt + cue.durationMs) : now.getTime());
    const endedAt = new Date(Math.max(endedAtMs, row.startedAt.getTime()));
    await db.update(graphicAirtime).set({ endedAt, durationMs: endedAt.getTime() - row.startedAt.getTime() }).where(eq(graphicAirtime.id, row.id));
    live.delete(key);
  }
  for (const cue of live.values()) {
    if (cue.outAt) continue;
    const startedAt = new Date(cue.startedAt);
    const planned = cue.durationMs != null ? new Date(cue.startedAt + cue.durationMs) : null;
    const alreadyOver = planned && planned.getTime() <= now.getTime();
    await db
      .insert(graphicAirtime)
      .values({ organisationId: o.organisationId, matchId: o.matchId, overlayId, cueId: cue.cueId, templateKey: cue.templateKey, layer: cue.layer, source: cue.source ?? 'operator', sponsorCreativeId: cue.sponsor?.creativeId ?? null, startedAt, endedAt: alreadyOver ? planned : null, durationMs: alreadyOver && planned ? planned.getTime() - startedAt.getTime() : null })
      .onConflictDoNothing();
  }
}

/** Housekeeping: close rows whose cue had a fixed hold and has run out (no later state update arrived). */
export async function closeExpiredAirtime(db: Db) {
  const stale = await db.select().from(graphicAirtime).where(and(isNull(graphicAirtime.endedAt), lte(graphicAirtime.startedAt, new Date(Date.now() - 6 * 3600_000))));
  for (const r of stale) {
    const endedAt = new Date(r.startedAt.getTime() + 6 * 3600_000);
    await db.update(graphicAirtime).set({ endedAt, durationMs: endedAt.getTime() - r.startedAt.getTime() }).where(eq(graphicAirtime.id, r.id));
  }
  return stale.length;
}

/** "Home v Away" and the kick-off of each match, so report rows name the match rather than its id. */
export async function matchLabels(t: Tx, organisationId: string, ids: string[]) {
  const out = new Map<string, { label: string; scheduledAt: string }>();
  if (!ids.length) return out;
  const ms = await t.select({ id: matches.id, home: matches.homeTeamId, away: matches.awayTeamId, scheduledAt: matches.scheduledAt }).from(matches).where(and(eq(matches.organisationId, organisationId), inArray(matches.id, [...new Set(ids)])));
  const teamIds = [...new Set(ms.flatMap((m) => [m.home, m.away]))];
  const names = new Map((teamIds.length ? await t.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.organisationId, organisationId), inArray(teams.id, teamIds))) : []).map((x) => [x.id, x.name]));
  for (const m of ms) out.set(m.id, { label: `${names.get(m.home) ?? 'Home'} v ${names.get(m.away) ?? 'Away'}`, scheduledAt: m.scheduledAt.toISOString() });
  return out;
}

export interface AirtimeReport {
  totals: { graphics: number; seconds: number };
  byTemplate: { key: string; count: number; seconds: number }[];
  /** key: "Home v Away" */
  byMatch: { key: string; matchId: string; scheduledAt: string | null; count: number; seconds: number }[];
  /** key: "Brand · creative" */
  bySponsorCreative: { key: string; count: number; seconds: number }[];
  bySource: { key: string; count: number; seconds: number }[];
}

export async function airtimeReport(ctx: Ctx, q: { from?: string; to?: string; competitionId?: string; matchId?: string } = {}): Promise<AirtimeReport> {
  assertCan(ctx.actor, 'reports.read');
  return tx(ctx, async (t) => {
    const conds = [eq(graphicAirtime.organisationId, ctx.actor.organisationId)];
    if (q.from) conds.push(gte(graphicAirtime.startedAt, new Date(q.from)));
    if (q.to) conds.push(lte(graphicAirtime.startedAt, new Date(q.to)));
    if (q.matchId) conds.push(eq(graphicAirtime.matchId, q.matchId));
    if (q.competitionId) conds.push(eq(matches.competitionId, q.competitionId));
    const rows = await t
      .select({ a: graphicAirtime, round: matches.round, home: matches.homeTeamId, away: matches.awayTeamId, scheduledAt: matches.scheduledAt, isDemo: matches.isDemo })
      .from(graphicAirtime)
      .innerJoin(matches, eq(matches.id, graphicAirtime.matchId))
      .where(and(...conds))
      .orderBy(asc(graphicAirtime.startedAt));
    const now = Date.now();
    const seconds = (r: typeof graphicAirtime.$inferSelect) => Math.round(((r.endedAt ?? new Date(now)).getTime() - r.startedAt.getTime()) / 1000);
    const group = (key: (r: (typeof rows)[number]) => string | null) => {
      const m = new Map<string, { key: string; count: number; seconds: number }>();
      for (const r of rows) {
        if (r.isDemo) continue;
        const k = key(r);
        if (!k) continue;
        const cur = m.get(k) ?? { key: k, count: 0, seconds: 0 };
        cur.count++;
        cur.seconds += seconds(r.a);
        m.set(k, cur);
      }
      return [...m.values()].sort((x, y) => y.seconds - x.seconds);
    };
    const real = rows.filter((r) => !r.isDemo);
    const org = ctx.actor.organisationId;
    const labels = await matchLabels(t, org, real.map((r) => r.a.matchId));
    const creativeIds = [...new Set(real.map((r) => r.a.sponsorCreativeId).filter((x): x is string => !!x))];
    const creativeNames = new Map(
      (creativeIds.length
        ? await t.select({ id: creatives.id, name: creatives.name, brand: brands.name }).from(creatives).innerJoin(creativeSets, eq(creativeSets.id, creatives.creativeSetId)).innerJoin(brands, eq(brands.id, creativeSets.brandId)).where(and(eq(creatives.organisationId, org), inArray(creatives.id, creativeIds)))
        : []
      ).map((c) => [c.id, `${c.brand} · ${c.name}`]),
    );
    return {
      totals: { graphics: real.length, seconds: real.reduce((a, r) => a + seconds(r.a), 0) },
      byTemplate: group((r) => r.a.templateKey.replace('builtin:', '')),
      byMatch: group((r) => r.a.matchId).map((g) => ({ ...g, matchId: g.key, key: labels.get(g.key)?.label ?? 'Deleted match', scheduledAt: labels.get(g.key)?.scheduledAt ?? null })),
      bySponsorCreative: group((r) => (r.a.sponsorCreativeId ? creativeNames.get(r.a.sponsorCreativeId) ?? 'Removed artwork' : null)),
      bySource: group((r) => r.a.source),
    };
  });
}

/** Recent airtime rows for one match (the match page's "what was on air" list). */
export async function matchAirtime(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) return [];
    assertCan(ctx.actor, 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    return t.select().from(graphicAirtime).where(eq(graphicAirtime.matchId, matchId)).orderBy(desc(graphicAirtime.startedAt)).limit(200);
  });
}

export const _sql = sql;
