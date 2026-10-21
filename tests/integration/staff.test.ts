// Site-wide staff over HTTP against real PostgreSQL (application role, row-level security on): an Owner from
// PLATFORM_OWNER_EMAILS, Support, Moderator and Admin staff, and an organisation that is looked up, has a public
// match page taken down, is suspended and reactivated, given a plan; accounts disabled, enabled and signed out.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, organisations, outboxEvents, withTenant, withUser } from '@bs/db';
import { getConfig } from '@bs/config';
import { buildApp, type AppBundle } from '../../apps/api/src/app';
import { registerRoutes } from '../../apps/api/src/routes';
import { Client } from '../http-client';

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const links: { kind: string; email: string; url: string }[] = [];
const origin = new URL(config.PUBLIC_WEB_URL).origin;
const tag = Date.now().toString(36);
const mail = (who: string) => `${who}-${tag}@example.test`;
const password = 'correct-horse-battery-1';
let b: AppBundle;

beforeAll(async () => {
  b = await buildApp({
    db,
    config: { ...config, PUBLIC_API_URL: origin, PLATFORM_OWNER_EMAILS: ` ${mail('owner').toUpperCase()} , someone-else@example.test` },
    mailer: { send: async () => undefined },
    onEmailLink: (kind, email, url) => links.push({ kind, email, url }),
  });
  registerRoutes(b);
  await b.app.ready();
});
afterAll(async () => {
  await b.app.close();
  await pool.end();
});

let n = 0;
async function signUp(who: string, opts: { verify?: boolean } = {}) {
  const c = new Client(() => b, origin, { 'x-forwarded-for': `10.77.0.${++n}` });
  const email = mail(who);
  expect((await c.req('POST', '/api/auth/sign-up/email', { email, password, name: who[0]!.toUpperCase() + who.slice(1) })).status).toBe(200);
  if (opts.verify !== false) {
    const v = new URL(links.find((l) => l.kind === 'verify' && l.email === email)!.url);
    await c.req('GET', v.pathname + v.search);
  }
  const me = await c.req('GET', '/api/v1/me');
  return { c, email, id: (me.json.user as { id: string } | undefined)?.id ?? '' };
}

describe('site staff', () => {
  const s: Record<string, Awaited<ReturnType<typeof signUp>>> = {};
  let orgId = '';
  let matchId = '';
  let pageUrl = '';

  it('an Owner named in PLATFORM_OWNER_EMAILS; other accounts are not staff', async () => {
    s.owner = await signUp('owner');
    expect((await s.owner.c.req('GET', '/api/v1/me')).json.staff).toEqual({ role: 'owner', label: 'Owner' });
    const sm = await s.owner.c.req('GET', '/api/v1/staff/me');
    expect(sm.json).toMatchObject({ role: 'owner', source: 'config', can: { 'staff.manage': true, 'organisation.suspend': true } });

    s.alice = await signUp('alice');
    expect((await s.alice.c.req('GET', '/api/v1/me')).json.staff).toBeNull();
    expect((await s.alice.c.req('GET', '/api/v1/staff/me')).json.error?.code).toBe('NOT_STAFF');
    expect((await s.alice.c.req('GET', '/api/v1/staff/organisations')).status).toBe(403);
    expect((await new Client(() => b, origin).req('GET', '/api/v1/staff/organisations')).status).toBe(401);

    // Alice's organisation, with a match that has a public page
    const org = await s.alice.c.req('POST', '/api/v1/organisations', { name: `Alice Media ${tag}`, timezone: 'Australia/Brisbane' });
    orgId = org.json.id as string;
    const comp = await s.alice.c.req('POST', '/api/v1/competitions', { name: 'Bay League', sport: 'football', defaultTimezone: 'Australia/Brisbane' });
    const season = await s.alice.c.req('POST', `/api/v1/competitions/${comp.json.id}/seasons`, { name: '2026' });
    const team = async (n: string, a: string) => (await s.alice.c.req('POST', '/api/v1/teams', { name: n, shortName: n, abbreviation: a, sport: 'football' })).json.id;
    const m = await s.alice.c.req('POST', '/api/v1/matches', { competitionId: comp.json.id, seasonId: season.json.id, homeTeamId: await team('Harbour', 'HAR'), awayTeamId: await team('Bayside', 'BAY'), kickoffLocal: '2026-11-07 19:00', timezone: 'Australia/Brisbane' });
    matchId = m.json.id as string;
    pageUrl = (await s.alice.c.req('POST', `/api/v1/matches/${matchId}/share`, { action: 'create' })).json.url as string;
    expect(pageUrl).toMatch(/\/m\//);
  });

  it('Owners add staff by email; Support reads the directories but cannot act', async () => {
    s.sam = await signUp('sam');
    s.mo = await signUp('mo');
    s.ada = await signUp('ada');
    expect((await s.owner.c.req('POST', '/api/v1/staff/team', { email: mail('nobody'), role: 'support' })).json.error?.code).toBe('NO_ACCOUNT');
    for (const [who, role] of [['sam', 'support'], ['mo', 'moderator'], ['ada', 'admin']] as const) {
      const r = await s.owner.c.req('POST', '/api/v1/staff/team', { email: mail(who).toUpperCase(), role });
      expect(r.status).toBe(201);
    }
    const team = await s.sam.c.req('GET', '/api/v1/staff/team');
    expect((team.json as unknown as { email: string; role: string }[]).filter((x) => x.email.endsWith(`${tag}@example.test`)).map((x) => [x.email.split('-')[0], x.role])).toEqual([['owner', 'owner'], ['ada', 'admin'], ['mo', 'moderator'], ['sam', 'support']]);

    // the directory finds an organisation by an owner's email; the detail shows members and counts
    const list = await s.sam.c.req('GET', `/api/v1/staff/organisations?search=${encodeURIComponent(mail('alice'))}`);
    expect(list.json).toMatchObject({ total: 1, items: [{ id: orgId, status: 'active', members: 1, owners: mail('alice') }] });
    const detail = await s.sam.c.req('GET', `/api/v1/staff/organisations/${orgId}`);
    expect(detail.json).toMatchObject({ organisation: { id: orgId, status: 'active' }, counts: { competitions: 1, matches: 1 }, members: [{ email: mail('alice'), role: 'owner' }], publicPages: [{ matchId, home: 'Harbour', away: 'Bayside' }] });
    expect(JSON.stringify(detail.json)).not.toMatch(new RegExp(pageUrl.split('/m/')[1]!)); // the page's link is not shown
    const users = await s.sam.c.req('GET', `/api/v1/staff/users?search=${encodeURIComponent(mail('alice'))}`);
    expect(users.json).toMatchObject({ total: 1, items: [{ email: mail('alice'), organisations: 1, staffRole: null }] });

    // Support cannot take content down, suspend, disable, manage staff or read the staff log
    expect((await s.sam.c.req('POST', '/api/v1/staff/public-links/lookup', { url: pageUrl })).status).toBe(403);
    expect((await s.sam.c.req('POST', `/api/v1/staff/organisations/${orgId}/suspend`, { reason: 'testing' })).status).toBe(403);
    expect((await s.sam.c.req('POST', `/api/v1/staff/users/${s.alice.id}/disable`, { reason: 'testing' })).status).toBe(403);
    expect((await s.sam.c.req('POST', '/api/v1/staff/team', { email: mail('alice'), role: 'support' })).status).toBe(403);
    expect((await s.sam.c.req('GET', '/api/v1/staff/activity')).status).toBe(403);

    // Support resends a verification email to an account that has not verified
    const una = await signUp('una', { verify: false });
    const before = links.filter((l) => l.email === una.email && l.kind === 'verify').length;
    const unaId = ((await s.sam.c.req('GET', `/api/v1/staff/users?search=${encodeURIComponent(una.email)}`)).json.items as { id: string }[])[0]!.id;
    expect((await s.sam.c.req('POST', `/api/v1/staff/users/${unaId}/resend-verification`)).json).toEqual({ sent: true });
    expect(links.filter((l) => l.email === una.email && l.kind === 'verify').length).toBe(before + 1);
    expect((await s.sam.c.req('POST', `/api/v1/staff/users/${s.alice.id}/resend-verification`)).json.error?.code).toBe('ALREADY_VERIFIED');
  });

  it('a Moderator looks up a reported public link and takes the match page down', async () => {
    const token = pageUrl.split('/m/')[1]!;
    expect((await new Client(() => b, origin).req('GET', `/api/v1/public/match/${token}`)).status).toBe(200);
    const hit = await s.mo.c.req('POST', '/api/v1/staff/public-links/lookup', { url: pageUrl });
    expect(hit.json).toMatchObject({ kind: 'match_page', organisation: { id: orgId, name: `Alice Media ${tag}` }, match: { id: matchId, title: 'Harbour v Bayside' } });
    expect((await s.mo.c.req('POST', '/api/v1/staff/public-links/lookup', { url: 'https://example.test/somewhere/else' })).status).toBe(422);
    expect((await s.mo.c.req('POST', `/api/v1/staff/organisations/${orgId}/match-pages/${matchId}/take-down`, {})).json.error?.code).toBe('VALIDATION_FAILED'); // a reason is required
    expect((await s.mo.c.req('POST', `/api/v1/staff/organisations/${orgId}/match-pages/${matchId}/take-down`, { reason: 'Reported: offensive team names' })).json).toEqual({ ok: true });
    expect((await new Client(() => b, origin).req('GET', `/api/v1/public/match/${token}`)).status).toBe(404);
    // a Moderator cannot suspend
    expect((await s.mo.c.req('POST', `/api/v1/staff/organisations/${orgId}/suspend`, { reason: 'testing' })).status).toBe(403);
  });

  it('an Admin suspends and reactivates an organisation; members are told it is suspended', async () => {
    expect((await s.ada.c.req('POST', `/api/v1/staff/organisations/${orgId}/suspend`, { reason: 'Unpaid invoices' })).json).toEqual({ status: 'suspended' });
    // connected app sessions and outputs of the organisation are dropped by the realtime server
    const ev = await withTenant(db, { organisationId: orgId }, (t) => t.select().from(outboxEvents).where(eq(outboxEvents.topic, 'organisation.suspended')));
    expect(ev.map((e) => e.aggregateId)).toEqual([orgId]);
    const blocked = await s.alice.c.req('GET', '/api/v1/competitions');
    expect(blocked.status).toBe(403);
    expect(blocked.json.error?.code).toBe('ORGANISATION_SUSPENDED');
    expect((await s.alice.c.req('GET', '/api/v1/me')).json).toMatchObject({ organisations: [{ id: orgId, status: 'suspended' }], activeOrganisation: { id: orgId, status: 'suspended' } });
    expect((await s.ada.c.req('GET', `/api/v1/staff/organisations?status=suspended&search=${encodeURIComponent(`Alice Media ${tag}`)}`)).json).toMatchObject({ total: 1 });
    // the organisation's own log shows what staff did, with the reason
    const d = await s.ada.c.req('GET', `/api/v1/staff/organisations/${orgId}`);
    expect((d.json.activity as { action: string; actorType: string; reason: string | null }[]).slice(0, 2)).toEqual([
      expect.objectContaining({ action: 'staff.organisation.suspend', actorType: 'staff', reason: 'Unpaid invoices' }),
      expect.objectContaining({ action: 'staff.match.unshare', actorType: 'staff', reason: 'Reported: offensive team names' }),
    ]);
    expect((await s.ada.c.req('POST', `/api/v1/staff/organisations/${orgId}/suspend`, { reason: 'again' })).json.error?.code).toBe('ALREADY_SUSPENDED');
    expect((await s.ada.c.req('POST', `/api/v1/staff/organisations/${orgId}/reactivate`, {})).json).toEqual({ status: 'active' });
    expect((await s.alice.c.req('GET', '/api/v1/competitions')).status).toBe(200);

    // and gives it a plan by hand
    expect((await s.ada.c.req('PUT', `/api/v1/staff/organisations/${orgId}/plan`, { plan: 'club', reason: 'Sponsored club' })).json).toEqual({ plan: 'club' });
    expect((await s.ada.c.req('GET', `/api/v1/staff/organisations/${orgId}`)).json).toMatchObject({ entitlements: { plan: 'club' } });
  });

  it('an Admin disables an account (signed out at once, cannot sign in), enables it, and signs people out', async () => {
    const d = await s.ada.c.req('POST', `/api/v1/staff/users/${s.alice.id}/disable`, { reason: 'Abusive messages to support' });
    expect(d.json).toMatchObject({ disabled: true });
    expect((d.json.sessionsEnded as number) >= 1).toBe(true);
    expect((await s.alice.c.req('GET', '/api/v1/me')).status).toBe(401);
    const again = new Client(() => b, origin, { 'x-forwarded-for': '10.77.1.1' });
    const r = await again.req('POST', '/api/auth/sign-in/email', { email: mail('alice'), password });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect((await s.ada.c.req('GET', `/api/v1/staff/users/${s.alice.id}`)).json).toMatchObject({ disabledReason: 'Abusive messages to support', activeSessions: 0, organisations: [{ organisationId: orgId, role: 'owner' }] });
    await s.ada.c.req('POST', `/api/v1/staff/users/${s.alice.id}/enable`, {});
    expect((await again.req('POST', '/api/auth/sign-in/email', { email: mail('alice'), password })).status).toBe(200);
    expect((await again.req('GET', '/api/v1/competitions')).status).toBe(200);

    // never their own account, never an Owner's
    expect((await s.ada.c.req('POST', `/api/v1/staff/users/${s.ada.id}/disable`, { reason: 'testing' })).status).toBe(403);
    expect((await s.ada.c.req('POST', `/api/v1/staff/users/${s.owner.id}/sign-out`, {})).status).toBe(403);
    // sign out everywhere
    expect((await s.ada.c.req('POST', `/api/v1/staff/users/${s.sam.id}/sign-out`, {})).json).toMatchObject({ sessionsEnded: 1 });
    expect((await s.sam.c.req('GET', '/api/v1/staff/me')).status).toBe(401);
  });

  it('staff ranks: Admins manage Moderators and Support only; the configured Owner is changed in configuration', async () => {
    expect((await s.ada.c.req('PATCH', `/api/v1/staff/team/${s.mo.id}`, { role: 'support' })).json).toMatchObject({ role: 'support' });
    expect((await s.ada.c.req('PATCH', `/api/v1/staff/team/${s.mo.id}`, { role: 'admin' })).json.error?.message).toBe('Only an Owner can make someone an Admin');
    expect((await s.ada.c.req('PATCH', `/api/v1/staff/team/${s.ada.id}`, { role: 'owner' })).status).toBe(403);
    expect((await s.ada.c.req('DELETE', `/api/v1/staff/team/${s.owner.id}`)).status).toBe(403);
    expect((await s.mo.c.req('DELETE', `/api/v1/staff/team/${s.sam.id}`)).status).toBe(403);
    // a second Owner cannot remove the one from configuration
    await s.owner.c.req('PATCH', `/api/v1/staff/team/${s.ada.id}`, { role: 'owner' });
    expect((await s.ada.c.req('DELETE', `/api/v1/staff/team/${s.owner.id}`)).json.error?.code).toBe('OWNER_FROM_CONFIG');
    expect((await s.owner.c.req('DELETE', `/api/v1/staff/team/${s.ada.id}`)).json).toMatchObject({ role: null });
    expect((await s.ada.c.req('GET', '/api/v1/staff/me')).json.error?.code).toBe('NOT_STAFF');

    // the staff log has every action, with who did it and why
    const log = (await s.owner.c.req('GET', '/api/v1/staff/activity?limit=200')).json as unknown as { action: string; actor: string; reason: string | null; organisationId: string | null }[];
    const mine = log.filter((x) => x.actor?.endsWith(`${tag}@example.test`));
    expect(mine.map((x) => x.action)).toEqual(expect.arrayContaining(['staff.add', 'organisation.view', 'user.resend_verification', 'content.match_page_down', 'organisation.suspend', 'organisation.reactivate', 'organisation.plan', 'user.disable', 'user.enable', 'user.sign_out', 'staff.change', 'staff.remove']));
    expect(mine.find((x) => x.action === 'organisation.suspend')).toMatchObject({ actor: mail('ada'), reason: 'Unpaid invoices', organisationId: orgId });
  });

  it('staff read every organisation but write only inside its tenant context (row-level security)', async () => {
    // as a staff member without a tenant context: other organisations are visible, not writable
    const seen = await withUser(db, s.owner.id, (t) => t.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, orgId)));
    expect(seen).toHaveLength(1);
    const changed = await withUser(db, s.owner.id, (t) => t.update(organisations).set({ name: 'Renamed' }).where(eq(organisations.id, orgId)).returning());
    expect(changed).toHaveLength(0);
    // a non-staff account sees only its own organisations
    expect(await withUser(db, s.mo.id, (t) => t.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, orgId)))).toHaveLength(1); // mo is still Support
    const outsider = await signUp('outsider');
    expect(await withUser(db, outsider.id, (t) => t.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, orgId)))).toHaveLength(0);
  });
});
