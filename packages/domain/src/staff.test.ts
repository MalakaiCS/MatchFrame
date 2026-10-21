import { describe, expect, it } from 'vitest';
import { STAFF_ACTIONS, STAFF_ROLES, canActOnAccount, canManageStaff, staffCan, type StaffAction, type StaffRole } from './staff';

describe('staff roles', () => {
  it('each role has everything the role below it has', () => {
    const allowed = (r: StaffRole) => (Object.keys(STAFF_ACTIONS) as StaffAction[]).filter((a) => staffCan(r, a));
    expect(allowed('support')).toEqual(['directory.read', 'organisation.view', 'user.view', 'user.resend_verification']);
    expect(allowed('moderator')).toEqual([...allowed('support'), 'content.takedown']);
    expect(allowed('admin')).toEqual([...allowed('moderator'), 'organisation.suspend', 'organisation.plan', 'user.disable', 'user.sign_out', 'staff.manage', 'activity.read']);
    expect(allowed('owner')).toEqual(allowed('admin'));
    expect(STAFF_ROLES.map((r) => allowed(r).length)).toEqual([11, 11, 5, 4]);
    expect(staffCan(null, 'directory.read')).toBe(false);
  });

  it('Owners manage everyone, Admins only Moderators and Support, nobody their own role', () => {
    const owner = { userId: 'o', role: 'owner' as const };
    const admin = { userId: 'a', role: 'admin' as const };
    const mod = { userId: 'm', role: 'moderator' as const };
    expect(canManageStaff(owner, { userId: 'x', current: null }, 'owner').ok).toBe(true);
    expect(canManageStaff(owner, { userId: 'a', current: 'admin' }, null).ok).toBe(true);
    expect(canManageStaff(admin, { userId: 'x', current: null }, 'moderator').ok).toBe(true);
    expect(canManageStaff(admin, { userId: 'm', current: 'moderator' }, 'support').ok).toBe(true);
    expect(canManageStaff(admin, { userId: 'm', current: 'moderator' }, null).ok).toBe(true);
    expect(canManageStaff(admin, { userId: 'x', current: null }, 'admin')).toEqual({ ok: false, reason: 'Only an Owner can make someone an Admin' });
    expect(canManageStaff(admin, { userId: 'b', current: 'admin' }, 'support')).toEqual({ ok: false, reason: 'Only an Owner can change an Admin' });
    expect(canManageStaff(admin, { userId: 'o', current: 'owner' }, null).ok).toBe(false);
    expect(canManageStaff(admin, { userId: 'a', current: 'admin' }, 'owner').ok).toBe(false);
    expect(canManageStaff(owner, { userId: 'o', current: 'owner' }, 'admin').ok).toBe(false);
    expect(canManageStaff(mod, { userId: 'x', current: null }, 'support')).toEqual({ ok: false, reason: 'Only Admins and Owners manage staff' });
  });

  it('accounts: never your own, never staff of your rank or above unless you are an Owner', () => {
    const admin = { userId: 'a', role: 'admin' as const };
    expect(canActOnAccount(admin, { userId: 'u', staffRole: null }).ok).toBe(true);
    expect(canActOnAccount(admin, { userId: 'm', staffRole: 'moderator' }).ok).toBe(true);
    expect(canActOnAccount(admin, { userId: 'b', staffRole: 'admin' }).ok).toBe(false);
    expect(canActOnAccount(admin, { userId: 'a', staffRole: 'admin' }).ok).toBe(false);
    expect(canActOnAccount({ userId: 'o', role: 'owner' }, { userId: 'p', staffRole: 'owner' }).ok).toBe(true);
  });
});
