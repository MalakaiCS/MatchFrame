// Starter game plans (spec §11.5). Plain data validated by gamePlanSchema at publish.
import type { GamePlan } from './automation';

export const FOOTBALL_STARTER: GamePlan = {
  version: 1,
  sport: 'football',
  defaultScorebug: true,
  freshnessMs: 10_000,
  playlists: [
    {
      id: 'pre_game', name: 'Pre-game loop', kind: 'pre', priority: 3, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_pre', type: 'phase', phaseTags: ['pre_match', 'players_entering'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 2000, maxIterations: 40 },
      items: [
        { id: 'ident', action: 'show', templateKey: 'builtin:ident', offsetMs: 0, durationMs: 8000 },
        { id: 'lineup_home', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'home' }, offsetMs: 8800, durationMs: 10_000 },
        { id: 'lineup_away', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'away' }, offsetMs: 19_600, durationMs: 10_000 },
        { id: 'sponsor_slate', action: 'sponsor', placement: 'full_frame_image', offsetMs: 30_400, durationMs: 6000 },
      ],
    },
    {
      id: 'kickoff', name: 'Period start → scorebug', kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_period', type: 'phase', phaseTags: ['period_start'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'clear_ff', action: 'clear_layers', layers: ['fullframe', 'background'], offsetMs: 0 },
        { id: 'bug', action: 'scorebug_show', offsetMs: 300 },
      ],
    },
    {
      id: 'goal', name: 'Goal → scorer graphic → partner', kind: 'in_play', priority: 1, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_goal', type: 'event', eventTypes: ['goal', 'own_goal', 'penalty_scored'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'goal_gfx', action: 'show', templateKey: 'builtin:goal', variables: { team: { from: 'event.side' }, player: { from: 'event.playerId' }, minute: { from: 'event.minute' }, eventType: { from: 'event.type' } }, offsetMs: 0, durationMs: 7000 },
        { id: 'goal_partner', action: 'sponsor', placement: 'detached_logo', offsetMs: 7500, durationMs: 5000 },
      ],
    },
    {
      id: 'card', name: 'Card → player card', kind: 'in_play', priority: 1, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_card', type: 'event', eventTypes: ['yellow_card', 'second_yellow', 'red_card'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [{ id: 'card_gfx', action: 'show', templateKey: 'builtin:card', variables: { team: { from: 'event.side' }, player: { from: 'event.playerId' }, cardType: { from: 'event.cardType' }, minute: { from: 'event.minute' } }, offsetMs: 0, durationMs: 6000 }],
    },
    {
      id: 'sub', name: 'Substitution panel', kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_sub', type: 'event', eventTypes: ['substitution'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [{ id: 'sub_gfx', action: 'show', templateKey: 'builtin:substitution', variables: { team: { from: 'event.side' }, playerOut: { from: 'event.playerOutId' }, playerIn: { from: 'event.playerInId' }, minute: { from: 'event.minute' } }, offsetMs: 0, durationMs: 7000 }],
    },
    {
      id: 'half_time', name: 'Half time slate + sponsor loop', kind: 'break', priority: 3, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ht', type: 'phase', phaseTags: ['half_time', 'extra_time_interval'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 2000, maxIterations: 30 },
      items: [
        { id: 'ht_bug_off', action: 'scorebug_hide', offsetMs: 0 },
        { id: 'ht_score', action: 'show', templateKey: 'builtin:break_score', offsetMs: 300, durationMs: 10_000 },
        { id: 'ht_stats', action: 'show', templateKey: 'builtin:stats', offsetMs: 11_000, durationMs: 10_000 },
        { id: 'ht_sponsor', action: 'sponsor', placement: 'full_frame_image', offsetMs: 21_800, durationMs: 6000 },
      ],
    },
    {
      id: 'full_time', name: 'Full time + closing sponsor', kind: 'post', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ft', type: 'phase', phaseTags: ['full_time'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'ft_bug_off', action: 'scorebug_hide', offsetMs: 0 },
        { id: 'ft_score', action: 'show', templateKey: 'builtin:break_score', variables: { label: 'FULL TIME' }, offsetMs: 300, durationMs: 15_000 },
        { id: 'ft_sponsor', action: 'sponsor', placement: 'full_frame_image', offsetMs: 16_000, durationMs: 8000 },
      ],
    },
  ],
};

export const BASKETBALL_STARTER: GamePlan = {
  version: 1,
  sport: 'basketball',
  defaultScorebug: true,
  freshnessMs: 10_000,
  playlists: [
    {
      id: 'pre_game', name: 'Pre-game ident + lineups', kind: 'pre', priority: 3, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_pre', type: 'phase', phaseTags: ['pre_match', 'players_entering'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 2000, maxIterations: 40 },
      items: [
        { id: 'ident', action: 'show', templateKey: 'builtin:ident', offsetMs: 0, durationMs: 8000 },
        { id: 'lineup_home', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'home' }, offsetMs: 8800, durationMs: 9000 },
        { id: 'lineup_away', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'away' }, offsetMs: 18_600, durationMs: 9000 },
      ],
    },
    {
      id: 'period_start', name: 'Scorebug through play', kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_period', type: 'phase', phaseTags: ['period_start'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'clear_ff', action: 'clear_layers', layers: ['fullframe', 'background'], offsetMs: 0 },
        { id: 'bug', action: 'scorebug_show', offsetMs: 300 },
      ],
    },
    {
      id: 'timeout', name: 'Timeout sponsor sequence', kind: 'in_play', priority: 3, promotional: true, cooldownMs: 0,
      triggers: [{ id: 't_timeout', type: 'event', eventTypes: ['timeout'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'to_sponsor', action: 'sponsor', placement: 'detached_logo', offsetMs: 0, durationMs: 8000 },
        { id: 'to_stats', action: 'show', templateKey: 'builtin:stats', offsetMs: 8500, durationMs: 9000 },
      ],
    },
    {
      id: 'quarter_break', name: 'Period break score + stats', kind: 'break', priority: 3, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_break', type: 'phase', phaseTags: ['period_break'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'qb_score', action: 'show', templateKey: 'builtin:break_score', offsetMs: 0, durationMs: 10_000 },
        { id: 'qb_stats', action: 'show', templateKey: 'builtin:stats', offsetMs: 10_800, durationMs: 10_000 },
      ],
    },
    {
      id: 'milestone', name: 'Every 20 points milestone', kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ms', type: 'milestone', counter: 'points', every: 20 }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [{ id: 'ms_lt', action: 'show', templateKey: 'builtin:lower_third', variables: { heading: 'Scoring milestone', subtitle: { from: 'trigger.milestone' } }, offsetMs: 0, durationMs: 6000 }],
    },
    {
      id: 'full_time', name: 'Final score', kind: 'post', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ft', type: 'phase', phaseTags: ['full_time'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'ft_bug_off', action: 'scorebug_hide', offsetMs: 0 },
        { id: 'ft_score', action: 'show', templateKey: 'builtin:break_score', variables: { label: 'FINAL' }, offsetMs: 300, durationMs: 15_000 },
      ],
    },
  ],
};

export const STARTER_PLANS = { football: FOOTBALL_STARTER, basketball: BASKETBALL_STARTER };
