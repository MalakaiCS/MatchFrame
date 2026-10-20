// A match's activity in plain words: who scored what, who took over scoring, what went to air, lineup changes,
// all from the audit trail and the accepted facts. Read-only.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { auditLogs, matchFacts, matches, overlays, users } from '@bs/db';
import { getAdapter } from '@bs/domain';
import { assertCan } from './authz';
import { notFound } from './errors';
import { tx, type Ctx } from './context';

export interface ActivityLine { at: string; who: string | null; text: string; kind: 'fact' | 'control' | 'graphics' | 'setup'; }

const AUDIT_WORDS: Record<string, (meta: Record<string, unknown>) => string> = {
  'match.lineup': (m) => `set the lineup (${(m.after as { home?: number })?.home ?? '?'} home, ${(m.after as { away?: number })?.away ?? '?'} away)`,
  'match.assign_scorer': () => 'assigned a scorer',
  'match.update': () => 'updated the match details',
  'match.copy_setup': () => 'copied the production setup from another match',
  'match.share': (m) => ((m.after as { shared?: boolean })?.shared ? 'shared the public match link' : 'turned the public match link off'),
  'match.note': () => 'added a run-sheet line',
  'scorer.lease.acquire': () => 'took over scoring',
  'scorer.lease.release': () => 'handed over scoring',
  'scorer.lease.takeover': () => 'took scoring from another device',
  'match.score_adjust': (m) => `adjusted the score (${JSON.stringify(m.after ?? {})})`,
  'match.fact.void': (m) => `undid an event (${String(m.reason ?? 'no reason given')})`,
  'match.fact.correct': () => 'corrected an event',
  'overlay.command': (m) => {
    const a = m.after as { type?: string; templateKey?: string } | undefined;
    const t = a?.templateKey?.replace('builtin:', '').replace(/_/g, ' ');
    return a?.type === 'TAKE_IN' ? `put ${t ?? 'a graphic'} on air` : a?.type === 'TAKE_OUT' ? `took ${t ?? 'a graphic'} off air` : a?.type === 'CLEAR_OUTPUT' ? 'cleared the output' : `sent ${a?.type?.toLowerCase().replace(/_/g, ' ') ?? 'a command'} to the output`;
  },
  'overlay.theme_profile': () => 'changed the look of the output',
  'overlay.format': (m) => `set the output format to ${(m.after as { format?: string })?.format ?? '16:9'}`,
  'overlay.game_plan': () => 'changed the automation plan',
  'demo.start': () => 'started a demo run',
};

export async function matchActivity(ctx: Ctx, matchId: string, limit = 120): Promise<ActivityLine[]> {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'competition.read', { matchId: m.id, competitionId: m.competitionId, teamIds: [m.homeTeamId, m.awayTeamId] });
    const ovs = await t.select({ id: overlays.id, name: overlays.name }).from(overlays).where(eq(overlays.matchId, matchId));
    const ids = [matchId, ...ovs.map((o) => o.id)];
    const audits = await t.select().from(auditLogs).where(and(eq(auditLogs.organisationId, ctx.actor.organisationId), inArray(auditLogs.resourceId, ids))).orderBy(desc(auditLogs.id)).limit(limit);
    const facts = await t.select().from(matchFacts).where(eq(matchFacts.matchId, matchId)).orderBy(asc(matchFacts.sequence));
    const userIds = [...new Set([...audits.map((a) => a.actorUserId), ...facts.map((f) => f.actorUserId)].filter((x): x is string => !!x))];
    const names = new Map((userIds.length ? await t.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : []).map((u) => [u.id, u.name]));
    const adapter = getAdapter(m.sport);
    const defs = adapter.eventTypes(m.rulesConfig as never);
    const phases = adapter.phases(m.rulesConfig as never);
    const lines: ActivityLine[] = [];
    for (const f of facts) {
      const who = f.actorUserId ? names.get(f.actorUserId) ?? null : f.source === 'api' ? 'Demo runner' : null;
      if (f.category === 'phase') {
        const to = (f.payload as { to?: string }).to ?? f.type;
        lines.push({ at: f.acceptedAt.toISOString(), who, text: `moved the match to ${phases.find((p) => p.id === to)?.label ?? to}`, kind: 'control' });
      } else if (f.category === 'event') {
        const def = defs.find((d) => d.type === f.type);
        const minute = f.clockMs != null ? ` at ${Math.floor(f.clockMs / 60000) + 1}'` : '';
        lines.push({ at: f.acceptedAt.toISOString(), who, text: `${f.voided ? 'recorded (later undone) ' : 'recorded '}${(def?.label ?? f.type).toLowerCase()}${f.side ? ` for ${f.side === 'home' ? 'the home side' : 'the away side'}` : ''}${minute}`, kind: 'fact' });
      }
    }
    for (const a of audits) {
      const word = AUDIT_WORDS[a.action];
      if (!word) continue;
      const ov = ovs.find((o) => o.id === a.resourceId);
      lines.push({ at: a.createdAt.toISOString(), who: a.actorUserId ? names.get(a.actorUserId) ?? null : null, text: `${word({ before: a.before, after: a.after, reason: a.reason } as Record<string, unknown>)}${ov ? ` (${ov.name})` : ''}`, kind: a.resourceType === 'overlay' ? 'graphics' : a.action.startsWith('scorer.') ? 'control' : 'setup' });
    }
    lines.sort((x, y) => y.at.localeCompare(x.at));
    return lines.slice(0, limit);
  });
}
