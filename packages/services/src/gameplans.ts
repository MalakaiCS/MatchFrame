// Game plans: editable drafts, publish-time validation and immutable published versions.
import { and, asc, desc, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import { creatives, gamePlans, gamePlanVersions, matches, mediaAssets, memberships, overlays, type Tx } from '@bs/db';
import { getAdapter, SPORT_LABELS, STARTER_PLANS, validateGamePlan, type GamePlan, type PlanIssue, type Sport, SPORTS } from '@bs/domain';
import { BUILTIN_TEMPLATES } from '@bs/graphics';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { invalid, notFound } from './errors';
import { resolveActor, tx, type Ctx, type Deps } from './context';
import { customDefs, latestPublishedPlan, loadOverlay, setOverlayGamePlan } from './overlays';
import { planFingerprint, STARTER_FINGERPRINTS } from './starter-history';

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

export const createPlanInput = z.object({ name: z.string().trim().min(1).max(80), sport: z.enum(SPORTS), fromStarter: z.boolean().default(true) });

export async function createGamePlan(ctx: Ctx, input: z.input<typeof createPlanInput>, t0?: Tx) {
  assertCan(ctx.actor, 'theme.write');
  const d = createPlanInput.parse(input);
  const run = async (t: Tx) => {
    const starter = d.fromStarter ? STARTER_PLANS[d.sport] : undefined;
    const draft: GamePlan = starter ? structuredClone(starter) : { version: 1, sport: d.sport, defaultScorebug: true, freshnessMs: 10_000, playlists: [] };
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
  return t0 ? publishTx(ctx, t0, id) : tx(ctx, (t) => publishTx(ctx, t, id));
}

async function publishTx(ctx: Ctx, t: Tx, id: string) {
  const [p] = await t.select().from(gamePlans).where(and(eq(gamePlans.id, id), eq(gamePlans.organisationId, ctx.actor.organisationId))).for('update');
  if (!p) throw notFound('Game plan');
  const v = await validateFor(t, ctx.actor.organisationId, p.draft);
  if (!v.ok) throw invalid('The game plan has errors; fix them before publishing', v.issues.filter((i) => i.severity === 'error').map((i) => ({ field: i.path, message: i.message })));
  const version = p.currentVersion + 1;
  const [gv] = await t.insert(gamePlanVersions).values({ organisationId: ctx.actor.organisationId, gamePlanId: id, version, sport: p.sport, definition: v.plan as never, publishedBy: ctx.actor.userId }).returning();
  await t.update(gamePlans).set({ currentVersion: version, updatedAt: new Date() }).where(eq(gamePlans.id, id));
  await audit(t, ctx.actor, 'game_plan.publish', 'game_plan', id, { after: { version, warnings: v.issues.length } });
  return { id: gv!.id, version, issues: v.issues };
}

/**
 * An organisation's first match in a sport with a starter flow, and no published plan for that sport: create the
 * starter flow ("Football starter flow") and publish it, so the match's output shows the pre-match graphics from
 * the start instead of nothing. It is an ordinary plan afterwards, editable under Automation. A system step of match
 * creation, so it does not need the creator to be allowed to edit plans; the audit log records it.
 */
export async function ensureStarterPlan(ctx: Ctx, t: Tx, sport: Sport): Promise<string | null> {
  const starter = STARTER_PLANS[sport];
  if (!starter) return null;
  const name = `${SPORT_LABELS[sport]} starter flow`;
  const [p] = await t.insert(gamePlans).values({ organisationId: ctx.actor.organisationId, name, sport, draft: structuredClone(starter) as never }).returning();
  await audit(t, ctx.actor, 'game_plan.create', 'game_plan', p!.id, { after: { name, sport, reason: 'first match in this sport, no plan published' } });
  const v = await publishTx(ctx, t, p!.id);
  return v.id;
}

/** Published definition for an overlay's pinned version (worker and rehearsal). */
export async function loadPlanVersion(t: Tx, versionId: string) {
  const [v] = await t.select().from(gamePlanVersions).where(eq(gamePlanVersions.id, versionId));
  return v ? { id: v.id, sport: v.sport, version: v.version, gamePlanId: v.gamePlanId, plan: v.definition as unknown as GamePlan } : null;
}

export async function overlaysUsingPlan(t: Tx, gamePlanId: string) {
  return t.select({ id: overlays.id, name: overlays.name, versionId: overlays.gamePlanVersionId }).from(overlays).innerJoin(gamePlanVersions, eq(gamePlanVersions.id, overlays.gamePlanVersionId)).where(eq(gamePlanVersions.gamePlanId, gamePlanId));
}

/**
 * "Use the starter flow" on a match whose output has no plan (one created before plans were attached by
 * default): the organisation's latest published plan for the sport, or else the starter flow published now, goes
 * on the output, which then catches up with the match phase (the background and header come up before kick-off).
 */
export async function applyStarterPlan(ctx: Ctx, overlayId: string): Promise<{ gamePlanVersionId: string }> {
  const versionId = await tx(ctx, async (t) => {
    const { m } = await loadOverlay(ctx, t, overlayId);
    assertCan(ctx.actor, 'competition.write', { matchId: m.id, competitionId: m.competitionId });
    return (await latestPublishedPlan(t, ctx.actor.organisationId, m.sport)) ?? (await ensureStarterPlan(ctx, t, m.sport as Sport));
  });
  if (!versionId) throw invalid('There is no starter flow for this sport yet; create a plan under Automation.');
  await setOverlayGamePlan(ctx, overlayId, versionId);
  return { gamePlanVersionId: versionId };
}

/**
 * On worker start: the main output (the one created with the match) of an upcoming or live match that never had
 * an automation plan (matches created before the main output got one by default) gets one now, exactly as if the
 * organisation's owner had pressed "Use the starter flow", and catches up with its match. Extra outputs added
 * later, and any output whose plan someone has set or removed (the audit log has an "overlay.game_plan" entry for
 * it), are left as they are. Returns how many outputs were given a plan.
 */
export async function backfillDefaultPlans(deps: Deps, now = new Date()): Promise<number> {
  const rows = await deps.db
    .select({ id: overlays.id, organisationId: overlays.organisationId })
    .from(overlays)
    .innerJoin(matches, and(eq(matches.id, overlays.matchId), eq(matches.organisationId, overlays.organisationId)))
    .where(
      and(
        isNull(overlays.gamePlanVersionId),
        eq(overlays.kind, 'graphics'),
        inArray(matches.status, ['scheduled', 'live']),
        gte(matches.scheduledAt, new Date(now.getTime() - 86_400_000)),
        sql`not exists (select 1 from overlays first where first.match_id = ${overlays.matchId} and first.kind = 'graphics' and first.created_at < ${overlays.createdAt})`,
        sql`not exists (select 1 from audit_logs a where a.organisation_id = ${overlays.organisationId} and a.resource_type = 'overlay' and a.resource_id = ${overlays.id}::text and a.action = 'overlay.game_plan')`,
      ),
    );
  let given = 0;
  for (const r of rows) {
    const ctx = await ownerCtx(deps, r.organisationId);
    if (!ctx) continue;
    try {
      await applyStarterPlan(ctx, r.id);
      given++;
    } catch (e) {
      console.warn(`[automation] could not give output ${r.id} a plan: ${(e as Error).message}`);
    }
  }
  return given;
}

/** A system step acting for an organisation: as its earliest active owner. */
async function ownerCtx(deps: Deps, organisationId: string): Promise<Ctx | null> {
  const [owner] = await deps.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organisationId, organisationId), eq(memberships.role, 'owner'), eq(memberships.status, 'active')))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  const actor = owner ? await resolveActor(deps.db, owner.userId, organisationId) : null;
  return actor ? { ...deps, actor } : null;
}

/**
 * On worker start: a plan that is still an untouched copy of an older starter flow (published as it was created,
 * nothing edited since) gets the current starter flow as a new version, as if its owner had reset it to the
 * starter and published. Upcoming matches whose outputs used that copy move to the new version and catch up with
 * their match (for football, the background and match header come up before kick-off). Plans someone has edited,
 * and matches already under way, are left as they are. Returns how many plans were updated.
 */
export async function upgradeStarterPlans(deps: Deps, now = new Date()): Promise<number> {
  const plans = await deps.db
    .select({ id: gamePlans.id, organisationId: gamePlans.organisationId, sport: gamePlans.sport })
    .from(gamePlans)
    .where(and(eq(gamePlans.status, 'active'), gt(gamePlans.currentVersion, 0)));
  let updated = 0;
  for (const p of plans) {
    const starter = STARTER_PLANS[p.sport as Sport];
    const latest = starter ? planFingerprint(starter) : null;
    const known = STARTER_FINGERPRINTS[p.sport as Sport] ?? [];
    if (!starter || !known.some((f) => f !== latest)) continue;
    const ctx = await ownerCtx(deps, p.organisationId);
    if (!ctx) continue;
    try {
      const moved = await tx(ctx, async (t) => {
        const [plan] = await t.select().from(gamePlans).where(and(eq(gamePlans.id, p.id), eq(gamePlans.organisationId, p.organisationId))).for('update');
        if (!plan) return null;
        const [pub] = await t.select().from(gamePlanVersions).where(and(eq(gamePlanVersions.gamePlanId, p.id), eq(gamePlanVersions.organisationId, p.organisationId), eq(gamePlanVersions.version, plan.currentVersion)));
        const fp = pub ? planFingerprint(pub.definition) : null;
        if (!fp || fp === latest || !known.includes(fp) || planFingerprint(plan.draft) !== fp) return null;
        await t.update(gamePlans).set({ draft: structuredClone(starter) as never, updatedAt: new Date() }).where(eq(gamePlans.id, p.id));
        await audit(t, ctx.actor, 'game_plan.update', 'game_plan', p.id, { before: { version: plan.currentVersion }, after: { reason: 'untouched copy of an older starter flow, updated to the current one' } });
        const v = await publishTx(ctx, t, p.id);
        const outputs = await t
          .select({ id: overlays.id })
          .from(overlays)
          .innerJoin(matches, and(eq(matches.id, overlays.matchId), eq(matches.organisationId, overlays.organisationId)))
          .where(and(eq(overlays.organisationId, p.organisationId), eq(overlays.gamePlanVersionId, pub!.id), eq(matches.status, 'scheduled'), gte(matches.scheduledAt, new Date(now.getTime() - 86_400_000))));
        return { versionId: v.id, outputs: outputs.map((o) => o.id) };
      });
      if (!moved) continue;
      updated++;
      for (const o of moved.outputs) await setOverlayGamePlan(ctx, o, moved.versionId);
    } catch (e) {
      console.warn(`[automation] could not update plan ${p.id} to the current starter flow: ${(e as Error).message}`);
    }
  }
  return updated;
}
