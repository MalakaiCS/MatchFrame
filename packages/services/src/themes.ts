// Theme profiles (published theme version + colours/typography/logos/sponsor slots/layout) and designer templates.
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { competitions, graphicTemplates, overlays, templateVersions, themeProfileVersions, themeProfiles, themeVersions, themes, type Tx } from '@bs/db';
import { DEFAULT_THEMES, emptyScene, validateScene, type ThemeConfig } from '@bs/graphics';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { conflict, invalid, notFound } from './errors';
import { tx, type Ctx } from './context';
import { enqueueOutbox } from './outbox';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const profileConfigSchema = z.object({
  primary: color.optional(),
  secondary: color.optional(),
  accent: color.optional(),
  text: color.optional(),
  panel: color.optional(),
  motion: z.enum(['none', 'subtle', 'full']).optional(),
  entranceMs: z.number().int().min(150).max(600).optional(),
  exitMs: z.number().int().min(150).max(600).optional(),
  safeArea: z.number().min(0.03).max(0.1).optional(),
  logoAssetId: z.string().uuid().nullable().optional(),
  /** a club typeface (woff2 / ttf / otf) uploaded as a font asset */
  fontAssetId: z.string().uuid().nullable().optional(),
  scorebug: z.object({ variant: z.enum(['box', 'strip']).optional(), position: z.enum(['left', 'centre', 'right']).optional() }).optional(),
  clock: z.object({ hideSeconds: z.boolean().optional(), stoppage: z.enum(['plus', 'label']).optional() }).optional(),
  wording: z.record(z.string().max(40), z.string().max(60)).optional(),
  stings: z.boolean().optional(),
  sponsorSlots: z.record(z.string(), z.boolean()).optional(),
  controlRoomLayoutId: z.string().uuid().nullable().optional(),
});
export type ProfileConfig = z.infer<typeof profileConfigSchema>;

export async function listThemes(ctx: Ctx) {
  return tx(ctx, async (t) => {
    const ts = await t.select().from(themes).where(or(isNull(themes.organisationId), eq(themes.organisationId, ctx.actor.organisationId)));
    const vs = await t.select().from(themeVersions).where(inArray(themeVersions.themeId, ts.map((x) => x.id)));
    return ts.map((th) => ({ ...th, versions: vs.filter((v) => v.themeId === th.id).map((v) => ({ id: v.id, version: v.version, supportedSports: v.supportedSports, config: v.config })) }));
  });
}

async function latestThemeVersion(t: Tx, key: string) {
  const [row] = await t
    .select({ v: themeVersions, th: themes })
    .from(themeVersions)
    .innerJoin(themes, eq(themes.id, themeVersions.themeId))
    .where(and(eq(themes.key, key), isNull(themes.organisationId)))
    .orderBy(desc(themeVersions.version))
    .limit(1);
  if (!row) throw invalid('Unknown theme', [{ field: 'themeKey', message: 'Choose Minimal, Broadcast or Club' }]);
  return row;
}

export const profileInput = z.object({
  name: z.string().trim().min(1).max(80),
  themeKey: z.enum(['minimal', 'broadcast', 'club']),
  competitionId: z.string().uuid().nullable().optional(),
  config: profileConfigSchema.optional(),
  publish: z.boolean().optional(),
});

export async function listProfiles(ctx: Ctx) {
  return tx(ctx, async (t) => {
    const ps = await t.select().from(themeProfiles).where(eq(themeProfiles.organisationId, ctx.actor.organisationId)).orderBy(themeProfiles.name);
    const vs = ps.length ? await t.select().from(themeProfileVersions).where(inArray(themeProfileVersions.profileId, ps.map((p) => p.id))).orderBy(desc(themeProfileVersions.version)) : [];
    return ps.map((p) => ({ ...p, versions: vs.filter((v) => v.profileId === p.id).map((v) => ({ id: v.id, version: v.version, publishedAt: v.publishedAt })) }));
  });
}

export async function createProfile(ctx: Ctx, input: z.input<typeof profileInput>) {
  assertCan(ctx.actor, 'theme.write');
  const d = profileInput.parse(input);
  return tx(ctx, async (t) => {
    const [p] = await t
      .insert(themeProfiles)
      .values({ organisationId: ctx.actor.organisationId, name: d.name, competitionId: d.competitionId ?? null, draft: { themeKey: d.themeKey, config: d.config ?? {} } })
      .returning();
    await audit(t, ctx.actor, 'theme_profile.create', 'theme_profile', p!.id, { after: { name: d.name, themeKey: d.themeKey } });
    if (d.publish) await publishProfileTx(ctx, t, p!.id);
    if (d.competitionId) await t.update(competitions).set({ themeProfileId: p!.id }).where(and(eq(competitions.id, d.competitionId), eq(competitions.organisationId, ctx.actor.organisationId)));
    return (await t.select().from(themeProfiles).where(eq(themeProfiles.id, p!.id)))[0]!;
  });
}

export async function updateProfileDraft(ctx: Ctx, id: string, input: { name?: string; themeKey?: string; config?: unknown }) {
  assertCan(ctx.actor, 'theme.write');
  return tx(ctx, async (t) => {
    const [p] = await t.select().from(themeProfiles).where(and(eq(themeProfiles.id, id), eq(themeProfiles.organisationId, ctx.actor.organisationId)));
    if (!p) throw notFound('Theme profile');
    const draft = p.draft as { themeKey: string; config: ProfileConfig };
    const next = {
      themeKey: input.themeKey ? z.enum(['minimal', 'broadcast', 'club']).parse(input.themeKey) : draft.themeKey,
      config: input.config ? { ...draft.config, ...profileConfigSchema.parse(input.config) } : draft.config,
    };
    // Editing a draft never changes a running broadcast: only publish + explicit apply do.
    const [u] = await t.update(themeProfiles).set({ name: input.name ?? p.name, draft: next, updatedAt: new Date() }).where(eq(themeProfiles.id, id)).returning();
    return u!;
  });
}

async function publishProfileTx(ctx: Ctx, t: Tx, id: string) {
  const [p] = await t.select().from(themeProfiles).where(and(eq(themeProfiles.id, id), eq(themeProfiles.organisationId, ctx.actor.organisationId))).for('update');
  if (!p) throw notFound('Theme profile');
  const draft = p.draft as { themeKey: string; config: ProfileConfig };
  const tv = await latestThemeVersion(t, draft.themeKey);
  const version = p.currentVersion + 1;
  const [v] = await t
    .insert(themeProfileVersions)
    .values({ organisationId: ctx.actor.organisationId, profileId: id, version, themeVersionId: tv.v.id, config: { themeKey: draft.themeKey, ...profileConfigSchema.parse(draft.config ?? {}) }, publishedBy: ctx.actor.userId })
    .returning();
  await t.update(themeProfiles).set({ currentVersion: version, updatedAt: new Date() }).where(eq(themeProfiles.id, id));
  // Live overlays using this profile are flagged; they switch only on an explicit apply.
  const affected = await t
    .update(overlays)
    .set({ pendingThemeProfileVersionId: v!.id, updatedAt: new Date() })
    .where(and(eq(overlays.organisationId, ctx.actor.organisationId), sql`${overlays.themeProfileVersionId} in (select id from theme_profile_versions where profile_id = ${id})`))
    .returning({ id: overlays.id });
  for (const o of affected) await enqueueOutbox(t, { organisationId: ctx.actor.organisationId, topic: 'overlay.theme.pending', aggregateType: 'overlay', aggregateId: o.id, payload: { themeProfileVersionId: v!.id, version } });
  await audit(t, ctx.actor, 'theme_profile.publish', 'theme_profile', id, { after: { version } });
  return v!;
}

export async function publishProfile(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'theme.write');
  return tx(ctx, (t) => publishProfileTx(ctx, t, id));
}

/** Effective theme config for a pinned profile version (theme version defaults + profile overrides). */
export async function effectiveTheme(t: Tx, profileVersionId: string | null, themeVersionId: string | null): Promise<{ config: ThemeConfig; logoAssetId: string | null; fontAssetId: string | null; sponsorSlots: Record<string, boolean> }> {
  if (profileVersionId) {
    const [pv] = await t.select({ pv: themeProfileVersions, tv: themeVersions }).from(themeProfileVersions).innerJoin(themeVersions, eq(themeVersions.id, themeProfileVersions.themeVersionId)).where(eq(themeProfileVersions.id, profileVersionId));
    if (pv) {
      const c = pv.pv.config as ProfileConfig & { themeKey: ThemeConfig['themeKey'] };
      const base = pv.tv.config as unknown as ThemeConfig;
      const { logoAssetId, fontAssetId, sponsorSlots, controlRoomLayoutId: _l, ...overrides } = c;
      return { config: { ...base, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) } as ThemeConfig, logoAssetId: logoAssetId ?? null, fontAssetId: fontAssetId ?? null, sponsorSlots: sponsorSlots ?? {} };
    }
  }
  if (themeVersionId) {
    const [tv] = await t.select().from(themeVersions).where(eq(themeVersions.id, themeVersionId));
    if (tv) return { config: tv.config as unknown as ThemeConfig, logoAssetId: null, fontAssetId: null, sponsorSlots: {} };
  }
  return { config: DEFAULT_THEMES.broadcast, logoAssetId: null, fontAssetId: null, sponsorSlots: {} };
}

// ------------------------------------------------------------------ designer templates

export async function listTemplates(ctx: Ctx) {
  return tx(ctx, async (t) => {
    const ts = await t.select().from(graphicTemplates).where(and(eq(graphicTemplates.organisationId, ctx.actor.organisationId), eq(graphicTemplates.status, 'active'))).orderBy(graphicTemplates.name);
    const vs = ts.length ? await t.select({ id: templateVersions.id, templateId: templateVersions.templateId, version: templateVersions.version, publishedAt: templateVersions.publishedAt }).from(templateVersions).where(inArray(templateVersions.templateId, ts.map((x) => x.id))).orderBy(desc(templateVersions.version)) : [];
    return ts.map((x) => ({ ...x, versions: vs.filter((v) => v.templateId === x.id) }));
  });
}

export async function getTemplate(ctx: Ctx, id: string) {
  return tx(ctx, async (t) => {
    const [x] = await t.select().from(graphicTemplates).where(and(eq(graphicTemplates.id, id), eq(graphicTemplates.organisationId, ctx.actor.organisationId)));
    if (!x) throw notFound('Template');
    const versions = await t.select().from(templateVersions).where(eq(templateVersions.templateId, id)).orderBy(desc(templateVersions.version));
    return { ...x, versions };
  });
}

export async function createTemplate(ctx: Ctx, input: { name: string; scene?: unknown }) {
  assertCan(ctx.actor, 'theme.write');
  const name = z.string().trim().min(1).max(60).parse(input.name);
  const scene = input.scene ?? emptyScene(name);
  return tx(ctx, async (t) => {
    const [x] = await t.insert(graphicTemplates).values({ organisationId: ctx.actor.organisationId, name, category: (scene as { category?: string }).category ?? 'People', draft: scene as Record<string, unknown> }).returning();
    await audit(t, ctx.actor, 'template.create', 'graphic_template', x!.id, { after: { name } });
    return x!;
  });
}

/** Draft save tolerates incomplete scenes (validation runs at publish); returns issues for the editor. */
export async function saveTemplateDraft(ctx: Ctx, id: string, scene: unknown) {
  assertCan(ctx.actor, 'theme.write');
  if (JSON.stringify(scene ?? null).length > 400_000) throw invalid('Template is too large');
  return tx(ctx, async (t) => {
    const r = await t.update(graphicTemplates).set({ draft: scene as Record<string, unknown>, name: (scene as { name?: string })?.name?.slice(0, 60) ?? undefined, updatedAt: new Date() }).where(and(eq(graphicTemplates.id, id), eq(graphicTemplates.organisationId, ctx.actor.organisationId))).returning();
    if (!r.length) throw notFound('Template');
    const v = validateScene(scene);
    return { template: r[0]!, validation: v.ok ? { ok: true, issues: [], warnings: v.warnings } : { ok: false, issues: v.issues, warnings: [] } };
  });
}

export async function publishTemplate(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'theme.write');
  return tx(ctx, async (t) => {
    const [x] = await t.select().from(graphicTemplates).where(and(eq(graphicTemplates.id, id), eq(graphicTemplates.organisationId, ctx.actor.organisationId))).for('update');
    if (!x) throw notFound('Template');
    const v = validateScene(x.draft);
    if (!v.ok) throw invalid('Fix the template issues before publishing', v.issues.map((i) => ({ field: i.path, message: i.message })), 'TEMPLATE_INVALID');
    const assetIds: string[] = [];
    const walk = (els: { type: string; assetId?: string; children?: unknown[] }[]) => els.forEach((e) => { if (e.assetId) assetIds.push(e.assetId); if (e.children) walk(e.children as never); });
    walk(v.scene.elements as never);
    const version = x.currentVersion + 1;
    const [tv] = await t
      .insert(templateVersions)
      .values({ organisationId: ctx.actor.organisationId, templateId: id, version, scene: v.scene as never, variables: v.scene.variables, layers: [v.scene.layer], assetIds, publishedBy: ctx.actor.userId })
      .returning();
    await t.update(graphicTemplates).set({ currentVersion: version, category: v.scene.category, updatedAt: new Date() }).where(eq(graphicTemplates.id, id));
    await audit(t, ctx.actor, 'template.publish', 'graphic_template', id, { after: { version } });
    return { version: tv!, warnings: v.warnings };
  });
}

export async function archiveTemplate(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'theme.write');
  return tx(ctx, async (t) => {
    const r = await t.update(graphicTemplates).set({ status: 'archived' }).where(and(eq(graphicTemplates.id, id), eq(graphicTemplates.organisationId, ctx.actor.organisationId))).returning();
    if (!r.length) throw notFound('Template');
    return r[0];
  });
}

/** Published custom templates (latest version each) available to an organisation's overlays. */
export async function publishedCustomTemplates(t: Tx, organisationId: string) {
  const rows = await t
    .select({ v: templateVersions, tpl: graphicTemplates })
    .from(templateVersions)
    .innerJoin(graphicTemplates, eq(graphicTemplates.id, templateVersions.templateId))
    .where(and(eq(templateVersions.organisationId, organisationId), eq(graphicTemplates.status, 'active'), eq(templateVersions.version, graphicTemplates.currentVersion)));
  return rows.map((r) => ({ key: `custom:${r.v.id}`, scene: r.v.scene, assetIds: r.v.assetIds, templateId: r.tpl.id, name: r.tpl.name }));
}

export { conflict };
