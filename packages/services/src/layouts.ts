// Reusable control-room section layouts (catalogue grouping/order, favourites, quick buttons).
import { and, eq } from 'drizzle-orm';
import { controlRoomLayouts } from '@bs/db';
import { z } from 'zod';
import { assertCan } from './authz';
import { notFound } from './errors';
import { tx, type Ctx } from './context';

export const layoutConfig = z.object({
  sections: z.array(z.object({ title: z.string().max(40), templateKeys: z.array(z.string().max(80)).max(60) })).max(12),
  favourites: z.array(z.string().max(80)).max(12).default([]),
  shortcuts: z.record(z.string().max(20), z.string().max(40)).default({}),
});

export async function listLayouts(ctx: Ctx) {
  return tx(ctx, (t) => t.select().from(controlRoomLayouts).where(eq(controlRoomLayouts.organisationId, ctx.actor.organisationId)).orderBy(controlRoomLayouts.name));
}

export async function saveLayout(ctx: Ctx, input: { id?: string; name: string; config: unknown }) {
  assertCan(ctx.actor, 'theme.write');
  const config = layoutConfig.parse(input.config);
  const name = z.string().trim().min(1).max(60).parse(input.name);
  return tx(ctx, async (t) => {
    if (input.id) {
      const r = await t.update(controlRoomLayouts).set({ name, config, updatedAt: new Date() }).where(and(eq(controlRoomLayouts.id, input.id), eq(controlRoomLayouts.organisationId, ctx.actor.organisationId))).returning();
      if (!r.length) throw notFound('Layout');
      return r[0]!;
    }
    const [r] = await t.insert(controlRoomLayouts).values({ organisationId: ctx.actor.organisationId, name, config }).returning();
    return r!;
  });
}

export async function deleteLayout(ctx: Ctx, id: string) {
  assertCan(ctx.actor, 'theme.write');
  return tx(ctx, async (t) => {
    await t.delete(controlRoomLayouts).where(and(eq(controlRoomLayouts.id, id), eq(controlRoomLayouts.organisationId, ctx.actor.organisationId)));
    return { ok: true };
  });
}
