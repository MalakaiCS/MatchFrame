// Starter game plans (spec §11.5). Plain data validated by gamePlanSchema at publish.
import type { Sport } from './types';
import type { GamePlan } from './automation';

/**
 * Football match flow, in Auto mode:
 * - From the moment the match exists: the animated background with the match header (teams, ground, kick-off time
 *   and a countdown to kick-off however far away), on air until the players walk out.
 * - Players entering: the header animates out, then the background; 15 s later each line-up shows once for 8 s (a team with no
 *   line-up entered is left out). It keeps going if the scorer presses "About to start" meanwhile.
 * - About to start: the scorebug comes up, its clock at 0:00 until the kick-off starts it.
 * - Kick-off of each half: the kick-off banner (and the scorebug, if it is not already up).
 * - Goals, cards and substitutions put their graphic on air during play.
 * - Half time: 10 s after the whistle the animated background comes up over everything and the scorebug goes; the
 *   match header (with the countdown to the second half) and the match stats then take turns, 30 s each, until
 *   the players walk back out.
 * - Players entering (2nd half): the board animates out, then the background; the scorebug returns 7 s later.
 * - Full time: 30 s after the whistle, the animated background with the final score on the match header and
 *   "Thank you for watching".
 * The animated background and the boards on it sit above every graphic except the stinger transition.
 */
export const FOOTBALL_STARTER: GamePlan = {
  version: 1,
  sport: 'football',
  defaultScorebug: true,
  freshnessMs: 10_000,
  playlists: [
    {
      // from the moment the match exists (and again at "Pre-match", where the graphics already on air are left alone)
      id: 'pre_match', name: 'Before the match: animated background and match header', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_pre', type: 'phase', phaseTags: ['pre_match'], phaseIds: ['scheduled', 'ready'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'pre_backdrop', action: 'show', templateKey: 'builtin:backdrop', offsetMs: 0, durationMs: null },
        { id: 'pre_header', action: 'show', templateKey: 'builtin:ident', variables: { showCountdown: true }, offsetMs: 600, durationMs: null },
      ],
    },
    {
      id: 'players_entering', name: 'Players entering: graphics out, then both line-ups once', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
      continueOnPhaseStep: true,
      triggers: [{ id: 't_enter', type: 'phase', phaseTags: [], phaseIds: ['players_entering'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'enter_clear', action: 'clear_layers', layers: ['fullframe', 'lower'], offsetMs: 0 },
        { id: 'enter_clear_bg', action: 'clear_layers', layers: ['background'], offsetMs: 400 },
        { id: 'lineup_home', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'home' }, offsetMs: 15_000, durationMs: 8000 },
        { id: 'lineup_away', action: 'show', templateKey: 'builtin:lineup', variables: { team: 'away' }, offsetMs: 23_600, durationMs: 8000 },
      ],
    },
    {
      id: 'about_to_start', name: 'About to start: scorebug up before kick-off', kind: 'pre', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ready', type: 'phase', phaseTags: ['about_to_start'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [{ id: 'ready_bug', action: 'scorebug_show', offsetMs: 0 }],
    },
    {
      id: 'kickoff', name: 'Kick-off: scorebug and kick-off banner', kind: 'in_play', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_period', type: 'phase', phaseTags: ['period_start'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'clear_ff', action: 'clear_layers', layers: ['background', 'fullframe', 'lower'], offsetMs: 0 },
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
      id: 'half_time', name: 'Half time: after 10 s, the animated background over everything', kind: 'break', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ht', type: 'phase', phaseTags: ['half_time', 'extra_time_interval'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'ht_backdrop', action: 'show', templateKey: 'builtin:backdrop', offsetMs: 10_000, durationMs: null },
        { id: 'ht_bug_off', action: 'scorebug_hide', offsetMs: 10_600 },
      ],
    },
    {
      id: 'half_time_boards', name: 'Half time: match header with countdown, then match stats (30 s each)', kind: 'break', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ht_boards', type: 'phase', phaseTags: ['half_time', 'extra_time_interval'], phaseIds: [] }],
      guards: [],
      startDelayMs: 10_600,
      repeat: { mode: 'loop', gapMs: 600, maxIterations: 60 },
      items: [
        { id: 'ht_header', action: 'show', templateKey: 'builtin:ident', variables: { showCountdown: true }, offsetMs: 0, durationMs: 30_000 },
        { id: 'ht_stats', action: 'show', templateKey: 'builtin:stats', offsetMs: 30_600, durationMs: 30_000 },
      ],
    },
    {
      id: 'second_half_entering', name: 'Players entering (2nd half): graphics out, scorebug back 7 s later', kind: 'break', priority: 2, promotional: false, cooldownMs: 0,
      continueOnPhaseStep: true,
      triggers: [{ id: 't_enter2', type: 'phase', phaseTags: [], phaseIds: ['second_half_entering'] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'enter2_clear', action: 'clear_layers', layers: ['fullframe', 'lower'], offsetMs: 0 },
        { id: 'enter2_clear_bg', action: 'clear_layers', layers: ['background'], offsetMs: 400 },
        { id: 'enter2_bug', action: 'scorebug_show', offsetMs: 7000 },
      ],
    },
    {
      id: 'full_time', name: 'Full time: after 30 s, final score on the match header with a thank-you', kind: 'post', priority: 2, promotional: false, cooldownMs: 0,
      triggers: [{ id: 't_ft', type: 'phase', phaseTags: ['full_time'], phaseIds: [] }],
      guards: [],
      repeat: { mode: 'once', gapMs: 0, maxIterations: 1 },
      items: [
        { id: 'ft_backdrop', action: 'show', templateKey: 'builtin:backdrop', offsetMs: 30_000, durationMs: null },
        { id: 'ft_bug_off', action: 'scorebug_hide', offsetMs: 30_600 },
        { id: 'ft_header', action: 'show', templateKey: 'builtin:ident', variables: { showCountdown: false, message: 'Thank you for watching' }, offsetMs: 30_600, durationMs: null },
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
