'use client';
// The scorer's match screen. A dark header holds the controls (back, line-ups, events, details, undo and the button
// that ends the period), the teams and the score, and the clock with its corrections. Below it a white sheet:
// before the match and in breaks, the match details and the steps to the next period (each can be skipped); during
// play, one row per event with the home team's half on the left and the away team's on the right, each with its
// count; in the shoot-out, scored and missed for each team. Basketball keeps its court controls.
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronLeft, CloudOff, Info, List, Minus, Pause, Pencil, Play, Plus, RotateCcw, Settings2, SkipForward, Undo2, UserRound, Users, X } from 'lucide-react';
import {
  FUTSAL_GOAL_TYPES,
  FUTSAL_GOAL_TYPE_LABELS,
  GOAL_TYPES,
  GOAL_TYPE_LABELS,
  POSSESSION_EVENT,
  clockDisplayMs,
  getAdapter,
  onField,
  possessionShare,
  scorerSheet,
  sheetCount,
  shootoutLine,
  shootoutStatus,
  type DisplayModel,
  type EventTypeDef,
  type LineupPlayer,
  type PhaseDef,
} from '@bs/domain';
import { Button, Dialog, ErrorNotice, Field, Input, NativeSelect, Spinner, StatusPill, Switch, cx } from '@bs/ui';
import { get } from '@/lib/api';
import { fmtDate } from '@/lib/hooks';
import { feedback, tone, useScorerPrefs } from '@/lib/feedback';
import { ACCESS_LABEL } from '@/lib/scorer-access';
import { useMe } from '@/lib/session';
import { useScorer } from '@/lib/use-scorer';
import { STARTERS } from '@/components/lineup-editor';
import { CARD_COLOUR, CentreBadge, EventIcon, HalfCell, MirrorRow, TeamCrest, type SheetTeam } from '@/components/scorer/sheet';

type Side = 'home' | 'away';
const SIDES = ['home', 'away'] as const;
interface Fact { id: string; sequence: number; category: string; type: string; side: Side | null; playerId: string | null; clockMs: number | null; voided: boolean; revision: number; periodId: string; payload: Record<string, unknown> }
type FoulType = 'personal' | 'offensive' | 'technical' | 'unsportsmanlike' | 'disqualifying';
const FOUL_TYPES: { id: FoulType; label: string }[] = [
  { id: 'personal', label: 'Personal' },
  { id: 'offensive', label: 'Offensive' },
  { id: 'technical', label: 'Technical' },
  { id: 'unsportsmanlike', label: 'Unsportsmanlike' },
  { id: 'disqualifying', label: 'Disqualifying' },
];
const DETAIL_GOAL_TYPES = GOAL_TYPES.filter((g) => g !== 'own_goal' && g !== 'penalty');
// futsal penalties and 10 m kicks have their own buttons
const FUTSAL_DETAIL_GOAL_TYPES = FUTSAL_GOAL_TYPES.filter((g) => g !== 'own_goal' && g !== 'penalty' && g !== 'second_penalty');
const GOAL_LABELS: Record<string, string> = { ...GOAL_TYPE_LABELS, ...FUTSAL_GOAL_TYPE_LABELS };
const HEAD_BTN = 'grid size-11 place-items-center rounded-lg text-[var(--sc-head-text)] enabled:hover:bg-[var(--sc-head-raised)] disabled:opacity-35';
const CLOCK_BTN = 'grid h-14 w-14 place-items-center rounded-xl bg-[var(--sc-head-raised)] text-[var(--sc-head-text)] enabled:active:opacity-80 disabled:opacity-35';
const STEP_BTN = 'scorer-display flex min-h-14 flex-1 items-center justify-center gap-2 rounded-lg bg-[#ececee] px-4 text-[17px] font-semibold text-[var(--sc-ink)] enabled:active:bg-[#dedfe3] disabled:opacity-45';

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
  const [endOpen, setEndOpen] = useState(false);
  const [morePhases, setMorePhases] = useState(false);
  const [confirmStop, setConfirmStop] = useState<PhaseDef | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [bbReset, setBbReset] = useState(true);
  const [settings, setSettings] = useState(false);
  const [quickUndo, setQuickUndo] = useState<{ commandId: string; label: string; at: number } | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [lineupBannerClosed, setLineupBannerClosed] = useState(false);
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
  const team = (side: Side) => m.teams[side] as SheetTeam & { id: string };
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
  const allDefs = adapter.eventTypes(cfg);
  const defOf = (type: string) => allDefs.find((e) => e.type === type);
  const allowedNow = (type: string) => events.some((e) => e.type === type);
  const canTap = (type: string) => { const e = defOf(type); return !!e && allowedNow(type) && (e.group === 'stat' ? canStats : canScore); };

  // the step that follows the match flow; the rest of the allowed steps are offered beside it
  const nextOf = (phaseId: string): PhaseDef | null => {
    const defs = adapter.allowedTransitions(cfg, { ...proj, phase: phaseId }).map((id) => adapter.phase(cfg, id)).filter((p): p is PhaseDef => !!p);
    return defs.find((p) => p.kind !== 'terminal' && p.tags.length) ?? defs.find((p) => p.kind !== 'terminal') ?? null;
  };
  const phaseDefs = transitions.map((id) => adapter.phase(cfg, id)!);
  const nextPhase = nextOf(proj.phase);
  const otherPhases = phaseDefs.filter((p) => p.id !== nextPhase?.id);
  // before the match and in a break: the steps to the next period, from where the break began
  const stepStart = phase.kind === 'pre' ? 'scheduled' : phase.kind === 'break' ? (proj.breakPhase ?? proj.phase) : null;
  const steps: PhaseDef[] = [];
  let playNext: PhaseDef | null = null;
  if (stepStart) {
    let cur = stepStart;
    for (let i = 0; i < 8; i++) {
      const n = nextOf(cur);
      if (!n || n.kind === 'final' || n.kind === 'terminal') break;
      if (n.kind === 'play') {
        playNext = n;
        break;
      }
      steps.push(n);
      cur = n.id;
    }
  }
  const doneUpTo = steps.findIndex((p) => p.id === proj.phase);
  const stepState = (i: number) => (i <= doneUpTo ? 'done' : skipped.has(steps[i]!.id) ? 'skipped' : 'todo');
  const clearTo = (i: number) => steps.slice(doneUpTo + 1, i).every((p) => skipped.has(p.id));
  const stepAllowed = (i: number) => stepState(i) === 'todo' && clearTo(i) && transitions.includes(steps[i]!.id);
  const startAllowed = !!playNext && clearTo(steps.length) && transitions.includes(playNext.id);

  const sheet = scorerSheet(m.sport);
  const overrunMs = phase.kind === 'play' && proj.phase !== 'shootout' && mainClock?.limitMs ? clockDisplayMs(mainClock, s.serverNow()) - mainClock.limitMs : 0;
  const expectedStarters = STARTERS[m.sport] ?? 1;
  const lineupThin = SIDES.some((sd) => playersOf(sd).filter((p) => p.starter).length < expectedStarters);
  const foulLimit = m.sport === 'basketball' ? ((cfg as { playerFoulLimit?: number }).playerFoulLimit ?? 5) : null;
  const clockNow = mainClock ? clockDisplayMs(mainClock, s.serverNow()) : null;
  const liveShare = sheet?.some((r) => r.kind === 'possession') ? possessionShare(proj, clockNow) : null;
  const shootoutEv = events.find((e) => e.group === 'shootout');
  // a level match whose rules let the draw stand, at the end of regulation: offer to decide it instead
  const ko = adapter.knockout;
  const koOn = !!ko?.isOn(cfg);
  const level = proj.score.home === proj.score.away;
  const regulationEnd = phase.kind === 'play' && !phase.tags.some((t) => t === 'extra_time' || t === 'shootout') && transitions.includes('full_time');
  const offerKnockout = !!ko && !koOn && level && regulationEnd && access === 'score';
  const isBbFoulStep = (p: typeof pick) => !!p && p.ev.type === 'foul' && m.sport === 'basketball' && !p.extra?.foulType;
  const tz = (m as { timezone?: string }).timezone ?? me.data?.activeOrganisation?.timezone ?? 'Australia/Brisbane';
  const venue = (m as { venue?: { name: string } | null }).venue ?? null;
  const lastFact = [...(facts.data ?? [])].reverse().find((f) => f.category === 'event' && !f.voided && f.type !== POSSESSION_EVENT) ?? null;

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

  const choosePlayer = async (playerId: string | null) => {
    if (!pick?.side) return;
    let ev = pick.ev;
    if (ev.group === 'change') {
      const extra = pick.extra ?? {};
      if (!('playerOutId' in extra)) return setPick({ ...pick, extra: { ...extra, playerOutId: playerId } });
      await sendFact(ev, pick.side, { ...extra, playerInId: playerId });
      return setPick(null);
    }
    // a second yellow for the same player is recorded as one, so the sending-off follows the rules
    const second = defOf('second_yellow');
    if (ev.type === 'yellow_card' && playerId && second && (proj.players[playerId]?.yellow ?? 0) >= 1) ev = second;
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
  /** the header's undo: the action just recorded at once (it waits while that is still sending), an older one with a reason */
  const quickUndoOpen = !!quickUndo && undoLeftS > 0;
  const undoLast = () => {
    if (quickUndoOpen) return void (quickUndoReady && quickUndoNow());
    if (lastFact && access === 'score') {
      setUndo(lastFact);
      setReason('');
    }
  };

  /** a tap on one team's half of a row: scores go out at once (who scored follows), cards and changes ask the player first, statistics just count */
  const recordFor = async (evType: string, side: Side) => {
    const e = defOf(evType);
    if (!e) return;
    if (e.group === 'score' && e.playerField !== 'none' && playersOf(side).length) {
      const cid = await sendFact(e, side);
      setPlayerFor({ commandId: cid, side, label: e.label, eventType: e.type });
      return;
    }
    const asksPlayer = e.group === 'change' || (e.group === 'discipline' && e.type !== 'foul' && e.playerField !== 'none' && playersOf(side).length > 0);
    if (asksPlayer) return setPick({ ev: e, side });
    await sendFact(e, side);
  };

  const setPhase = async (to: string) => {
    await s.enqueue('SET_PHASE', { to }, `→ ${adapter.phase(cfg, to)?.label ?? to}`);
    feedback(prefs, 'tick');
  };
  /** a step from a menu: abandoning, cancelling or postponing asks first */
  const pickPhase = (def: PhaseDef) => (def.kind === 'terminal' ? setConfirmStop(def) : void setPhase(def.id));
  const clockAction = (action: 'start' | 'pause' | 'resume', clockId = 'main') => s.enqueue('CLOCK_ACTION', { clockId, action }, `Clock ${action}`);
  const nudgeClock = (deltaMs: number) => {
    if (clockNow == null) return;
    void s.enqueue('CLOCK_ACTION', { clockId: 'main', action: 'set', ms: Math.max(0, clockNow + deltaMs), reason: `Adjusted by ${deltaMs > 0 ? '+' : '−'}1 minute on the scorer` }, `Clock ${deltaMs > 0 ? '+' : '−'}1 min`);
  };
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const ev = (type: string) => events.find((e) => e.type === type)!;
  const label = (type: string) => defOf(type)?.label ?? type.replace(/_/g, ' ');
  const sideLabel = (side: Side, what: string, count: string | number) => `${what}, ${team(side).shortName}: ${count}`;
  const periodWord = phase.kind === 'pre' ? 'Pregame' : phase.label;
  const ending = phase.kind === 'play' && access === 'score' && !!nextPhase;
  const controlNoSide = events.filter((e) => e.group === 'control' && !e.requiresSide);
  const head = (side: Side) => team(side).primaryColor;

  // ------------------------------------------------------------------ the sheet's rows during play
  const liveRows = sheet ? (
    <div aria-label="Teams" role="region">
      {sheet.map((row) => {
        if (row.kind === 'possession') {
          if (!defOf(POSSESSION_EVENT)) return null;
          return (
            <MirrorRow key="possession" centre={<CentreBadge home={head('home')} away={head('away')}><EventIcon type={POSSESSION_EVENT} className="size-5" /></CentreBadge>}>
              {SIDES.map((side) => {
                const pct = liveShare ? `${liveShare[side]}%` : '–';
                const has = proj.possession === side;
                return <HalfCell key={side} side={side} eventType={POSSESSION_EVENT} team={team(side)} label="Possession" count={pct} active={has} disabled={!canTap(POSSESSION_EVENT)} onTap={() => void recordFor(POSSESSION_EVENT, side)} testLabel={sideLabel(side, 'Possession', liveShare ? `${liveShare[side]}%` : 'none yet')} />;
              }) as [React.ReactNode, React.ReactNode]}
            </MirrorRow>
          );
        }
        if (row.kind === 'cards') {
          const cards = row.cards.filter((c) => defOf(c.type));
          const cell = (side: Side, c: { type: string; stat?: string }) => {
            const n = sheetCount(proj, side, c.type, c.stat);
            return (
              <button key={`${side}-${c.type}`} type="button" data-side={side} data-event={c.type} aria-label={sideLabel(side, label(c.type), n)} disabled={!canTap(c.type)} onClick={() => void recordFor(c.type, side)}
                className="flex min-h-[68px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 enabled:active:bg-[var(--sc-press)] disabled:opacity-40 [&+&]:border-l [&+&]:border-[var(--sc-line)]">
                <span className="scorer-display flex items-center gap-1.5 text-[13px] font-semibold leading-tight text-[var(--sc-ink)]"><span className="h-3.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: CARD_COLOUR[c.type] }} aria-hidden />{label(c.type).replace(/ card$/i, '')}</span>
                <span className={cx('scorer-display text-[30px] font-bold italic leading-none tabular', n ? 'text-[var(--sc-ink)]' : 'text-[var(--sc-faint)]')}>{n}</span>
              </button>
            );
          };
          return (
            <MirrorRow key="cards" centre={<CentreBadge home={head('home')} away={head('away')}><span className="h-5 w-3.5 rounded-[3px] border-2 border-current" aria-hidden /></CentreBadge>}>
              {[<div key="h" className="flex min-w-0 flex-1">{cards.map((c) => cell('home', c))}</div>, <div key="a" className="flex min-w-0 flex-1">{[...cards].reverse().map((c) => cell('away', c))}</div>] as [React.ReactNode, React.ReactNode]}
            </MirrorRow>
          );
        }
        if (!defOf(row.type)) return null;
        return (
          <MirrorRow key={row.type} centre={<CentreBadge home={head('home')} away={head('away')}><EventIcon type={row.type} className="size-5" /></CentreBadge>}>
            {SIDES.map((side) => {
              const n = sheetCount(proj, side, row.type, row.stat);
              return <HalfCell key={side} side={side} eventType={row.type} team={team(side)} label={label(row.type)} count={n} disabled={!canTap(row.type)} onTap={() => void recordFor(row.type, side)} testLabel={sideLabel(side, label(row.type), n)} />;
            }) as [React.ReactNode, React.ReactNode]}
          </MirrorRow>
        );
      })}
    </div>
  ) : null;

  // ------------------------------------------------------------------ the shoot-out
  // where the shoot-out stands: the team to kick next is ringed; once it is decided no more kicks are taken
  const so = shootoutStatus(proj.shootout, cfg);
  const soNames = { home: team('home').shortName, away: team('away').shortName };
  const soLine = shootoutLine(so, soNames) + (!so.winner && !so.pressure && so.next ? ` · ${soNames[so.next]} to kick` : '');
  const soSlots = (side: Side) => {
    const ks = proj.shootout?.kicks.filter((k) => k.side === side) ?? [];
    const n = Math.max(so.rounds, ks.length + (so.next === side ? 1 : 0));
    return Array.from({ length: n }, (_, i) => ({ kick: ks[i], next: !ks[i] && so.next === side && i === ks.length, sudden: i >= so.rounds }));
  };
  const shootoutRows = shootoutEv ? (
    <div role="region" aria-label="Shootout">
      <p role="status" data-shootout-line className={cx('scorer-display mx-4 mt-4 rounded-lg px-4 py-2.5 text-center text-[16px] font-semibold', so.winner ? 'text-white' : so.pressure ? 'bg-[#fff4d6] text-[#7a4b00]' : 'bg-[var(--sc-press)] text-[var(--sc-ink)]')} style={so.winner ? { background: head(so.winner) } : undefined}>
        {soLine}
      </p>
      {so.winner ? <p className="mx-4 mt-2 text-center text-sm text-[var(--sc-muted)]">Decided: no more kicks are needed. Use <b>End shoot-out</b> at the top to finish the match.</p> : null}
      {([['scored', true], ['missed', false]] as const).map(([word, scored]) => (
        <MirrorRow key={word} centre={<CentreBadge home={head('home')} away={head('away')}>{scored ? <Check className="size-5" /> : <X className="size-5" />}</CentreBadge>}>
          {SIDES.map((side) => {
            const n = proj.shootout?.kicks.filter((k) => k.side === side && k.scored === scored).length ?? 0;
            return <HalfCell key={side} side={side} eventType={`shootout_${word}`} team={team(side)} label={scored ? 'Scored' : 'Missed'} count={n} active={so.next === side} disabled={!canScore || !!so.winner} onTap={() => void sendFact(shootoutEv, side, { scored })} testLabel={sideLabel(side, scored ? 'Scored' : 'Missed', n)} />;
          }) as [React.ReactNode, React.ReactNode]}
        </MirrorRow>
      ))}
      <div className="grid grid-cols-2 gap-4 px-4 py-3">
        {SIDES.map((side) => (
          <ol key={side} className={cx('flex flex-wrap items-center gap-1.5', side === 'away' && 'justify-end')} aria-label={`${team(side).shortName} kicks`}>
            {soSlots(side).map((x, i) => (
              <li key={i} aria-label={x.kick ? (x.kick.scored ? 'scored' : 'missed') : x.next ? 'next' : 'to take'}
                className={cx('grid size-7 place-items-center rounded-full text-xs font-bold text-white', x.kick ? (x.kick.scored ? 'bg-[#16a34a]' : 'bg-[#dc2626]') : 'bg-[#2a2f38]', x.next && 'ring-2 ring-primary ring-offset-2', x.sudden && i === so.rounds && 'ml-2')}>
                {x.kick ? (x.kick.scored ? '✓' : '✗') : ''}
              </li>
            ))}
          </ol>
        ))}
      </div>
    </div>
  ) : null;

  // ------------------------------------------------------------------ before the match and in breaks
  const stepsSheet = (
    <div className="px-5 py-5 text-[var(--sc-ink)]">
      <h2 className="scorer-display mb-3 text-[22px] font-bold italic">{phase.kind === 'pre' ? 'Match details' : phase.label}</h2>
      {phase.kind === 'pre' ? (
        <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-[15px]">
          <dt className="font-semibold">Competition:</dt><dd>{m.competition.name}</dd>
          <dt className="font-semibold">Teams:</dt><dd>{team('home').name} vs {team('away').name}</dd>
          <dt className="font-semibold">Venue:</dt><dd>{venue?.name ?? 'Not set'}</dd>
          <dt className="font-semibold">Date:</dt><dd>{fmtDate(m.scheduledAt, tz, { dateStyle: 'long' })}</dd>
          <dt className="font-semibold">Time:</dt><dd>{fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}</dd>
        </dl>
      ) : (
        <p className="mb-5 text-[15px] text-[var(--sc-muted)]">{team('home').shortName} {display.score.home} – {display.score.away} {team('away').shortName}{display.shootout ? ` · pens ${display.shootout.home}–${display.shootout.away}` : ''}</p>
      )}
      {access === 'score' ? (
        <div role="region" aria-label="Match phase" className="grid gap-3">
          {steps.map((p, i) => {
            const st = stepState(i);
            return (
              <div key={p.id} className="flex gap-3">
                <button type="button" className={STEP_BTN} disabled={!canScore || !stepAllowed(i)} onClick={() => void setPhase(p.id)}>
                  {st === 'done' ? <Check className="size-5 text-[#16a34a]" aria-hidden /> : null}
                  <span className={cx(st === 'skipped' && 'line-through')}>{p.label}</span>
                  {st === 'done' ? <span className="sr-only">(done)</span> : st === 'skipped' ? <span className="sr-only">(skipped)</span> : null}
                </button>
                <button type="button" className={cx(STEP_BTN, 'max-w-28 flex-none px-5')} aria-label={st === 'skipped' ? `Undo skipping ${p.label}` : `Skip ${p.label}`} disabled={!canScore || st === 'done'}
                  onClick={() => setSkipped((cur) => { const n = new Set(cur); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}>
                  {st === 'skipped' ? <RotateCcw className="size-4" aria-hidden /> : <SkipForward className="size-4" aria-hidden />}{st === 'skipped' ? 'Undo' : 'Skip'}
                </button>
              </div>
            );
          })}
          {playNext ? (
            <button type="button" className="scorer-display min-h-14 rounded-lg bg-primary px-4 text-[18px] font-semibold text-white enabled:active:opacity-90 disabled:opacity-35" disabled={!canScore || !startAllowed} onClick={() => void setPhase(playNext.id)}>
              Start {playNext.label}
            </button>
          ) : nextPhase ? (
            <button type="button" className="scorer-display min-h-14 rounded-lg bg-primary px-4 text-[18px] font-semibold text-white disabled:opacity-35" disabled={!canScore} onClick={() => void setPhase(nextPhase.id)}>{nextPhase.label}</button>
          ) : null}
          {steps.length && !startAllowed && playNext ? <p className="text-center text-sm text-[var(--sc-muted)]">Do or skip each step to start {playNext.label.toLowerCase()}.</p> : null}
          {otherPhases.length ? <button className="min-h-10 text-sm text-[var(--sc-muted)] underline" onClick={() => setMorePhases(true)}>More options</button> : null}
        </div>
      ) : <p className="text-sm text-[var(--sc-muted)]">The main scorer starts the match.</p>}
    </div>
  );

  // ------------------------------------------------------------------ after the match
  const finalSheet = (
    <div className="text-[var(--sc-ink)]">
      <p className="scorer-display px-5 pt-5 text-[22px] font-bold italic">{phase.label}</p>
      <p className="px-5 pb-3 text-sm text-[var(--sc-muted)]">The match is finished. The counts below are its statistics; undo or correct an event from the events list.</p>
      {liveRows}
    </div>
  );

  return (
    <div className="scorer flex min-h-screen flex-col bg-[var(--sc-head)] text-[var(--sc-head-text)]">
      {/* line-ups not filled in */}
      {access === 'score' && phase.kind === 'pre' && lineupThin && !lineupBannerClosed ? (
        <div className="flex items-start gap-3 bg-[#e5534b] px-4 py-3 text-white" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p className="flex-1 text-[15px]">The starting line-ups are not filled in yet. <Link href={`/score/${matchId}/lineup`} className="underline">Edit the starting line-ups ›</Link></p>
          <button aria-label="Close" className="p-1" onClick={() => setLineupBannerClosed(true)}><X className="size-5" /></button>
        </div>
      ) : null}

      {/* the controls */}
      <nav aria-label="Match controls" className="flex items-center gap-1 border-b border-[var(--sc-head-raised)] px-2 py-2">
        <Link href="/score" aria-label="All matches" className={HEAD_BTN}><ChevronLeft className="size-6" /></Link>
        {access === 'score' ? <Link href={`/score/${matchId}/lineup`} aria-label="Line-ups" className={HEAD_BTN}><Users className="size-5" /></Link> : null}
        <button type="button" aria-label="Match events" className={HEAD_BTN} onClick={() => setEventsOpen(true)}><List className="size-5" /></button>
        <button type="button" aria-label="Match details" className={HEAD_BTN} onClick={() => setDetailsOpen(true)}><Info className="size-5" /></button>
        <span className="flex-1" />
        {access !== 'view' ? <button type="button" aria-label="Undo the last action" className={HEAD_BTN} disabled={!canStats || (quickUndoOpen ? !quickUndoReady : !(access === 'score' && lastFact))} onClick={undoLast}><Undo2 className="size-5" /></button> : null}
        {ending ? (
          <button type="button" className="scorer-display ml-1 min-h-11 rounded-lg bg-primary px-4 text-[16px] font-semibold text-white disabled:opacity-40" disabled={!canScore} onClick={() => setEndOpen(true)}>
            End {proj.phase === 'shootout' ? 'shoot-out' : phase.label}
          </button>
        ) : null}
      </nav>

      {/* connection and authority */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-[var(--sc-head-muted)]" role="status">
        {s.transport === 'offline' ? <StatusPill tone="offline"><CloudOff className="size-3" /> Offline</StatusPill> : s.transport === 'polling' ? <StatusPill tone="healthy">Online · {prefs.lowData ? 'low data' : 'refreshing'}</StatusPill> : <StatusPill tone="healthy">Online</StatusPill>}
        {access !== 'score' ? <StatusPill tone="primary">{ACCESS_LABEL[access]}</StatusPill> : null}
        {pending.length ? <StatusPill tone="warning">{pending.length} pending</StatusPill> : <span>All changes saved</span>}
        {s.provisional?.provisional ? <span className="w-full text-[#f5b94a]">Score shown includes unconfirmed actions (provisional)</span> : null}
        {!s.online ? <span className="w-full text-[#f5b94a]">Offline: actions are stored on this device only. They are not reaching scoreboards or live graphics until you reconnect.</span> : null}
        {s.fromCache ? <span className="w-full">Showing the last saved copy of this match.</span> : null}
        {access === 'stats' ? <span className="w-full">You record statistics for this match. The main scorer keeps the score, clock and periods.</span> : null}
        {access === 'view' ? <span className="w-full">You can follow this match live but not change it.</span> : null}
      </div>
      {access === 'score' && (s.leaseProblem || (s.online && !s.holding)) ? (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-md bg-[#e5534b]/20 px-3 py-2 text-sm" role="alert">
          <AlertTriangle className="size-4 text-[#ff8a80]" />
          <span className="flex-1">{s.leaseProblem ?? 'Another device has control of this match. Your actions will wait until you take over.'}</span>
          <Button size="sm" onClick={() => s.takeControl()}>Take over scoring</Button>
        </div>
      ) : null}

      {/* teams and score */}
      <section aria-label="Score" className="px-3 pb-4 pt-2 text-center">
        <p className="scorer-display text-[15px] font-medium text-[var(--sc-head-muted)]">{periodWord}</p>
        <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {SIDES.map((side, i) => (
            <div key={side} className={cx('flex min-w-0 items-center gap-2', i === 0 ? 'justify-end' : 'order-3 flex-row-reverse justify-end')}>
              <TeamCrest team={team(side)} size={52} />
              <div className={cx('min-w-0', i === 0 ? 'text-right' : 'text-left')}>
                <span className="scorer-display block truncate text-[26px] font-bold italic leading-none">{team(side).abbreviation}</span>
                {display.scoreDetail ? <span className="block text-xs text-[var(--sc-head-muted)] tabular">{display.scoreDetail[side]}</span> : null}
                {display.fouls ? <span className="block text-[11px] text-[var(--sc-head-muted)]">Fouls {display.fouls[side]}{display.bonus?.[side] ? (m.sport === 'futsal' ? ' · next is a 10 m kick' : ' · BONUS') : ''} · TO {display.timeouts?.[side]}</span> : null}
                {display.shortHanded?.find((x) => x.side === side) ? <span className="mt-0.5 inline-block rounded bg-[#e5534b]/25 px-1.5 text-[11px] font-semibold text-[#ffb4ab] tabular" aria-label={`${team(side).shortName} a player short`}>{display.shortHanded.find((x) => x.side === side)!.players} on court · {display.shortHanded.find((x) => x.side === side)!.remainingText}</span> : null}
                {m.sport === 'basketball' && display.possession === side ? <span className="block text-[11px] text-primary">◀ possession</span> : null}
              </div>
            </div>
          ))}
          <div className="order-2 px-2">
            {phase.kind === 'pre' ? (
              <>
                <span className="scorer-display block text-[18px] text-[var(--sc-head-muted)]">vs</span>
                <span className="scorer-display block text-[17px] text-primary">{fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}</span>
              </>
            ) : (
              <span className={cx('scorer-display flex gap-5 text-[64px] font-bold leading-none tabular', s.provisional?.provisional && 'text-[#f5b94a]')}>
                <span data-score-side="home">{display.score.home}</span>
                <span data-score-side="away">{display.score.away}</span>
              </span>
            )}
            {display.shootout ? <span className="scorer-display mt-1 block text-[14px]">Pens {display.shootout.home}–{display.shootout.away}</span> : null}
          </div>
        </div>
      </section>
      {display.alerts.map((a) => <p key={a} className="mx-3 mb-2 rounded-md bg-[#f5b94a]/15 px-3 py-2 text-sm text-[#f5d38a]" role="alert">{a}</p>)}
      {access === 'score' && overrunMs > 10 * 60_000 ? (
        <div role="alert" className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-md bg-[#f5b94a]/15 px-3 py-2 text-sm text-[#f5d38a]">
          <AlertTriangle className="size-4 shrink-0" /> This period is {Math.floor(overrunMs / 60_000)} minutes over. Still playing?
          {ending ? <Button size="sm" variant="primary" disabled={!canScore} onClick={() => setEndOpen(true)}>End {phase.label}</Button> : null}
        </div>
      ) : null}

      {/* the clock */}
      {access === 'score' && phase.kind === 'play' && proj.phase !== 'shootout' && mainClock ? (
        <section aria-label="Clock controls" className="flex items-center justify-center gap-2 px-3 pb-4">
          <button type="button" aria-label="Correct the clock" className={CLOCK_BTN} disabled={!canScore} onClick={() => { setClockDlg('main'); setClockVal(mmss(clockDisplayMs(mainClock, s.serverNow()))); }}><Pencil className="size-6" /></button>
          <button type="button" aria-label={running ? 'Pause clock' : mainClock.baseMs ? 'Resume clock' : 'Start clock'} className={CLOCK_BTN} disabled={!canScore} onClick={() => clockAction(running ? 'pause' : mainClock.baseMs ? 'resume' : 'start')}>{running ? <Pause className="size-7" /> : <Play className="size-7" />}</button>
          <span className="flex h-14 min-w-[7.5rem] flex-col items-center justify-center rounded-xl bg-[var(--sc-head-raised)] px-3">
            <span data-clock className="scorer-display text-[38px] font-medium leading-none tabular" aria-live="off">{display.clockText}</span>
            {display.stoppageText ? <span className="scorer-display text-[13px] leading-none text-[#f5b94a] tabular">{display.stoppageText}</span> : null}
          </span>
          <button type="button" aria-label="Take a minute off the clock" className={CLOCK_BTN} disabled={!canScore} onClick={() => nudgeClock(-60_000)}><Minus className="size-7" /></button>
          <button type="button" aria-label="Add a minute to the clock" className={CLOCK_BTN} disabled={!canScore} onClick={() => nudgeClock(60_000)}><Plus className="size-7" /></button>
        </section>
      ) : phase.kind === 'play' && proj.phase !== 'shootout' ? (
        <p className="scorer-display pb-4 text-center text-[34px] tabular" data-clock>{display.clockText}</p>
      ) : null}
      {s.state.clocks.shot && access === 'score' && phase.kind === 'play' ? (
        <section aria-label="Shot clock" className="flex items-center justify-center gap-2 px-3 pb-4">
          {display.shotClockText ? <span className="scorer-display rounded-lg bg-[#e5534b]/25 px-3 py-1 text-[26px] text-[#ffb4ab] tabular" aria-label="Shot clock">{display.shotClockText}</span> : null}
          <Button size="touch" disabled={!canScore} onClick={() => s.enqueue('CLOCK_ACTION', { clockId: 'shot', action: 'reset', ms: ((cfg as { shotClock: { fullSeconds: number } }).shotClock.fullSeconds) * 1000 }, 'Shot clock reset')}><RotateCcw className="size-4" /> {(cfg as { shotClock: { fullSeconds: number } }).shotClock.fullSeconds}</Button>
          <Button size="touch" disabled={!canScore} onClick={() => s.enqueue('CLOCK_ACTION', { clockId: 'shot', action: 'reset', ms: ((cfg as { shotClock: { resetSeconds: number } }).shotClock.resetSeconds) * 1000 }, 'Shot clock reset')}><RotateCcw className="size-4" /> {(cfg as { shotClock: { resetSeconds: number } }).shotClock.resetSeconds}</Button>
        </section>
      ) : null}
      {access === 'score' && controlNoSide.length && phase.kind === 'play' ? (
        <div className="flex justify-center gap-2 px-3 pb-3">{controlNoSide.map((e) => <Button key={e.type} size="sm" variant="secondary" disabled={!canScore} onClick={() => onEvent(e)}>{e.label}</Button>)}</div>
      ) : null}

      {/* basketball keeps its court controls */}
      {access !== 'view' && m.sport === 'basketball' && phase.kind === 'play' ? (
        <section className="grid grid-cols-2 gap-2 px-3 pb-4" aria-label="Scoring">
          {SIDES.map((side) => (
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
              <div className="grid grid-cols-2 gap-2" aria-label={`${team(side).abbreviation} statistics`}>
                {events.filter((e) => e.group === 'stat').map((e) => <Button key={e.type} size="md" variant="ghost" className="border border-border" disabled={!canStats} onClick={() => setPick({ ev: e, side })}>{e.label} {team(side).abbreviation}</Button>)}
              </div>
            </div>
          ))}
          {access === 'score' ? <label className="col-span-2 flex items-center gap-2 text-sm text-[var(--sc-head-muted)]"><input type="checkbox" checked={bbReset} onChange={(e) => setBbReset(e.target.checked)} className="size-5" /> Reset shot clock on 2/3-point scores</label> : null}
        </section>
      ) : null}

      {/* the sheet */}
      <main className="flex-1 rounded-t-[28px] bg-[var(--sc-sheet)] pb-24 text-[var(--sc-ink)]">
        {review.length ? (
          <section aria-label="Needs review" className="border-b-4 border-[#f5b94a] px-4 py-3">
            <h2 className="mb-2 text-sm font-semibold text-[#9a6700]">Needs your review ({review.length})</h2>
            {review.map((i) => (
              <div key={i.commandId} className="flex flex-wrap items-center gap-2 border-t border-[var(--sc-line)] py-2 text-sm">
                <span className="flex-1"><strong>{i.label}</strong> <span className="text-xs text-[var(--sc-muted)]">recorded {new Date(i.createdAt).toLocaleTimeString('en-AU')}</span><span className="block text-xs text-[var(--sc-muted)]">{i.error?.message}</span></span>
                {i.status === 'needs_review' ? <Button size="sm" variant="primary" onClick={() => s.review(i.commandId, 'apply')}>Apply now</Button> : <Button size="sm" onClick={() => s.review(i.commandId, 'apply')}>Retry</Button>}
                <Button size="sm" variant="ghost" className="text-[var(--sc-ink)]" onClick={() => s.review(i.commandId, 'discard')}>Discard</Button>
              </div>
            ))}
          </section>
        ) : null}
        {offerKnockout ? (
          <div className="mx-4 mt-4 grid gap-2 rounded-lg border border-primary/50 bg-primary/10 p-3 text-sm" role="status">
            <span>Level. This match&apos;s rules let a draw stand. Does it need a winner?</span>
            <Button size="touch" variant="primary" disabled={!canScore} onClick={() => void s.enqueue('SET_KNOCKOUT', { on: true, reason: 'level at the end of regulation: the match needs a winner' }, ko!.label)}>Play {ko!.label.replace(/ when level$/, '').toLowerCase()}</Button>
          </div>
        ) : null}
        {phase.kind === 'pre' || phase.kind === 'break' ? stepsSheet
          : proj.phase === 'shootout' ? shootoutRows
          : phase.kind === 'play' ? (m.sport === 'basketball' ? <p className="p-5 text-sm text-[var(--sc-muted)]">Score from the court controls above. Events are listed under the events button.</p> : liveRows)
          : phase.kind === 'final' ? finalSheet
          : <p className="p-5 text-sm text-[var(--sc-muted)]">This match is {phase.label.toLowerCase()}.</p>}
        <div className="flex justify-between px-4 py-4 text-xs text-[var(--sc-muted)]">
          <span>{m.competition.name}</span>
          {access === 'score' ? <button className="min-h-9 underline" onClick={() => s.release()}>Hand over scoring</button> : null}
        </div>
      </main>

      {/* ending a period: the next step, and the other ways on */}
      <Dialog open={endOpen} onOpenChange={setEndOpen} title={`End ${proj.phase === 'shootout' ? 'the shoot-out' : phase.label}?`} description={`${team('home').shortName} ${display.score.home} – ${display.score.away} ${team('away').shortName}${display.shootout ? ` (pens ${display.shootout.home}–${display.shootout.away})` : ''}.`}>
        <div className="grid gap-2">
          {nextPhase ? <Button size="touch" variant="primary" data-next disabled={!canScore} onClick={() => { setEndOpen(false); void setPhase(nextPhase.id); }}>{nextPhase.label}</Button> : null}
          {offerKnockout ? <Button size="touch" variant="secondary" disabled={!canScore} onClick={() => { setEndOpen(false); void s.enqueue('SET_KNOCKOUT', { on: true, reason: 'level at the end of regulation: the match needs a winner' }, ko!.label); }}>Play {ko!.label.replace(/ when level$/, '').toLowerCase()} instead</Button> : null}
          {otherPhases.map((def) => <Button key={def.id} size="touch" variant={def.kind === 'terminal' ? 'danger' : 'secondary'} disabled={!canScore} onClick={() => { setEndOpen(false); pickPhase(def); }}>{def.label}</Button>)}
        </div>
      </Dialog>

      {/* events so far */}
      <Dialog open={eventsOpen} onOpenChange={setEventsOpen} title="Match events" description="Newest first. Add the player, add goal details or undo an event.">
        <ul className="grid gap-1 text-sm" aria-label="History">
          {pending.map((i) => <li key={i.commandId} className="flex items-center gap-2 text-warning"><StatusPill tone="warning">{i.status === 'sending' ? 'sending' : 'pending'}</StatusPill>{i.label}</li>)}
          {(facts.data ?? []).filter((f) => f.category === 'event' && f.type !== POSSESSION_EVENT).slice().reverse().map((f) => {
            const pl = nameOf(f.playerId);
            const assist = nameOf(f.payload?.assistId as string | undefined);
            const goalType = f.payload?.goalType ? GOAL_LABELS[String(f.payload.goalType)] ?? String(f.payload.goalType) : null;
            const detailsMissing = access === 'score' && (m.sport === 'football' || m.sport === 'futsal') && f.type === 'goal' && !f.voided && !!f.playerId && !f.payload?.goalType;
            return (
              <li key={f.id} className={cx('flex min-h-11 items-center gap-2', f.voided && 'line-through opacity-50')}>
                <span className="w-10 text-xs text-muted tabular">{f.clockMs != null ? `${Math.floor(f.clockMs / 60000)}'` : ''}</span>
                <span className="min-w-0 flex-1">
                  {label(f.type)}{f.type === 'shootout_kick' || f.type === 'shootout_stroke' ? (f.payload?.scored ? ' (scored)' : ' (missed)') : ''} {f.side ? team(f.side).abbreviation : ''} {pl ? `· ${pl}` : ''}
                  {assist || goalType ? <span className="block text-xs text-muted">{[assist ? `assist ${assist}` : null, goalType].filter(Boolean).join(' · ')}</span> : null}
                </span>
                {detailsMissing ? <Button size="sm" variant="ghost" aria-label={`Goal details for ${pl ?? 'goal'}`} onClick={() => { setEventsOpen(false); setGoalDetails({ factId: f.id, side: f.side!, scorerId: f.playerId, step: 'assist' }); }}>Details</Button> : null}
                {access === 'score' && !f.voided && !f.playerId && f.side && defOf(f.type)?.playerField !== 'none' ? <Button size="sm" variant="ghost" aria-label="Add player" onClick={() => { setEventsOpen(false); setPlayerFor({ factId: f.id, side: f.side!, label: label(f.type), eventType: f.type }); }}><UserRound className="size-4" /></Button> : null}
                {access === 'score' && !f.voided ? <Button size="sm" variant="ghost" aria-label={`Undo ${f.type}`} disabled={!canScore} onClick={() => { setEventsOpen(false); setUndo(f); setReason(''); }}><Undo2 className="size-4" /></Button> : null}
              </li>
            );
          })}
          {!facts.data?.some((f) => f.category === 'event') && !pending.length ? <li className="text-muted">Nothing recorded yet.</li> : null}
          {!s.online ? <li className="text-xs text-muted">History refreshes when you are back online.</li> : null}
        </ul>
      </Dialog>

      {/* the match, the phone's preferences */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen} title={`${team('home').name} v ${team('away').name}`} description={`${m.competition.name} · ${fmtDate(m.scheduledAt, tz, { dateStyle: 'medium', timeStyle: 'short' })}${venue ? ` · ${venue.name}` : ''}`}>
        <div className="grid gap-2">
          <p className="text-sm text-muted">Now: {phase.label}{koOn && ko ? ` · knockout: ${ko.label.toLowerCase()}` : ''}</p>
          {access === 'score' ? <Button asChild size="touch"><Link href={`/score/${matchId}/lineup`}><Users className="size-4" /> Line-ups</Link></Button> : null}
          <Button size="touch" aria-label="Scoring preferences" onClick={() => { setDetailsOpen(false); setSettings(true); }}><Settings2 className="size-4" /> Scoring preferences</Button>
          {access === 'score' && otherPhases.length ? <Button size="touch" onClick={() => { setDetailsOpen(false); setMorePhases(true); }}>More options</Button> : null}
          {access === 'score' ? <Button size="touch" variant="ghost" onClick={() => { setDetailsOpen(false); void s.release(); }}>Hand over scoring</Button> : null}
        </div>
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

      <Dialog open={!!playerFor} onOpenChange={(o) => !o && setPlayerFor(null)} title={`${playerFor?.label ?? ''} recorded`} description={playerFor?.factId ? 'Who was it? You can also add this later from the events list.' : 'Saving… you can pick the player once it is accepted.'}>
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

      <Dialog open={!!undo} onOpenChange={(o) => !o && setUndo(null)} title={`Undo ${undo ? label(undo.type).toLowerCase() : ''}`} description="The original stays in the audit trail; the score and stats are recalculated. No celebration is replayed."
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

      <Dialog open={morePhases} onOpenChange={setMorePhases} title="Other options" description="Skip a step or end the match early.">
        <div className="grid gap-2">
          {otherPhases.map((def) => <Button key={def.id} size="touch" variant={def.kind === 'terminal' ? 'danger' : 'secondary'} disabled={!canScore} onClick={() => { setMorePhases(false); pickPhase(def); }}>{def.label}</Button>)}
          {ko && phase.kind !== 'final' && phase.kind !== 'terminal' ? (
            <div className="mt-2 border-t border-border pt-3">
              <Switch label={`Knockout: ${ko.label.toLowerCase()}`} checked={koOn} disabled={!canScore || (koOn && phase.tags.some((t) => t === 'extra_time' || t === 'extra_time_interval' || t === 'shootout'))} onCheckedChange={(on) => void s.enqueue('SET_KNOCKOUT', { on }, on ? ko.label : 'A draw stands')} />
              <p className="mt-1 text-xs text-muted">{koOn ? 'A level score at the end goes to the decider instead of a draw.' : 'Off: a level score at the end is a draw.'} Finals matches are knockout from the start.</p>
            </div>
          ) : null}
        </div>
      </Dialog>

      <Dialog open={!!confirmStop} onOpenChange={(o) => !o && setConfirmStop(null)} title={`${confirmStop?.label ?? ''}?`} description={`The match ends as ${confirmStop?.label.toLowerCase() ?? ''}. Graphics and the season's results follow.`}
        footer={<><Button variant="ghost" onClick={() => setConfirmStop(null)}>Back</Button><Button variant="danger" disabled={!canScore} onClick={() => { const d = confirmStop!; setConfirmStop(null); void setPhase(d.id); }}>Confirm</Button></>} />

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
