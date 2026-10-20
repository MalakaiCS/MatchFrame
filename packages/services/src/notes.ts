// Run sheet and notes per match: timed lines the production team shares in the control room ("KO-10 ident",
// "HT sponsor read") and free notes. Visible to everyone who can see the match; edited by operators.
import { and, asc, eq, sql } from 'drizzle-orm';
import { matchNotes, matches } from '@bs/db';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { notFound } from './errors';
import { tx, type Ctx } from './context';

export const noteInput = z.object({
  kind: z.enum(['note', 'runsheet']).default('runsheet'),
  atLabel: z.string().trim().max(16).nullable().optional(),
  body: z.string().trim().min(1).max(500),
  position: z.number().int().min(0).max(10_000).optional(),
});

async function matchFor(ctx: Ctx, t: Parameters<Parameters<typeof tx>[1]>[0], matchId: string, write: boolean) {
  const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
  if (!m) throw notFound('Match');
  assertCan(ctx.actor, write ? 'overlay.operate' : 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
  return m;
}

export async function listNotes(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    await matchFor(ctx, t, matchId, false);
    return t.select().from(matchNotes).where(eq(matchNotes.matchId, matchId)).orderBy(asc(matchNotes.position), asc(matchNotes.createdAt));
  });
}

export async function addNote(ctx: Ctx, matchId: string, input: z.input<typeof noteInput>) {
  const d = noteInput.parse(input);
  return tx(ctx, async (t) => {
    await matchFor(ctx, t, matchId, true);
    const [row] = await t.select({ max: sql<number>`coalesce(max(${matchNotes.position}), 0)` }).from(matchNotes).where(eq(matchNotes.matchId, matchId));
    const [n] = await t.insert(matchNotes).values({ organisationId: ctx.actor.organisationId, matchId, kind: d.kind, atLabel: d.atLabel ?? null, body: d.body, position: d.position ?? Number(row?.max ?? 0) + 10, authorUserId: ctx.actor.userId }).returning();
    await audit(t, ctx.actor, 'match.note', 'match', matchId, { after: { kind: d.kind, atLabel: d.atLabel ?? null } });
    return n!;
  });
}

export async function updateNote(ctx: Ctx, matchId: string, noteId: string, input: Partial<z.input<typeof noteInput>> & { done?: boolean }) {
  const d = noteInput.partial().extend({ done: z.boolean().optional() }).parse(input);
  return tx(ctx, async (t) => {
    await matchFor(ctx, t, matchId, true);
    const [n] = await t.update(matchNotes).set({ ...d, updatedAt: new Date() }).where(and(eq(matchNotes.id, noteId), eq(matchNotes.matchId, matchId))).returning();
    if (!n) throw notFound('Note');
    return n;
  });
}

export async function deleteNote(ctx: Ctx, matchId: string, noteId: string) {
  return tx(ctx, async (t) => {
    await matchFor(ctx, t, matchId, true);
    const r = await t.delete(matchNotes).where(and(eq(matchNotes.id, noteId), eq(matchNotes.matchId, matchId))).returning();
    if (!r.length) throw notFound('Note');
    return { ok: true };
  });
}
