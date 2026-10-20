'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CloudOff, Pause, Play, RotateCcw, Undo2, UserRound } from 'lucide-react';
import { clockDisplayMs, getAdapter, type DisplayModel, type EventTypeDef } from '@bs/domain';
import { Button, Dialog, ErrorNotice, Field, Input, Spinner, StatusPill, cx } from '@bs/ui';
import { get } from '@/lib/api';
import { useMe } from '@/lib/session';
import { useScorer } from '@/lib/use-scorer';

type Side = 'home' | 'away';
interface Fact { id: string; sequence: number; category: string; type: string; side: Side | null; playerId: string | null; clockMs: number | null; voided: boolean; revision: number; periodId: string }

function useTicker(ms = 200) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export default function ScorePage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const me = useMe();
  const s = useScorer(matchId, me.data?.user.id);
  useTicker();
  const facts = useQuery({ queryKey: ['facts', matchId, s.state?.stateVersion], queryFn: () => get<Fact[]>(`matches/${matchId}/facts`), enabled: s.online && !!s.state, staleTime: 0 });
  const [pick, setPick] = useState<{ ev: EventTypeDef; side?: Side; extra?: Record<string, unknown> } | null>(null);
  const [playerFor, setPlayerFor] = useState<{ factId?: string; commandId?: string; side: Side; label: string } | null>(null);
  const [undo, setUndo] = useState<Fact | null>(null);
  const [reason, setReason] = useState('');
  const [clockDlg, setClockDlg] = useState<string | null>(null);
  const [clockVal, setClockVal] = useState('');
  const [phaseConfirm, setPhaseConfirm] = useState<string | null>(null);
  const [morePhases, setMorePhases] = useState(false);
  const [bbReset, setBbReset] = useState(true);
  const lastCommand = useRef<string | null>(null);

  const adapter = s.match ? getAdapter(s.match.sport) : null;
  const cfg = s.match?.rulesConfig as never;
  const proj = s.provisional?.projection ?? s.state?.projection;
  // recomputed on every tick: display time is derived from the server anchor, never stored
  const display: DisplayModel | null = adapter && proj && s.state ? adapter.display(cfg, proj, s.state.clocks, s.serverNow()) : null;

  // after an urgent goal is accepted, offer "who scored?" against exactly that accepted fact
  useEffect(() => {
    if (playerFor?.commandId && !playerFor.factId && s.accepted[playerFor.commandId]) setPlayerFor({ ...playerFor, factId: s.accepted[playerFor.commandId] });
  }, [s.accepted, playerFor]);

  if (s.loadError && !s.match) return <div className="p-4"><ErrorNotice error={s.loadError} /></div>;
  if (!s.match || !s.state || !adapter || !proj || !display) return <div className="grid min-h-[60vh] place-items-center"><Spinner /></div>;
  const m = s.match;
  const phase = adapter.phase(cfg, proj.phase)!;
  const transitions = adapter.allowedTransitions(cfg, proj);
  const events = adapter.eventTypes(cfg).filter((e) => (e.phases ?? ['play']).includes(phase.kind) && (proj.phase === 'shootout' ? e.type === 'shootout_kick' : e.type !== 'shootout_kick') && e.type !== 'stat_adjust');
  const pending = s.intents.filter((i) => i.status === 'queued' || i.status === 'sending');
  const review = s.intents.filter((i) => i.status === 'needs_review' || i.status === 'rejected');
  const canWrite = s.holding || !s.online; // offline intents are saved locally and applied after reconnect
  const team = (side: Side) => m.teams[side];
  const players = (side: Side) => m.lineup[side];
  const mainClock = s.state.clocks.main;
  const running = !!mainClock?.running;
  // the one step that follows the match flow (pre-match → players entering → about to start → kick-off → …); the rest sit under "More"
  const phaseDefs = transitions.map((id) => adapter.phase(cfg, id)!);
  const nextPhase = phaseDefs.find((p) => p.kind !== 'terminal' && p.tags.length) ?? phaseDefs.find((p) => p.kind !== 'terminal') ?? null;
  const otherPhases = phaseDefs.filter((p) => p.id !== nextPhase?.id);
  // goals, cards and substitutions put a graphic on air; the rest are statistics for the half-time board
  const GRAPHIC_GROUPS = ['score', 'discipline', 'change', 'shootout'];
  const primaryEvents = events.filter((e) => GRAPHIC_GROUPS.includes(e.group));
  const statEvents = events.filter((e) => !GRAPHIC_GROUPS.includes(e.group));
  const overrunMs = phase.kind === 'play' && proj.phase !== 'shootout' && mainClock?.limitMs ? clockDisplayMs(mainClock, s.serverNow()) - mainClock.limitMs : 0;

  const sendFact = async (ev: EventTypeDef, side: Side | null, extra: Record<string, unknown> = {}, playerId?: string | null) => {
    const label = `${ev.label}${side ? ` · ${team(side).abbreviation}` : ''}`;
    const id = await s.enqueue('ADD_FACT', { type: ev.type, side, playerId: playerId ?? null, payload: extra, occurredAt: Date.now() }, label);
    lastCommand.current = id;
    return id;
  };

  const onEvent = (ev: EventTypeDef) => {
    if (ev.type === 'stoppage_announced') {
      const v = prompt('Added time (minutes)');
      if (v && /^\d+$/.test(v)) void sendFact(ev, null, { minutes: Number(v) });
      return;
    }
    setPick({ ev });
  };

  const onSide = async (side: Side) => {
    if (!pick) return;
    const ev = pick.ev;
    if (ev.group === 'score' && m.sport === 'football') {
      // urgent: score now, scorer name afterwards (never invented)
      const cid = await sendFact(ev, side, pick.extra ?? {});
      setPick(null);
      setPlayerFor({ commandId: cid, side, label: ev.label });
      return;
    }
    if (ev.playerField === 'none' && ev.type !== 'substitution') {
      await sendFact(ev, side, pick.extra ?? {});
      setPick(null);
      return;
    }
    setPick({ ...pick, side });
  };

  const choosePlayer = async (playerId: string | null) => {
    if (!pick?.side) return;
    const ev = pick.ev;
    if (ev.type === 'substitution') {
      const extra = pick.extra ?? {};
      if (!('playerOutId' in extra)) return setPick({ ...pick, extra: { playerOutId: playerId } });
      await sendFact(ev, pick.side, { ...extra, playerInId: playerId });
      return setPick(null);
    }
    await sendFact(ev, pick.side, pick.extra ?? {}, playerId);
    setPick(null);
  };

  const assignScorer = async (playerId: string) => {
    if (!playerFor) return;
    if (playerFor.factId) await s.enqueue('CORRECT_FACT', { factId: playerFor.factId, reason: 'scorer identified', changes: { playerId } }, `Scorer for ${playerFor.label}`);
    setPlayerFor(null);
  };

  const clockAction = (action: 'start' | 'pause' | 'resume', clockId = 'main') => s.enqueue('CLOCK_ACTION', { clockId, action }, `Clock ${action}`);
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3 pb-24">
      {/* status */}
      <div className={cx('flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm', s.online ? 'border-border' : 'border-warning/60 bg-warning/10')} role="status">
        {s.online ? <StatusPill tone="healthy">Online</StatusPill> : <StatusPill tone="offline"><CloudOff className="size-3" /> Offline</StatusPill>}
        {pending.length ? <StatusPill tone="warning">{pending.length} pending</StatusPill> : <span className="text-xs text-muted">All changes saved</span>}
        {s.provisional?.provisional ? <span className="text-xs text-warning">Score shown includes unconfirmed actions (provisional)</span> : null}
        {!s.online ? <span className="w-full text-xs text-warning">Offline: actions are stored on this device only. They are not reaching scoreboards or live graphics until you reconnect.</span> : null}
        {s.fromCache ? <span className="w-full text-xs text-muted">Showing the last saved copy of this match.</span> : null}
      </div>
      {s.leaseProblem || (s.online && !s.holding) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-live/50 bg-live/10 px-3 py-2 text-sm" role="alert">
          <AlertTriangle className="size-4 text-live" />
          <span className="flex-1">{s.leaseProblem ?? 'Another device has control of this match. Your actions will wait until you take over.'}</span>
          <Button size="sm" onClick={() => s.takeControl()}>Take over scoring</Button>
        </div>
      ) : null}

      {/* scoreboard */}
      <section className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[var(--radius-card)] border border-border bg-panel p-3 text-center" aria-label="Score">
        {(['home', 'away'] as const).map((side, i) => (
          <div key={side} className={cx('flex flex-col items-center', i === 1 && 'order-3')}>
            <span className="h-1.5 w-12 rounded" style={{ background: team(side).primaryColor }} />
            <span className="mt-1 text-sm font-medium">{team(side).shortName}</span>
            <span className={cx('text-5xl font-bold tabular', s.provisional?.provisional && 'text-warning')}>{display.score[side]}</span>
            {display.fouls ? <span className="text-xs text-muted">Fouls {display.fouls[side]}{display.bonus?.[side] ? ' · BONUS' : ''} · TO {display.timeouts?.[side]}</span> : null}
            {display.possession === side ? <span className="text-xs text-primary">◀ possession</span> : null}
          </div>
        ))}
        <div className="order-2 flex flex-col items-center">
          <span className="text-xs text-muted">{display.periodLabel}</span>
          <span className="text-3xl font-semibold tabular" aria-live="off">{display.clockText}</span>
          {display.stoppageText ? <span className="text-sm text-warning tabular">{display.stoppageText}</span> : null}
          {display.shotClockText ? <span className="mt-1 rounded bg-live/20 px-2 text-lg font-semibold tabular text-live" aria-label="Shot clock">{display.shotClockText}</span> : null}
          {display.shootout ? <span className="text-xs">Pens {display.shootout.home}–{display.shootout.away}</span> : null}
        </div>
      </section>
      {display.alerts.map((a) => <p key={a} className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning" role="alert">{a}</p>)}
      {overrunMs > 10 * 60_000 ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm">
          <span className="flex w-full items-center gap-2"><AlertTriangle className="size-4 shrink-0 text-warning" /> This period is {Math.floor(overrunMs / 60_000)} minutes over. Still playing?</span>
          {nextPhase ? <Button size="sm" variant="primary" disabled={!canWrite} onClick={() => setPhaseConfirm(nextPhase.id)}>Next: {nextPhase.label}</Button> : null}
          <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => { setClockDlg('main'); setClockVal(mmss(clockDisplayMs(mainClock!, s.serverNow()))); }}>Correct clock</Button>
        </div>
      ) : null}

      {/* clock */}
      {phase.kind === 'play' && proj.phase !== 'shootout' ? (
        <section className="flex flex-wrap gap-2" aria-label="Clock controls">
          <Button size="touch" variant={running ? 'secondary' : 'primary'} className="flex-1" disabled={!canWrite} onClick={() => clockAction(running ? 'pause' : mainClock?.baseMs ? 'resume' : 'start')}>
            {running ? <><Pause className="size-5" /> Pause clock</> : <><Play className="size-5" /> Start clock</>}
          </Button>
          <Button size="touch" variant="ghost" disabled={!canWrite} onClick={() => { setClockDlg('main'); setClockVal(mmss(clockDisplayMs(mainClock!, s.serverNow()))); }}>Correct</Button>
          {s.state.clocks.shot ? (
            <>
              <Button size="touch" disabled={!canWrite} onClick={() => s.enqueue('CLOCK_ACTION', { clockId: 'shot', action: 'reset', ms: ((cfg as { shotClock: { fullSeconds: number } }).shotClock.fullSeconds) * 1000 }, 'Shot clock reset')}><RotateCcw className="size-4" /> {(cfg as { shotClock: { fullSeconds: number } }).shotClock.fullSeconds}</Button>
              <Button size="touch" disabled={!canWrite} onClick={() => s.enqueue('CLOCK_ACTION', { clockId: 'shot', action: 'reset', ms: ((cfg as { shotClock: { resetSeconds: number } }).shotClock.resetSeconds) * 1000 }, 'Shot clock reset')}><RotateCcw className="size-4" /> {(cfg as { shotClock: { resetSeconds: number } }).shotClock.resetSeconds}</Button>
            </>
          ) : null}
        </section>
      ) : null}

      {/* events */}
      {m.sport === 'basketball' && phase.kind === 'play' ? (
        <section className="grid grid-cols-2 gap-2" aria-label="Scoring">
          {(['home', 'away'] as const).map((side) => (
            <div key={side} className="grid gap-2">
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((pts) => (
                  <Button key={pts} size="touch" variant="primary" disabled={!canWrite} style={{ background: team(side).primaryColor, color: '#fff' }}
                    onClick={() => sendFact(events.find((e) => e.type === 'score')!, side, { points: pts, resetShotClock: pts > 1 ? bbReset : false })} aria-label={`${team(side).abbreviation} plus ${pts}`}>
                    +{pts}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button size="touch" disabled={!canWrite} onClick={() => setPick({ ev: events.find((e) => e.type === 'foul')!, side, extra: { foulType: 'personal' } })}>Foul</Button>
                <Button size="touch" disabled={!canWrite} onClick={() => sendFact(events.find((e) => e.type === 'timeout')!, side)}>T/O</Button>
                <Button size="touch" disabled={!canWrite} onClick={() => sendFact(events.find((e) => e.type === 'possession')!, side)}>Poss.</Button>
              </div>
              <Button size="touch" disabled={!canWrite} onClick={() => setPick({ ev: events.find((e) => e.type === 'substitution')!, side })}>Sub {team(side).abbreviation}</Button>
            </div>
          ))}
          <label className="col-span-2 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={bbReset} onChange={(e) => setBbReset(e.target.checked)} className="size-5" /> Reset shot clock on 2/3-point scores</label>
        </section>
      ) : events.length ? (
        <>
          <section className="grid grid-cols-3 gap-2" aria-label="Events">
            {primaryEvents.map((ev) => (
              <Button key={ev.type} size="touch" variant={ev.group === 'score' || ev.group === 'shootout' ? 'primary' : ev.group === 'discipline' ? 'danger' : 'secondary'} disabled={!canWrite} onClick={() => onEvent(ev)}>
                {ev.label}
              </Button>
            ))}
          </section>
          {statEvents.length ? (
            <section className="rounded-[var(--radius-card)] border border-border p-3" aria-label="Statistics">
              <h2 className="mb-2 text-xs font-medium text-muted">Statistics · counted for the half-time board, no graphic</h2>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {statEvents.map((ev) => <Button key={ev.type} size="md" variant="ghost" className="border border-border" disabled={!canWrite} onClick={() => onEvent(ev)}>{ev.label}</Button>)}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {/* phases */}
      <section aria-label="Match phase" className="rounded-[var(--radius-card)] border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted">Now: {phase.label}</h2>
          {otherPhases.length ? <button className="text-xs text-muted underline" onClick={() => setMorePhases(true)}>More options</button> : null}
        </div>
        {nextPhase ? (
          <Button size="touch" variant={nextPhase.kind === 'play' ? 'primary' : 'secondary'} className="w-full justify-between" disabled={!canWrite} onClick={() => setPhaseConfirm(nextPhase.id)}>
            <span>Next: {nextPhase.label}</span><ArrowRight className="size-5" />
          </Button>
        ) : <p className="text-sm text-muted">The match is finished.</p>}
      </section>

      {/* review queue */}
      {review.length ? (
        <section aria-label="Needs review" className="rounded-[var(--radius-card)] border border-warning/60 p-3">
          <h2 className="mb-2 text-sm font-medium text-warning">Needs your review ({review.length})</h2>
          {review.map((i) => (
            <div key={i.commandId} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
              <span className="flex-1"><strong>{i.label}</strong> <span className="text-xs text-muted">recorded {new Date(i.createdAt).toLocaleTimeString('en-AU')}</span><span className="block text-xs text-muted">{i.error?.message}</span></span>
              {i.status === 'needs_review' ? <Button size="sm" variant="primary" onClick={() => s.review(i.commandId, 'apply')}>Apply now</Button> : <Button size="sm" onClick={() => s.review(i.commandId, 'apply')}>Retry</Button>}
              <Button size="sm" variant="ghost" onClick={() => s.review(i.commandId, 'discard')}>Discard</Button>
            </div>
          ))}
        </section>
      ) : null}

      {/* history */}
      <section aria-label="History" className="rounded-[var(--radius-card)] border border-border p-3">
        <h2 className="mb-2 text-xs font-medium text-muted">Recent</h2>
        <ul className="grid gap-1 text-sm">
          {pending.map((i) => <li key={i.commandId} className="flex items-center gap-2 text-warning"><StatusPill tone="warning">{i.status === 'sending' ? 'sending' : 'pending'}</StatusPill>{i.label}</li>)}
          {(facts.data ?? []).filter((f) => f.category === 'event').slice(-12).reverse().map((f) => {
            const pl = f.playerId ? [...players('home'), ...players('away')].find((p) => p.playerId === f.playerId) : null;
            return (
              <li key={f.id} className={cx('flex min-h-11 items-center gap-2', f.voided && 'line-through opacity-50')}>
                <span className="w-10 text-xs text-muted tabular">{f.clockMs != null ? `${Math.floor(f.clockMs / 60000)}'` : ''}</span>
                <span className="flex-1">{f.type.replace(/_/g, ' ')} {f.side ? team(f.side).abbreviation : ''} {pl ? `· ${pl.displayName}` : ''}</span>
                {!f.voided && !f.playerId && f.side ? <Button size="sm" variant="ghost" aria-label="Add player" onClick={() => setPlayerFor({ factId: f.id, side: f.side!, label: f.type })}><UserRound className="size-4" /></Button> : null}
                {!f.voided ? <Button size="sm" variant="ghost" aria-label={`Undo ${f.type}`} disabled={!canWrite} onClick={() => { setUndo(f); setReason(''); }}><Undo2 className="size-4" /></Button> : null}
              </li>
            );
          })}
          {!s.online ? <li className="text-xs text-muted">History refreshes when you are back online.</li> : null}
        </ul>
      </section>

      {/* team picker */}
      <Dialog open={!!pick && !pick.side} onOpenChange={(o) => !o && setPick(null)} title={pick?.ev.label ?? ''} description="Which team?">
        <div className="grid grid-cols-2 gap-3">
          {(['home', 'away'] as const).map((side) => <Button key={side} size="touch" className="min-h-20 text-xl" disabled={pick?.ev.type === 'shootout_kick' && pick.extra?.scored === undefined} style={{ background: team(side).primaryColor, color: '#fff' }} onClick={() => onSide(side)}>{team(side).shortName}</Button>)}
        </div>
        {pick?.ev.type === 'shootout_kick' ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="touch" variant={pick.extra?.scored === true ? 'primary' : 'secondary'} onClick={() => setPick({ ...pick, extra: { scored: true } })}>Scored</Button>
            <Button size="touch" variant={pick.extra?.scored === false ? 'primary' : 'secondary'} onClick={() => setPick({ ...pick, extra: { scored: false } })}>Missed</Button>
          </div>
        ) : null}
      </Dialog>

      {/* player picker */}
      <Dialog open={!!pick?.side} onOpenChange={(o) => !o && setPick(null)} title={pick?.ev.type === 'substitution' ? ('playerOutId' in (pick?.extra ?? {}) ? 'Player coming on' : 'Player going off') : `${pick?.ev.label}: which player?`} description="Optional — skip if unsure. Players are never guessed.">
        <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto">
          {pick?.side ? players(pick.side).map((p) => <Button key={p.playerId} size="touch" className="justify-start" onClick={() => choosePlayer(p.playerId)}><span className="w-8 text-right tabular text-muted">{p.number ?? ''}</span> {p.displayName}</Button>) : null}
        </div>
        <Button className="mt-3 w-full" size="touch" variant="ghost" onClick={() => choosePlayer(null)}>Skip player</Button>
      </Dialog>

      <Dialog open={!!playerFor} onOpenChange={(o) => !o && setPlayerFor(null)} title={`${playerFor?.label ?? ''} recorded`} description={playerFor?.factId ? 'Who was it? You can also add this later from the history.' : 'Saving… you can pick the player once it is accepted.'}>
        <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto">
          {playerFor ? players(playerFor.side).map((p) => <Button key={p.playerId} size="touch" className="justify-start" disabled={!playerFor.factId} onClick={() => assignScorer(p.playerId)}><span className="w-8 text-right tabular text-muted">{p.number ?? ''}</span> {p.displayName}</Button>) : null}
        </div>
        <Button className="mt-3 w-full" size="touch" variant="ghost" onClick={() => setPlayerFor(null)}>Later</Button>
      </Dialog>

      <Dialog open={!!undo} onOpenChange={(o) => !o && setUndo(null)} title={`Undo ${undo?.type.replace(/_/g, ' ')}`} description="The original stays in the audit trail; the score and stats are recalculated. No celebration is replayed."
        footer={<><Button variant="ghost" onClick={() => setUndo(null)}>Keep</Button><Button variant="danger" disabled={!reason.trim()} onClick={async () => { await s.enqueue('VOID_FACT', { factId: undo!.id, reason }, `Undo ${undo!.type}`); setUndo(null); }}>Undo it</Button></>}>
        <Field label="Reason" htmlFor="ur"><Input id="ur" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. disallowed – offside" /></Field>
      </Dialog>

      <Dialog open={!!clockDlg} onOpenChange={(o) => !o && setClockDlg(null)} title="Correct the clock" description="Corrections are audited. Timed graphics crossed by a forward correction are skipped, not played."
        footer={<><Button variant="ghost" onClick={() => setClockDlg(null)}>Cancel</Button><Button variant="primary" disabled={!/^\d{1,3}:\d{2}$/.test(clockVal) || !reason.trim()} onClick={async () => { const [mi, se] = clockVal.split(':').map(Number); await s.enqueue('CLOCK_ACTION', { clockId: clockDlg, action: 'set', ms: (mi! * 60 + se!) * 1000, reason }, 'Clock correction'); setClockDlg(null); setReason(''); }}>Set clock</Button></>}>
        <div className="grid gap-3">
          <Field label="Clock (mm:ss)" htmlFor="cv"><Input id="cv" inputMode="numeric" value={clockVal} onChange={(e) => setClockVal(e.target.value)} /></Field>
          <Field label="Reason" htmlFor="cr"><Input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Dialog>

      <Dialog open={morePhases} onOpenChange={setMorePhases} title="Other options" description="Skip a step or end the match early. Each move is confirmed.">
        <div className="grid gap-2">
          {otherPhases.map((def) => <Button key={def.id} size="touch" variant={def.kind === 'terminal' ? 'danger' : 'secondary'} disabled={!canWrite} onClick={() => { setMorePhases(false); setPhaseConfirm(def.id); }}>{def.label}</Button>)}
        </div>
      </Dialog>

      <Dialog open={!!phaseConfirm} onOpenChange={(o) => !o && setPhaseConfirm(null)} title={`Move to ${phaseConfirm ? adapter.phase(cfg, phaseConfirm)?.label : ''}?`} description={phaseConfirm && adapter.phase(cfg, phaseConfirm)?.kind === 'play' ? 'The period clock is set for the new period.' : 'The match clock pauses.'}
        footer={<><Button variant="ghost" onClick={() => setPhaseConfirm(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await s.enqueue('SET_PHASE', { to: phaseConfirm }, `→ ${adapter.phase(cfg, phaseConfirm!)?.label}`); setPhaseConfirm(null); }}>Confirm</Button></>} />

      <div className="flex justify-between text-xs text-muted">
        <span>{m.competition.name}</span>
        <button className="underline" onClick={() => s.release()}>Hand over scoring</button>
      </div>
    </div>
  );
}
