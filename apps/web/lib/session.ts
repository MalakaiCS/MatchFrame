'use client';
import { useQuery } from '@tanstack/react-query';
import { ApiError, get } from './api';

export type Role = 'owner' | 'admin' | 'producer' | 'operator' | 'scorer' | 'club_manager' | 'viewer';
export interface Me {
  user: { id: string; name: string; email: string; emailVerified: boolean; twoFactorEnabled?: boolean };
  organisations: { id: string; name: string; role: Role; timezone: string; locale: string }[];
  activeOrganisation: { id: string; name: string; timezone: string; locale: string; requireTwoFactor?: boolean } | null;
  role: Role | null;
  grants: { action: string; scopeType: string; scopeId: string | null }[];
  product: { name: string; locale: string; timezone: string };
  features?: { streaming: boolean };
}

export function useMe() {
  return useQuery<Me | null, ApiError>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<Me>('me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
}

const FULL: Role[] = ['owner', 'admin', 'producer'];
export const isFull = (r?: Role | null) => !!r && FULL.includes(r);
export const isAdmin = (r?: Role | null) => r === 'owner' || r === 'admin';

/** False on graphics-only deployments (STREAMING_ENABLED=false): no inputs, outputs, recordings or live highlights. */
export const streamingOn = (me: Me | null | undefined) => me?.features?.streaming !== false;

/** UI hinting only. The server enforces every permission. */
export function canSee(me: Me | null | undefined, area: string): boolean {
  const r = me?.role;
  if (!r) return false;
  if (area === 'streams' && !streamingOn(me)) return false;
  if (isFull(r)) return area !== 'settings.owner' || r === 'owner';
  switch (r) {
    case 'operator':
      return ['dashboard', 'matches', 'control', 'streams', 'media', 'competitions'].includes(area);
    case 'club_manager':
      return ['dashboard', 'assets', 'media', 'competitions', 'matches'].includes(area);
    case 'viewer':
      return ['dashboard', 'matches', 'competitions', 'reports', 'media'].includes(area);
    case 'scorer':
      return ['score'].includes(area);
    default:
      return false;
  }
}
