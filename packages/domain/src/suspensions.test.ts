import { describe, expect, it } from 'vitest';
import { applyCommand, getAdapter, type CommandType, type StoredFact } from './engine';
import { STARTER_PLANS } from './starter-plans';
import type { LineupSnapshot, Side, Sport } from './types';

const id = (n: number, prefix = '0') => `00000000-0000-4000-8000-${prefix}${String(n).padStart(11, '0')}`;
const MIN = 60_000;

/** A match driven through the engine's commands, with the clock reading given for each fact. */
function match(sport: Sport, over: Record<string, unknown> = {}, lineup: LineupSnapshot | null = null) {
  const a = getAdapter(sport);
  const cfg = { ...(a.defaultConfig as object), ...over } as never;
  let state = { projection: a.initialProjection(cfg), clocks: a.initialClocks(cfg), sequence: 0 };
  const log: StoredFact[] = [];
  const run = (type: CommandType, payload: unknown) => {
    const r = applyCommand(a, cfg, state, log, type, payload, 2_000_000, lineup);
    if (r.kind === 'append') log.push({ ...r.entry, id: id(log.length + 1) } as StoredFact);
    if (r.kind === 'correction') log.splice(log.findIndex((f) => f.id === r.factId), 1, r.updated as StoredFact);
    state = r.state as typeof state;
    return r;
  };
  return {
    get p() {
      return state.projection;
    },
    log,
    phase: (to: string) => run('SET_PHASE', { to }),
    fact: (type: string, side: Side | null, payload: Record<string, unknown> = {}, clockMs?: number, playerId?: string) => run('ADD_FACT', { type, side, payload, playerId: playerId ?? null, occurredAt: 1_000_000, clockMs }),
    undo: (factId: string) => run('VOID_FACT', { factId, reason: 'test' }),
    /** the display with the main clock stopped at `clockMs` */
    display: (clockMs: number) => a.display(cfg, state.projection, { ...state.clocks, main: { ...state.clocks.main!, baseMs: clockMs, running: false, anchorAt: null } }, 0),
  };
}

const squad = (prefix: string): LineupSnapshot['home'] => Array.from({ length: 17 }, (_, i) => ({ playerId: id(i + 1, prefix), displayName: `P${i + 1}`, number: i + 1, starter: i < 13 }));

describe('rugby league sin bin, timed on playing time', () => {
  it('counts down from 10 minutes on the scorebug while the clock runs', () => {
    const m = match('rugby_league');
    m.phase('p1');
    m.fact('sin_bin', 'away', {}, 30 * MIN);
    expect(m.display(35 * MIN).timers).toEqual([{ side: 'away', kind: 'sin_bin', count: 1, remainingMs: 5 * MIN, remainingText: '5:00' }]);
    expect(m.display(35 * MIN).alerts.join(' ')).toMatch(/sin bin, 5:00 of playing time/);
    expect(m.display(40 * MIN).timers).toBeNull();
  });

  it('runs over half time: time after the siren does not count, the rest carries into the second half', () => {
    const m = match('rugby_league');
    m.phase('p1');
    m.fact('sin_bin', 'home', {}, 36 * MIN);
    // the half ran on to 41:30 after the siren; at half time 4 minutes have been served
    expect(m.display(41 * MIN + 30_000).timers?.[0]?.remainingText).toBe('6:00');
    m.phase('half_time');
    expect(m.display(41 * MIN + 30_000).timers?.[0]?.remainingText).toBe('6:00');
    m.phase('p2'); // the second half starts at 40:00
    expect(m.display(43 * MIN).timers?.[0]?.remainingText).toBe('3:00');
    expect(m.display(46 * MIN).timers).toBeNull();
  });

  it('the player is back on the field when the time is up, and can then be interchanged', () => {
    const lineup = { home: squad('1'), away: squad('2') };
    const m = match('rugby_league', {}, lineup);
    m.phase('p1');
    const pl = id(5, '1');
    m.fact('sin_bin', 'home', {}, 10 * MIN, pl);
    // still in the sin bin: not on the field to come off
    expect(() => m.fact('interchange', 'home', { playerOutId: pl, playerInId: id(14, '1') }, 15 * MIN)).toThrow(/not on the field/);
    expect(() => m.fact('sin_bin', 'home', {}, 15 * MIN, pl)).toThrow(/already in the sin bin/);
    // nor brought back early through an interchange
    m.fact('interchange', 'home', { playerOutId: id(6, '1'), playerInId: id(14, '1') }, 16 * MIN);
    expect(() => m.fact('interchange', 'home', { playerOutId: id(7, '1'), playerInId: pl }, 17 * MIN)).toThrow(/in the sin bin/);
    // ten minutes on: back on, so the interchange is accepted
    m.fact('interchange', 'home', { playerOutId: pl, playerInId: id(15, '1') }, 21 * MIN);
    expect(m.p.players[pl]?.onCourt).toBe(false);
    expect(m.p.sinBins?.[0]?.endedAtMs).toBe(20 * MIN);
  });

  it('a bench player sin-binned goes back to the bench, not onto the field', () => {
    const lineup = { home: squad('1'), away: squad('2') };
    const m = match('rugby_league', {}, lineup);
    m.phase('p1');
    const bench = id(15, '1');
    m.fact('sin_bin', 'home', {}, 10 * MIN, bench);
    m.fact('error', 'home', {}, 25 * MIN);
    expect(m.p.players[bench]?.onCourt).toBeUndefined();
    // still a bench player: can come on, cannot go off
    expect(() => m.fact('interchange', 'home', { playerOutId: bench, playerInId: id(16, '1') }, 26 * MIN)).toThrow(/not on the field/);
    m.fact('interchange', 'home', { playerOutId: id(2, '1'), playerInId: bench }, 26 * MIN);
    expect(m.p.players[bench]?.onCourt).toBe(true);
  });

  it('two at once count as two, the countdown shows the one that ends first; a send-off ends a sin bin for good', () => {
    const m = match('rugby_league');
    m.phase('p1');
    m.fact('sin_bin', 'away', {}, 20 * MIN, id(3, '2'));
    m.fact('sin_bin', 'away', {}, 24 * MIN, id(4, '2'));
    expect(m.display(25 * MIN).timers).toEqual([expect.objectContaining({ side: 'away', count: 2, remainingText: '5:00' })]);
    m.fact('send_off', 'away', {}, 26 * MIN, id(3, '2'));
    expect(m.display(27 * MIN).timers).toEqual([expect.objectContaining({ count: 1, remainingText: '7:00' })]);
    expect(m.p.players[id(3, '2')]).toMatchObject({ red: true, onCourt: false });
  });

  it("the rules' sin-bin length, 10 minutes for rules stored before it existed, and undo", () => {
    const short = match('rugby_league', { sinBinMinutes: 5 });
    short.phase('p1');
    short.fact('sin_bin', 'home', {}, 10 * MIN);
    expect(short.display(12 * MIN).timers?.[0]?.remainingText).toBe('3:00');
    const old = match('rugby_league', { sinBinMinutes: undefined });
    old.phase('p1');
    old.fact('sin_bin', 'home', {}, 10 * MIN);
    expect(old.display(12 * MIN).timers?.[0]?.remainingText).toBe('8:00');
    old.undo(old.log[old.log.length - 1]!.id);
    expect(old.display(12 * MIN).timers).toBeNull();
  });
});

describe('video review (rugby league)', () => {
  it('waits for its decision, then shows it; one review at a time', () => {
    const m = match('rugby_league');
    m.phase('p1');
    expect(() => m.fact('review_decision', null, { outcome: 'awarded' }, 5 * MIN)).toThrow(/no video review waiting/);
    m.fact('video_review', 'home', { subject: 'try' }, 5 * MIN);
    expect(m.p.review).toMatchObject({ subject: 'try', side: 'home', outcome: null });
    expect(() => m.fact('video_review', 'away', {}, 5 * MIN)).toThrow(/already waiting/);
    m.fact('review_decision', null, { outcome: 'denied' }, 6 * MIN);
    expect(m.p.review).toMatchObject({ side: 'home', outcome: 'denied' });
    expect(m.p.score).toEqual({ home: 0, away: 0 });
    // a captain's challenge after it
    m.fact('video_review', 'away', { subject: 'captains_challenge' }, 8 * MIN);
    expect(m.p.review).toMatchObject({ subject: 'captains_challenge', side: 'away', outcome: null });
    expect(() => m.fact('review_decision', null, { outcome: 'maybe' }, 8 * MIN)).toThrow();
  });

  it('a review with no subject reads as a try review; undoing the decision opens it again; the end of the period drops an open one', () => {
    const m = match('rugby_league');
    m.phase('p1');
    m.fact('video_review', 'away', {}, 5 * MIN);
    expect(m.p.review?.subject).toBe('try');
    m.fact('review_decision', null, { outcome: 'awarded' }, 6 * MIN);
    m.undo(m.log[m.log.length - 1]!.id);
    expect(m.p.review).toMatchObject({ outcome: null });
    m.phase('half_time');
    expect(m.p.review).toBeNull();
  });
});

describe('added time (football)', () => {
  it('shows on the scorebug for the rest of the half it was given in', () => {
    const m = match('football');
    m.phase('first_half');
    expect(m.display(44 * MIN).addedMinutes).toBeNull();
    m.fact('stoppage_announced', null, { minutes: 3 }, 45 * MIN);
    expect(m.display(45 * MIN + 30_000).addedMinutes).toBe(3);
    m.phase('half_time');
    expect(m.display(45 * MIN).addedMinutes).toBeNull();
    m.phase('second_half');
    expect(m.display(50 * MIN).addedMinutes).toBeNull();
  });
});

describe('futsal send-off on the scorebug', () => {
  it("is the team's time a player short", () => {
    const m = match('futsal');
    m.phase('p1');
    m.fact('red_card', 'home', {}, 15 * MIN);
    const t = m.display(14 * MIN).timers;
    expect(t).toEqual([expect.objectContaining({ side: 'home', kind: 'send_off', count: 1, remainingText: '1:00' })]);
  });
});

describe('the starter flows', () => {
  it("football puts the fourth official's board on air when added time is entered; futsal does not (its clock stops)", () => {
    const step = (sport: Sport, event: string) => STARTER_PLANS[sport]!.playlists.find((pl) => pl.triggers.some((t) => t.type === 'event' && t.eventTypes.includes(event)));
    expect(step('football', 'stoppage_announced')?.items).toEqual([expect.objectContaining({ action: 'show', templateKey: 'builtin:added_time', durationMs: 8000 })]);
    expect(step('futsal', 'stoppage_announced')).toBeUndefined();
    // rugby league: the review graphic while it is checked, out 6 s after the decision
    expect(step('rugby_league', 'video_review')?.items).toEqual([expect.objectContaining({ action: 'show', templateKey: 'builtin:review', durationMs: null })]);
    expect(step('rugby_league', 'review_decision')?.items).toEqual([expect.objectContaining({ action: 'clear_layers', layers: ['lower'], offsetMs: 6000 })]);
    for (const sport of ['basketball', 'netball', 'afl', 'hockey'] as Sport[]) expect(step(sport, 'video_review'), sport).toBeUndefined();
  });
});
