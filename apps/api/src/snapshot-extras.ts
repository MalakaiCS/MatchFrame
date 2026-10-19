import type { ApiDeps } from './app';

/** Hook for later milestones to enrich renderer snapshots (sponsor creatives, slot assignments). */
export function snapshotExtras(_deps: ApiDeps) {
  return undefined;
}
