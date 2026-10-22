import { describe, expect, it } from 'vitest';
import { shootoutLine, shootoutRounds, shootoutStatus } from './shootout';

// kicks written as "HAHA…" sides with x for a miss: 'H' scored, 'h' missed
const kicks = (s: string) => [...s].map((c) => ({ side: (c.toLowerCase() === 'h' ? 'home' : 'away') as 'home' | 'away', scored: c === c.toUpperCase() }));
const names = { home: 'France', away: 'Italy' };
const at = (s: string, rounds = 5) => shootoutStatus({ kicks: kicks(s) }, rounds);

describe('penalty shoot-out', () => {
  it('before the first kick: best of five, nobody known to kick first', () => {
    expect(at('')).toMatchObject({ next: null, round: 0, suddenDeath: false, winner: null, pressure: null });
    expect(shootoutLine(at(''), names)).toBe('Best of 5, then sudden death');
  });

  it('alternates from whoever kicked first and counts the round', () => {
    expect(at('A')).toMatchObject({ first: 'away', next: 'home', round: 1 });
    expect(at('Ah')).toMatchObject({ next: 'away', round: 2, scored: { home: 0, away: 1 }, taken: { home: 1, away: 1 } });
    expect(shootoutLine(at('Ah'), names)).toBe('Kick 2 of 5');
  });

  it('is decided as soon as a team cannot be caught with the kicks it has left', () => {
    // France 3 of 3, Italy 0 of 3: Italy can reach 2 at most
    expect(at('HaHaHa')).toMatchObject({ winner: 'home', next: null, round: 3 });
    expect(shootoutLine(at('HaHaHa'), names)).toBe('France win 3–0 on penalties');
    // France 2 of 3, Italy 0 of 2: Italy can still reach 3, so it goes on
    expect(at('HaHaH').winner).toBeNull();
  });

  it('says when the next kick wins it or must be scored to stay in', () => {
    // after four each France 4, Italy 3, France to kick: scoring wins it
    expect(at('HAHAHAHa').pressure).toEqual({ side: 'home', kind: 'to_win' });
    expect(shootoutLine(at('HAHAHAHa'), names)).toBe('France score to win');
    // France miss their fifth (4 of 5): Italy, 3 of 4, must score their fifth to stay in
    expect(at('HAHAHAHah').pressure).toEqual({ side: 'away', kind: 'to_survive' });
    expect(shootoutLine(at('HAHAHAHah'), names)).toBe('Italy must score to stay in');
    // France 5 of 5, Italy 3 of 4: Italy cannot catch up even with their last kick
    expect(at('HAHAHaHAH')).toMatchObject({ winner: 'home', pressure: null });
  });

  it('goes to sudden death level after five each and ends on a split pair', () => {
    const level = 'HAHAHAHAHA';
    expect(at(level)).toMatchObject({ winner: null, next: 'home', round: 6, suddenDeath: true });
    expect(shootoutLine(at(`${level}HA`), names)).toBe('Sudden death · round 7');
    // France score their sixth: Italy must answer
    expect(at(`${level}H`).pressure).toEqual({ side: 'away', kind: 'to_survive' });
    // France miss their sixth: Italy score to win
    expect(at(`${level}h`).pressure).toEqual({ side: 'away', kind: 'to_win' });
    expect(at(`${level}hA`)).toMatchObject({ winner: 'away', next: null, suddenDeath: true });
    expect(shootoutLine(at(`${level}hA`), names)).toBe('Italy win 6–5 on penalties');
    // a pair is never decided half way
    expect(at(`${level}H`).winner).toBeNull();
  });

  it("uses the rules' number of kicks (futsal three) and otherwise five", () => {
    expect(shootoutRounds({ shootout: { enabled: true, kicks: 3 } })).toBe(3);
    expect(shootoutRounds({ shootout: { enabled: true } })).toBe(5);
    expect(shootoutRounds(null)).toBe(5);
    expect(shootoutStatus({ kicks: kicks('HAHAHA') }, { shootout: { kicks: 3 } })).toMatchObject({ rounds: 3, suddenDeath: true, round: 4 });
  });

  it('a kick recorded after it was decided does not reopen it', () => {
    expect(at('HaHaHaA').winner).toBe('home');
  });
});

describe('kicks once the shoot-out is decided', () => {
  it('are refused for football, futsal and hockey until the deciding kick is undone', async () => {
    const { applyCommand, getAdapter } = await import('./engine');
    for (const [sport, type, cfgOver] of [['football', 'shootout_kick', {}], ['futsal', 'shootout_kick', { shootout: { enabled: true, kicks: 3 } }], ['hockey', 'shootout_stroke', { shootout: { enabled: true } }]] as const) {
      const a = getAdapter(sport);
      const cfg = { ...a.defaultConfig, ...cfgOver } as never;
      // the match is in its shoot-out (as a phase entry, so a replay after an undo starts from there too)
      const log: Parameters<typeof applyCommand>[3] = [{ id: '00000000-0000-4000-8000-000000000000', sequence: 1, category: 'phase', type: 'phase_change', side: null, playerId: null, payload: { from: 'scheduled', to: 'shootout' }, periodId: 'shootout', clockMs: null, voided: false, occurredAt: 500, revision: 1 }];
      let state = { projection: { ...a.applyPhase(cfg, a.initialProjection(cfg), 'shootout'), lastFactSequence: 1 }, clocks: a.initialClocks(cfg), sequence: 1 };
      const kick = (side: 'home' | 'away', scored: boolean) => {
        const r = applyCommand(a, cfg, state, log, 'ADD_FACT', { type, side, payload: { scored }, occurredAt: 1_000 }, 1_000, null);
        if (r.kind === 'append') log.push({ ...r.entry, id: `00000000-0000-4000-8000-${String(log.length + 1).padStart(12, '0')}` });
        state = r.state as typeof state;
      };
      // home score every kick, away miss every kick: decided after the away team cannot catch up
      const rounds = shootoutRounds(cfg);
      for (let i = 0; !shootoutStatus(state.projection.shootout, cfg).winner; i++) kick(i % 2 ? 'away' : 'home', i % 2 === 0);
      expect(shootoutStatus(state.projection.shootout, cfg).winner, sport).toBe('home');
      expect(state.projection.shootout?.kicks.length, sport).toBeLessThan(rounds * 2);
      expect(() => kick('away', true), sport).toThrow(/already decided/);
      const r = applyCommand(a, cfg, state, log, 'VOID_FACT', { factId: log[log.length - 1]!.id, reason: 'wrong side' }, 2_000, null);
      state = r.state as typeof state;
      expect(shootoutStatus(state.projection.shootout, cfg).winner, sport).toBeNull();
      expect(() => kick('away', true), sport).not.toThrow();
    }
  });
});

describe('the starter flows', () => {
  it('put the shoot-out tracker on air at the shoot-out and keep it there (football, futsal, hockey only)', async () => {
    const { STARTER_PLANS } = await import('./starter-plans');
    for (const [sport, plan] of Object.entries(STARTER_PLANS)) {
      const pl = plan!.playlists.find((p) => p.triggers.some((t) => t.type === 'phase' && t.phaseTags.includes('shootout')));
      if (!['football', 'futsal', 'hockey'].includes(sport)) {
        expect(pl, sport).toBeUndefined();
        continue;
      }
      expect(pl?.items, sport).toEqual([expect.objectContaining({ action: 'show', templateKey: 'builtin:shootout', durationMs: null })]);
    }
  });
});
