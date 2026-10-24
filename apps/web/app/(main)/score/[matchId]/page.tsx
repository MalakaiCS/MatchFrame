'use client';
// The scorer's match screen, in MatchFrame's console style. Along the top, the match and the connection; under it
// the scoreboard (each team in its own block with its colour down the outside edge, the period and clock between
// them) and the clock's controls. Before the match and in breaks, the match details and the run-down to the next
// period (each step can be skipped); during play, the event pad: a column for each team, in sections (score,
// possession, the run of play, discipline, the team), each tile with its count; in the shoot-out, scored and missed
// for each team. Basketball keeps its court controls. A dock along the bottom holds undo, the events, the line-ups,
// the match details and the button that ends the period.
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Check, ChevronLeft, CloudOff, Info, List, MapPin, Minus, Pause, Pencil, Play, Plus, RotateCcw, Settings2, SkipForward, Trophy, Undo2, UserRound, Users, X } from 'lucide-react';
import {
  FUTSAL_GOAL_TYPES,
  FUTSAL_GOAL_TYPE_LABELS,
  GOAL_TYPES,
  GOAL_TYPE_LABELS,
  POSSESSION_EVENT,
  REVIEW_SUBJECT_LABELS,
  REVIEW_SUBJECTS,
  clockDisplayMs,
  getAdapter,
  onField,
  possessionShare,
  reviewWords,
  scorerSheet,
  sheetCount,
  sheetRows,
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
import { CARD_COLOUR, CardGlyph, EventIcon, PadSection, PadTile, PossessionBar, ScoreBlock, type SheetTeam } from '@/components/scorer/sheet';

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
const ICON_BTN = 'grid size-11 shrink-0 place-items-center rounded-lg text-text enabled:active:bg-elevated';
const CTRL_BTN = 'flex h-12 min-w-14 items-center justify-center gap-1 rounded-xl border border-border bg-panel px-3 text-[14px] font-semibold enabled:active:bg-elevated disabled:opacity-35';
const DOCK_BTN = 'flex min-h-12 min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 text-[11px] font-medium text-muted enabled:active:bg-elevated disabled:opacity-35';
const CARD = 'rounded-xl border border-border bg-panel';
const KICKER = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-muted';

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
  const [addedOpen, setAddedOpen] = useState(false);
  const [addedVal, setAddedVal] = useState('');
  const [reviewFor, setReviewFor] = useState<Side | null>(null);
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
  const liveShare = sheet && sheetRows(sheet).some((r) => r.kind === 'possession') ? possessionShare(proj, clockNow) : null;
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
      setAddedVal('');
      setAddedOpen(true);
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
  // anything still in the outbox, or accepted, can be taken back (one that was refused has nothing to undo)
  const quickUndoReady = !!quickUndo && (!!s.accepted[quickUndo.commandId] || s.intents.some((x) => x.commandId === quickUndo.commandId && (x.status === 'queued' || x.status === 'sending')));
  const undoLeftS = quickUndo ? prefs.undoWindowS - (Date.now() - quickUndo.at) / 1000 : 0;
  const quickUndoNow = async () => {
    if (!quickUndo) return;
    // dropped if it has not gone, undone if it has, or undone as soon as it lands if it is on its way
    await s.takeBack(quickUndo.commandId, 'Undone by the scorer straight after recording', quickUndo.label);
    feedback(prefs, 'tick');
    setQuickUndo(null);
  };
  /** the header's undo: the action just recorded at once (even while it is on its way), an older one with a reason */
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
    if (e.type === 'video_review') return setReviewFor(side);
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
  // the review decision has its own buttons on the sheet while a review is open
  const controlNoSide = events.filter((e) => e.group === 'control' && !e.requiresSide && e.type !== 'review_decision');
  // a video review waiting for its decision
  const openReview = proj.review && proj.review.outcome == null ? proj.review : null;
  const decideReview = async (outcome: 'awarded' | 'denied') => {
    const dec = defOf('review_decision');
    if (!openReview || !dec) return;
    await sendFact(dec, null, { outcome });
    // a try awarded by the video referee goes on the score at once; who scored follows, as for any try
    const tryEv = defOf('try');
    if (outcome === 'awarded' && openReview.subject === 'try' && tryEv) {
      const cid = await sendFact(tryEv, openReview.side);
      if (playersOf(openReview.side).length) setPlayerFor({ commandId: cid, side: openReview.side, label: tryEv.label, eventType: tryEv.type });
    }
  };
  const reviewBanner = openReview ? (
    <section role="region" aria-label="Video review" className="mx-3 mt-3 rounded-xl border border-warning/60 bg-warning/10 p-3">
      <p className="text-center text-[15px] font-semibold text-warning" data-review-line>{openReview.subject === 'try' ? `Video review · ${team(openReview.side).shortName} try?` : `${REVIEW_SUBJECT_LABELS[openReview.subject as keyof typeof REVIEW_SUBJECT_LABELS] ?? 'Video review'} · ${team(openReview.side).shortName}`}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" data-decision="awarded" disabled={!canScore} onClick={() => void decideReview('awarded')} className="min-h-14 rounded-xl bg-[#16a34a] text-[17px] font-bold text-white enabled:active:scale-[0.98] disabled:opacity-40">{reviewWords(openReview.subject).buttons.awarded}</button>
        <button type="button" data-decision="denied" disabled={!canScore} onClick={() => void decideReview('denied')} className="min-h-14 rounded-xl bg-[#dc2626] text-[17px] font-bold text-white enabled:active:scale-[0.98] disabled:opacity-40">{reviewWords(openReview.subject).buttons.denied}</button>
      </div>
      {openReview.subject === 'try' ? <p className="mt-2 text-center text-xs text-muted">A try awarded goes on the score at once (4 points); then pick who scored.</p> : null}
    </section>
  ) : null;
  const head = (side: Side) => team(side).primaryColor;
  const teamTag = (side: Side, extra?: React.ReactNode) => (
    <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
      <span aria-hidden className="h-4 w-1 shrink-0 rounded-full" style={{ background: head(side) }} />
      <span className="truncate">{team(side).shortName}</span>
      {extra}
    </span>
  );

  // ------------------------------------------------------------------ the event pad during play
  /** one team's tile for an event; the first scoring event of the sport is filled with the team's colour */
  const tileFor = (side: Side, type: string, stat: string | undefined, strong: boolean) => {
    const n = sheetCount(proj, side, type, stat);
    return (
      <PadTile key={`${side}-${type}`} side={side} eventType={type} team={team(side)} label={label(type)} count={n} strong={strong}
        icon={CARD_COLOUR[type] ? <CardGlyph type={type} /> : <EventIcon type={type} className="size-[18px]" />}
        disabled={!canTap(type) || (type === 'video_review' && !!openReview)} onTap={() => void recordFor(type, side)} testLabel={sideLabel(side, label(type), n)} />
    );
  };
  const liveRows = sheet ? (
    <div aria-label="Teams" role="region" className="pb-4">
      <div aria-hidden className="sticky top-0 z-10 grid grid-cols-2 gap-2 border-b border-border bg-bg/95 px-3 py-2">
        {SIDES.map((side) => <span key={side} className="rounded-lg bg-panel px-2.5 py-1.5">{teamTag(side)}</span>)}
      </div>
      {sheet.map((sec) => {
        const rows = sec.rows.filter((r) => (r.kind === 'possession' ? !!defOf(POSSESSION_EVENT) : r.kind === 'cards' ? r.cards.some((c) => defOf(c.type)) : !!defOf(r.type)));
        if (!rows.length) return null;
        return (
          <PadSection key={sec.title} title={sec.title}>
            {rows.flatMap((row, ri) => {
              if (row.kind === 'possession')
                return [<PossessionBar key="possession" teams={{ home: team('home'), away: team('away') }} share={liveShare} has={proj.possession ?? null} disabled={!canTap(POSSESSION_EVENT)} onTap={(side) => void recordFor(POSSESSION_EVENT, side)} testLabel={(side) => sideLabel(side, 'Possession', liveShare ? `${liveShare[side]}%` : 'none yet')} />];
              const items = row.kind === 'cards' ? row.cards.filter((c) => defOf(c.type)) : [{ type: row.type, stat: row.stat }];
              return items.flatMap((c) => SIDES.map((side) => tileFor(side, c.type, c.stat, sec.title === 'Score' && ri === 0)));
            })}
          </PadSection>
        );
      })}
    </div>
  ) : null;

  // ------------------------------------------------------------------ the shoot-out
  // where the shoot-out stands: the team to kick next is marked; once it is decided no more kicks are taken
  const so = shootoutStatus(proj.shootout, cfg);
  const soNames = { home: team('home').shortName, away: team('away').shortName };
  const soLine = shootoutLine(so, soNames) + (!so.winner && !so.pressure && so.next ? ` · ${soNames[so.next]} to kick` : '');
  const soSlots = (side: Side) => {
    const ks = proj.shootout?.kicks.filter((k) => k.side === side) ?? [];
    const n = Math.max(so.rounds, ks.length + (so.next === side ? 1 : 0));
    return Array.from({ length: n }, (_, i) => ({ kick: ks[i], next: !ks[i] && so.next === side && i === ks.length, sudden: i >= so.rounds }));
  };
  const shootoutRows = shootoutEv ? (
    <div role="region" aria-label="Shootout" className="px-3 pb-4 pt-3">
      <p role="status" data-shootout-line className={cx('rounded-xl px-4 py-3 text-center text-[15px] font-semibold', so.winner ? 'text-white' : so.pressure ? 'bg-warning/15 text-warning' : 'border border-border bg-panel')} style={so.winner ? { background: head(so.winner) } : undefined}>
        {soLine}
      </p>
      {so.winner ? <p className="mt-2 text-center text-sm text-muted">Decided: no more kicks are needed. Use <b>End shoot-out</b> below to finish the match.</p> : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {SIDES.map((side) => (
          <div key={side} className={cx('grid content-start gap-2 rounded-xl border bg-panel p-2', so.next === side && !so.winner ? 'border-primary' : 'border-border')}>
            <div className="flex items-center px-1">{teamTag(side, so.next === side && !so.winner ? <span className="ml-auto shrink-0 text-[11px] font-medium text-primary">to kick</span> : null)}</div>
            <ol className="flex flex-wrap gap-1.5 px-1" aria-label={`${team(side).shortName} kicks`}>
              {soSlots(side).map((x, i) => (
                <li key={i} aria-label={x.kick ? (x.kick.scored ? 'scored' : 'missed') : x.next ? 'next' : 'to take'}
                  className={cx('grid size-7 place-items-center rounded-md text-xs font-bold text-white', x.kick ? (x.kick.scored ? 'bg-[#16a34a]' : 'bg-[#dc2626]') : 'border border-border bg-elevated', x.next && 'ring-2 ring-primary', x.sudden && i === so.rounds && 'ml-2')}>
                  {x.kick ? (x.kick.scored ? '✓' : '✗') : ''}
                </li>
              ))}
            </ol>
            {([['scored', true], ['missed', false]] as const).map(([word, scored]) => {
              const n = proj.shootout?.kicks.filter((k) => k.side === side && k.scored === scored).length ?? 0;
              return <PadTile key={word} side={side} eventType={`shootout_${word}`} team={team(side)} label={scored ? 'Scored' : 'Missed'} count={n} icon={scored ? <Check className="size-[18px]" /> : <X className="size-[18px]" />} disabled={!canScore || !!so.winner} onTap={() => void sendFact(shootoutEv, side, { scored })} testLabel={sideLabel(side, scored ? 'Scored' : 'Missed', n)} />;
            })}
          </div>
        ))}
      </div>
    </div>
  ) : null;

  // ------------------------------------------------------------------ before the match and in breaks
  const stepsSheet = (
    <div className="grid gap-3 px-3 pb-4 pt-3">
      {phase.kind === 'pre' ? (
        <section aria-label="Match details" className={cx(CARD, 'p-4')}>
          <h2 className={KICKER}>Match details</h2>
          <ul className="mt-3 grid gap-2.5 text-[15px]">
            <li className="flex items-start gap-3"><Trophy className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><span>{m.competition.name}{(m as { round?: string | null }).round ? ` · ${(m as { round?: string | null }).round}` : ''}</span></li>
            <li className="flex items-start gap-3"><Users className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><span>{team('home').name} v {team('away').name}</span></li>
            <li className="flex items-start gap-3"><MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><span>{venue?.name ?? 'Ground not set'}</span></li>
            <li className="flex items-start gap-3"><CalendarDays className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><span>{fmtDate(m.scheduledAt, tz, { dateStyle: 'full' })} · {fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}</span></li>
          </ul>
        </section>
      ) : (
        <p className={cx(CARD, 'px-4 py-3 text-[15px]')}><span className={cx(KICKER, 'block')}>{phase.label}</span>{team('home').shortName} {display.score.home} – {display.score.away} {team('away').shortName}{display.shootout ? ` · pens ${display.shootout.home}–${display.shootout.away}` : ''}</p>
      )}
      {access === 'score' ? (
        <section role="region" aria-label="Match phase" className={cx(CARD, 'p-4')}>
          <h2 className={KICKER}>{playNext ? `Run-down to ${playNext.label}` : 'Next'}</h2>
          <ol className="mt-3 grid gap-2">
            {steps.map((p, i) => {
              const st = stepState(i);
              const now = stepAllowed(i);
              return (
                <li key={p.id} className="flex items-center gap-2">
                  <span aria-hidden className={cx('grid size-7 shrink-0 place-items-center rounded-full border text-[12px] font-bold', st === 'done' ? 'border-transparent bg-[#16a34a] text-white' : st === 'skipped' ? 'border-dashed border-muted text-muted' : now ? 'border-primary text-primary' : 'border-border text-muted')}>
                    {st === 'done' ? <Check className="size-4" /> : i + 1}
                  </span>
                  <button type="button" disabled={!canScore || !now} onClick={() => void setPhase(p.id)}
                    className={cx('flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-left text-[15px] font-semibold enabled:bg-elevated enabled:active:scale-[0.99] disabled:text-muted', st === 'skipped' && 'line-through')}>
                    <span className="truncate">{p.label}</span>
                    {st === 'done' ? <span className="sr-only">(done)</span> : st === 'skipped' ? <span className="sr-only">(skipped)</span> : null}
                    {now && canScore ? <span aria-hidden className="ml-auto shrink-0 text-[12px] font-medium text-primary">Now</span> : null}
                  </button>
                  <button type="button" aria-label={st === 'skipped' ? `Undo skipping ${p.label}` : `Skip ${p.label}`} disabled={!canScore || st === 'done'}
                    className="flex min-h-12 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-[13px] font-medium text-muted enabled:active:bg-elevated disabled:opacity-35"
                    onClick={() => setSkipped((cur) => { const n = new Set(cur); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}>
                    {st === 'skipped' ? <RotateCcw className="size-4" aria-hidden /> : <SkipForward className="size-4" aria-hidden />}{st === 'skipped' ? 'Undo' : 'Skip'}
                  </button>
                </li>
              );
            })}
          </ol>
          {playNext ? (
            <button type="button" className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[17px] font-bold text-bg enabled:active:scale-[0.99] disabled:opacity-35" disabled={!canScore || !startAllowed} onClick={() => void setPhase(playNext.id)}>
              <Play className="size-5" aria-hidden />Start {playNext.label}
            </button>
          ) : nextPhase ? (
            <button type="button" className="mt-3 min-h-14 w-full rounded-xl bg-primary text-[17px] font-bold text-bg disabled:opacity-35" disabled={!canScore} onClick={() => void setPhase(nextPhase.id)}>{nextPhase.label}</button>
          ) : null}
          {steps.length && !startAllowed && playNext ? <p className="mt-2 text-center text-sm text-muted">Mark or skip each step to start {playNext.label.toLowerCase()}.</p> : null}
          {otherPhases.length ? <button className="mt-1 min-h-10 w-full text-sm text-muted underline" onClick={() => setMorePhases(true)}>More options</button> : null}
        </section>
      ) : <p className="px-1 text-sm text-muted">The main scorer starts the match.</p>}
    </div>
  );

  // ------------------------------------------------------------------ after the match
  const finalSheet = (
    <div>
      <div className="px-3 pt-3">
        <p className={cx(CARD, 'px-4 py-3 text-sm text-muted')}><span className={cx(KICKER, 'block text-text')}>{phase.label}</span>The match is finished. The counts below are its statistics; undo or correct an event from the events list.</p>
      </div>
      {liveRows}
    </div>
  );

  const teamDetail = (side: Side) => (
    <>
      {display.scoreDetail ? <span className="block text-[11px] text-muted tabular">{display.scoreDetail[side]}</span> : null}
      {display.fouls ? <span className="block text-[11px] text-muted">Fouls {display.fouls[side]}{display.bonus?.[side] ? (m.sport === 'futsal' ? ' · next is a 10 m kick' : ' · BONUS') : ''} · TO {display.timeouts?.[side]}</span> : null}
      {display.timers?.filter((x) => x.side === side && x.kind === 'sin_bin').map((x) => <span key={x.kind} className="mt-0.5 inline-block rounded bg-warning/20 px-1.5 text-[11px] font-semibold text-warning tabular" data-sin-bin={side} aria-label={`${team(side).shortName} sin bin ${x.remainingText}`}>{x.count > 1 ? `${x.count}× ` : ''}Sin bin {x.remainingText}</span>)}
      {display.shortHanded?.find((x) => x.side === side) ? <span className="mt-0.5 inline-block rounded bg-live/20 px-1.5 text-[11px] font-semibold text-live tabular" aria-label={`${team(side).shortName} a player short`}>{display.shortHanded.find((x) => x.side === side)!.players} on court · {display.shortHanded.find((x) => x.side === side)!.remainingText}</span> : null}
      {m.sport === 'basketball' && display.possession === side ? <span className="block text-[11px] text-primary">possession</span> : null}
    </>
  );
  const clockRunsHere = phase.kind === 'play' && proj.phase !== 'shootout';

  return (
    <div className="flex min-h-screen flex-col bg-bg pb-[calc(env(safe-area-inset-bottom)+84px)] text-text">
      {/* line-ups not filled in */}
      {access === 'score' && phase.kind === 'pre' && lineupThin && !lineupBannerClosed ? (
        <div className="flex items-start gap-3 border-b border-live/40 bg-live/15 px-4 py-3" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-live" aria-hidden />
          <p className="flex-1 text-[14px]">The starting line-ups are not filled in yet. <Link href={`/score/${matchId}/lineup`} className="font-semibold text-primary underline">Edit the starting line-ups</Link></p>
          <button aria-label="Close" className="p-1 text-muted" onClick={() => setLineupBannerClosed(true)}><X className="size-5" /></button>
        </div>
      ) : null}

      {/* the match and the connection */}
      <header className="flex items-center gap-1 border-b border-border px-1.5 py-1.5">
        <Link href="/score" aria-label="All matches" className={ICON_BTN}><ChevronLeft className="size-6" /></Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{team('home').shortName} v {team('away').shortName}</p>
          <p className="truncate text-[12px] text-muted">{m.competition.name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 pr-2 text-[11px] text-muted" role="status">
          <span className="flex items-center gap-1.5">
            {s.transport === 'offline' ? <><CloudOff className="size-3.5 text-warning" aria-hidden /><span className="text-warning">Offline</span></> : <><span aria-hidden className="size-2 rounded-full bg-[#16a34a]" />Online{s.transport === 'polling' ? ` · ${prefs.lowData ? 'low data' : 'refreshing'}` : ''}</>}
          </span>
          {pending.length ? <span className="font-semibold text-warning">{pending.length} pending</span> : <span>All changes saved</span>}
        </div>
      </header>
      {access !== 'score' || s.provisional?.provisional || !s.online || s.fromCache ? (
        <div className="grid gap-1 px-3 pt-2 text-[12px] text-muted">
          {access !== 'score' ? <span><StatusPill tone="primary">{ACCESS_LABEL[access]}</StatusPill></span> : null}
          {s.provisional?.provisional ? <span className="text-warning">Score shown includes unconfirmed actions (provisional)</span> : null}
          {!s.online ? <span className="text-warning">Offline: actions are stored on this device only. They are not reaching scoreboards or live graphics until you reconnect.</span> : null}
          {s.fromCache ? <span>Showing the last saved copy of this match.</span> : null}
          {access === 'stats' ? <span>You record statistics for this match. The main scorer keeps the score, clock and periods.</span> : null}
          {access === 'view' ? <span>You can follow this match live but not change it.</span> : null}
        </div>
      ) : null}
      {access === 'score' && (s.leaseProblem || (s.online && !s.holding)) ? (
        <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-live/40 bg-live/10 px-3 py-2 text-sm" role="alert">
          <AlertTriangle className="size-4 text-live" />
          <span className="flex-1">{s.leaseProblem ?? 'Another device has control of this match. Your actions will wait until you take over.'}</span>
          <Button size="sm" onClick={() => s.takeControl()}>Take over scoring</Button>
        </div>
      ) : null}

      {/* the scoreboard */}
      <section aria-label="Score" className="mx-3 mt-3 overflow-hidden rounded-2xl border border-border bg-panel">
        <div className="grid grid-cols-[1fr_auto_1fr]">
          {SIDES.map((side, i) => (
            <div key={side} className={i === 0 ? 'order-1 min-w-0' : 'order-3 min-w-0'}>
              <ScoreBlock side={side} team={team(side)} score={phase.kind === 'pre' ? null : display.score[side]} provisional={s.provisional?.provisional} detail={teamDetail(side)} />
            </div>
          ))}
          <div className="order-2 flex w-[104px] flex-col items-center justify-center border-x border-border bg-bg/50 px-1.5 py-2 text-center">
            <span className={cx(KICKER, 'text-balance leading-tight')}>{periodWord}</span>
            {phase.kind === 'pre' ? (
              <>
                <span className="text-[22px] font-bold leading-tight tabular">{fmtDate(m.scheduledAt, tz, { timeStyle: 'short' })}</span>
                <span className="text-[11px] text-muted">kick-off</span>
              </>
            ) : clockRunsHere ? (
              <span data-clock className={cx('text-[26px] font-bold leading-tight tabular', running ? 'text-text' : 'text-muted')} aria-live="off">{display.clockText}</span>
            ) : null}
            {display.stoppageText || display.addedMinutes ? <span className="text-[12px] font-semibold leading-none text-warning tabular">{[display.stoppageText, display.addedMinutes ? `of +${display.addedMinutes}` : null].filter(Boolean).join(' ')}</span> : null}
            {display.shootout ? <span className="mt-0.5 text-[13px] font-semibold">Pens {display.shootout.home}–{display.shootout.away}</span> : null}
          </div>
        </div>
      </section>
      {display.alerts.map((a) => <p key={a} className="mx-3 mt-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" role="alert">{a}</p>)}
      {access === 'score' && overrunMs > 10 * 60_000 ? (
        <div role="alert" className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" /> This period is {Math.floor(overrunMs / 60_000)} minutes over. Still playing?
          {ending ? <Button size="sm" variant="primary" disabled={!canScore} onClick={() => setEndOpen(true)}>End {phase.label}</Button> : null}
        </div>
      ) : null}

      {/* the clock's controls */}
      {access === 'score' && clockRunsHere && mainClock ? (
        <section aria-label="Clock controls" className="mx-3 mt-2 grid grid-cols-[auto_1fr_auto_auto] gap-2">
          <button type="button" aria-label="Take a minute off the clock" className={CTRL_BTN} disabled={!canScore} onClick={() => nudgeClock(-60_000)}><Minus className="size-4" aria-hidden />1′</button>
          <button type="button" aria-label={running ? 'Pause clock' : mainClock.baseMs ? 'Resume clock' : 'Start clock'} disabled={!canScore} onClick={() => clockAction(running ? 'pause' : mainClock.baseMs ? 'resume' : 'start')}
            className={cx('flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-bold enabled:active:scale-[0.99] disabled:opacity-35', running ? 'border border-border bg-elevated text-text' : 'bg-primary text-bg')}>
            {running ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}{running ? 'Pause' : mainClock.baseMs ? 'Resume' : 'Start clock'}
          </button>
          <button type="button" aria-label="Add a minute to the clock" className={CTRL_BTN} disabled={!canScore} onClick={() => nudgeClock(60_000)}><Plus className="size-4" aria-hidden />1′</button>
          <button type="button" aria-label="Correct the clock" className={CTRL_BTN} disabled={!canScore} onClick={() => { setClockDlg('main'); setClockVal(mmss(clockDisplayMs(mainClock, s.serverNow()))); }}><Pencil className="size-4" aria-hidden /></button>
        </section>
      ) : null}
      {s.state.clocks.shot && access === 'score' && phase.kind === 'play' ? (
        <section aria-label="Shot clock" className="mx-3 mt-2 flex items-center justify-center gap-2">
          {display.shotClockText ? <span className="rounded-lg bg-live/20 px-3 py-1 text-[24px] font-bold text-live tabular" aria-label="Shot clock">{display.shotClockText}</span> : null}
          <Button size="touch" disabled={!canScore} onClick={() => s.enqueue('CLOCK_ACTION', { clockId: 'shot', action: 'reset', ms: ((cfg as { shotClock: { fullSeconds: number } }).shotClock.fullSeconds) * 1000 }, 'Shot clock reset')}><RotateCcw className="size-4" /> {(cfg as { shotClock: { fullSeconds: number } }).shotClock.fullSeconds}</Button>
          <Button size="touch" disabled={!canScore} onClick={() => s.enqueue('CLOCK_ACTION', { clockId: 'shot', action: 'reset', ms: ((cfg as { shotClock: { resetSeconds: number } }).shotClock.resetSeconds) * 1000 }, 'Shot clock reset')}><RotateCcw className="size-4" /> {(cfg as { shotClock: { resetSeconds: number } }).shotClock.resetSeconds}</Button>
        </section>
      ) : null}
      {access === 'score' && controlNoSide.length && phase.kind === 'play' ? (
        <div className="mx-3 mt-2 flex flex-wrap gap-2">{controlNoSide.map((e) => <button key={e.type} type="button" className="min-h-10 rounded-full border border-border bg-panel px-4 text-[13px] font-semibold enabled:active:bg-elevated disabled:opacity-35" disabled={!canScore} onClick={() => onEvent(e)}>{e.label}{e.type === 'stoppage_announced' && display.addedMinutes ? ` +${display.addedMinutes}` : ''}</button>)}</div>
      ) : null}

      {/* basketball keeps its court controls */}
      {access !== 'view' && m.sport === 'basketball' && phase.kind === 'play' ? (
        <section className="mx-3 mt-3 grid grid-cols-2 gap-2" aria-label="Scoring">
          {SIDES.map((side) => (
            <div key={side} className={cx(CARD, 'grid gap-2 p-2')}>
              <div className="px-1">{teamTag(side)}</div>
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
          {access === 'score' ? <label className="col-span-2 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={bbReset} onChange={(e) => setBbReset(e.target.checked)} className="size-5" /> Reset shot clock on 2/3-point scores</label> : null}
        </section>
      ) : null}

      {/* what the scorer records */}
      <main className="flex-1">
        {review.length ? (
          <section aria-label="Needs review" className="mx-3 mt-3 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2">
            <h2 className="mb-1 text-sm font-semibold text-warning">Needs your review ({review.length})</h2>
            {review.map((i) => (
              <div key={i.commandId} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
                <span className="flex-1"><strong>{i.label}</strong> <span className="text-xs text-muted">recorded {new Date(i.createdAt).toLocaleTimeString('en-AU')}</span><span className="block text-xs text-muted">{i.error?.message}</span></span>
                {i.status === 'needs_review' ? <Button size="sm" variant="primary" onClick={() => s.review(i.commandId, 'apply')}>Apply now</Button> : <Button size="sm" onClick={() => s.review(i.commandId, 'apply')}>Retry</Button>}
                <Button size="sm" variant="ghost" onClick={() => s.review(i.commandId, 'discard')}>Discard</Button>
              </div>
            ))}
          </section>
        ) : null}
        {offerKnockout ? (
          <div className="mx-3 mt-3 grid gap-2 rounded-xl border border-primary/50 bg-primary/10 p-3 text-sm" role="status">
            <span>Level. This match&apos;s rules let a draw stand. Does it need a winner?</span>
            <Button size="touch" variant="primary" disabled={!canScore} onClick={() => void s.enqueue('SET_KNOCKOUT', { on: true, reason: 'level at the end of regulation: the match needs a winner' }, ko!.label)}>Play {ko!.label.replace(/ when level$/, '').toLowerCase()}</Button>
          </div>
        ) : null}
        {phase.kind === 'pre' || phase.kind === 'break' ? stepsSheet
          : proj.phase === 'shootout' ? shootoutRows
          : phase.kind === 'play' ? (m.sport === 'basketball' ? <p className="p-4 text-sm text-muted">Score from the court controls above. Events are listed under Events.</p> : <>{reviewBanner}{liveRows}</>)
          : phase.kind === 'final' ? finalSheet
          : <p className="p-4 text-sm text-muted">This match is {phase.label.toLowerCase()}.</p>}
      </main>

      {/* the dock: undo, the events, the line-ups, the details and the end of the period */}
      <nav aria-label="Match controls" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-panel/95 px-2 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
        <div className="mx-auto flex max-w-xl items-center gap-1">
          {access !== 'view' ? <button type="button" aria-label="Undo the last action" className={DOCK_BTN} disabled={!canStats || (quickUndoOpen ? !quickUndoReady : !(access === 'score' && lastFact))} onClick={undoLast}><Undo2 className="size-5" aria-hidden />Undo</button> : null}
          <button type="button" aria-label="Match events" className={DOCK_BTN} onClick={() => setEventsOpen(true)}><List className="size-5" aria-hidden />Events</button>
          {access === 'score' ? <Link href={`/score/${matchId}/lineup`} aria-label="Line-ups" className={DOCK_BTN}><Users className="size-5" aria-hidden />Line-ups</Link> : null}
          <button type="button" aria-label="Match details" className={DOCK_BTN} onClick={() => setDetailsOpen(true)}><Info className="size-5" aria-hidden />Details</button>
          {ending ? (
            <button type="button" className="ml-1 min-h-12 flex-1 rounded-xl bg-primary px-3 text-[15px] font-bold text-bg enabled:active:scale-[0.99] disabled:opacity-40" disabled={!canScore} onClick={() => setEndOpen(true)}>
              End {proj.phase === 'shootout' ? 'shoot-out' : phase.label}
            </button>
          ) : null}
        </div>
      </nav>

      {/* ending a period: the next step, and the other ways on */}
      <Dialog open={endOpen} onOpenChange={setEndOpen} title={`End ${proj.phase === 'shootout' ? 'the shoot-out' : phase.label}?`} description={`${team('home').shortName} ${display.score.home} – ${display.score.away} ${team('away').shortName}${display.shootout ? ` (pens ${display.shootout.home}–${display.shootout.away})` : ''}.`}>
        <div className="grid gap-2">
          {nextPhase ? <Button size="touch" variant="primary" data-next disabled={!canScore} onClick={() => { setEndOpen(false); void setPhase(nextPhase.id); }}>{nextPhase.label}</Button> : null}
          {offerKnockout ? <Button size="touch" variant="secondary" disabled={!canScore} onClick={() => { setEndOpen(false); void s.enqueue('SET_KNOCKOUT', { on: true, reason: 'level at the end of regulation: the match needs a winner' }, ko!.label); }}>Play {ko!.label.replace(/ when level$/, '').toLowerCase()} instead</Button> : null}
          {otherPhases.map((def) => <Button key={def.id} size="touch" variant={def.kind === 'terminal' ? 'danger' : 'secondary'} disabled={!canScore} onClick={() => { setEndOpen(false); pickPhase(def); }}>{def.label}</Button>)}
        </div>
      </Dialog>

      {/* the fourth official's board: the minutes of added time */}
      <Dialog open={addedOpen} onOpenChange={setAddedOpen} title="Added time" description={`Minutes added to ${phase.label.toLowerCase()}. The board graphic goes on air and the scorebug shows +minutes until the end of the period.`}>
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Minutes">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <Button key={n} size="touch" variant={display.addedMinutes === n ? 'primary' : 'secondary'} disabled={!canScore} onClick={() => { const e = defOf('stoppage_announced'); setAddedOpen(false); if (e) void sendFact(e, null, { minutes: n }); }}>+{n}</Button>)}
        </div>
        <div className="mt-3 flex items-end gap-2">
          <Field label="Other (minutes)" htmlFor="added-other"><Input id="added-other" inputMode="numeric" value={addedVal} onChange={(e) => setAddedVal(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
          <Button variant="primary" disabled={!canScore || !addedVal || Number(addedVal) > 30} onClick={() => { const e = defOf('stoppage_announced'); setAddedOpen(false); if (e) void sendFact(e, null, { minutes: Number(addedVal) }); }}>Show +{addedVal || '…'}</Button>
        </div>
      </Dialog>

      {/* a video review: what the video referee checks */}
      <Dialog open={!!reviewFor} onOpenChange={(o) => !o && setReviewFor(null)} title={`Video review · ${reviewFor ? team(reviewFor).shortName : ''}`} description="The review graphic goes on air while it is checked. Give the decision on the sheet when it comes.">
        <div className="grid gap-2">
          {REVIEW_SUBJECTS.map((subject) => <Button key={subject} size="touch" variant={subject === 'try' ? 'primary' : 'secondary'} disabled={!canScore} onClick={() => { const e = defOf('video_review'); const sd = reviewFor; setReviewFor(null); if (e && sd) void sendFact(e, sd, { subject }); }}>{REVIEW_SUBJECT_LABELS[subject]}</Button>)}
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
        <div className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-3" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}>
          <Button size="touch" variant="secondary" className="pointer-events-auto shadow-lg" disabled={!quickUndoReady} onClick={() => void quickUndoNow()}>
            <Undo2 className="size-5" /> Undo {quickUndo.label} · {Math.ceil(undoLeftS)}s
          </Button>
        </div>
      ) : null}
    </div>
  );
}
