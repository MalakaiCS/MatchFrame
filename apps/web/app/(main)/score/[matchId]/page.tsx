'use client';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CloudOff, Pause, Play, RotateCcw, Settings2, Undo2, UserRound, Users } from 'lucide-react';
import { FUTSAL_GOAL_TYPES, FUTSAL_GOAL_TYPE_LABELS, GOAL_TYPES, GOAL_TYPE_LABELS, clockDisplayMs, getAdapter, onField, type DisplayModel, type EventTypeDef, type LineupPlayer } from '@bs/domain';
import { Button, Dialog, ErrorNotice, Field, Input, NativeSelect, Spinner, StatusPill, Switch, cx } from '@bs/ui';
import { get } from '@/lib/api';
import { feedback, tone, useScorerPrefs } from '@/lib/feedback';
import { ACCESS_LABEL } from '@/lib/scorer-access';
import { useMe } from '@/lib/session';
import { useScorer } from '@/lib/use-scorer';
import { STARTERS } from '@/components/lineup-editor';

type Side = 'home' | 'away';
interface Fact { id: string; sequence: number; category: string; type: string; side: Side | null; playerId: string | null; clockMs: number | null; voided: boolean; revision: number; periodId: string; payload: Record<string, unknown> }
type FoulType = 'personal' | 'offensive' | 'technical' | 'unsportsmanlike' | 'disqualifying';
const FOUL_TYPES: { id: FoulType; label: string }[] = [
  { id: 'personal', label: 'Personal' },
  { id: 'offensive', label: 'Offensive' },
  { id: 'technical', label: 'Technical' },
  { id: 'unsportsmanlike', label: 'Unsportsmanlike' },
  { id: 'disqualifying', label: 'Disqualifying' },
];
// goals, cards and substitutions put a graphic on air; the rest are statistics for the half-time board
const GRAPHIC_GROUPS = ['score', 'discipline', 'change', 'shootout'];
const DETAIL_GOAL_TYPES = GOAL_TYPES.filter((g) => g !== 'own_goal' && g !== 'penalty');
// futsal penalties and 10 m kicks have their own buttons
const FUTSAL_DETAIL_GOAL_TYPES = FUTSAL_GOAL_TYPES.filter((g) => g !== 'own_goal' && g !== 'penalty' && g !== 'second_penalty');
const GOAL_LABELS: Record<string, string> = { ...GOAL_TYPE_LABELS, ...FUTSAL_GOAL_TYPE_LABELS };

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
  const { prefs, update: updatePrefs } = useScorerPrefs();
  const s = useScorer(matchId, me.data, { lowData: prefs.lowData });
  useTicker();
  const facts = useQuery({ queryKey: ['facts', matchId, s.state?.stateVersion], queryFn: () => get<Fact[]>(`matches/${matchId}/facts`), enabled: s.online && !!s.state, staleTime: 0 });
  const [pick, setPick] = useState<{ ev: EventTypeDef; side?: Side; extra?: Record<string, unknown> } | null>(null);
  const [playerFor, setPlayerFor] = useState<{ factId?: string; commandId?: string; side: Side; label: string; eventType: string } | null>(null);
  const [goalDetails, setGoalDetails] = useState<{ factId: string; side: Side; scorerId: string | null; step: 'assist' | 'type'; assistId?: string | null } | null>(null);
  const [undo, setUndo] = useState<Fact | null>(null);
  const [reason, setReason] = useState('');
  const [clockDlg, setClockDlg] = useState<string | null>(null);
  const [clockVal, setClockVal] = useState('');
  const [phaseConfirm, setPhaseConfirm] = useState<string | null>(null);
  const [morePhases, setMorePhases] = useState(false);
  const [bbReset, setBbReset] = useState(true);
  const [settings, setSettings] = useState(false);
  const [quickUndo, setQuickUndo] = useState<{ commandId: string; label: string; at: number } | null>(null);
  const warned = useRef(0);

  const adapter = s.match ? getAdapter(s.match.sport) : null;
  const cfg = s.match?.rulesConfig as never;
  const proj = s.provisional?.projection ?? s.state?.projection;
  // recomputed on every tick: display time is derived from the server anchor, never stored
  const display: DisplayModel | null = adapter && proj && s.state ? adapter.display(cfg, proj, s.state.clocks, s.serverNow()) : null;

  // after an urgent score is accepted, offer "who scored?" against exactly that accepted fact
  useEffect(() => {
    if (playerFor?.commandId && !playerFor.factId && s.accepted[playerFor.commandId]) setPlayerFor({ ...playerFor, factId: s.accepted[playerFor.commandId] });
  }, [s.accepted, playerFor]);

  // a buzz and a low tone when something came back rejected or needs a decision
  useEffect(() => {
    const n = s.intents.filter((i) => i.status === 'needs_review' || i.status === 'rejected').length;
    if (n > warned.current) feedback(prefs, 'warn');
    warned.current = n;
  }, [s.intents, prefs]);

  if (s.loadError && !s.match) return <div className="p-4"><ErrorNotice error={s.loadError} /></div>;
  if (!s.match || !s.state || !adapter || !proj || !display) return <div className="grid min-h-[60vh] place-items-center"><Spinner /></div>;
  const m = s.match;
  const access = s.access;
  const phase = adapter.phase(cfg, proj.phase)!;
  const transitions = adapter.allowedTransitions(cfg, proj);
  const events = adapter.eventTypes(cfg).filter((e) => (e.phases ?? ['play']).includes(phase.kind) && (proj.phase === 'shootout' ? e.group === 'shootout' : e.group !== 'shootout') && e.type !== 'stat_adjust');
  const pending = s.intents.filter((i) => i.status === 'queued' || i.status === 'sending');
  const review = s.intents.filter((i) => i.status === 'needs_review' || i.status === 'rejected');
  // full scorers need the scoring lease (or to be offline, where actions wait); statistics scorers never do
  const canScore = access === 'score' && (s.holding || !s.online);
  const canStats = access === 'stats' || canScore;
  const team = (side: Side) => m.teams[side];
  const playersOf = (side: Side): LineupPlayer[] => m.lineup[side] ?? [];
  const allPlayers = [...playersOf('home'), ...playersOf('away')];
  const nameOf = (id: string | null | undefined) => (id ? allPlayers.find((p) => p.playerId === id)?.displayName ?? null : null);
  const rolling = m.sport !== 'football';
  const fieldWord = m.sport === 'basketball' || m.sport === 'netball' || m.sport === 'futsal' ? 'On the court' : 'On the field';
  /** who is on the field for a side right now: the line-up plus substitutions and dismissals so far */
  const groupPlayers = (side: Side) => {
    const f = onField(m.lineup, proj, side);
    const list = playersOf(side);
    const pickIds = (ids: string[]) => ids.map((id) => list.find((p) => p.playerId === id)).filter((p): p is LineupPlayer => !!p);
    return { on: pickIds(f.on), bench: pickIds(f.off), out: pickIds(f.unavailable) };
  };
  const mainClock = s.state.clocks.main;
  const running = !!mainClock?.running;
  // the one step that follows the match flow (pre-match → players entering → about to start → kick-off → …); the rest sit under "More"
  const phaseDefs = transitions.map((id) => adapter.phase(cfg, id)!);
  const nextPhase = phaseDefs.find((p) => p.kind !== 'terminal' && p.tags.length) ?? phaseDefs.find((p) => p.kind !== 'terminal') ?? null;
  const otherPhases = phaseDefs.filter((p) => p.id !== nextPhase?.id);
  const primaryEvents = events.filter((e) => GRAPHIC_GROUPS.includes(e.group));
  const controlEvents = events.filter((e) => e.group === 'control');
  const statEvents = events.filter((e) => e.group === 'stat');
  const overrunMs = phase.kind === 'play' && proj.phase !== 'shootout' && mainClock?.limitMs ? clockDisplayMs(mainClock, s.serverNow()) - mainClock.limitMs : 0;
  const expectedStarters = STARTERS[m.sport] ?? 1;
  const lineupThin = (['home', 'away'] as const).some((sd) => playersOf(sd).filter((p) => p.starter).length < expectedStarters);
  const foulLimit = m.sport === 'basketball' ? ((cfg as { playerFoulLimit?: number }).playerFoulLimit ?? 5) : null;
  const isBbFoulStep = (p: typeof pick) => !!p && p.ev.type === 'foul' && m.sport === 'basketball' && !p.extra?.foulType;

  const playerNote = (id: string) => {
    const t = proj.players[id];
    if (!t) return null;
    const parts: string[] = [];
    if (m.sport === 'basketball') {
      if (t.points) parts.push(`${t.points} pts`);
      if (t.fouls) parts.push(`${t.fouls} F${foulLimit && t.fouls >= foulLimit ? ' · fouled out' : ''}`);
    } else {
      if (t.goals) parts.push(`${t.goals} ${t.goals === 1 ? 'goal' : 'goals'}`);
      if (t.yellow) parts.push('yellow');
    }
    return parts.join(' · ') || null;
  };
  const renderPlayers = (list: LineupPlayer[], onPick: (id: string) => void, disabled = false) =>
    list.map((p) => (
      <Button key={p.playerId} size="touch" className="justify-start" disabled={disabled} onClick={() => onPick(p.playerId)}>
        <span className="w-8 shrink-0 text-right tabular text-muted">{p.number ?? ''}</span>
        <span className="min-w-0 flex-1 truncate text-left">{p.displayName}</span>
        {playerNote(p.playerId) ? <span className="shrink-0 text-xs font-normal text-muted">{playerNote(p.playerId)}</span> : null}
      </Button>
    ));
  /** on-field players first, then the bench; dismissed players are left out */
  const renderGrouped = (side: Side, onPick: (id: string) => void, opts: { exclude?: string | null; disabled?: boolean } = {}) => {
    const g = groupPlayers(side);
    const sections: [string, LineupPlayer[]][] = [[fieldWord, g.on], ['Bench', g.bench]];
    const shown = sections.filter(([, l]) => l.some((p) => p.playerId !== opts.exclude));
    if (!shown.length) return <p className="text-sm text-muted">No players listed for this team yet. Line-ups can be entered from the Line-ups screen.</p>;
    return shown.map(([title, list]) => (
      <div key={title}>
        <h3 className="mb-1 mt-2 text-xs font-medium text-muted">{title}</h3>
        <div className="grid grid-cols-2 gap-2">{renderPlayers(list.filter((p) => p.playerId !== opts.exclude), onPick, opts.disabled)}</div>
      </div>
    ));
  };

  const sendFact = async (ev: EventTypeDef, side: Side | null, extra: Record<string, unknown> = {}, playerId?: string | null) => {
    const label = `${ev.label}${side ? ` · ${team(side).abbreviation}` : ''}`;
    const id = await s.enqueue('ADD_FACT', { type: ev.type, side, playerId: playerId ?? null, payload: extra, occurredAt: Date.now() }, label);
    feedback(prefs, ev.group === 'score' || ev.group === 'shootout' ? 'score' : ev.group === 'discipline' ? 'card' : 'tick');
    setQuickUndo({ commandId: id, label, at: Date.now() });
    return id;
  };

  const onEvent = (ev: EventTypeDef) => {
    if (ev.type === 'stoppage_announced') {
      const v = prompt('Added time (minutes)');
      if (v && /^\d+$/.test(v)) void sendFact(ev, null, { minutes: Number(v) });
      return;
    }
    if (!ev.requiresSide) {
      void sendFact(ev, null);
      return;
    }
    setPick({ ev });
  };

  const onSide = async (side: Side) => {
    if (!pick) return;
    const ev = pick.ev;
    if (ev.group === 'score' && ev.playerField !== 'none' && playersOf(side).length) {
      // urgent: the score goes out now; the scorer's name follows (never guessed)
      const cid = await sendFact(ev, side, pick.extra ?? {});
      setPick(null);
      setPlayerFor({ commandId: cid, side, label: ev.label, eventType: ev.type });
      return;
    }
    if (ev.playerField === 'none' && ev.group !== 'change') {
      await sendFact(ev, side, pick.extra ?? {});
      setPick(null);
      return;
    }
    setPick({ ...pick, side });
  };

  const choosePlayer = async (playerId: string | null) => {
    if (!pick?.side) return;
    const ev = pick.ev;
    if (ev.group === 'change') {
      const extra = pick.extra ?? {};
      if (!('playerOutId' in extra)) return setPick({ ...pick, extra: { ...extra, playerOutId: playerId } });
      await sendFact(ev, pick.side, { ...extra, playerInId: playerId });
      return setPick(null);
    }
    await sendFact(ev, pick.side, pick.extra ?? {}, playerId);
    setPick(null);
  };

  const assignScorer = async (playerId: string) => {
    if (!playerFor?.factId) return;
    const factId = playerFor.factId;
    const { side, label, eventType } = playerFor;
    await s.enqueue('CORRECT_FACT', { factId, reason: 'scorer identified', changes: { playerId } }, `Scorer for ${label}`);
    feedback(prefs, 'tick');
    setPlayerFor(null);
    // football and futsal goals carry an assist and a type for the goal graphic and the season statistics
    if ((m.sport === 'football' || m.sport === 'futsal') && eventType === 'goal') setGoalDetails({ factId, side, scorerId: playerId, step: 'assist' });
  };

  const finishGoalDetails = async (goalType: string | null) => {
    if (!goalDetails) return;
    const payload: Record<string, unknown> = {};
    if (goalDetails.assistId) payload.assistId = goalDetails.assistId;
    if (goalType) payload.goalType = goalType;
    if (Object.keys(payload).length) {
      await s.enqueue('CORRECT_FACT', { factId: goalDetails.factId, reason: 'goal details added', changes: { payload } }, 'Goal details');
      feedback(prefs, 'tick');
    }
    setGoalDetails(null);
  };

  // "Undo" straight after an action: voids the accepted fact, or drops it from the queue if it has not been sent yet
  const quickUndoReady = !!quickUndo && (!!s.accepted[quickUndo.commandId] || s.intents.some((x) => x.commandId === quickUndo.commandId && x.status === 'queued'));
  const undoLeftS = quickUndo ? prefs.undoWindowS - (Date.now() - quickUndo.at) / 1000 : 0;
  const quickUndoNow = async () => {
    if (!quickUndo) return;
    const factId = s.accepted[quickUndo.commandId];
    if (factId) await s.enqueue('VOID_FACT', { factId, reason: 'Undone by the scorer straight after recording' }, `Undo ${quickUndo.label}`);
    else {
      const i = s.intents.find((x) => x.commandId === quickUndo.commandId);
      if (!i || i.status !== 'queued') return; // mid-send: undo it from the history once it lands
      await s.review(quickUndo.commandId, 'discard');
    }
    feedback(prefs, 'tick');
    setQuickUndo(null);
  };

  const clockAction = (action: 'start' | 'pause' | 'resume', clockId = 'main') => s.enqueue('CLOCK_ACTION', { clockId, action }, `Clock ${action}`);
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const ev = (type: string) => events.find((e) => e.type === type)!;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3 pb-28">
      {/* status */}
      <div className={cx('flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm', s.online ? 'border-border' : 'border-warning/60 bg-warning/10')} role="status">
        {s.transport === 'offline' ? <StatusPill tone="offline"><CloudOff className="size-3" /> Offline</StatusPill> : s.transport === 'polling' ? <StatusPill tone="healthy">Online · {prefs.lowData ? 'low data' : 'refreshing'}</StatusPill> : <StatusPill tone="healthy">Online</StatusPill>}
        {access !== 'score' ? <StatusPill tone="primary">{ACCESS_LABEL[access]}</StatusPill> : null}
        {pending.length ? <StatusPill tone="warning">{pending.length} pending</StatusPill> : <span className="text-xs text-muted">All changes saved</span>}
        <span className="ml-auto flex items-center gap-1">
          {access === 'score' ? <Button asChild size="sm" variant="ghost"><Link href={`/score/${matchId}/lineup`}><Users className="size-4" /> Line-ups</Link></Button> : null}
          <Button size="sm" variant="ghost" aria-label="Scoring preferences" onClick={() => setSettings(true)}><Settings2 className="size-4" /></Button>
        </span>
        {s.provisional?.provisional ? <span className="w-full text-xs text-warning">Score shown includes unconfirmed actions (provisional)</span> : null}
        {!s.online ? <span className="w-full text-xs text-warning">Offline: actions are stored on this device only. They are not reaching scoreboards or live graphics until you reconnect.</span> : null}
        {s.fromCache ? <span className="w-full text-xs text-muted">Showing the last saved copy of this match.</span> : null}
        {access === 'stats' ? <span className="w-full text-xs text-muted">You record statistics for this match. The main scorer keeps the score, clock and periods.</span> : null}
        {access === 'view' ? <span className="w-full text-xs text-muted">You can follow this match live but not change it.</span> : null}
      </div>
      {access === 'score' && (s.leaseProblem || (s.online && !s.holding)) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-live/50 bg-live/10 px-3 py-2 text-sm" role="alert">
          <AlertTriangle className="size-4 text-live" />
          <span className="flex-1">{s.leaseProblem ?? 'Another device has control of this match. Your actions will wait until you take over.'}</span>
          <Button size="sm" onClick={() => s.takeControl()}>Take over scoring</Button>
        </div>
      ) : null}
      {access === 'score' && phase.kind === 'pre' && lineupThin ? (
        <Link href={`/score/${matchId}/lineup`} className="flex min-h-12 items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm">
          <Users className="size-4 shrink-0 text-primary" />
          <span className="flex-1">Line-ups are not complete. Enter them before the start so goals and cards can name the player.</span>
          <ArrowRight className="size-4 shrink-0" />
        </Link>
      ) : null}

      {/* scoreboard */}
      <section className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[var(--radius-card)] border border-border bg-panel p-3 text-center" aria-label="Score">
        {(['home', 'away'] as const).map((side, i) => (
          <div key={side} className={cx('flex flex-col items-center', i === 1 && 'order-3')}>
            <span className="h-1.5 w-12 rounded" style={{ background: team(side).primaryColor }} />
            <span className="mt-1 text-sm font-medium">{team(side).shortName}</span>
            <span className={cx('text-5xl font-bold tabular', s.provisional?.provisional && 'text-warning')}>{display.score[side]}</span>
            {display.scoreDetail ? <span className="text-xs text-muted tabular">{display.scoreDetail[side]}</span> : null}
            {display.fouls ? <span className="text-xs text-muted">Fouls {display.fouls[side]}{display.bonus?.[side] ? (m.sport === 'futsal' ? ' · next is a 10 m kick' : ' · BONUS') : ''} · TO {display.timeouts?.[side]}</span> : null}
            {display.shortHanded?.find((x) => x.side === side) ? <span className="mt-1 rounded bg-live/15 px-2 text-xs font-semibold text-live tabular" aria-label={`${team(side).shortName} a player short`}>{display.shortHanded.find((x) => x.side === side)!.players} on court · {display.shortHanded.find((x) => x.side === side)!.remainingText}</span> : null}
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
      {access === 'score' && overrunMs > 10 * 60_000 ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm">
          <span className="flex w-full items-center gap-2"><AlertTriangle className="size-4 shrink-0 text-warning" /> This period is {Math.floor(overrunMs / 60_000)} minutes over. Still playing?</span>
          {nextPhase ? <Button size="sm" variant="primary" disabled={!canScore} onClick={() => setPhaseConfirm(nextPhase.id)}>Next: {nextPhase.label}</Button> : null}
          <Button size="sm" variant="ghost" disabled={!canScore} onClick={() => { setClockDlg('main'); setClockVal(mmss(clockDisplayMs(mainClock!, s.serverNow()))); }}>Correct clock</Button>
        </div>
      ) : null}

      {/* clock */}
      {access === 'score' && phase.kind === 'play' && proj.phase !== 'shootout' ? (
        <section className="flex flex-wrap gap-2" aria-label="Clock controls">
          <Button size="touch" variant={running ? 'secondary' : 'primary'} className="flex-1" disabled={!canScore} onClick={() => clockAction(running ? 'pause' : mainClock?.baseMs ? 'resume' : 'start')}>
            {running ? <><Pause className="size-5" /> Pause clock</> : <><Play className="size-5" /> Start clock</>}
          </Button>
          <Button size="touch" variant="ghost" disabled={!canScore} onClick={() => { setClockDlg('main'); setClockVal(mmss(clockDisplayMs(mainClock!, s.serverNow()))); }}>Correct</Button>
          {s.state.clocks.shot ? (
            <>
              <Button size="touch" disabled={!canScore} onClick={() => s.enqueue('CLOCK_ACTION', { clockId: 'shot', action: 'reset', ms: ((cfg as { shotClock: { fullSeconds: number } }).shotClock.fullSeconds) * 1000 }, 'Shot clock reset')}><RotateCcw className="size-4" /> {(cfg as { shotClock: { fullSeconds: number } }).shotClock.fullSeconds}</Button>
              <Button size="touch" disabled={!canScore} onClick={() => s.enqueue('CLOCK_ACTION', { clockId: 'shot', action: 'reset', ms: ((cfg as { shotClock: { resetSeconds: number } }).shotClock.resetSeconds) * 1000 }, 'Shot clock reset')}><RotateCcw className="size-4" /> {(cfg as { shotClock: { resetSeconds: number } }).shotClock.resetSeconds}</Button>
            </>
          ) : null}
        </section>
      ) : null}

      {/* events */}
      {access === 'view' ? null : m.sport === 'basketball' && phase.kind === 'play' ? (
        <section className="grid grid-cols-2 gap-2" aria-label="Scoring">
          {(['home', 'away'] as const).map((side) => (
            <div key={side} className="grid gap-2">
              {access === 'score' ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3].map((pts) => (
                      <Button key={pts} size="touch" variant="primary" disabled={!canScore} style={{ background: team(side).primaryColor, color: '#fff' }} aria-label={`${team(side).abbreviation} plus ${pts}`}
                        onClick={async () => {
                          const cid = await sendFact(ev('score'), side, { points: pts, resetShotClock: pts > 1 ? bbReset : false });
                          if (playersOf(side).length) setPlayerFor({ commandId: cid, side, label: `+${pts} ${team(side).abbreviation}`, eventType: 'score' });
                        }}>
                        +{pts}
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button size="touch" variant="danger" disabled={!canScore} onClick={() => setPick({ ev: ev('foul'), side })}>Foul</Button>
                    <Button size="touch" disabled={!canScore || !(display.timeouts?.[side] ?? 0)} onClick={() => sendFact(ev('timeout'), side)}>T/O{display.timeouts ? ` (${display.timeouts[side]})` : ''}</Button>
                    <Button size="touch" disabled={!canScore} onClick={() => sendFact(ev('possession'), side)}>Poss.</Button>
                  </div>
                  <Button size="touch" disabled={!canScore} onClick={() => setPick({ ev: ev('substitution'), side })}>Sub {team(side).abbreviation}</Button>
                </>
              ) : null}
              {statEvents.length ? (
                <div className="grid grid-cols-2 gap-2" aria-label={`${team(side).abbreviation} statistics`}>
                  {statEvents.map((e) => <Button key={e.type} size="md" variant="ghost" className="border border-border" disabled={!canStats} onClick={() => setPick({ ev: e, side })}>{e.label} {team(side).abbreviation}</Button>)}
                </div>
              ) : null}
            </div>
          ))}
          {access === 'score' ? <label className="col-span-2 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={bbReset} onChange={(e) => setBbReset(e.target.checked)} className="size-5" /> Reset shot clock on 2/3-point scores</label> : null}
        </section>
      ) : events.length ? (
        <>
          {access === 'score' && primaryEvents.length ? (
            <section className="grid grid-cols-3 gap-2" aria-label="Events">
              {primaryEvents.map((e) => (
                <Button key={e.type} size="touch" variant={e.group === 'score' || e.group === 'shootout' ? 'primary' : e.group === 'discipline' ? 'danger' : 'secondary'} disabled={!canScore} onClick={() => onEvent(e)}>
                  {e.label}
                </Button>
              ))}
            </section>
          ) : null}
          {access === 'score' && controlEvents.length ? (
            <section className="flex flex-wrap gap-2" aria-label="Match control">
              {controlEvents.map((e) => <Button key={e.type} size="md" variant="secondary" disabled={!canScore} onClick={() => onEvent(e)}>{e.label}</Button>)}
            </section>
          ) : null}
          {statEvents.length ? (
            <section className="rounded-[var(--radius-card)] border border-border p-3" aria-label="Statistics">
              <h2 className="mb-2 text-xs font-medium text-muted">Statistics · counted for the half-time board, no graphic</h2>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {statEvents.map((e) => <Button key={e.type} size="md" variant="ghost" className="border border-border" disabled={!canStats} onClick={() => onEvent(e)}>{e.label}</Button>)}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {/* phases */}
      {access === 'score' ? (
        <section aria-label="Match phase" className="rounded-[var(--radius-card)] border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-medium text-muted">Now: {phase.label}</h2>
            {otherPhases.length ? <button className="min-h-9 text-xs text-muted underline" onClick={() => setMorePhases(true)}>More options</button> : null}
          </div>
          {nextPhase ? (
            <Button size="touch" variant={nextPhase.kind === 'play' ? 'primary' : 'secondary'} className="w-full justify-between" disabled={!canScore} onClick={() => setPhaseConfirm(nextPhase.id)}>
              <span>Next: {nextPhase.label}</span><ArrowRight className="size-5" />
            </Button>
          ) : <p className="text-sm text-muted">The match is finished.</p>}
        </section>
      ) : null}

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
            const pl = nameOf(f.playerId);
            const assist = nameOf(f.payload?.assistId as string | undefined);
            const goalType = f.payload?.goalType ? GOAL_LABELS[String(f.payload.goalType)] ?? String(f.payload.goalType) : null;
            const detailsMissing = access === 'score' && (m.sport === 'football' || m.sport === 'futsal') && f.type === 'goal' && !f.voided && !!f.playerId && !f.payload?.goalType;
            return (
              <li key={f.id} className={cx('flex min-h-11 items-center gap-2', f.voided && 'line-through opacity-50')}>
                <span className="w-10 text-xs text-muted tabular">{f.clockMs != null ? `${Math.floor(f.clockMs / 60000)}'` : ''}</span>
                <span className="min-w-0 flex-1">
                  {f.type.replace(/_/g, ' ')} {f.side ? team(f.side).abbreviation : ''} {pl ? `· ${pl}` : ''}
                  {assist || goalType ? <span className="block text-xs text-muted">{[assist ? `assist ${assist}` : null, goalType].filter(Boolean).join(' · ')}</span> : null}
                </span>
                {detailsMissing ? <Button size="sm" variant="ghost" aria-label={`Goal details for ${pl ?? 'goal'}`} onClick={() => setGoalDetails({ factId: f.id, side: f.side!, scorerId: f.playerId, step: 'assist' })}>Details</Button> : null}
                {access === 'score' && !f.voided && !f.playerId && f.side ? <Button size="sm" variant="ghost" aria-label="Add player" onClick={() => setPlayerFor({ factId: f.id, side: f.side!, label: f.type.replace(/_/g, ' '), eventType: f.type })}><UserRound className="size-4" /></Button> : null}
                {access === 'score' && !f.voided ? <Button size="sm" variant="ghost" aria-label={`Undo ${f.type}`} disabled={!canScore} onClick={() => { setUndo(f); setReason(''); }}><Undo2 className="size-4" /></Button> : null}
              </li>
            );
          })}
          {!s.online ? <li className="text-xs text-muted">History refreshes when you are back online.</li> : null}
        </ul>
      </section>

      {/* team picker */}
      <Dialog open={!!pick && !pick.side} onOpenChange={(o) => !o && setPick(null)} title={pick?.ev.label ?? ''} description="Which team?">
        <div className="grid grid-cols-2 gap-3">
          {(['home', 'away'] as const).map((side) => <Button key={side} size="touch" className="min-h-20 text-xl" disabled={pick?.ev.group === 'shootout' && pick.extra?.scored === undefined} style={{ background: team(side).primaryColor, color: '#fff' }} onClick={() => onSide(side)}>{team(side).shortName}</Button>)}
        </div>
        {pick?.ev.group === 'shootout' ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="touch" variant={pick.extra?.scored === true ? 'primary' : 'secondary'} onClick={() => setPick({ ...pick, extra: { scored: true } })}>Scored</Button>
            <Button size="touch" variant={pick.extra?.scored === false ? 'primary' : 'secondary'} onClick={() => setPick({ ...pick, extra: { scored: false } })}>Missed</Button>
          </div>
        ) : null}
      </Dialog>

      {/* player picker: on-field players first; substitutions only offer players who can make the change */}
      <Dialog
        open={!!pick?.side}
        onOpenChange={(o) => !o && setPick(null)}
        title={pick?.ev.group === 'change' ? ('playerOutId' in (pick?.extra ?? {}) ? 'Player coming on' : 'Player going off') : isBbFoulStep(pick) ? 'What kind of foul?' : `${pick?.ev.label ?? ''}: which player?`}
        description={pick?.ev.group === 'change' ? 'Only players who can make this change are listed.' : isBbFoulStep(pick) ? 'Personal is the usual call.' : 'Optional — skip if unsure. Players are never guessed.'}
      >
        {pick?.side ? (
          isBbFoulStep(pick) ? (
            <div className="grid grid-cols-2 gap-2">
              {FOUL_TYPES.map((ft) => <Button key={ft.id} size="touch" variant={ft.id === 'personal' ? 'primary' : 'secondary'} onClick={() => setPick({ ...pick, extra: { ...pick.extra, foulType: ft.id } })}>{ft.label}</Button>)}
            </div>
          ) : pick.ev.group === 'change' ? (
            (() => {
              const g = groupPlayers(pick.side);
              const outStep = !('playerOutId' in (pick.extra ?? {}));
              const sections: [string, LineupPlayer[]][] = outStep ? [[fieldWord, g.on]] : [['Bench', g.bench], ...(rolling && g.out.length ? ([['Came off earlier', g.out]] as [string, LineupPlayer[]][]) : [])];
              const shown = sections.filter(([, l]) => l.length);
              return (
                <div className="max-h-[55vh] overflow-y-auto">
                  {shown.map(([title, list]) => (
                    <div key={title}>
                      <h3 className="mb-1 mt-2 text-xs font-medium text-muted">{title}</h3>
                      <div className="grid grid-cols-2 gap-2">{renderPlayers(list, choosePlayer)}</div>
                    </div>
                  ))}
                  {!shown.length ? <p className="text-sm text-muted">{outStep ? 'Nobody is listed on the field for this team.' : 'Nobody is available on the bench.'} Skip to record the change without names.</p> : null}
                </div>
              );
            })()
          ) : (
            <div className="max-h-[55vh] overflow-y-auto">{renderGrouped(pick.side, choosePlayer)}</div>
          )
        ) : null}
        {pick?.side && !isBbFoulStep(pick) ? <Button className="mt-3 w-full" size="touch" variant="ghost" onClick={() => choosePlayer(null)}>Skip player</Button> : null}
      </Dialog>

      <Dialog open={!!playerFor} onOpenChange={(o) => !o && setPlayerFor(null)} title={`${playerFor?.label ?? ''} recorded`} description={playerFor?.factId ? 'Who was it? You can also add this later from the history.' : 'Saving… you can pick the player once it is accepted.'}>
        <div className="max-h-[55vh] overflow-y-auto">{playerFor ? renderGrouped(playerFor.side, assignScorer, { disabled: !playerFor.factId }) : null}</div>
        <Button className="mt-3 w-full" size="touch" variant="ghost" onClick={() => setPlayerFor(null)}>Later</Button>
      </Dialog>

      <Dialog open={!!goalDetails} onOpenChange={(o) => !o && setGoalDetails(null)} title={goalDetails?.step === 'assist' ? 'Assist?' : 'What kind of goal?'} description="Optional. Shown on the goal graphic and counted in the season statistics.">
        {goalDetails?.step === 'assist' ? (
          <>
            <div className="max-h-[50vh] overflow-y-auto">{renderGrouped(goalDetails.side, (id) => setGoalDetails({ ...goalDetails, assistId: id, step: 'type' }), { exclude: goalDetails.scorerId })}</div>
            <Button className="mt-3 w-full" size="touch" variant="ghost" onClick={() => setGoalDetails({ ...goalDetails, assistId: null, step: 'type' })}>No assist</Button>
          </>
        ) : goalDetails ? (
          <>
            <div className="grid grid-cols-2 gap-2">{(m.sport === 'futsal' ? FUTSAL_DETAIL_GOAL_TYPES : DETAIL_GOAL_TYPES).map((g) => <Button key={g} size="touch" onClick={() => finishGoalDetails(g)}>{GOAL_LABELS[g]}</Button>)}</div>
            <Button className="mt-3 w-full" size="touch" variant="ghost" onClick={() => finishGoalDetails(null)}>Skip</Button>
          </>
        ) : null}
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
          {otherPhases.map((def) => <Button key={def.id} size="touch" variant={def.kind === 'terminal' ? 'danger' : 'secondary'} disabled={!canScore} onClick={() => { setMorePhases(false); setPhaseConfirm(def.id); }}>{def.label}</Button>)}
        </div>
      </Dialog>

      <Dialog open={!!phaseConfirm} onOpenChange={(o) => !o && setPhaseConfirm(null)} title={`Move to ${phaseConfirm ? adapter.phase(cfg, phaseConfirm)?.label : ''}?`} description={phaseConfirm && adapter.phase(cfg, phaseConfirm)?.kind === 'play' ? 'The period clock is set for the new period.' : 'The match clock pauses.'}
        footer={<><Button variant="ghost" onClick={() => setPhaseConfirm(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await s.enqueue('SET_PHASE', { to: phaseConfirm }, `→ ${adapter.phase(cfg, phaseConfirm!)?.label}`); feedback(prefs, 'tick'); setPhaseConfirm(null); }}>Confirm</Button></>} />

      <Dialog open={settings} onOpenChange={setSettings} title="Scoring preferences" description="Saved to your account and kept on this phone for offline use.">
        <div className="grid gap-4">
          <Switch label="Vibrate when an action is recorded" checked={prefs.vibrate} onCheckedChange={(v) => updatePrefs({ vibrate: v })} />
          <Switch label="Confirmation sounds" checked={prefs.sound} onCheckedChange={(v) => { updatePrefs({ sound: v }); if (v) tone('tick'); }} />
          <div>
            <Switch label="Sunlight mode (high contrast)" checked={prefs.sunlight} onCheckedChange={(v) => updatePrefs({ sunlight: v })} />
            <p className="mt-1 text-xs text-muted">Black on white with stronger colours, for a phone in direct sun.</p>
          </div>
          <div>
            <Switch label="Low data mode" checked={prefs.lowData} onCheckedChange={(v) => updatePrefs({ lowData: v })} />
            <p className="mt-1 text-xs text-muted">Turns off the live connection; the score refreshes every 10 seconds instead and uses far less data. Your actions still send immediately.</p>
          </div>
          <Field label="Undo button stays for" htmlFor="uw">
            <NativeSelect id="uw" value={String(prefs.undoWindowS)} onChange={(e) => updatePrefs({ undoWindowS: Number(e.target.value) })}>
              {[5, 10, 12, 15, 30].map((n) => <option key={n} value={n}>{n} seconds</option>)}
            </NativeSelect>
          </Field>
        </div>
      </Dialog>

      <div className="flex justify-between text-xs text-muted">
        <span>{m.competition.name}</span>
        {access === 'score' ? <button className="min-h-9 underline" onClick={() => s.release()}>Hand over scoring</button> : null}
      </div>

      {/* undo straight after an action, without a reason, for a few seconds */}
      {access !== 'view' && quickUndo && undoLeftS > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center px-3">
          <Button size="touch" variant="secondary" className="pointer-events-auto shadow-lg" disabled={!quickUndoReady} onClick={() => void quickUndoNow()}>
            <Undo2 className="size-5" /> Undo {quickUndo.label} · {Math.ceil(undoLeftS)}s
          </Button>
        </div>
      ) : null}
    </div>
  );
}
