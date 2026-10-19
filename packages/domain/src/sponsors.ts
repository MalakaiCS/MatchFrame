// Sponsor creative selection (spec §12.1): eligibility by slot fit, approval, dates, target scope, caps,
// spacing and category exclusions; then priority and deterministic weighted rotation. Pure.
export type Placement = 'scorebug_logo' | 'lower_third_banner' | 'event_partner' | 'detached_logo' | 'full_frame_image' | 'full_frame_video' | 'clip_intro' | 'clip_outro';

export interface SponsorCampaign {
  id: string;
  brandId: string;
  brandName: string;
  brandCategory: string | null;
  creativeSetId: string;
  startsAt: number;
  endsAt: number;
  priority: number; // 1 highest
  weight: number;
  totalCap: number | null;
  perMatchCap: number | null;
  minSpacingSeconds: number;
  excludedCategories: string[];
  eventSponsorship: string[];
  status: string;
}
export interface SponsorAllocation {
  campaignId: string;
  scopeType: 'organisation' | 'competition' | 'team' | 'match';
  scopeId: string | null;
  placement: Placement;
}
export interface SponsorCreative {
  id: string;
  creativeSetId: string;
  kind: 'image' | 'banner' | 'video';
  width: number | null;
  height: number | null;
  durationMs: number | null;
  approvalStatus: string;
  expiresAt: number | null;
  assetReady: boolean;
}
export interface SelectionInput {
  placement: Placement;
  now: number;
  scope: { competitionId: string; matchId: string; teamIds: string[] };
  campaigns: SponsorCampaign[];
  allocations: SponsorAllocation[];
  creatives: SponsorCreative[];
  /** confirmed/selected counts so far (from decisions) */
  totalShown: Record<string, number>;
  matchShown: Record<string, number>;
  lastShownAt: Record<string, number>;
  /** categories excluded for this match (e.g. competing brand already on air, or match-level exclusion) */
  excludedCategories?: string[];
  eventType?: string | null;
  requireDurationMs?: number | null;
}

export interface SelectionResult {
  outcome: 'selected' | 'empty';
  campaignId: string | null;
  creativeId: string | null;
  reason: string;
  considered: { campaignId: string; eligible: boolean; reason: string }[];
  precedence: 'match' | 'team' | 'competition' | 'organisation' | null;
}

const ASPECT: Partial<Record<Placement, [number, number]>> = {
  scorebug_logo: [1, 4.5],
  lower_third_banner: [2.5, 12],
  event_partner: [1, 5],
  detached_logo: [0.8, 5],
  full_frame_image: [1.6, 1.9],
  full_frame_video: [1.6, 1.9],
  clip_intro: [1.6, 1.9],
  clip_outro: [1.6, 1.9],
};

export function creativeFits(placement: Placement, c: SponsorCreative): string | null {
  const wantVideo = placement === 'full_frame_video' || placement === 'clip_intro' || placement === 'clip_outro';
  if (wantVideo && c.kind !== 'video' && placement === 'full_frame_video') return 'placement needs a video';
  if (!wantVideo && c.kind === 'video') return 'placement needs an image';
  const r = ASPECT[placement];
  if (r && c.width && c.height) {
    const a = c.width / c.height;
    if (a < r[0] || a > r[1]) return `aspect ratio ${a.toFixed(2)} does not fit ${placement}`;
  }
  return null;
}

const SCOPE_RANK = { match: 4, team: 3, competition: 2, organisation: 1 } as const;

export function selectCreative(i: SelectionInput): SelectionResult {
  const considered: SelectionResult['considered'] = [];
  // Precedence: an explicit match allocation overrides team, which overrides competition, which overrides organisation.
  const allocs = i.allocations.filter(
    (a) =>
      a.placement === i.placement &&
      (a.scopeType === 'organisation' || (a.scopeType === 'competition' && a.scopeId === i.scope.competitionId) || (a.scopeType === 'match' && a.scopeId === i.scope.matchId) || (a.scopeType === 'team' && !!a.scopeId && i.scope.teamIds.includes(a.scopeId))),
  );
  const top = Math.max(0, ...allocs.map((a) => SCOPE_RANK[a.scopeType]));
  const scoped = allocs.filter((a) => SCOPE_RANK[a.scopeType] === top);
  const precedence = (Object.keys(SCOPE_RANK) as (keyof typeof SCOPE_RANK)[]).find((k) => SCOPE_RANK[k] === top) ?? null;
  const excluded = new Set(i.excludedCategories ?? []);
  const pool: { c: SponsorCampaign; creatives: SponsorCreative[] }[] = [];
  for (const a of scoped) {
    const c = i.campaigns.find((x) => x.id === a.campaignId);
    if (!c) continue;
    const why = (() => {
      if (c.status !== 'active') return 'campaign inactive';
      if (i.now < c.startsAt) return 'campaign not started';
      if (i.now >= c.endsAt) return 'campaign expired';
      if (c.totalCap != null && (i.totalShown[c.id] ?? 0) >= c.totalCap) return 'total cap reached';
      if (c.perMatchCap != null && (i.matchShown[c.id] ?? 0) >= c.perMatchCap) return 'per-match cap reached';
      if (c.minSpacingSeconds && i.lastShownAt[c.id] && i.now - i.lastShownAt[c.id]! < c.minSpacingSeconds * 1000) return 'minimum spacing not reached';
      if (c.brandCategory && excluded.has(c.brandCategory)) return `category "${c.brandCategory}" excluded`;
      if (i.eventType && c.eventSponsorship.length && !c.eventSponsorship.includes(i.eventType)) return `not sponsoring ${i.eventType}`;
      return null;
    })();
    if (why) {
      considered.push({ campaignId: c.id, eligible: false, reason: why });
      continue;
    }
    const creatives = i.creatives.filter((cr) => {
      if (cr.creativeSetId !== c.creativeSetId) return false;
      if (cr.approvalStatus !== 'approved' || !cr.assetReady) return false;
      if (cr.expiresAt && cr.expiresAt <= i.now) return false;
      if (i.requireDurationMs && cr.kind === 'video' && (cr.durationMs ?? 0) > i.requireDurationMs + 500) return false;
      return !creativeFits(i.placement, cr);
    });
    if (!creatives.length) {
      considered.push({ campaignId: c.id, eligible: false, reason: 'no approved creative fits this placement' });
      continue;
    }
    considered.push({ campaignId: c.id, eligible: true, reason: 'eligible' });
    pool.push({ c, creatives });
  }
  if (!pool.length) return { outcome: 'empty', campaignId: null, creativeId: null, reason: allocs.length ? 'no eligible campaign (see considered)' : 'no allocation for this placement', considered, precedence };
  const best = Math.min(...pool.map((p) => p.c.priority));
  const group = pool.filter((p) => p.c.priority === best).sort((a, b) => a.c.id.localeCompare(b.c.id));
  // Deterministic weighted rotation: the campaign furthest below its weighted share goes next.
  const total = group.reduce((n, p) => n + (i.matchShown[p.c.id] ?? 0), 0) + 1;
  const tw = group.reduce((n, p) => n + p.c.weight, 0);
  let pick = group[0]!;
  let bestDeficit = -Infinity;
  for (const p of group) {
    const deficit = (p.c.weight / tw) * total - (i.matchShown[p.c.id] ?? 0);
    if (deficit > bestDeficit + 1e-9) {
      bestDeficit = deficit;
      pick = p;
    }
  }
  const shown = i.matchShown[pick.c.id] ?? 0;
  const creative = [...pick.creatives].sort((a, b) => a.id.localeCompare(b.id))[shown % pick.creatives.length]!;
  return { outcome: 'selected', campaignId: pick.c.id, creativeId: creative.id, reason: `priority ${best}, weighted rotation (${pick.c.brandName})`, considered, precedence };
}
