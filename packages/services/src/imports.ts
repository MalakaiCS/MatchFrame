// Fixture CSV import: parse/validate (dry-run) → explicit idempotent commit.
import { and, eq, inArray } from 'drizzle-orm';
import { competitions, matches, seasons, teams, venues } from '@bs/db';
import { importErrorsCsv, planFixtureImport, type ImportContext, type ImportPlan, SPORTS } from '@bs/domain';
import { z } from 'zod';
import { assertCan } from './authz';
import { audit } from './audit';
import { sha256 } from './crypto';
import { invalid } from './errors';
import { tx, type Ctx } from './context';
import { createMatchTx } from './matches';
import { createTeam } from './catalog';

export const importOptions = z.object({
  sport: z.enum(SPORTS),
  mode: z.enum(['skip_duplicates', 'update_matched_future']).default('skip_duplicates'),
  createMissingTeams: z.boolean().default(false),
  teamMappings: z.record(z.string(), z.string().uuid()).default({}),
  venueMappings: z.record(z.string(), z.string().uuid()).default({}),
});

const MAX_BYTES = 2 * 1024 * 1024;

async function buildContext(ctx: Ctx, opts: z.infer<typeof importOptions>) {
  return tx(ctx, async (t) => {
    const org = ctx.actor.organisationId;
    const comps = await t.select().from(competitions).where(eq(competitions.organisationId, org));
    const ss = await t.select().from(seasons).where(eq(seasons.organisationId, org));
    const ts = await t.select().from(teams).where(and(eq(teams.organisationId, org), eq(teams.sport, opts.sport)));
    const vs = await t.select().from(venues).where(eq(venues.organisationId, org));
    const ms = await t.select({ id: matches.id, externalId: matches.externalId, status: matches.status }).from(matches).where(eq(matches.organisationId, org));
    const norm = (k: string) => k.trim().toLowerCase().replace(/\s+/g, ' ');
    const c: ImportContext = {
      sport: opts.sport,
      competitions: comps.filter((x) => x.status !== 'archived').map((x) => ({ id: x.id, name: x.name, shortName: x.shortName, sport: x.sport })),
      seasons: ss.map((x) => ({ id: x.id, competitionId: x.competitionId, name: x.name })),
      teams: ts.filter((x) => x.status !== 'archived').map((x) => ({ id: x.id, name: x.name, shortName: x.shortName, abbreviation: x.abbreviation })),
      venues: vs.map((x) => ({ id: x.id, name: x.name })),
      teamMappings: Object.fromEntries(Object.entries(opts.teamMappings).map(([k, v]) => [norm(k), v])),
      venueMappings: Object.fromEntries(Object.entries(opts.venueMappings).map(([k, v]) => [norm(k), v])),
      createMissingTeams: opts.createMissingTeams,
      existingFixtures: ms
        .filter((m) => m.externalId)
        .map((m) => ({ id: m.id, externalId: m.externalId!, status: m.status === 'live' ? 'live' : ['completed', 'abandoned', 'cancelled'].includes(m.status) ? 'completed' : 'future' })),
      mode: opts.mode,
    };
    // mapped team ids must belong to this tenant
    const mapped = Object.values(c.teamMappings ?? {});
    if (mapped.some((id) => !ts.some((x) => x.id === id))) throw invalid('A team mapping points at an unknown team');
    return c;
  });
}

export async function dryRunFixtureImport(ctx: Ctx, csv: string, options: z.input<typeof importOptions>) {
  assertCan(ctx.actor, 'competition.write');
  if (Buffer.byteLength(csv) > MAX_BYTES) throw invalid('CSV file is larger than 2 MB');
  const opts = importOptions.parse(options);
  const plan = planFixtureImport(csv, await buildContext(ctx, opts));
  return { ...plan, checksum: sha256(csv + JSON.stringify(opts)), errorsCsv: plan.errors.length ? importErrorsCsv(plan.errors) : null };
}

/**
 * Commit re-validates against current data (the preview may be stale) and only proceeds when the
 * checksum matches a valid preview. External IDs are unique per competition, so a repeated commit is idempotent.
 */
export async function commitFixtureImport(ctx: Ctx, csv: string, options: z.input<typeof importOptions>, checksum: string) {
  assertCan(ctx.actor, 'competition.write');
  const opts = importOptions.parse(options);
  if (sha256(csv + JSON.stringify(opts)) !== checksum) throw invalid('The file or options changed since the preview. Run the preview again.', undefined, 'PREVIEW_MISMATCH');
  const plan: ImportPlan = planFixtureImport(csv, await buildContext(ctx, opts));
  if (!plan.valid) throw invalid('Fix the reported errors before importing', plan.errors.map((e) => ({ field: `row ${e.row}: ${e.field}`, message: e.message })), 'IMPORT_INVALID');
  return tx(ctx, async (t) => {
    const created: string[] = [];
    const updated: string[] = [];
    const skipped: { externalId: string; reason: string }[] = [];
    const newTeams = new Map<string, string>();
    for (const name of plan.summary.teamsToCreate) {
      const abbr = name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
      const team = await createTeam(ctx, { name, shortName: name.slice(0, 24), abbreviation: abbr, sport: opts.sport }, t);
      newTeams.set(name, team.id);
    }
    const teamId = (x: { id: string } | { create: string }) => ('id' in x ? x.id : newTeams.get(x.create)!);
    for (const r of plan.rows) {
      if (r.action === 'skip') {
        skipped.push({ externalId: r.externalId, reason: r.skipReason ?? 'skipped' });
        continue;
      }
      if (r.action === 'update' && r.existingId) {
        // never touch live/completed fixtures (re-checked under lock)
        const [cur] = await t.select().from(matches).where(and(eq(matches.id, r.existingId), inArray(matches.status, ['scheduled', 'postponed']))).for('update');
        if (!cur) {
          skipped.push({ externalId: r.externalId, reason: 'Fixture is no longer in the future' });
          continue;
        }
        await t
          .update(matches)
          .set({ round: r.round, venueId: r.venueId, scheduledAt: new Date(r.scheduledAt), timezone: r.timezone, scheduleVersion: cur.scheduleVersion + 1, updatedAt: new Date() })
          .where(eq(matches.id, cur.id));
        updated.push(r.externalId);
        continue;
      }
      const existing = await t.select({ id: matches.id }).from(matches).where(and(eq(matches.competitionId, r.competitionId), eq(matches.externalId, r.externalId)));
      if (existing.length) {
        skipped.push({ externalId: r.externalId, reason: 'Already imported' });
        continue;
      }
      await createMatchTx(ctx, t, {
        competitionId: r.competitionId,
        seasonId: r.seasonId,
        homeTeamId: teamId(r.homeTeam),
        awayTeamId: teamId(r.awayTeam),
        venueId: r.venueId,
        round: r.round,
        externalId: r.externalId,
        kickoffLocal: r.kickoffLocal,
        timezone: r.timezone,
        scheduledAt: new Date(r.scheduledAt),
      });
      created.push(r.externalId);
    }
    await audit(t, ctx.actor, 'fixtures.import', 'competition', plan.rows[0]?.competitionId ?? null, { after: { created: created.length, updated: updated.length, skipped: skipped.length, teamsCreated: newTeams.size } });
    return { created, updated, skipped, teamsCreated: [...newTeams.keys()] };
  });
}
