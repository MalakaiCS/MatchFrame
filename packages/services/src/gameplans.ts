// Game plans: editable drafts, publish-time validation and immutable published versions.
import { and, asc, desc, eq } from 'drizzle-orm';
import { creatives, gamePlans, gamePlanVersions, mediaAssets, overlays, type Tx } from '@bs/db';
import { getAdapter, STARTER_PLANS, validateGamePlan, type GamePlan, type PlanIssue } from '@bs/domain';
import { BUILTIN_TEMPLATES } from '@bs/graphics';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { invalid, notFound } from './errors';
import { tx, type Ctx } from './context';
import { customDefs } from './overlays';

export async function templateLayerMap(t: Tx, organisationId: string) {
  const custom = await customDefs(t, organisationId);
  const layers: Record<string, string> = {};
  for (const d of [...BUILTIN_TEMPLATES, ...custom]) layers[d.key] = d.layer;
  return { layers, custom };
}

async function validateFor(t: Tx, organisationId: string, draft: unknown) {
  const sport = (draft as { sport?: string })?.sport === 'basketball' ? 'basketball' : 'football';
  const { layers } = await templateLayerMap(t, organisationId);
  const approved = await t
    .select({ id: creatives.id })
    .from(creatives)
    .innerJoin(mediaAssets, eq(mediaAssets.id, creatives.assetId))
    .where(and(eq(creatives.organisationId, organisationId), eq(creatives.approvalStatus, 'approved'), eq(mediaAssets.state, 'READY')));
  const eventTypes = getAdapter(sport).eventTypes(getAdapter(sport).defaultConfig as never).map((e) => e.type);
  return validateGamePlan(draft, { templateKeys: Object.keys(layers), templateLayers: layers, eventTypes, creativeIds: approved.map((c) => c.id) });
}

export async function listGamePlans(ctx: Ctx) {
  assertCan(ctx.actor, 'theme.use');
  return tx(ctx, async (t) => {
    const plans = await t.select().from(gamePlans).where(and(eq(gamePlans.organisationId, ctx.actor.organisationId), eq(gamePlans.status, 'active'))).orderBy(asc(gamePlans.name));
    const versions = await t.select({ id: gamePlanVersions.id, gamePlanId: gamePlanVersions.gamePlanId, version: gamePlanVersions.version, publishedAt: gamePlanVersions.publishedAt }).from(gamePlanVersions).where(eq(gamePlanVersions.organisationId, ctx.actor.organisationId)).orderBy(desc(gamePlanVersions.version));
    return plans.map((p) => ({ ...p, draft: undefined, versions: versions.filter((v) => v.gamePlanId === p.id) }));
  });
}

export async function getGamePlan(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'theme.use');
  return tx(ctx, async (t) => {
    const [p] = await t.select().from(gamePlans).where(and(eq(gamePlans.id, id), eq(gamePlans.organisationId, ctx.actor.organisationId)));
    if (!p) throw notFound('Game plan');
    const versions = await t.select().from(gamePlanVersions).where(eq(gamePlanVersions.gamePlanId, id)).orderBy(desc(gamePlanVersions.version));
    const v = await validateFor(t, ctx.actor.organisationId, p.draft);
    const { layers } = await templateLayerMap(t, ctx.actor.organisationId);
    return { ...p, versions, validation: { ok: v.ok, issues: v.issues }, templateLayers: layers };
  });
}

export const createPlanInput = z.object({ name: z.string().trim().min(1).max(80), sport: z.enum(['football', 'basketball']), fromStarter: z.boolean().default(true) });

export async function createGamePlan(ctx: Ctx, input: z.input<typeof createPlanInput>, t0?: Tx) {
  assertCan(ctx.actor, 'theme.write');
  const d = createPlanInput.parse(input);
  const run = async (t: Tx) => {
    const draft: GamePlan = d.fromStarter ? structuredClone(STARTER_PLANS[d.sport]) : { version: 1, sport: d.sport, defaultScorebug: true, freshnessMs: 10_000, playlists: [] };
    const [p] = await t.insert(gamePlans).values({ organisationId: ctx.actor.organisationId, name: d.name, sport: d.sport, draft: draft as never }).returning();
    await audit(t, ctx.actor, 'game_plan.create', 'game_plan', p!.id, { after: { name: d.name, sport: d.sport } });
    return p!;
  };
  return t0 ? run(t0) : tx(ctx, run);
}

export async function updateGamePlanDraft(ctx: Ctx, id: string, input: { name?: string; draft: unknown }) {
  assertCan(ctx.actor, 'theme.write');
  return tx(ctx, async (t) => {
    const [p] = await t.select().from(gamePlans).where(and(eq(gamePlans.id, id), eq(gamePlans.organisationId, ctx.actor.organisationId)));
    if (!p) throw notFound('Game plan');
    if ((input.draft as { sport?: string })?.sport !== p.sport) throw invalid('A game plan cannot change sport', [{ field: 'sport', message: `This plan is for ${p.sport}` }]);
    if (JSON.stringify(input.draft).length > 400_000) throw invalid('Game plan is too large');
    const [u] = await t.update(gamePlans).set({ draft: input.draft as never, name: input.name?.trim() || p.name, updatedAt: new Date() }).where(eq(gamePlans.id, id)).returning();
    const v = await validateFor(t, ctx.actor.organisationId, input.draft);
    return { ...u!, validation: { ok: v.ok, issues: v.issues } };
  });
}

export async function publishGamePlan(ctx: Ctx, id: string, t0?: Tx): Promise<{ id: string; version: number; issues: PlanIssue[] }> {
  assertCan(ctx.actor, 'theme.write');
  const run = async (t: Tx) => {
    const [p] = await t.select().from(gamePlans).where(and(eq(gamePlans.id, id), eq(gamePlans.organisationId, ctx.actor.organisationId))).for('update');
    if (!p) throw notFound('Game plan');
    const v = await validateFor(t, ctx.actor.organisationId, p.draft);
    if (!v.ok) throw invalid('The game plan has errors; fix them before publishing', v.issues.filter((i) => i.severity === 'error').map((i) => ({ field: i.path, message: i.message })));
    const version = p.currentVersion + 1;
    const [gv] = await t.insert(gamePlanVersions).values({ organisationId: ctx.actor.organisationId, gamePlanId: id, version, sport: p.sport, definition: v.plan as never, publishedBy: ctx.actor.userId }).returning();
    await t.update(gamePlans).set({ currentVersion: version, updatedAt: new Date() }).where(eq(gamePlans.id, id));
    await audit(t, ctx.actor, 'game_plan.publish', 'game_plan', id, { after: { version, warnings: v.issues.length } });
    return { id: gv!.id, version, issues: v.issues };
  };
  return t0 ? run(t0) : tx(ctx, run);
}

/** Published definition for an overlay's pinned version (worker and rehearsal). */
export async function loadPlanVersion(t: Tx, versionId: string) {
  const [v] = await t.select().from(gamePlanVersions).where(eq(gamePlanVersions.id, versionId));
  return v ? { id: v.id, sport: v.sport, version: v.version, gamePlanId: v.gamePlanId, plan: v.definition as unknown as GamePlan } : null;
}

export async function overlaysUsingPlan(t: Tx, gamePlanId: string) {
  return t.select({ id: overlays.id, name: overlays.name, versionId: overlays.gamePlanVersionId }).from(overlays).innerJoin(gamePlanVersions, eq(gamePlanVersions.id, overlays.gamePlanVersionId)).where(eq(gamePlanVersions.gamePlanId, gamePlanId));
}
