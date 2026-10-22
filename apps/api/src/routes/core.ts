// Identity, organisation, catalog, fixtures, matches and scoring routes (/api/v1).
import { z } from 'zod';
import { AppError, apiKeysSvc, catalog, finalsSvc, imports, matchesSvc, orgs, prefs, scoring, seasonData, staffSvc } from '@bs/services';
import { fixtureTemplateCsv, STAFF_LABELS } from '@bs/domain';
import type { AppBundle } from '../app';

const id = z.object({ id: z.string().uuid() });
const P = <T extends z.ZodTypeAny>(s: T, v: unknown) => s.parse(v) as z.infer<T>;

export function registerCoreRoutes(b: AppBundle) {
  const { app, ctxFor, loadSession, forgetOrg, deps } = b;

  // ---------------------------------------------------------------- me & organisations
  app.get('/api/v1/me', async (req) => {
    const s = await loadSession(req);
    if (!s) throw new AppError('UNAUTHENTICATED', 401, 'Sign in to continue');
    const mine = await orgs.listMyOrganisations(deps.db, s.user.id);
    let active = mine.find((o) => o.id === s.session.activeOrganisationId) ?? null;
    if (!active && mine.length === 1) active = await orgs.switchOrganisation(deps.db, s.user.id, s.session.id, mine[0]!.id);
    let grants: unknown[] = [];
    const staff = await staffSvc.resolveStaff(deps, s.user);
    if (active && active.status === 'active') {
      const ctx = await ctxFor(req).catch(() => null);
      grants = ctx?.actor.grants ?? [];
    }
    return {
      user: { id: s.user.id, name: s.user.name, email: s.user.email, emailVerified: s.user.emailVerified, twoFactorEnabled: !!(s.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled },
      organisations: mine,
      activeOrganisation: active,
      role: active ? mine.find((o) => o.id === active!.id)?.role : null,
      grants,
      product: { name: deps.config.PRODUCT_NAME, locale: deps.config.DEFAULT_LOCALE, timezone: deps.config.DEFAULT_TIMEZONE },
      features: { streaming: deps.config.STREAMING_ENABLED },
      staff: staff ? { role: staff.role, label: STAFF_LABELS[staff.role] } : null,
    };
  });

  app.get('/api/v1/me/preferences', async (req) => {
    const s = await loadSession(req);
    if (!s) throw new AppError('UNAUTHENTICATED', 401, 'Sign in to continue');
    return prefs.getPrefs(deps.db, s.user.id);
  });
  app.put('/api/v1/me/preferences', async (req) => {
    const s = await loadSession(req);
    if (!s) throw new AppError('UNAUTHENTICATED', 401, 'Sign in to continue');
    return prefs.mergePrefs(deps.db, s.user.id, req.body);
  });
  app.get('/api/v1/notifications', async (req) => prefs.listNotifications(await ctxFor(req)));
  app.post('/api/v1/notifications/:id/read', async (req) => prefs.markNotificationRead(await ctxFor(req), P(id, req.params).id));

  app.post('/api/v1/organisations', async (req, reply) => {
    const s = await loadSession(req);
    if (!s) throw new AppError('UNAUTHENTICATED', 401, 'Sign in to continue');
    if (!s.user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 403, 'Verify your email address first');
    const r = await orgs.createOrganisation(deps, s.user.id, req.body as never);
    await orgs.switchOrganisation(deps.db, s.user.id, s.session.id, r.organisation.id);
    return reply.code(201).send(r.organisation);
  });

  app.post('/api/v1/organisations/switch', async (req) => {
    const s = await loadSession(req);
    if (!s) throw new AppError('UNAUTHENTICATED', 401, 'Sign in to continue');
    const { organisationId } = P(z.object({ organisationId: z.string().uuid() }), req.body);
    return orgs.switchOrganisation(deps.db, s.user.id, s.session.id, organisationId);
  });

  app.get('/api/v1/organisations/current', async (req) => orgs.getOrganisation(await ctxFor(req)));
  app.patch('/api/v1/organisations/current', async (req) => {
    const ctx = await ctxFor(req);
    const r = await orgs.updateOrganisation(ctx, req.body as never);
    forgetOrg(ctx.actor.organisationId); // a changed two-step requirement applies at once
    return r;
  });
  app.put('/api/v1/organisations/current/entitlements', async (req) => orgs.setEntitlements(await ctxFor(req), req.body as never));

  app.get('/api/v1/members', async (req) => orgs.listMembers(await ctxFor(req)));
  app.patch('/api/v1/members/:id', async (req) => orgs.changeMemberRole(await ctxFor(req), P(id, req.params).id, P(z.object({ role: z.string() }), req.body).role as never));
  app.delete('/api/v1/members/:id', async (req) => orgs.revokeMember(await ctxFor(req), P(id, req.params).id));
  app.put('/api/v1/members/:id/grants', async (req) => orgs.setMemberGrants(await ctxFor(req), P(id, req.params).id, P(z.object({ grants: z.array(z.any()) }), req.body).grants));

  app.get('/api/v1/invitations', async (req) => orgs.listInvitations(await ctxFor(req)));
  app.post('/api/v1/invitations', async (req, reply) => {
    const r = await orgs.createInvitation(await ctxFor(req), req.body as never);
    return reply.code(201).send({ invitation: r.invitation, acceptUrl: r.acceptUrl });
  });
  app.delete('/api/v1/invitations/:id', async (req) => orgs.revokeInvitation(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/invitations/accept', async (req) => {
    const s = await loadSession(req);
    if (!s) throw new AppError('UNAUTHENTICATED', 401, 'Sign in to accept the invitation');
    const { token } = P(z.object({ token: z.string().min(20).max(200) }), req.body);
    const r = await orgs.acceptInvitation(deps, s.user, token);
    await orgs.switchOrganisation(deps.db, s.user.id, s.session.id, r.organisationId);
    return r;
  });

  app.get('/api/v1/audit', async (req) => {
    const q = P(z.object({ limit: z.coerce.number().int().optional(), resourceType: z.string().optional(), resourceId: z.string().optional() }), req.query);
    return orgs.listAudit(await ctxFor(req), q);
  });

  app.get('/api/v1/api-keys', async (req) => apiKeysSvc.listApiKeys(await ctxFor(req)));
  app.post('/api/v1/api-keys', async (req, reply) => reply.code(201).send(await apiKeysSvc.createApiKey(await ctxFor(req), req.body as never)));
  app.delete('/api/v1/api-keys/:id', async (req) => apiKeysSvc.revokeApiKey(await ctxFor(req), P(id, req.params).id));

  // ---------------------------------------------------------------- catalog
  app.get('/api/v1/competitions', async (req) => catalog.listCompetitions(await ctxFor(req), req.query as never));
  app.post('/api/v1/competitions', async (req, reply) => reply.code(201).send(await catalog.createCompetition(await ctxFor(req), req.body as never)));
  app.get('/api/v1/competitions/:id', async (req) => catalog.getCompetition(await ctxFor(req), P(id, req.params).id));
  app.patch('/api/v1/competitions/:id', async (req) => catalog.updateCompetition(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.get('/api/v1/rules-presets', async (req) => catalog.listRulesPresets(await ctxFor(req), (req.query as { sport?: string }).sport || undefined));
  app.post('/api/v1/rules-presets', async (req, reply) => reply.code(201).send(await catalog.saveRulesPreset(await ctxFor(req), req.body as never)));
  app.delete('/api/v1/rules-presets/:id', async (req) => catalog.deleteRulesPreset(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/competitions/:id/seasons', async (req, reply) => reply.code(201).send(await catalog.createSeason(await ctxFor(req), P(id, req.params).id, req.body as never)));
  app.patch('/api/v1/seasons/:id', async (req) => catalog.updateSeason(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.get('/api/v1/competitions/:id/seasons', async (req) => seasonData.listSeasons(await ctxFor(req), P(id, req.params).id));
  // ---------------------------------------------------------------- season data: tables, fixtures, player stats, rollover
  app.get('/api/v1/seasons/:id/standings', async (req) => seasonData.getStandings(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/seasons/:id/fixtures', async (req) => seasonData.getFixtures(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/seasons/:id/player-stats', async (req) => seasonData.getSeasonPlayerStats(await ctxFor(req), P(id, req.params).id));
  // finals series: the ladder's top teams in knockout rounds, each round from the winners of the last
  app.get('/api/v1/seasons/:id/finals', async (req) => finalsSvc.getFinals(await ctxFor(req), P(id, req.params).id));
  app.post('/api/v1/seasons/:id/finals/rounds', async (req, reply) => reply.code(201).send(await finalsSvc.createFinalsRound(await ctxFor(req), P(id, req.params).id, req.body as never)));
  app.post('/api/v1/seasons/:id/rollover', async (req, reply) => reply.code(201).send(await seasonData.rolloverSeason(await ctxFor(req), P(id, req.params).id, req.body as never)));

  app.get('/api/v1/clubs', async (req) => catalog.listClubs(await ctxFor(req)));
  app.post('/api/v1/clubs', async (req, reply) => reply.code(201).send(await catalog.createClub(await ctxFor(req), req.body as never)));
  app.patch('/api/v1/clubs/:id', async (req) => catalog.updateClub(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.get('/api/v1/teams', async (req) => catalog.listTeams(await ctxFor(req), req.query as never));
  app.post('/api/v1/teams', async (req, reply) => reply.code(201).send(await catalog.createTeam(await ctxFor(req), req.body as never)));
  app.get('/api/v1/teams/:id', async (req) => catalog.getTeam(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/teams/:id/history', async (req) => catalog.teamHistory(await ctxFor(req), P(id, req.params).id));
  app.patch('/api/v1/teams/:id', async (req) => catalog.updateTeam(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.delete('/api/v1/teams/:id', async (req) => catalog.deleteTeam(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/players', async (req) => catalog.listPlayers(await ctxFor(req), req.query as never));
  app.post('/api/v1/players', async (req, reply) => reply.code(201).send(await catalog.createPlayer(await ctxFor(req), req.body as never)));
  app.patch('/api/v1/players/:id', async (req) => catalog.updatePlayer(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.post('/api/v1/rosters', async (req, reply) => reply.code(201).send(await catalog.addToRoster(await ctxFor(req), req.body as never)));
  app.post('/api/v1/rosters/transfer', async (req) => catalog.transferPlayer(await ctxFor(req), req.body as never));
  app.delete('/api/v1/rosters/:id', async (req) => catalog.removeFromRoster(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/venues', async (req) => catalog.listVenues(await ctxFor(req)));
  app.post('/api/v1/venues', async (req, reply) => reply.code(201).send(await catalog.createVenue(await ctxFor(req), req.body as never)));
  app.patch('/api/v1/venues/:id', async (req) => catalog.updateVenue(await ctxFor(req), P(id, req.params).id, req.body as never));

  // ---------------------------------------------------------------- fixtures import
  app.get('/api/v1/imports/fixtures/template.csv', async (_req, reply) =>
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="fixtures-template.csv"').send(fixtureTemplateCsv()),
  );
  const importBody = z.object({ csv: z.string().max(2 * 1024 * 1024), options: z.any(), checksum: z.string().optional() });
  app.post('/api/v1/imports/fixtures/dry-run', async (req) => {
    const b2 = P(importBody, req.body);
    return imports.dryRunFixtureImport(await ctxFor(req), b2.csv, b2.options);
  });
  app.post('/api/v1/imports/fixtures/commit', async (req) => {
    const b2 = P(importBody.extend({ checksum: z.string() }), req.body);
    return imports.commitFixtureImport(await ctxFor(req), b2.csv, b2.options, b2.checksum);
  });

  // ---------------------------------------------------------------- matches
  app.get('/api/v1/matches', async (req) => matchesSvc.listMatches(await ctxFor(req), req.query as never));
  app.post('/api/v1/matches', async (req, reply) => reply.code(201).send(await matchesSvc.createMatch(await ctxFor(req), req.body as never)));
  app.get('/api/v1/matches/:id', async (req) => matchesSvc.getMatch(await ctxFor(req), P(id, req.params).id));
  app.patch('/api/v1/matches/:id', async (req) => matchesSvc.updateMatch(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.put('/api/v1/matches/:id/lineup', async (req) => matchesSvc.setLineup(await ctxFor(req), P(id, req.params).id, req.body as never));
  app.post('/api/v1/matches/:id/scorers', async (req) => matchesSvc.assignScorer(await ctxFor(req), P(id, req.params).id, P(z.object({ membershipId: z.string().uuid() }), req.body).membershipId));
  app.get('/api/v1/score/matches', async (req) => matchesSvc.listScorableMatches(await ctxFor(req)));
  app.post('/api/v1/matches/bulk', async (req, reply) => reply.code(201).send(await matchesSvc.bulkCreateMatches(await ctxFor(req), req.body as never)));
  app.post('/api/v1/matches/:id/copy-setup', async (req) => matchesSvc.copyMatchSetup(await ctxFor(req), P(id, req.params).id, P(z.object({ fromMatchId: z.string().uuid() }), req.body).fromMatchId));
  app.get('/api/v1/matches/:id/lineup/suggest', async (req) => {
    const q = P(z.object({ side: z.enum(['home', 'away']), source: z.enum(['last', 'default']).default('last') }), req.query);
    return matchesSvc.suggestLineup(await ctxFor(req), P(id, req.params).id, q.side, q.source);
  });
  app.get('/api/v1/matches/:id/preview', async (req) => seasonData.getMatchPreview(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/matches/:id/roster', async (req) => matchesSvc.matchRoster(await ctxFor(req), P(id, req.params).id));

  // ---------------------------------------------------------------- scoring
  app.get('/api/v1/matches/:id/state', async (req) => scoring.getMatchState(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/matches/:id/facts', async (req) => scoring.listFacts(await ctxFor(req), P(id, req.params).id));
  app.get('/api/v1/matches/:id/events', async (req) => {
    const q = P(z.object({ afterVersion: z.coerce.number().int().min(0) }), req.query);
    return scoring.listMatchEvents(await ctxFor(req), P(id, req.params).id, q.afterVersion);
  });
  app.post('/api/v1/matches/:id/commands', async (req) => {
    const ctx = await ctxFor(req);
    const source = ctx.actor.role === 'scorer' ? 'scorer' : ctx.actor.kind === 'api_key' ? 'api' : 'producer';
    return scoring.handleMatchCommand(ctx, P(id, req.params).id, req.body, source);
  });
  app.post('/api/v1/matches/:id/scorer-lease', async (req) => scoring.scorerLease(await ctxFor(req), P(id, req.params).id, req.body as never));
}
