import { describe, expect, it } from 'vitest';
import { clockCrossings, decidePriority, matchTriggers, planRun, resolveVariables, validateGamePlan, type GamePlan, type TriggerInput } from './automation';
import { FOOTBALL_STARTER, BASKETBALL_STARTER } from './starter-plans';
import { selectCreative, type SelectionInput } from './sponsors';
import { simulateRehearsal, syntheticTimeline } from './rehearsal';
import { footballAdapter } from './sports/football';
import { basketballAdapter } from './sports/basketball';

const LAYERS: Record<string, string> = {
  'builtin:scorebug': 'scoreboard', 'builtin:ident': 'fullframe', 'builtin:lineup': 'fullframe', 'builtin:goal': 'event', 'builtin:score': 'event', 'builtin:card': 'event', 'builtin:substitution': 'event',
  'builtin:lower_third': 'lower', 'builtin:player_card': 'event', 'builtin:stats': 'fullframe', 'builtin:break_score': 'fullframe', 'builtin:sponsor': 'sponsor', 'builtin:full_frame_media': 'fullframe', 'builtin:ticker': 'ticker', 'builtin:slate': 'background',
};
const opts = (sport: 'football' | 'basketball') => ({ templateKeys: Object.keys(LAYERS), templateLayers: LAYERS, eventTypes: (sport === 'football' ? footballAdapter.eventTypes(footballAdapter.defaultConfig) : basketballAdapter.eventTypes(basketballAdapter.defaultConfig)).map((e) => e.type) });
const guard = { hasLineup: true, sponsorAvailable: () => true, now: 0 };

describe('game plan validation', () => {
  it('accepts both starter plans', () => {
    expect(validateGamePlan(FOOTBALL_STARTER, opts('football'))).toMatchObject({ ok: true });
    expect(validateGamePlan(BASKETBALL_STARTER, opts('basketball'))).toMatchObject({ ok: true });
  });
  it('rejects unknown templates, overlaps, infinite loops and unknown events', () => {
    const bad: GamePlan = structuredClone(FOOTBALL_STARTER);
    bad.playlists[2]!.items.push({ id: 'x', action: 'show', templateKey: 'builtin:nope', offsetMs: 0, durationMs: 1000 });
    bad.playlists[3]!.items.push({ id: 'y', action: 'show', templateKey: 'builtin:goal', offsetMs: 1000, durationMs: 1000 }); // overlaps card on event layer
    bad.playlists.push({ id: 'spin', name: 'spin', kind: 'in_play', priority: 4, promotional: false, cooldownMs: 0, triggers: [{ id: 'tt', type: 'event', eventTypes: ['dunk'] }], guards: [], repeat: { mode: 'loop', gapMs: 0, maxIterations: 5 }, items: [{ id: 'w', action: 'scorebug_show', offsetMs: 0 }] });
    const r = validateGamePlan(bad, opts('football'));
    expect(r.ok).toBe(false);
    const msgs = r.issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/unknown template/i);
    expect(msgs).toMatch(/Overlaps/);
    expect(msgs).toMatch(/would spin/);
    expect(msgs).toMatch(/Unknown football event "dunk"/);
  });
});

describe('triggers', () => {
  const ev = (over: Partial<Extract<TriggerInput, { kind: 'event' }>> = {}): TriggerInput => ({ kind: 'event', eventType: 'goal', side: 'home', factId: 'f1', factRevision: 1, playerId: null, payload: {}, clockMs: 61_000, phaseId: 'first_half', phaseKind: 'play', occurredAt: 1000, at: 1000, historical: false, counters: {}, prevCounters: {}, ...over });

  it('a goal starts the goal playlist with variables resolved from the event', () => {
    const { matches } = matchTriggers(FOOTBALL_STARTER, ev({ playerId: '00000000-0000-4000-8000-000000000001' }), guard);
    expect(matches.map((m) => m.playlist.id)).toEqual(['goal']);
    const cues = planRun(matches[0]!.playlist, matches[0]!, 1000, { freshnessMs: 10_000, templateLayers: LAYERS, liveTrigger: true });
    expect(cues[0]!.variables).toEqual({ team: 'home', player: '00000000-0000-4000-8000-000000000001', minute: '2', eventType: 'goal' });
    expect(cues[0]!.deadlineAt).toBe(11_000); // occurrence + freshness, not queue time
    expect(cues[1]).toMatchObject({ dueAt: 8500, layer: 'sponsor' });
  });

  it('historical (late offline) facts never start a live celebration (A16)', () => {
    const r = matchTriggers(FOOTBALL_STARTER, ev({ historical: true }), guard);
    expect(r.matches).toHaveLength(0);
    expect(r.skipped[0]!.reason).toMatch(/historical/);
  });

  it('milestones fire once per qualifying crossing', () => {
    const m1 = matchTriggers(BASKETBALL_STARTER, ev({ eventType: 'score', prevCounters: { points: 18 }, counters: { points: 21 } }), guard);
    expect(m1.matches.map((m) => [m.playlist.id, m.iteration])).toEqual([['milestone', 'milestone:points:20']]);
    expect(resolveVariables(m1.matches[0]!.playlist.items[0]!.variables, m1.matches[0]!.context)).toMatchObject({ subtitle: '20 points' });
    expect(matchTriggers(BASKETBALL_STARTER, ev({ eventType: 'score', prevCounters: { points: 21 }, counters: { points: 23 } }), guard).matches).toHaveLength(0);
    // routine baskets do not trigger a full-screen graphic
    expect(matchTriggers(BASKETBALL_STARTER, ev({ eventType: 'score', prevCounters: { points: 2 }, counters: { points: 4 } }), guard).matches).toHaveLength(0);
  });

  it('guards skip with reasons', () => {
    const p: GamePlan = structuredClone(FOOTBALL_STARTER);
    p.playlists[2]!.guards = [{ type: 'min_data', require: ['player'] }, { type: 'freshness', maxAgeMs: 5000 }];
    expect(matchTriggers(p, ev(), guard).skipped[0]!.reason).toMatch(/no player/);
    expect(matchTriggers(p, ev({ playerId: 'p', occurredAt: 0 }), { ...guard, now: 9000 }).skipped[0]!.reason).toMatch(/stale/);
  });
});

describe('match clock thresholds (A25)', () => {
  const plan: GamePlan = { ...FOOTBALL_STARTER, playlists: [{ id: 'promo', name: 'promo', kind: 'in_play', priority: 4, promotional: true, cooldownMs: 0, triggers: [{ id: 'c20', type: 'match_clock', atMs: 20 * 60_000, periodIds: ['first_half'] }, { id: 'every5', type: 'match_clock', atMs: 5 * 60_000, repeatEveryMs: 5 * 60_000, untilMs: 40 * 60_000, periodIds: [] }], guards: [], repeat: { mode: 'once', gapMs: 0, maxIterations: 1 }, items: [{ id: 's', action: 'sponsor', placement: 'detached_logo', offsetMs: 0, durationMs: 5000 }] }] };
  it('fires once when crossed during normal running', () => {
    const r = clockCrossings(plan, 'first_half', 19 * 60_000 + 59_500, 20 * 60_000 + 200);
    expect(r).toEqual([expect.objectContaining({ triggerId: 'c20', thresholdMs: 1_200_000, outcome: 'fire' }), expect.objectContaining({ triggerId: 'every5', thresholdMs: 1_200_000, outcome: 'fire' })]);
  });
  it('does not fire while paused or when corrected backwards', () => {
    expect(clockCrossings(plan, 'first_half', 1_200_100, 1_200_100)).toEqual([]);
    expect(clockCrossings(plan, 'first_half', 1_250_000, 1_100_000)).toEqual([]);
  });
  it('a forward correction across thresholds records skips instead of firing', () => {
    const r = clockCrossings(plan, 'first_half', 4 * 60_000, 16 * 60_000);
    expect(r.map((x) => [x.triggerId, x.thresholdMs / 60_000, x.outcome])).toEqual([['every5', 5, 'skip'], ['every5', 10, 'skip'], ['every5', 15, 'skip']]);
  });
  it('respects period scope', () => {
    expect(clockCrossings(plan, 'second_half', 19 * 60_000 + 59_500, 20 * 60_000 + 200).map((x) => x.triggerId)).toEqual(['every5']);
  });
});

describe('priority and preemption (A24)', () => {
  const active = [{ runId: 'r1', playlistId: 'half_time_loop', priority: 3, layers: ['fullframe', 'sponsor'], state: 'running' as const, createdAt: 0, promotional: true }];
  it('higher priority preempts conflicting lower runs', () => {
    expect(decidePriority({ priority: 1, layers: ['fullframe'], promotional: false }, active)).toEqual({ action: 'start', preempt: [{ runId: 'r1', reason: 'preempted by priority 1' }] });
  });
  it('non-conflicting layers run together', () => {
    expect(decidePriority({ priority: 4, layers: ['ticker'], promotional: true }, active)).toEqual({ action: 'start', preempt: [] });
  });
  it('equal priority keeps trigger order; lower promotional is skipped', () => {
    expect(decidePriority({ priority: 3, layers: ['sponsor'], promotional: false }, active).action).toBe('queue');
    expect(decidePriority({ priority: 4, layers: ['sponsor'], promotional: true }, active).action).toBe('skip');
  });
});

describe('sponsor selection (A30)', () => {
  const base: SelectionInput = {
    placement: 'detached_logo', now: 1_000_000, scope: { competitionId: 'c', matchId: 'm', teamIds: ['t1', 't2'] },
    campaigns: [
      { id: 'A', brandId: 'b1', brandName: 'Alpha', brandCategory: 'drinks', creativeSetId: 'sa', startsAt: 0, endsAt: 2_000_000, priority: 2, weight: 3, totalCap: null, perMatchCap: null, minSpacingSeconds: 0, excludedCategories: [], eventSponsorship: [], status: 'active' },
      { id: 'B', brandId: 'b2', brandName: 'Beta', brandCategory: 'banking', creativeSetId: 'sb', startsAt: 0, endsAt: 2_000_000, priority: 2, weight: 1, totalCap: null, perMatchCap: 2, minSpacingSeconds: 0, excludedCategories: [], eventSponsorship: [], status: 'active' },
      { id: 'X', brandId: 'b3', brandName: 'Expired', brandCategory: null, creativeSetId: 'sx', startsAt: 0, endsAt: 500_000, priority: 1, weight: 1, totalCap: null, perMatchCap: null, minSpacingSeconds: 0, excludedCategories: [], eventSponsorship: [], status: 'active' },
    ],
    allocations: [{ campaignId: 'A', scopeType: 'competition', scopeId: 'c', placement: 'detached_logo' }, { campaignId: 'B', scopeType: 'competition', scopeId: 'c', placement: 'detached_logo' }, { campaignId: 'X', scopeType: 'competition', scopeId: 'c', placement: 'detached_logo' }],
    creatives: [
      { id: 'ca', creativeSetId: 'sa', kind: 'image', width: 600, height: 200, durationMs: null, approvalStatus: 'approved', expiresAt: null, assetReady: true },
      { id: 'cb', creativeSetId: 'sb', kind: 'image', width: 600, height: 200, durationMs: null, approvalStatus: 'approved', expiresAt: null, assetReady: true },
      { id: 'cx', creativeSetId: 'sx', kind: 'image', width: 600, height: 200, durationMs: null, approvalStatus: 'approved', expiresAt: null, assetReady: true },
    ],
    totalShown: {}, matchShown: {}, lastShownAt: {},
  };
  it('skips expired campaigns with a reason and rotates by weight deterministically', () => {
    const seen: string[] = [];
    const shown: Record<string, number> = {};
    for (let k = 0; k < 8; k++) {
      const r = selectCreative({ ...base, matchShown: shown });
      seen.push(r.campaignId!);
      shown[r.campaignId!] = (shown[r.campaignId!] ?? 0) + 1;
      expect(r.considered.find((c) => c.campaignId === 'X')!.reason).toBe('campaign expired');
    }
    expect(seen.filter((x) => x === 'A')).toHaveLength(6); // 3:1 weight, B capped at 2 per match
    expect(seen.filter((x) => x === 'B')).toHaveLength(2);
    expect(selectCreative({ ...base, matchShown: shown }).campaignId).toBe('A');
  });
  it('rejects incompatible creatives and falls back to empty', () => {
    const r = selectCreative({ ...base, placement: 'full_frame_image' });
    expect(r.outcome).toBe('empty');
    const r2 = selectCreative({ ...base, placement: 'full_frame_image', allocations: base.allocations.map((a) => ({ ...a, placement: 'full_frame_image' as const })) });
    expect(r2.outcome).toBe('empty');
    expect(r2.considered.every((c) => !c.eligible)).toBe(true);
    expect(r2.considered.map((c) => c.reason)).toContain('no approved creative fits this placement');
  });
  it('match allocation overrides competition default; category exclusion applies', () => {
    const r = selectCreative({ ...base, allocations: [...base.allocations, { campaignId: 'B', scopeType: 'match', scopeId: 'm', placement: 'detached_logo' }] });
    expect(r).toMatchObject({ campaignId: 'B', precedence: 'match' });
    expect(selectCreative({ ...base, excludedCategories: ['drinks'] }).campaignId).toBe('B');
  });
});

describe('rehearsal (A29: pure, explained)', () => {
  it('replays a synthetic match and explains every decision', () => {
    const r = simulateRehearsal(FOOTBALL_STARTER, footballAdapter.defaultConfig, syntheticTimeline('football'), { templateLayers: LAYERS });
    const fired = r.decisions.filter((d) => d.outcome === 'fired').map((d) => d.playlistId);
    expect(fired).toEqual(expect.arrayContaining(['pre_game', 'kickoff', 'goal', 'card', 'half_time', 'full_time']));
    expect(r.decisions.find((d) => d.outcome === 'cancelled' && /phase changed/.test(d.reason))).toBeTruthy(); // pre-game loop ends at kick-off
    expect(r.decisions.find((d) => d.playlistId === 'card' && d.outcome === 'queued')).toBeTruthy(); // equal priority: waits for the goal sequence
    expect(r.decisions.find((d) => d.playlistId === 'card' && d.outcome === 'fired')).toBeTruthy();
    expect(r.decisions.some((d) => d.outcome === 'skipped' && /historical|freshness/.test(d.reason))).toBe(true); // the late goal
    expect(r.cues.length).toBeGreaterThan(10);
  });
});
