// Media asset records. The upload/validation/normalisation pipeline lives in the media worker; this module
// holds shared registration helpers and listing.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { assetDerivatives, mediaAssets, type Tx } from '@bs/db';
import { assertCan } from './authz';
import { notFound } from './errors';
import { tx, type Ctx } from './context';
import { keys } from './storage';

export interface ProcessedFile {
  path: string;
  mime: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

const sha256File = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** Register an already validated/normalised file (seed fixtures, worker output) as a READY asset. */
export async function registerProcessedAsset(ctx: Ctx, t: Tx, input: { kind: 'image' | 'video' | 'audio' | 'logo'; name: string; original: ProcessedFile; broadcast?: ProcessedFile; tags?: string[]; ownerTeamId?: string | null }) {
  if (!ctx.storage) throw new Error('storage not configured');
  const id = crypto.randomUUID();
  const org = ctx.actor.organisationId;
  const okey = keys.assetOriginal(org, id);
  const size = await ctx.storage.putFile(okey, input.original.path, input.original.mime);
  const b = input.broadcast ?? input.original;
  const ext = b.mime === 'video/mp4' ? 'mp4' : b.mime === 'image/png' ? 'png' : b.mime === 'image/jpeg' ? 'jpg' : 'bin';
  const dkey = keys.assetDerivative(org, id, 'broadcast', ext);
  const dsize = await ctx.storage.putFile(dkey, b.path, b.mime);
  const [a] = await t
    .insert(mediaAssets)
    .values({ id, organisationId: org, kind: input.kind, name: input.name, tags: input.tags ?? [], originalKey: okey, originalMime: input.original.mime, detectedMime: input.original.mime, bytes: size, checksum: sha256File(input.original.path), width: b.width ?? null, height: b.height ?? null, durationMs: b.durationMs ?? null, state: 'READY', ownerTeamId: input.ownerTeamId ?? null, createdBy: ctx.actor.userId })
    .returning();
  await t.insert(assetDerivatives).values({ organisationId: org, assetId: id, purpose: 'broadcast', objectKey: dkey, mime: b.mime, bytes: dsize, width: b.width ?? null, height: b.height ?? null, durationMs: b.durationMs ?? null, checksum: sha256File(b.path) });
  return a!;
}

export async function listAssets(ctx: Ctx, q: { kind?: string; search?: string; includeArchived?: boolean } = {}) {
  assertCan(ctx.actor, 'org.read');
  return tx(ctx, async (t) => {
    const conds = [eq(mediaAssets.organisationId, ctx.actor.organisationId)];
    if (q.kind) conds.push(eq(mediaAssets.kind, q.kind));
    if (!q.includeArchived) conds.push(ne(mediaAssets.state, 'ARCHIVED'));
    const rows = await t.select().from(mediaAssets).where(and(...conds)).orderBy(desc(mediaAssets.createdAt)).limit(500);
    const s = q.search?.toLowerCase();
    return rows.filter((r) => !s || r.name.toLowerCase().includes(s) || r.tags.some((x) => x.toLowerCase().includes(s))).map((r) => ({ ...r, originalKey: undefined }));
  });
}

export async function assetsByIds(t: Tx, ids: string[]) {
  if (!ids.length) return [];
  return t.select().from(mediaAssets).where(inArray(mediaAssets.id, ids));
}

export async function getAsset(ctx: Ctx, id: string) {
  return tx(ctx, async (t) => {
    const [a] = await t.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.organisationId, ctx.actor.organisationId)));
    if (!a) throw notFound('Asset');
    const ds = await t.select().from(assetDerivatives).where(eq(assetDerivatives.assetId, id));
    return { ...a, originalKey: undefined, derivatives: ds.map((d) => ({ purpose: d.purpose, mime: d.mime, bytes: d.bytes, width: d.width, height: d.height, durationMs: d.durationMs })) };
  });
}
