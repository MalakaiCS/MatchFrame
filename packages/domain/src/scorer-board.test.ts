import { describe, expect, it } from 'vitest';
import { applyCommand, getAdapter, tallyOf, type EngineState, type StoredFact } from './engine';
import { possessionShare, POSSESSION_EVENT } from './possession';
import { SCORER_SHEETS, sheetCount, sheetEvents, type SheetRow } from './scorer-board';
import type { Sport } from './types';

describe('scorer sheet', () => {
  it('names only events the sport has, and every row with a statistic reads one the event moves', () => {
    for (const [sport, rows] of Object.entries(SCORER_SHEETS) as [Sport, SheetRow[]][]) {
      const a = getAdapter(sport);
      const cfg = a.defaultConfig;
      const types = a.eventTypes(cfg).map((e) => e.type);
      for (const t of sheetEvents(rows)) expect(types, `${sport}: ${t}`).toContain(t);
      if (rows.some((r) => r.kind === 'possession')) expect(types, sport).toContain(POSSESSION_EVENT);
      const counted = rows.flatMap((r) => (r.kind === 'event' ? [r] : r.kind === 'cards' ? r.cards : [])).filter((r) => r.stat);
      for (const row of counted) {
        const p = { ...a.initialProjection(cfg), phase: a.phases(cfg).find((x) => x.kind === 'play')!.id };
        const after = a.applyFact(cfg, p, { sequence: 1, category: 'event', type: row.type, side: 'home', playerId: null, payload: {}, periodId: p.phase, clockMs: 0 });
        expect(sheetCount(after, 'home', row.type, row.stat), `${sport}: ${row.type} counts ${row.stat}`).toBe(1);
      }
    }
  });

  it('counts an event with no statistic by the times it was recorded, for that team only, and an undo takes it back', () => {
    const a = getAdapter('football');
    const cfg = a.defaultConfig;
    let state: EngineState = { projection: a.initialProjection(cfg), clocks: a.initialClocks(cfg), sequence: 0 };
    const log: StoredFact[] = [];
    const run = (type: Parameters<typeof applyCommand>[4], payload: unknown) => {
      const r = applyCommand(a, cfg, state, log, type, payload, 2_000_000, null);
      if (r.kind === 'append') log.push({ ...r.entry, id: `00000000-0000-4000-8000-${String(log.length + 1).padStart(12, '0')}` });
      if (r.kind === 'correction') log.splice(log.findIndex((f) => f.id === r.factId), 1, r.updated);
      state = r.state;
    };
    run('SET_PHASE', { to: 'first_half' });
    for (const type of ['goal', 'goal', 'penalty_scored', 'own_goal']) run('ADD_FACT', { type, side: 'home', payload: {}, occurredAt: 2_000_000 });
    expect([sheetCount(state.projection, 'home', 'goal'), sheetCount(state.projection, 'home', 'penalty_scored'), sheetCount(state.projection, 'home', 'own_goal'), sheetCount(state.projection, 'away', 'goal')]).toEqual([2, 1, 1, 0]);
    // the own goal went to the away side's score
    expect(state.projection.score).toEqual({ home: 3, away: 1 });
    run('VOID_FACT', { factId: log.find((f) => f.type === 'goal')!.id, reason: 'offside' });
    expect(sheetCount(state.projection, 'home', 'goal')).toBe(1);
  });

  it('a projection stored before the counts existed gets the same counts from its log', () => {
    const a = getAdapter('football');
    const cfg = a.defaultConfig;
    let state: EngineState = { projection: a.initialProjection(cfg), clocks: a.initialClocks(cfg), sequence: 0 };
    const log: StoredFact[] = [];
    const run = (type: Parameters<typeof applyCommand>[4], payload: unknown) => {
      const r = applyCommand(a, cfg, state, log, type, payload, 2_000_000, null);
      if (r.kind === 'append') log.push({ ...r.entry, id: `00000000-0000-4000-8000-${String(log.length + 1).padStart(12, '0')}` });
      if (r.kind === 'correction') log.splice(log.findIndex((f) => f.id === r.factId), 1, r.updated);
      state = r.state;
    };
    run('SET_PHASE', { to: 'first_half' });
    for (const [type, side] of [['goal', 'home'], ['substitution', 'away'], ['goal', 'away'], ['corner', 'home']] as const) run('ADD_FACT', { type, side, payload: {}, occurredAt: 2_000_000 });
    run('VOID_FACT', { factId: log.find((f) => f.type === 'goal' && f.side === 'away')!.id, reason: 'offside' });
    expect(tallyOf(log)).toEqual(state.projection.tally);
    expect(tallyOf(log)).toEqual({ home: { goal: 1, corner: 1 }, away: { substitution: 1 } });
  });

  it('the walk-out steps can be skipped straight from the fixture', () => {
    for (const sport of ['football', 'futsal', 'basketball', 'hockey'] as const) {
      const a = getAdapter(sport);
      expect(a.allowedTransitions(a.defaultConfig, a.initialProjection(a.defaultConfig)), sport).toEqual(expect.arrayContaining(['pre_match', 'players_entering', 'about_to_start']));
    }
  });
});

describe('possession by time', () => {
  const a = getAdapter('football');
  const cfg = a.defaultConfig;
  it('counts match-clock time between taps, ends the spell at half time and replays the same from the log', () => {
    let state: EngineState = { projection: a.initialProjection(cfg), clocks: a.initialClocks(cfg), sequence: 0 };
    const log: StoredFact[] = [];
    let t = 1_000_000;
    const run = (type: Parameters<typeof applyCommand>[4], payload: unknown) => {
      const r = applyCommand(a, cfg, state, log, type, payload, t, null);
      if (r.kind === 'append') log.push({ ...r.entry, id: `00000000-0000-4000-8000-${String(log.length + 1).padStart(12, '0')}` });
      state = r.state;
    };
    const tap = (side: 'home' | 'away') => run('ADD_FACT', { type: POSSESSION_EVENT, side, payload: {}, occurredAt: t });
    run('SET_PHASE', { to: 'first_half' });
    tap('home');
    t += 60_000;
    tap('away');
    t += 20_000;
    // the running spell counts in the live share: 60 s home, 20 s away so far
    expect(possessionShare(state.projection, 80_000)).toEqual({ home: 75, away: 25 });
    expect(state.projection.stats.home.possession_pct).toBe(100); // stored at the last tap
    tap('home');
    expect(state.projection.stats).toMatchObject({ home: { possession_pct: 75 }, away: { possession_pct: 25 } });
    t += 20_000;
    run('SET_PHASE', { to: 'half_time' }); // home's spell ends with the half: 80 s home, 20 s away
    expect(state.projection.possessionTime).toMatchObject({ side: null, ms: { home: 80_000, away: 20_000 } });
    expect(state.projection.stats.home.possession_pct).toBe(80);
    t += 600_000; // half time does not count
    run('SET_PHASE', { to: 'second_half' });
    expect(state.projection.possession).toBeNull();
    tap('away');
    t += 100_000;
    tap('home');
    expect(state.projection.stats).toMatchObject({ home: { possession_pct: 40 }, away: { possession_pct: 60 } });
    // a correction replays the whole log: voiding the last away tap gives the time back to nobody
    run('VOID_FACT', { factId: log.findLast((f) => f.type === POSSESSION_EVENT && f.side === 'away')!.id, reason: 'wrong team' });
    expect(state.projection.stats).toMatchObject({ home: { possession_pct: 80 }, away: { possession_pct: 20 } });
  });

  it('is not kept in the shoot-out', () => {
    const p = { ...a.initialProjection(cfg), phase: 'shootout' };
    expect(() => applyCommand(a, cfg, { projection: p, clocks: a.initialClocks(cfg), sequence: 0 }, [], 'ADD_FACT', { type: POSSESSION_EVENT, side: 'home', payload: {}, occurredAt: 1 }, 2, null)).toThrow(/shoot-out/);
  });
});
