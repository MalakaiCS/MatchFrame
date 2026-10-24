// Site-wide staff: the people who run the installation (not members of an organisation). Four roles, each with
// everything the one below it has. What each can do is listed here once; the API and the console both use it.

export const STAFF_ROLES = ['owner', 'admin', 'moderator', 'support'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_LABELS: Record<StaffRole, string> = { owner: 'Owner', admin: 'Admin', moderator: 'Moderator', support: 'Support' };

export const STAFF_DESCRIPTIONS: Record<StaffRole, string> = {
  support: 'Looks up organisations and accounts, sees an organisation’s members and recent activity, and resends verification emails.',
  moderator: 'Support, and takes down public content: public match pages and media share links.',
  admin: 'Moderator, and suspends organisations, disables accounts, signs people out, sets plans, manages Moderator and Support staff and reads the staff log.',
  owner: 'Everything, including adding and removing Admins and other Owners.',
};

const RANK: Record<StaffRole, number> = { support: 1, moderator: 2, admin: 3, owner: 4 };

export const isStaffRole = (r: unknown): r is StaffRole => typeof r === 'string' && (STAFF_ROLES as readonly string[]).includes(r);
export const staffRank = (r: StaffRole | null | undefined) => (r ? RANK[r] : 0);

/** Everything staff can do, with the lowest role allowed to do it. */
export const STAFF_ACTIONS = {
  'directory.read': 'support',
  'organisation.view': 'support',
  'user.view': 'support',
  'user.resend_verification': 'support',
  'enquiries.read': 'support',
  'enquiries.manage': 'support',
  'content.takedown': 'moderator',
  'organisation.suspend': 'admin',
  'organisation.plan': 'admin',
  'user.disable': 'admin',
  'user.sign_out': 'admin',
  'staff.manage': 'admin',
  'activity.read': 'admin',
  'enquiries.delete': 'admin',
} as const satisfies Record<string, StaffRole>;
export type StaffAction = keyof typeof STAFF_ACTIONS;

export function staffCan(role: StaffRole | null | undefined, action: StaffAction): boolean {
  return staffRank(role) >= RANK[STAFF_ACTIONS[action]];
}

/**
 * Whether `actor` may give `target` the role `next` (null: remove them from staff). `current` is the target's role
 * now (null: not staff yet). Owners manage everyone; Admins manage Moderators and Support only; nobody changes
 * their own role.
 */
export function canManageStaff(actor: { userId: string; role: StaffRole }, target: { userId: string; current: StaffRole | null }, next: StaffRole | null): { ok: true } | { ok: false; reason: string } {
  if (!staffCan(actor.role, 'staff.manage')) return { ok: false, reason: 'Only Admins and Owners manage staff' };
  if (actor.userId === target.userId) return { ok: false, reason: 'Ask another Owner or Admin to change your own role' };
  if (actor.role === 'owner') return { ok: true };
  const ceiling = RANK.moderator;
  if (staffRank(target.current) > ceiling) return { ok: false, reason: `Only an Owner can change an ${STAFF_LABELS[target.current!]}` };
  if (next && RANK[next] > ceiling) return { ok: false, reason: `Only an Owner can make someone an ${STAFF_LABELS[next]}` };
  return { ok: true };
}

/** Whether `actor` may act on an account (disable it, sign it out): never their own, never staff of their rank or above. */
export function canActOnAccount(actor: { userId: string; role: StaffRole }, target: { userId: string; staffRole: StaffRole | null }): { ok: true } | { ok: false; reason: string } {
  if (actor.userId === target.userId) return { ok: false, reason: 'You cannot do this to your own account' };
  if (target.staffRole && staffRank(target.staffRole) >= staffRank(actor.role) && actor.role !== 'owner') return { ok: false, reason: `Only an Owner can do this to an ${STAFF_LABELS[target.staffRole]}` };
  return { ok: true };
}
