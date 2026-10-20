// Reminders: a kick-off email (and web push when configured) to the match's scorers and the person who set it
// up, and a nudge when a match has been live for hours. Each reminder is sent once per match.
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { matchReminders, matchState, matches, memberships, permissionGrants, pushSubscriptions, teams, users, type Db } from '@bs/db';
import type { AppConfig } from '@bs/config';
import type { Mailer } from './mail';

export interface ReminderDeps {
  db: Db;
  config: AppConfig;
  mailer?: Mailer;
  /** Web Push sender (undefined when VAPID keys are not configured) */
  push?: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;
}

type MatchRow = typeof matches.$inferSelect;

async function recipients(db: Db, m: MatchRow) {
  const scorers = await db
    .select({ userId: memberships.userId, email: users.email, name: users.name })
    .from(permissionGrants)
    .innerJoin(memberships, eq(memberships.id, permissionGrants.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(permissionGrants.scopeType, 'match'), eq(permissionGrants.scopeId, m.id), inArray(permissionGrants.action, ['match.score', 'match.stats']), eq(memberships.status, 'active')));
  const creator = m.createdBy ? await db.select({ userId: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, m.createdBy)) : [];
  return { scorers, operators: creator };
}

async function alreadySent(db: Db, matchId: string, kind: string) {
  const [r] = await db.select({ id: matchReminders.id }).from(matchReminders).where(and(eq(matchReminders.matchId, matchId), eq(matchReminders.kind, kind)));
  return !!r;
}

async function sendTo(d: ReminderDeps, people: { userId: string; email: string }[], subject: string, text: string, pushBody: string, link: string) {
  for (const p of people) {
    if (d.mailer) await d.mailer.send(p.email, subject, `${text}\n\n${link}`, `<p>${text}</p><p><a href="${link}">${link}</a></p>`).catch(() => undefined);
    if (d.push) {
      const subs = await d.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, p.userId));
      for (const s of subs) await d.push({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: subject, body: pushBody, url: link })).catch(async (e: unknown) => {
        // a gone subscription (410) is removed; other failures are retried next time
        if (e && typeof e === 'object' && 'statusCode' in e && (e as { statusCode: number }).statusCode === 410) await d.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      });
    }
  }
}

const teamNames = async (db: Db, m: MatchRow) => {
  const ts = await db.select({ id: teams.id, name: teams.shortName }).from(teams).where(inArray(teams.id, [m.homeTeamId, m.awayTeamId]));
  return `${ts.find((t) => t.id === m.homeTeamId)?.name ?? 'Home'} v ${ts.find((t) => t.id === m.awayTeamId)?.name ?? 'Away'}`;
};

/** Worker loop (every minute): kick-off reminders 60 minutes out, and "still live" nudges after three hours. */
export async function reminderTick(d: ReminderDeps) {
  const now = Date.now();
  let sent = 0;
  const upcoming = await d.db.select().from(matches).where(and(eq(matches.status, 'scheduled'), eq(matches.isDemo, false), gte(matches.scheduledAt, new Date(now)), lte(matches.scheduledAt, new Date(now + 60 * 60_000))));
  for (const m of upcoming) {
    if (await alreadySent(d.db, m.id, 'kickoff')) continue;
    const label = await teamNames(d.db, m);
    const when = new Intl.DateTimeFormat('en-AU', { timeZone: m.timezone, hour: 'numeric', minute: '2-digit' }).format(m.scheduledAt);
    const { scorers, operators } = await recipients(d.db, m);
    await sendTo(d, scorers, `Kick-off at ${when}: ${label}`, `You are scoring ${label} today. Open the scorer before kick-off so the lineups and clock are ready.`, `You are scoring ${label} at ${when}.`, `${d.config.PUBLIC_WEB_URL}/score/${m.id}`);
    await sendTo(d, operators.filter((o) => !scorers.some((s) => s.userId === o.userId)), `Kick-off at ${when}: ${label}`, `${label} starts at ${when}. The match page has the checklist and the OBS link.`, `${label} starts at ${when}.`, `${d.config.PUBLIC_WEB_URL}/app/matches/${m.id}`);
    await d.db.insert(matchReminders).values({ organisationId: m.organisationId, matchId: m.id, kind: 'kickoff' }).onConflictDoNothing();
    sent++;
  }
  const stale = await d.db
    .select({ m: matches })
    .from(matches)
    .innerJoin(matchState, eq(matchState.matchId, matches.id))
    .where(and(eq(matches.status, 'live'), eq(matches.isDemo, false), lte(matchState.updatedAt, new Date(now - 3 * 3600_000))));
  for (const { m } of stale) {
    if (await alreadySent(d.db, m.id, 'left_live')) continue;
    const label = await teamNames(d.db, m);
    const { scorers, operators } = await recipients(d.db, m);
    const people = [...operators, ...scorers.filter((s) => !operators.some((o) => o.userId === s.userId))];
    await sendTo(d, people, `Still live: ${label}`, `${label} has been live for more than three hours without a change. If it is over, move it to full time so the graphics and reports close off.`, `${label} is still marked live.`, `${d.config.PUBLIC_WEB_URL}/app/matches/${m.id}`);
    await d.db.insert(matchReminders).values({ organisationId: m.organisationId, matchId: m.id, kind: 'left_live' }).onConflictDoNothing();
    sent++;
  }
  return sent;
}

export const _sql = sql;
