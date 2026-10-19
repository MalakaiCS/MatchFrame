// Permission matrix (spec §4). Enforced in HTTP handlers, socket joins, workers and storage access.
import type { Role } from '@bs/db';
import { forbidden } from './errors';

export type Action =
  | 'org.own' // ownership, organisation deletion, plans
  | 'org.manage' // members and broad settings
  | 'org.read'
  | 'competition.write' // competitions, rosters, fixtures
  | 'competition.read'
  | 'team_assets.write' // club manager: own team assets
  | 'theme.write' // themes, templates, game plans
  | 'theme.use'
  | 'stream.manage' // stream credentials & destinations
  | 'overlay.operate'
  | 'match.score'
  | 'sponsor.manage'
  | 'sponsor.trigger'
  | 'sponsor.report'
  | 'media.edit'
  | 'media.read'
  | 'audit.read'
  | 'reports.read';

export interface Grant {
  action: string;
  scopeType: 'organisation' | 'competition' | 'team' | 'match' | 'overlay' | 'output';
  scopeId: string | null;
  expiresAt?: Date | null;
}

export interface Actor {
  kind: 'user' | 'api_key' | 'system';
  userId: string | null;
  organisationId: string;
  membershipId: string | null;
  role: Role | 'system';
  grants: Grant[];
  accessVersion: number;
  requestId?: string;
}

export interface Target {
  competitionId?: string | null;
  matchId?: string | null;
  teamIds?: (string | null | undefined)[];
  overlayId?: string | null;
  outputId?: string | null;
  ownerTeamId?: string | null;
}

const FULL: Action[] = [
  'org.read', 'competition.write', 'competition.read', 'team_assets.write', 'theme.write', 'theme.use', 'stream.manage',
  'overlay.operate', 'match.score', 'sponsor.manage', 'sponsor.trigger', 'sponsor.report', 'media.edit', 'media.read', 'audit.read', 'reports.read',
];

/** Actions a role has across the whole organisation. */
const ROLE_WIDE: Record<Role, Action[]> = {
  owner: ['org.own', 'org.manage', ...FULL],
  admin: ['org.manage', ...FULL],
  producer: FULL,
  operator: ['org.read', 'theme.use'],
  scorer: ['org.read'],
  club_manager: ['org.read'],
  viewer: ['org.read'],
};

/** Actions a role may hold only within an assigned scope (via permission_grants). */
const ROLE_SCOPED: Record<Role, Action[]> = {
  owner: [],
  admin: [],
  producer: [],
  operator: ['competition.read', 'overlay.operate', 'stream.manage', 'sponsor.trigger', 'match.score', 'media.edit', 'media.read', 'audit.read'],
  scorer: ['competition.read', 'match.score', 'audit.read'],
  club_manager: ['competition.read', 'team_assets.write', 'media.edit', 'media.read', 'sponsor.manage'],
  viewer: ['competition.read', 'media.read', 'sponsor.report', 'reports.read'],
};

/** Reading assigned resources follows from any grant scoped to them. */
const READ_FROM_ANY_GRANT: Action[] = ['competition.read', 'media.read'];

function grantMatches(g: Grant, t: Target): boolean {
  if (g.expiresAt && g.expiresAt.getTime() < Date.now()) return false;
  switch (g.scopeType) {
    case 'organisation':
      return true;
    case 'competition':
      return !!t.competitionId && g.scopeId === t.competitionId;
    case 'match':
      return !!t.matchId && g.scopeId === t.matchId;
    case 'team':
      return !!g.scopeId && (t.teamIds ?? []).includes(g.scopeId);
    case 'overlay':
      return !!t.overlayId && g.scopeId === t.overlayId;
    case 'output':
      return !!t.outputId && g.scopeId === t.outputId;
  }
}

export function can(actor: Actor, action: Action, target: Target = {}): boolean {
  if (actor.role === 'system') return true;
  if (ROLE_WIDE[actor.role]?.includes(action)) return true;
  if (!ROLE_SCOPED[actor.role]?.includes(action)) return false;
  const relevant = actor.grants.filter((g) => grantMatches(g, target));
  if (relevant.some((g) => g.action === action)) return true;
  if (READ_FROM_ANY_GRANT.includes(action) && relevant.length > 0) return true;
  // club managers act on their own team's assets
  if (actor.role === 'club_manager' && (action === 'team_assets.write' || action === 'media.edit' || action === 'media.read') && target.ownerTeamId) {
    return actor.grants.some((g) => g.scopeType === 'team' && g.scopeId === target.ownerTeamId && (g.action === action || g.action === 'team_assets.write'));
  }
  return false;
}

export function assertCan(actor: Actor, action: Action, target: Target = {}, message?: string): void {
  if (!can(actor, action, target)) throw forbidden(message);
}

/** Does this actor have organisation-wide read of competitions/matches (vs. assigned only)? */
export const hasWideRead = (actor: Actor) => actor.role === 'system' || ROLE_WIDE[actor.role as Role]?.includes('competition.read') || actor.grants.some((g) => g.scopeType === 'organisation');

/** IDs of matches/competitions/teams an assigned-only actor may read. */
export function assignedScopes(actor: Actor) {
  const live = actor.grants.filter((g) => !g.expiresAt || g.expiresAt.getTime() > Date.now());
  return {
    matchIds: live.filter((g) => g.scopeType === 'match').map((g) => g.scopeId!),
    competitionIds: live.filter((g) => g.scopeType === 'competition').map((g) => g.scopeId!),
    teamIds: live.filter((g) => g.scopeType === 'team').map((g) => g.scopeId!),
  };
}

export const isScorerOnly = (actor: Actor) => actor.role === 'scorer';

export const systemActor = (organisationId: string, requestId?: string): Actor => ({
  kind: 'system',
  userId: null,
  organisationId,
  membershipId: null,
  role: 'system',
  grants: [],
  accessVersion: 0,
  requestId,
});
