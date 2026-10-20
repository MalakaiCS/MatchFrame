// Starter game plans (spec §11.5). Plain data validated by gamePlanSchema at publish.
import type { Sport } from './types';
import type { GamePlan } from './automation';

/**
 * Football match flow. Each phase step replaces the previous one (phaseStepCancellations), and the walk-out
 * repeats before the second half:
 * Pre-match → Players entering → About to start → Kick-off (1st half) → live events → Half time →
 * Players entering → About to start → Kick-off (2nd half) → live events → Full time.
 */
export const FOOTBALL_STARTER: GamePlan = {
  version: 1,
  sport: 'football',
  defaultScorebug: true,
  freshnessMs: 10_000,
  playlists: [
    {
      id: 'pre_match', name: 'Pre-match: match ident and sponsor', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_pre', type: 'phase', phaseTags: ['pre_match'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 2000, maxIterations: 40 },
      items: [
        { id: 'ident', action: 'show', templateKey: 'builtin:ident', offsetMs: 0, durationMs: 9000 },
        { id: 'pre_sponsor', action: 'sponsor', placement: 'full_frame_image', offsetMs: 9800, durationMs: 6000 },
      ],
    },
    {
      id: 'players_entering', name: 'Players entering: both lineups', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_enter', type: 'phase', phaseTags: ['players_entering'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 1500, maxIterations: 20 },
      items: [
        { id: 'enter_clear', action: 'clear_layers', layers: ['fullframe', 'background', 'lower'], offsetMs: 0 },
        { id: 'lineup_home', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'home' }, offsetMs: 400, durationMs: 10_000 },
        { id: 'lineup_away', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'away' }, offsetMs: 11_200, durationMs: 10_000 },
      ],
    },
    {
      id: 'about_to_start_1', name: 'About to start (1st half)', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ready1', type: 'phase', phaseTags: [], phaseIds: ['about_to_start'] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 3000, maxIterations: 30 },
      items: [
        { id: 'ready1_clear', action: 'clear_layers', layers: ['fullframe', 'background'], offsetMs: 0 },
        { id: 'ready1_banner', action: 'show', templateKey: 'builtin:period_banner', variables: { heading: 'ABOUT TO START', period: '1st Half' }, offsetMs: 400, durationMs: 8000 },
      ],
    },
    {
      id: 'about_to_start_2', name: 'About to start (2nd half)', kind: 'break', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ready2', type: 'phase', phaseTags: [], phaseIds: ['second_half_ready'] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 3000, maxIterations: 30 },
      items: [
        { id: 'ready2_clear', action: 'clear_layers', layers: ['fullframe', 'background'], offsetMs: 0 },
        { id: 'ready2_banner', action: 'show', templateKey: 'builtin:period_banner', variables: { heading: 'ABOUT TO START', period: '2nd Half' }, offsetMs: 400, durationMs: 8000 },
      ],
    },
    {
      id: 'kickoff', name: 'Kick-off: scorebug and kick-off banner', kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_period', type: 'phase', phaseTags: ['period_start'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'clear_ff', action: 'clear_layers', layers: ['fullframe', 'background', 'lower'], offsetMs: 0 },
        { id: 'bug', action: 'scorebug_show', offsetMs: 300 },
        { id: 'ko_banner', action: 'show', templateKey: 'builtin:period_banner', variables: { heading: 'KICK-OFF' }, offsetMs: 700, durationMs: 5000 },
      ],
    },
    {
      id: 'goal', name: 'Goal: scorer graphic, then partner', kind: 'in_play', priority: 1, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_goal', type: 'event', eventTypes: ['goal', 'own_goal', 'penalty_scored'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'goal_gfx', action: 'show', templateKey: 'builtin:goal', variables: { team: { from: 'event.side' }, player: { from: 'event.playerId' }, minute: { from: 'event.minute' }, eventType: { from: 'event.type' } }, offsetMs: 0, durationMs: 7000 },
        { id: 'goal_partner', action: 'sponsor', placement: 'detached_logo', offsetMs: 7500, durationMs: 5000 },
      ],
    },
    {
      id: 'card', name: 'Yellow and red cards', kind: 'in_play', priority: 1, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_card', type: 'event', eventTypes: ['yellow_card', 'second_yellow', 'red_card'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [{ id: 'card_gfx', action: 'show', templateKey: 'builtin:card', variables: { team: { from: 'event.side' }, player: { from: 'event.playerId' }, cardType: { from: 'event.cardType' }, minute: { from: 'event.minute' } }, offsetMs: 0, durationMs: 6000 }],
    },
    {
      id: 'sub', name: 'Substitution', kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_sub', type: 'event', eventTypes: ['substitution'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [{ id: 'sub_gfx', action: 'show', templateKey: 'builtin:substitution', variables: { team: { from: 'event.side' }, playerOut: { from: 'event.playerOutId' }, playerIn: { from: 'event.playerInId' }, minute: { from: 'event.minute' } }, offsetMs: 0, durationMs: 7000 }],
    },
    {
      id: 'half_time', name: 'Half time: score, stats and sponsor', kind: 'break', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ht', type: 'phase', phaseTags: ['half_time', 'extra_time_interval'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 2000, maxIterations: 30 },
      items: [
        { id: 'ht_bug_off', action: 'scorebug_hide', offsetMs: 0 },
        { id: 'ht_score', action: 'show', templateKey: 'builtin:break_score', offsetMs: 400, durationMs: 10_000 },
        { id: 'ht_stats', action: 'show', templateKey: 'builtin:stats', offsetMs: 11_200, durationMs: 12_000 },
        { id: 'ht_sponsor', action: 'sponsor', placement: 'full_frame_image', offsetMs: 24_000, durationMs: 6000 },
      ],
    },
    {
      id: 'full_time', name: 'Full time: final score, stats and sponsor', kind: 'post', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ft', type: 'phase', phaseTags: ['full_time'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 2000, maxIterations: 10 },
      items: [
        { id: 'ft_bug_off', action: 'scorebug_hide', offsetMs: 0 },
        { id: 'ft_score', action: 'show', templateKey: 'builtin:break_score', variables: { label: 'FULL TIME' }, offsetMs: 400, durationMs: 12_000 },
        { id: 'ft_stats', action: 'show', templateKey: 'builtin:stats', offsetMs: 13_200, durationMs: 12_000 },
        { id: 'ft_sponsor', action: 'sponsor', placement: 'full_frame_image', offsetMs: 26_000, durationMs: 8000 },
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

/**
 * The same broadcast flow for the period sports, with each code's own words: ident and sponsor before the match,
 * both lineups as the players enter, an "about to start" banner, the period banner at each start, a graphic for
 * every score, card and change, score + stats + sponsor at every interval, and the final board.
 */
export function periodStarter(sport: Sport, o: { startWord: string; scoreEvents: string[]; cardEvents: string[]; changeEvents: string[]; finalLabel?: string }): GamePlan {
  const playlists: GamePlan['playlists'] = [
    {
      id: 'pre_match', name: 'Pre-match: match ident and sponsor', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_pre', type: 'phase', phaseTags: ['pre_match'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 2000, maxIterations: 40 },
      items: [
        { id: 'ident', action: 'show', templateKey: 'builtin:ident', offsetMs: 0, durationMs: 9000 },
        { id: 'pre_sponsor', action: 'sponsor', placement: 'full_frame_image', offsetMs: 9800, durationMs: 6000 },
      ],
    },
    {
      id: 'players_entering', name: 'Players entering: both lineups', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_enter', type: 'phase', phaseTags: ['players_entering'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 1500, maxIterations: 20 },
      items: [
        { id: 'enter_clear', action: 'clear_layers', layers: ['fullframe', 'background', 'lower'], offsetMs: 0 },
        { id: 'lineup_home', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'home' }, offsetMs: 400, durationMs: 10_000 },
        { id: 'lineup_away', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'away' }, offsetMs: 11_200, durationMs: 10_000 },
      ],
    },
    {
      id: 'about_to_start', name: 'About to start', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ready', type: 'phase', phaseTags: ['about_to_start'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 3000, maxIterations: 30 },
      items: [
        { id: 'ready_clear', action: 'clear_layers', layers: ['fullframe', 'background'], offsetMs: 0 },
        { id: 'ready_banner', action: 'show', templateKey: 'builtin:period_banner', variables: { heading: 'ABOUT TO START', period: { from: 'phase.label' } }, offsetMs: 400, durationMs: 8000 },
      ],
    },
    {
      id: 'period_start', name: `${o.startWord}: scorebug and banner`, kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_period', type: 'phase', phaseTags: ['period_start'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'clear_ff', action: 'clear_layers', layers: ['fullframe', 'background', 'lower'], offsetMs: 0 },
        { id: 'bug', action: 'scorebug_show', offsetMs: 300 },
        { id: 'start_banner', action: 'show', templateKey: 'builtin:period_banner', variables: { heading: o.startWord.toUpperCase(), period: { from: 'phase.label' } }, offsetMs: 700, durationMs: 5000 },
      ],
    },
    {
      id: 'score', name: 'Score: scorer graphic, then partner', kind: 'in_play', priority: 1, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_score', type: 'event', eventTypes: o.scoreEvents }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'score_gfx', action: 'show', templateKey: 'builtin:goal', variables: { team: { from: 'event.side' }, player: { from: 'event.playerId' }, minute: { from: 'event.minute' }, eventType: { from: 'event.type' }, points: { from: 'event.points' } }, offsetMs: 0, durationMs: 7000 },
        { id: 'score_partner', action: 'sponsor', placement: 'detached_logo', offsetMs: 7500, durationMs: 5000 },
      ],
    },
  ];
  if (o.cardEvents.length)
    playlists.push({
      id: 'card', name: 'Cards and suspensions', kind: 'in_play', priority: 1, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_card', type: 'event', eventTypes: o.cardEvents }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [{ id: 'card_gfx', action: 'show', templateKey: 'builtin:card', variables: { team: { from: 'event.side' }, player: { from: 'event.playerId' }, cardType: { from: 'event.cardType' }, minute: { from: 'event.minute' } }, offsetMs: 0, durationMs: 6000 }],
    });
  playlists.push(
    {
      id: 'change', name: 'Substitutions and interchange', kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_change', type: 'event', eventTypes: o.changeEvents }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [{ id: 'change_gfx', action: 'show', templateKey: 'builtin:substitution', variables: { team: { from: 'event.side' }, playerOut: { from: 'event.playerOutId' }, playerIn: { from: 'event.playerInId' }, minute: { from: 'event.minute' } }, offsetMs: 0, durationMs: 7000 }],
    },
    {
      id: 'interval', name: 'Breaks: score, stats and sponsor', kind: 'break', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_interval', type: 'phase', phaseTags: ['interval'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 2000, maxIterations: 30 },
      items: [
        { id: 'int_bug_off', action: 'scorebug_hide', offsetMs: 0 },
        { id: 'int_score', action: 'show', templateKey: 'builtin:break_score', offsetMs: 400, durationMs: 10_000 },
        { id: 'int_stats', action: 'show', templateKey: 'builtin:stats', offsetMs: 11_200, durationMs: 12_000 },
        { id: 'int_sponsor', action: 'sponsor', placement: 'full_frame_image', offsetMs: 24_000, durationMs: 6000 },
      ],
    },
    {
      id: 'full_time', name: 'Full time: final score, stats and sponsor', kind: 'post', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ft', type: 'phase', phaseTags: ['full_time'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'loop', gapMs: 2000, maxIterations: 10 },
      items: [
        { id: 'ft_bug_off', action: 'scorebug_hide', offsetMs: 0 },
        { id: 'ft_score', action: 'show', templateKey: 'builtin:break_score', variables: { label: o.finalLabel ?? 'FULL TIME' }, offsetMs: 400, durationMs: 12_000 },
        { id: 'ft_stats', action: 'show', templateKey: 'builtin:stats', offsetMs: 13_200, durationMs: 12_000 },
        { id: 'ft_sponsor', action: 'sponsor', placement: 'full_frame_image', offsetMs: 26_000, durationMs: 8000 },
      ],
    },
  );
  return { version: 1, sport, defaultScorebug: true, freshnessMs: 10_000, playlists };
}

export const NETBALL_STARTER = periodStarter('netball', { startWord: 'Centre pass', scoreEvents: ['goal'], cardEvents: [], changeEvents: ['substitution'] });
export const RUGBY_LEAGUE_STARTER = periodStarter('rugby_league', { startWord: 'Kick-off', scoreEvents: ['try', 'penalty_try', 'penalty_goal', 'field_goal'], cardEvents: ['sin_bin', 'send_off'], changeEvents: ['interchange'] });
export const AFL_STARTER = periodStarter('afl', { startWord: 'First bounce', scoreEvents: ['goal'], cardEvents: [], changeEvents: ['interchange'], finalLabel: 'FINAL SIREN' });
export const HOCKEY_STARTER = periodStarter('hockey', { startWord: 'Push back', scoreEvents: ['goal'], cardEvents: ['green_card', 'yellow_card', 'red_card'], changeEvents: ['substitution'] });

export const STARTER_PLANS: Partial<Record<Sport, GamePlan>> = {
  football: FOOTBALL_STARTER,
  basketball: BASKETBALL_STARTER,
  netball: NETBALL_STARTER,
  rugby_league: RUGBY_LEAGUE_STARTER,
  afl: AFL_STARTER,
  hockey: HOCKEY_STARTER,
};
