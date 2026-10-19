// Sponsors: brands, creative sets, creatives, campaigns, allocations, decisions, delivery evidence, reports.
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import {
  allocations,
  brands,
  campaigns,
  creativeSets,
  creatives,
  matches,
  mediaAssets,
  overlays,
  rendererSessions,
  sponsorDecisions,
  sponsorExposures,
  withTenant,
  type Db,
  type Tx,
} from '@bs/db';
import { selectCreative, toCsv, type Placement, type SelectionResult, type SponsorAllocation, type SponsorCampaign, type SponsorCreative } from '@bs/domain';
import type { RenderCreative } from '@bs/graphics';
import type { AppConfig } from '@bs/config';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { invalid, notFound } from './errors';
import { nowMs, tx, type Ctx } from './context';
import { signedAssetUrl, type RendererScope } from './overlays';

export const PLACEMENTS = ['scorebug_logo', 'lower_third_banner', 'event_partner', 'detached_logo', 'full_frame_image', 'full_frame_video', 'clip_intro', 'clip_outro'] as const;

// ------------------------------------------------------------------ CRUD
export async function listSponsorData(ctx: Ctx) {
  assertCan(ctx.actor, 'org.read');
  return tx(ctx, async (t) => {
    const org = ctx.actor.organisationId;
    const [bs, sets, crs, cps, als] = await Promise.all([
      t.select().from(brands).where(eq(brands.organisationId, org)).orderBy(asc(brands.name)),
      t.select().from(creativeSets).where(eq(creativeSets.organisationId, org)),
      t.select({ c: creatives, a: mediaAssets }).from(creatives).innerJoin(mediaAssets, eq(mediaAssets.id, creatives.assetId)).where(eq(creatives.organisationId, org)),
      t.select().from(campaigns).where(eq(campaigns.organisationId, org)).orderBy(desc(campaigns.startsAt)),
      t.select().from(allocations).where(eq(allocations.organisationId, org)),
    ]);
    return {
      brands: bs.map((b) => ({
        ...b,
        creativeSets: sets.filter((s) => s.brandId === b.id).map((s) => ({ ...s, creatives: crs.filter((c) => c.c.creativeSetId === s.id).map((c) => ({ ...c.c, assetState: c.a.state, url: c.a.state === 'READY' ? signedAssetUrl(ctx.config, org, c.a.id, 3600) : null })) })),
      })),
      campaigns: cps.map((c) => ({ ...c, allocations: als.filter((a) => a.campaignId === c.id) })),
    };
  });
}

export const brandInput = z.object({ name: z.string().trim().min(1).max(80), category: z.string().trim().max(40).nullable().optional() });
export async function createBrand(ctx: Ctx, input: z.input<typeof brandInput>) {
  assertCan(ctx.actor, 'sponsor.manage');
  const d = brandInput.parse(input);
  return tx(ctx, async (t) => {
    const [b] = await t.insert(brands).values({ organisationId: ctx.actor.organisationId, name: d.name, category: d.category ?? null }).returning();
    const [s] = await t.insert(creativeSets).values({ organisationId: ctx.actor.organisationId, brandId: b!.id, name: `${d.name} creatives` }).returning();
    await audit(t, ctx.actor, 'brand.create', 'brand', b!.id, { after: d });
    return { ...b!, creativeSetId: s!.id };
  });
}

export const creativeInput = z.object({ creativeSetId: z.string().uuid(), assetId: z.string().uuid(), name: z.string().trim().min(1).max(80), expiresAt: z.string().datetime().nullable().optional() });
export async function addCreative(ctx: Ctx, input: z.input<typeof creativeInput>) {
  assertCan(ctx.actor, 'sponsor.manage');
  const d = creativeInput.parse(input);
  return tx(ctx, async (t) => {
    const [a] = await t.select().from(mediaAssets).where(and(eq(mediaAssets.id, d.assetId), eq(mediaAssets.organisationId, ctx.actor.organisationId)));
    if (!a) throw notFound('Asset');
    if (a.state !== 'READY') throw invalid('The asset is still processing or failed validation', [{ field: 'assetId', message: `Asset state: ${a.state}` }]);
    if (!['image', 'logo', 'video'].includes(a.kind)) throw invalid('Creatives must be images or videos');
    const [c] = await t
      .insert(creatives)
      .values({ organisationId: ctx.actor.organisationId, creativeSetId: d.creativeSetId, assetId: a.id, name: d.name, kind: a.kind === 'video' ? 'video' : a.width && a.height && a.width / a.height > 2.5 ? 'banner' : 'image', width: a.width, height: a.height, aspectRatio: a.width && a.height ? a.width / a.height : null, mimeType: a.detectedMime, durationMs: a.durationMs, approvalStatus: 'pending', expiresAt: d.expiresAt ? new Date(d.expiresAt) : null })
      .returning();
    await audit(t, ctx.actor, 'creative.create', 'creative', c!.id, { after: { name: d.name } });
    return c!;
  });
}

export async function setCreativeApproval(ctx: Ctx, id: string, status: 'approved' | 'rejected' | 'pending') {
  assertCan(ctx.actor, 'sponsor.manage');
  return tx(ctx, async (t) => {
    const [c] = await t.update(creatives).set({ approvalStatus: status, updatedAt: new Date() }).where(and(eq(creatives.id, id), eq(creatives.organisationId, ctx.actor.organisationId))).returning();
    if (!c) throw notFound('Creative');
    await audit(t, ctx.actor, `creative.${status}`, 'creative', id);
    return c;
  });
}

export const campaignInput = z.object({
  brandId: z.string().uuid(),
  creativeSetId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  priority: z.number().int().min(1).max(4).default(3),
  weight: z.number().int().min(1).max(1000).default(1),
  totalCap: z.number().int().min(1).nullable().optional(),
  perMatchCap: z.number().int().min(1).nullable().optional(),
  minSpacingSeconds: z.number().int().min(0).max(3600).default(0),
  excludedCategories: z.array(z.string().max(40)).default([]),
  eventSponsorship: z.array(z.string().max(40)).default([]),
  allocations: z.array(z.object({ scopeType: z.enum(['organisation', 'competition', 'team', 'match']), scopeId: z.string().uuid().nullable().optional(), placement: z.enum(PLACEMENTS) })).default([]),
});

export async function saveCampaign(ctx: Ctx, input: z.input<typeof campaignInput>, id?: string) {
  assertCan(ctx.actor, 'sponsor.manage');
  const d = campaignInput.parse(input);
  if (new Date(d.endsAt) <= new Date(d.startsAt)) throw invalid('Campaign must end after it starts', [{ field: 'endsAt', message: 'Must be after start' }]);
  for (const a of d.allocations) if (a.scopeType !== 'organisation' && !a.scopeId) throw invalid('Choose a target for each allocation', [{ field: 'allocations', message: 'Missing target' }]);
  return tx(ctx, async (t) => {
    const { allocations: allocs, ...fields } = d;
    const values = { ...fields, organisationId: ctx.actor.organisationId, startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt), totalCap: d.totalCap ?? null, perMatchCap: d.perMatchCap ?? null };
    let c;
    if (id) {
      [c] = await t.update(campaigns).set({ ...values, updatedAt: new Date() }).where(and(eq(campaigns.id, id), eq(campaigns.organisationId, ctx.actor.organisationId))).returning();
      if (!c) throw notFound('Campaign');
      await t.delete(allocations).where(eq(allocations.campaignId, id));
    } else [c] = await t.insert(campaigns).values(values).returning();
    if (allocs.length) await t.insert(allocations).values(allocs.map((a) => ({ organisationId: ctx.actor.organisationId, campaignId: c!.id, scopeType: a.scopeType, scopeId: a.scopeId ?? null, placement: a.placement })));
    await audit(t, ctx.actor, id ? 'campaign.update' : 'campaign.create', 'campaign', c!.id, { after: { name: d.name, allocations: allocs.length } });
    return c!;
  });
}

// ------------------------------------------------------------------ selection

async function loadSelectionData(t: Tx, organisationId: string, matchId: string) {
  const [m] = await t.select().from(matches).where(eq(matches.id, matchId));
  const cps = await t.select({ c: campaigns, b: brands }).from(campaigns).innerJoin(brands, eq(brands.id, campaigns.brandId)).where(eq(campaigns.organisationId, organisationId));
  const als = await t.select().from(allocations).where(eq(allocations.organisationId, organisationId));
  const crs = await t.select({ c: creatives, a: mediaAssets }).from(creatives).innerJoin(mediaAssets, eq(mediaAssets.id, creatives.assetId)).where(eq(creatives.organisationId, organisationId));
  const counts = await t
    .select({ campaignId: sponsorDecisions.campaignId, matchId: sponsorDecisions.matchId, n: sql<number>`count(*)::int`, last: sql<Date>`max(${sponsorDecisions.createdAt})` })
    .from(sponsorDecisions)
    .where(and(eq(sponsorDecisions.organisationId, organisationId), eq(sponsorDecisions.outcome, 'selected'), eq(sponsorDecisions.rehearsal, false)))
    .groupBy(sponsorDecisions.campaignId, sponsorDecisions.matchId);
  const totalShown: Record<string, number> = {};
  const matchShown: Record<string, number> = {};
  const lastShownAt: Record<string, number> = {};
  for (const c of counts) {
    if (!c.campaignId) continue;
    totalShown[c.campaignId] = (totalShown[c.campaignId] ?? 0) + c.n;
    if (c.matchId === matchId) {
      matchShown[c.campaignId] = c.n;
      lastShownAt[c.campaignId] = new Date(c.last).getTime();
    }
  }
  return {
    match: m!,
    campaigns: cps.map((x): SponsorCampaign => ({ id: x.c.id, brandId: x.b.id, brandName: x.b.name, brandCategory: x.b.category, creativeSetId: x.c.creativeSetId, startsAt: x.c.startsAt.getTime(), endsAt: x.c.endsAt.getTime(), priority: x.c.priority, weight: x.c.weight, totalCap: x.c.totalCap, perMatchCap: x.c.perMatchCap, minSpacingSeconds: x.c.minSpacingSeconds, excludedCategories: x.c.excludedCategories, eventSponsorship: x.c.eventSponsorship, status: x.c.status })),
    allocations: als.map((a): SponsorAllocation => ({ campaignId: a.campaignId, scopeType: a.scopeType as SponsorAllocation['scopeType'], scopeId: a.scopeId, placement: a.placement as Placement })),
    creatives: crs.map((x): SponsorCreative => ({ id: x.c.id, creativeSetId: x.c.creativeSetId, kind: x.c.kind as SponsorCreative['kind'], width: x.c.width, height: x.c.height, durationMs: x.c.durationMs, approvalStatus: x.c.approvalStatus, expiresAt: x.c.expiresAt?.getTime() ?? null, assetReady: x.a.state === 'READY' })),
    totalShown,
    matchShown,
    lastShownAt,
  };
}

/** Choose and persist a decision (idempotent on requestKey). Rehearsal decisions are flagged and excluded from counts. */
export async function decide(t: Tx, organisationId: string, input: { matchId: string; overlayId: string | null; placement: Placement; requestKey: string; now: number; eventType?: string | null; requireDurationMs?: number | null; rehearsal?: boolean }) {
  const [prior] = await t.select().from(sponsorDecisions).where(eq(sponsorDecisions.requestKey, input.requestKey));
  if (prior) return prior;
  const d = await loadSelectionData(t, organisationId, input.matchId);
  const r: SelectionResult = selectCreative({
    placement: input.placement,
    now: input.now,
    scope: { competitionId: d.match.competitionId, matchId: input.matchId, teamIds: [d.match.homeTeamId, d.match.awayTeamId] },
    campaigns: d.campaigns,
    allocations: d.allocations,
    creatives: d.creatives,
    totalShown: d.totalShown,
    matchShown: d.matchShown,
    lastShownAt: d.lastShownAt,
    eventType: input.eventType,
    requireDurationMs: input.requireDurationMs,
  });
  const [row] = await t
    .insert(sponsorDecisions)
    .values({ organisationId, matchId: input.matchId, overlayId: input.overlayId, placement: input.placement, campaignId: r.campaignId, creativeId: r.creativeId, outcome: r.outcome, reason: r.reason, inputs: { considered: r.considered, precedence: r.precedence, eventType: input.eventType ?? null }, requestKey: input.requestKey, rehearsal: !!input.rehearsal })
    .onConflictDoNothing({ target: sponsorDecisions.requestKey })
    .returning();
  return row ?? (await t.select().from(sponsorDecisions).where(eq(sponsorDecisions.requestKey, input.requestKey)))[0]!;
}

/** Operator/producer preview of who would be selected now for each placement (no decision is persisted). */
export async function eligibilityPreview(ctx: Ctx, matchId: string) {
  assertCan(ctx.actor, 'sponsor.report', {}, undefined);
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    const d = await loadSelectionData(t, ctx.actor.organisationId, matchId);
    return PLACEMENTS.map((placement) => {
      const r = selectCreative({ placement, now: nowMs(ctx), scope: { competitionId: m.competitionId, matchId, teamIds: [m.homeTeamId, m.awayTeamId] }, campaigns: d.campaigns, allocations: d.allocations, creatives: d.creatives, totalShown: d.totalShown, matchShown: d.matchShown, lastShownAt: d.lastShownAt });
      return { placement, ...r, campaignName: d.campaigns.find((c) => c.id === r.campaignId)?.brandName ?? null };
    });
  });
}

/** Creatives referenced by an overlay's on-air cues and slots, as signed render URLs. */
export async function renderCreatives(t: Tx, cfg: AppConfig, organisationId: string, ids: string[], includeAllApproved = false): Promise<Record<string, RenderCreative>> {
  const conds: SQL[] = [eq(creatives.organisationId, organisationId), eq(mediaAssets.state, 'READY')];
  if (!includeAllApproved) {
    if (!ids.length) return {};
    conds.push(inArray(creatives.id, ids));
  } else conds.push(eq(creatives.approvalStatus, 'approved'));
  const rows = await t.select({ c: creatives, a: mediaAssets, b: brands }).from(creatives).innerJoin(mediaAssets, eq(mediaAssets.id, creatives.assetId)).innerJoin(creativeSets, eq(creativeSets.id, creatives.creativeSetId)).innerJoin(brands, eq(brands.id, creativeSets.brandId)).where(and(...conds));
  const out: Record<string, RenderCreative> = {};
  for (const r of rows) out[r.c.id] = { id: r.c.id, kind: r.c.kind as RenderCreative['kind'], url: signedAssetUrl(cfg, organisationId, r.a.id) + (r.c.kind === 'video' ? '&v=.mp4' : ''), width: r.c.width, height: r.c.height, brandName: r.b.name };
  return out;
}

// ------------------------------------------------------------------ delivery evidence

export const exposureInput = z.object({
  cueId: z.string().max(64),
  creativeId: z.string().uuid(),
  placement: z.string().max(40),
  decisionId: z.string().uuid().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
  revision: z.number().int().min(0),
  visible: z.boolean(),
  area: z.number().min(0).max(1).optional(),
});

const HEARTBEAT_GRACE_MS = 6000;

/**
 * Renderer evidence. Only the nominated reporting authority (compositor for cloud programmes, else the first
 * production renderer) counts; previews, monitors, rehearsals and extra browser-source copies never do.
 */
export async function recordExposure(db: Db, scope: RendererScope, rendererSessionId: string, raw: unknown, now = Date.now()) {
  if (scope.purpose !== 'production' && scope.purpose !== 'compositor') return { counted: false, reason: 'not an output renderer' };
  const e = exposureInput.parse(raw);
  return withTenant(db, { organisationId: scope.organisationId }, async (t) => {
    const [rs] = await t.select().from(rendererSessions).where(and(eq(rendererSessions.id, rendererSessionId), eq(rendererSessions.overlayId, scope.overlayId), isNull(rendererSessions.disconnectedAt)));
    if (!rs?.isReportingAuthority) return { counted: false, reason: 'not the reporting authority' };
    const [ov] = await t.select().from(overlays).where(eq(overlays.id, scope.overlayId));
    const key = `${scope.overlayId}:${e.cueId}:${e.creativeId}:${e.placement}:${rendererSessionId}`;
    const [cur] = await t.select().from(sponsorExposures).where(eq(sponsorExposures.intervalKey, key));
    if (e.visible) {
      if (!cur) {
        await t.insert(sponsorExposures).values({ organisationId: scope.organisationId, matchId: ov!.matchId, overlayId: scope.overlayId, decisionId: e.decisionId ?? null, campaignId: e.campaignId ?? null, creativeId: e.creativeId, placement: e.placement, cueId: e.cueId, revision: e.revision, evidenceType: scope.purpose === 'compositor' ? 'compositor' : 'renderer', rendererSessionId, intervalKey: key, firstVisibleAt: new Date(now), lastConfirmedAt: new Date(now), visibleArea: e.area ?? null }).onConflictDoNothing();
      } else if (!cur.closedAt) {
        await t.update(sponsorExposures).set({ lastConfirmedAt: new Date(now) }).where(eq(sponsorExposures.id, cur.id));
      }
      return { counted: true };
    }
    if (cur && !cur.closedAt) {
      // close conservatively: never beyond the last heartbeat + grace
      const end = Math.min(now, cur.lastConfirmedAt.getTime() + HEARTBEAT_GRACE_MS);
      await t.update(sponsorExposures).set({ closedAt: new Date(end), lastConfirmedAt: new Date(end), closeReason: 'ended' }).where(eq(sponsorExposures.id, cur.id));
    }
    return { counted: true };
  });
}

/** Close intervals of disconnected renderers / lost heartbeats at the last confirmation (worker, cross-tenant). */
export async function closeStaleExposures(workerDb: Db, now = Date.now()) {
  const cutoff = new Date(now - HEARTBEAT_GRACE_MS);
  const r = await workerDb
    .update(sponsorExposures)
    .set({ closedAt: sql`${sponsorExposures.lastConfirmedAt}`, closeReason: sql`case when exists (select 1 from renderer_sessions rs where rs.id = ${sponsorExposures.rendererSessionId} and rs.disconnected_at is not null) then 'disconnected' else 'heartbeat_lost' end` })
    .where(and(isNull(sponsorExposures.closedAt), lte(sponsorExposures.lastConfirmedAt, cutoff)))
    .returning({ id: sponsorExposures.id });
  return r.length;
}

// ------------------------------------------------------------------ reports

export const reportQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  competitionId: z.string().uuid().optional(),
  seasonId: z.string().uuid().optional(),
  matchId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  overlayId: z.string().uuid().optional(),
});

export async function sponsorReport(ctx: Ctx, query: z.input<typeof reportQuery>) {
  assertCan(ctx.actor, 'sponsor.report');
  const q = reportQuery.parse(query);
  return tx(ctx, async (t) => {
    const org = ctx.actor.organisationId;
    const conds: SQL[] = [eq(sponsorExposures.organisationId, org)];
    if (q.from) conds.push(gte(sponsorExposures.firstVisibleAt, new Date(q.from)));
    if (q.to) conds.push(lte(sponsorExposures.firstVisibleAt, new Date(q.to)));
    if (q.matchId) conds.push(eq(sponsorExposures.matchId, q.matchId));
    if (q.campaignId) conds.push(eq(sponsorExposures.campaignId, q.campaignId));
    if (q.overlayId) conds.push(eq(sponsorExposures.overlayId, q.overlayId));
    const rows = await t
      .select({ e: sponsorExposures, m: matches, c: creatives, cp: campaigns, b: brands, o: overlays })
      .from(sponsorExposures)
      .innerJoin(matches, eq(matches.id, sponsorExposures.matchId))
      .innerJoin(creatives, eq(creatives.id, sponsorExposures.creativeId))
      .innerJoin(creativeSets, eq(creativeSets.id, creatives.creativeSetId))
      .innerJoin(brands, eq(brands.id, creativeSets.brandId))
      .leftJoin(campaigns, eq(campaigns.id, sponsorExposures.campaignId))
      .innerJoin(overlays, eq(overlays.id, sponsorExposures.overlayId))
      .where(and(...conds, q.competitionId ? eq(matches.competitionId, q.competitionId) : undefined, q.seasonId ? eq(matches.seasonId, q.seasonId) : undefined, q.brandId ? eq(brands.id, q.brandId) : undefined, eq(matches.isDemo, false)))
      .orderBy(asc(sponsorExposures.firstVisibleAt));
    const decConds: SQL[] = [eq(sponsorDecisions.organisationId, org), eq(sponsorDecisions.rehearsal, false)];
    if (q.matchId) decConds.push(eq(sponsorDecisions.matchId, q.matchId));
    if (q.from) decConds.push(gte(sponsorDecisions.createdAt, new Date(q.from)));
    if (q.to) decConds.push(lte(sponsorDecisions.createdAt, new Date(q.to)));
    const decisions = await t.select().from(sponsorDecisions).where(and(...decConds));
    const occurrences = rows.map((r) => {
      const end = (r.e.closedAt ?? r.e.lastConfirmedAt).getTime();
      const seconds = Math.max(0, (end - r.e.firstVisibleAt.getTime()) / 1000);
      return {
        exposureId: r.e.id,
        matchId: r.m.id,
        matchLabel: `${(r.m as { externalId?: string | null }).externalId ?? ''}`.trim() || r.m.id.slice(0, 8),
        output: r.o.name,
        overlayId: r.o.id,
        brand: r.b.name,
        campaign: r.cp?.name ?? '(direct)',
        creative: r.c.name,
        placement: r.e.placement,
        evidenceType: r.e.evidenceType,
        firstVisibleAt: r.e.firstVisibleAt.toISOString(),
        confirmedSeconds: Math.round(seconds * 10) / 10,
        closed: !!r.e.closedAt,
        closeReason: r.e.closeReason ?? (r.e.closedAt ? 'ended' : 'open'),
        uncertaintySeconds: r.e.closeReason === 'disconnected' || r.e.closeReason === 'heartbeat_lost' ? HEARTBEAT_GRACE_MS / 1000 : 0,
        destinationStatuses: r.e.destinationStatuses,
      };
    });
    const by = <K extends string>(key: (o: (typeof occurrences)[number]) => K) => {
      const m = new Map<K, { occurrences: number; seconds: number }>();
      for (const o of occurrences) {
        const k = key(o);
        const v = m.get(k) ?? { occurrences: 0, seconds: 0 };
        v.occurrences++;
        v.seconds += o.confirmedSeconds;
        m.set(k, v);
      }
      return [...m.entries()].map(([k, v]) => ({ key: k, ...v, seconds: Math.round(v.seconds * 10) / 10 }));
    };
    return {
      definitions: {
        occurrence: 'One continuous on-air interval of a creative on one output, confirmed by that output’s single reporting authority (cloud compositor or nominated production renderer).',
        confirmedSeconds: 'From first visible frame to the last heartbeat-confirmed moment. Interrupted intervals close at the last confirmation.',
        notIncluded: 'Audience views, impressions, reach and CPM are not measured: graphics render time is not viewer evidence.',
        evidenceType: 'compositor = cloud programme pixels; renderer = graphics-only browser source (render delivery, not proof that a viewer saw it).',
      },
      totals: { occurrences: occurrences.length, confirmedSeconds: Math.round(occurrences.reduce((n, o) => n + o.confirmedSeconds, 0) * 10) / 10, skippedOrEmpty: decisions.filter((d) => d.outcome !== 'selected').length },
      byCampaign: by((o) => o.campaign),
      byCreative: by((o) => `${o.brand} · ${o.creative}`),
      byMatch: by((o) => o.matchLabel),
      byOutput: by((o) => o.output),
      skipped: decisions.filter((d) => d.outcome !== 'selected').map((d) => ({ at: d.createdAt.toISOString(), placement: d.placement, matchId: d.matchId, reason: d.reason })),
      occurrences,
    };
  });
}

export function sponsorReportCsv(r: Awaited<ReturnType<typeof sponsorReport>>) {
  return toCsv(
    ['first_visible_at', 'match', 'output', 'brand', 'campaign', 'creative', 'placement', 'evidence_type', 'confirmed_seconds', 'close_reason', 'uncertainty_seconds'],
    r.occurrences.map((o) => [o.firstVisibleAt, o.matchLabel, o.output, o.brand, o.campaign, o.creative, o.placement, o.evidenceType, o.confirmedSeconds, o.closeReason, o.uncertaintySeconds]),
  );
}

/** Which placements currently have an eligible creative (automation sponsor_available guard). */
export async function availablePlacements(t: Tx, organisationId: string, matchId: string, placements: string[], now: number) {
  const out = new Set<string>();
  if (!placements.length) return out;
  const d = await loadSelectionData(t, organisationId, matchId);
  for (const placement of placements) {
    const r = selectCreative({ placement: placement as Placement, now, scope: { competitionId: d.match.competitionId, matchId, teamIds: [d.match.homeTeamId, d.match.awayTeamId] }, campaigns: d.campaigns, allocations: d.allocations, creatives: d.creatives, totalShown: d.totalShown, matchShown: d.matchShown, lastShownAt: d.lastShownAt });
    if (r.outcome === 'selected') out.add(placement);
  }
  return out;
}

/** A creative fixed in a game plan item still gets a decision record so delivery evidence links to it. */
export async function fixedDecision(t: Tx, organisationId: string, input: { matchId: string; overlayId: string; placement: string; creativeId: string; requestKey: string }) {
  const [c] = await t.select({ c: creatives, a: mediaAssets }).from(creatives).innerJoin(mediaAssets, eq(mediaAssets.id, creatives.assetId)).where(and(eq(creatives.id, input.creativeId), eq(creatives.organisationId, organisationId)));
  const usable = c && c.c.approvalStatus === 'approved' && c.a.state === 'READY' && (!c.c.expiresAt || c.c.expiresAt.getTime() > Date.now());
  const [row] = await t
    .insert(sponsorDecisions)
    .values({ organisationId, matchId: input.matchId, overlayId: input.overlayId, placement: input.placement, campaignId: null, creativeId: usable ? input.creativeId : null, outcome: usable ? 'selected' : 'none', reason: usable ? 'fixed creative in game plan' : 'fixed creative is not approved, expired or not ready', inputs: {}, requestKey: input.requestKey })
    .onConflictDoNothing({ target: sponsorDecisions.requestKey })
    .returning();
  return row ?? (await t.select().from(sponsorDecisions).where(eq(sponsorDecisions.requestKey, input.requestKey)))[0]!;
}
