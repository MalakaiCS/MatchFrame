import { describe, expect, it } from 'vitest';
import { applyCommand, getAdapter, type EngineState, type StoredFact } from './engine';
import { possessionShare, POSSESSION_EVENT } from './possession';
import { SCORER_BOARDS } from './scorer-board';
import type { Sport } from './types';

describe('scorer board', () => {
  it('names only events the sport has, and every counted row reads a statistic the event moves', () => {
    for (const [sport, board] of Object.entries(SCORER_BOARDS) as [Sport, NonNullable<(typeof SCORER_BOARDS)[Sport]>][]) {
      const a = getAdapter(sport);
      const cfg = a.defaultConfig;
      const types = a.eventTypes(cfg).map((e) => e.type);
      for (const t of [...board.scoring, ...board.rows.map((r) => r.type), ...board.more]) expect(types, `${sport}: ${t}`).toContain(t);
      if (board.possession) expect(types, sport).toContain(POSSESSION_EVENT);
      for (const row of board.rows.filter((r) => r.stat)) {
        const p = { ...a.initialProjection(cfg), phase: a.phases(cfg).find((x) => x.kind === 'play')!.id };
        const def = a.eventTypes(cfg).find((e) => e.type === row.type)!;
        const after = a.applyFact(cfg, p, { sequence: 1, category: 'event', type: row.type, side: 'home', playerId: null, payload: def.type === 'field_goal' ? { points: 1 } : {}, periodId: p.phase, clockMs: 0 });
        expect(after.stats.home[row.stat!], `${sport}: ${row.type} counts ${row.stat}`).toBe(1);
      }
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
