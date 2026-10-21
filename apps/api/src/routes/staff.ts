// Site staff console (/api/v1/staff): organisations, accounts, public content, the staff team and the staff log.
// Every route resolves the signed-in account's staff role; the service checks what that role may do.
import { z } from 'zod';
import { STAFF_DESCRIPTIONS, STAFF_LABELS, STAFF_ROLES, staffCan, STAFF_ACTIONS, type StaffAction } from '@bs/domain';
import { staffSvc } from '@bs/services';
import type { AppBundle } from '../app';

const id = z.object({ id: z.string().uuid() });
const userId = z.object({ id: z.string().min(1).max(200) });
const P = <T extends z.ZodTypeAny>(s: T, v: unknown) => s.parse(v) as z.infer<T>;
const body = (v: unknown) => (v ?? {}) as Record<string, string>;

export function registerStaffRoutes(b: AppBundle) {
  const { app, staffFor, forgetOrg, auth } = b;

  app.get('/api/v1/staff/me', async (req) => {
    const s = await staffFor(req);
    return {
      ...s.staff,
      label: STAFF_LABELS[s.staff.role],
      can: Object.fromEntries((Object.keys(STAFF_ACTIONS) as StaffAction[]).map((a) => [a, staffCan(s.staff.role, a)])),
      roles: STAFF_ROLES.map((r) => ({ role: r, label: STAFF_LABELS[r], description: STAFF_DESCRIPTIONS[r] })),
    };
  });

  // organisations
  app.get('/api/v1/staff/organisations', async (req) => staffSvc.listOrganisations(await staffFor(req), req.query as never));
  app.get('/api/v1/staff/organisations/:id', async (req) => staffSvc.getOrganisation(await staffFor(req), P(id, req.params).id));
  app.post('/api/v1/staff/organisations/:id/suspend', async (req) => {
    const orgId = P(id, req.params).id;
    const r = await staffSvc.suspendOrganisation(await staffFor(req), orgId, body(req.body) as never);
    forgetOrg(orgId);
    return r;
  });
  app.post('/api/v1/staff/organisations/:id/reactivate', async (req) => {
    const orgId = P(id, req.params).id;
    const r = await staffSvc.reactivateOrganisation(await staffFor(req), orgId, body(req.body));
    forgetOrg(orgId);
    return r;
  });
  app.put('/api/v1/staff/organisations/:id/plan', async (req) => staffSvc.setOrganisationPlan(await staffFor(req), P(id, req.params).id, body(req.body) as never));
  app.post('/api/v1/staff/organisations/:id/match-pages/:matchId/take-down', async (req) => {
    const p = P(z.object({ id: z.string().uuid(), matchId: z.string().uuid() }), req.params);
    return staffSvc.takeDownMatchPage(await staffFor(req), p.id, p.matchId, body(req.body) as never);
  });
  app.post('/api/v1/staff/organisations/:id/share-links/:shareId/revoke', async (req) => {
    const p = P(z.object({ id: z.string().uuid(), shareId: z.string().uuid() }), req.params);
    return staffSvc.revokeShareLink(await staffFor(req), p.id, p.shareId, body(req.body) as never);
  });
  app.post('/api/v1/staff/public-links/lookup', async (req) => staffSvc.lookupPublicLink(await staffFor(req), body(req.body) as never));

  // accounts
  app.get('/api/v1/staff/users', async (req) => staffSvc.listUsers(await staffFor(req), req.query as never));
  app.get('/api/v1/staff/users/:id', async (req) => staffSvc.getUser(await staffFor(req), P(userId, req.params).id));
  app.post('/api/v1/staff/users/:id/disable', async (req) => staffSvc.disableUser(await staffFor(req), P(userId, req.params).id, body(req.body) as never));
  app.post('/api/v1/staff/users/:id/enable', async (req) => staffSvc.enableUser(await staffFor(req), P(userId, req.params).id, body(req.body)));
  app.post('/api/v1/staff/users/:id/sign-out', async (req) => staffSvc.signOutUser(await staffFor(req), P(userId, req.params).id, body(req.body)));
  app.post('/api/v1/staff/users/:id/resend-verification', async (req) =>
    staffSvc.resendVerification(await staffFor(req), P(userId, req.params).id, async (email) => {
      await auth.api.sendVerificationEmail({ body: { email, callbackURL: '/verify-email?ok=1' } });
    }),
  );

  // the staff team
  app.get('/api/v1/staff/team', async (req) => staffSvc.listStaff(await staffFor(req)));
  app.post('/api/v1/staff/team', async (req, reply) => reply.code(201).send(await staffSvc.addStaff(await staffFor(req), body(req.body) as never)));
  app.patch('/api/v1/staff/team/:id', async (req) => staffSvc.setStaffRole(await staffFor(req), P(userId, req.params).id, body(req.body) as never));
  app.delete('/api/v1/staff/team/:id', async (req) => staffSvc.removeStaff(await staffFor(req), P(userId, req.params).id));

  // the staff log
  app.get('/api/v1/staff/activity', async (req) => staffSvc.listActivity(await staffFor(req), req.query as never));
}
