'use client';
// Derby: each team plays in its own colour. A team's block is the club's colour with its crest breaking out of the end;
// a white score plate sits between the two blocks with the clock in a grey tab underneath; event straps hang their
// detail (the player, the minute) in a light row under the block; the break board lists each team's scorers under its
// block; the statistics board fills the screen between the two teams' colour panels. An original design in the style
// of an Australian club football broadcast, with no league or broadcaster marks, names or typefaces. The graphics it
// does not draw itself (the match header, line-ups, tables, the ticker…) come from the broadcast pack engine as a
// matching set of white panels with title bars in the look's colour.
import type { CSSProperties, ReactNode } from 'react';
import { getAdapter } from '@bs/domain';
import { fitLabel } from '../fit';
import { occasionLine, type RenderPlayer, type RenderTeam } from '../data';
import { animStyle, changeStyle, stagger, type GraphicProps, type ThemeComponents } from './stage';
import { Fitted, Logo, RED_CARD_BOX, RedCardTab, ScorebugTabs, SponsorMark, ThemeBadge, badgeUrl, cardStyle, clockLabel, eventWord, identInfo, periodBanner, player, scorebugPosition, stoppageLabel, t, team } from './common';
import { packTheme, type Pack } from './theme-pack';

const SX = 96; // 5% title-safe
const SY = 54;
const INK = '#15171C';
const PLATE = '#FFFFFF';
/** the clock tab and the strap rows */
const TAB = '#E4E6EA';
const ROW = '#F3F4F6';
const MUTED = '#6A6F7C';
const SHADOW = 'drop-shadow(0 8px 18px rgba(0,0,0,.34))';
const ON_GREEN = '#1FA45A';
const OFF_RED = '#D8343C';
type Side = 'home' | 'away';

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}
function alpha(hex: string, a: number): string {
  const c = rgb(hex);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex;
}
/** a → b by k (0..1), as hex, without color-mix() (older OBS browser sources lack it). */
function mix(a: string, b: string, k: number): string {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, '0')).join('')}`;
}
function luminance(hex: string): number {
  const c = rgb(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
/** White on any club colour but a light one (yellow, sky, white), which takes ink: heavy type on a block reads. */
const inkOn = (bg: string) => (contrast(bg, '#FFFFFF') >= 2.3 ? '#FFFFFF' : INK);
/** A team's name on its own block: its second colour when that reads on the first, else white or ink. */
const nameInk = (tm: RenderTeam) => (tm.secondaryColor && contrast(tm.primaryColor, tm.secondaryColor) >= 2.3 ? tm.secondaryColor : inkOn(tm.primaryColor));
/** Card colours, fuller than the shared ones so they hold up on a white strap. */
const CARD_FILL: Record<string, string> = { yellow: '#FFC72C', sin_bin: '#FFC72C', second_yellow: '#E0262E', red: '#E0262E', green: '#22A957' };
/** A team's block: darker at the crest end, lighter towards the middle. */
const blockBg = (tm: RenderTeam, crestAt: 'left' | 'right') => `linear-gradient(${crestAt === 'left' ? 100 : 260}deg, ${mix(tm.primaryColor, '#000000', 0.16)} 0%, ${tm.primaryColor} 40%, ${mix(tm.primaryColor, '#ffffff', 0.1)} 100%)`;
const font = (p: GraphicProps): CSSProperties => ({ fontFamily: p.data.theme.font });
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

/** The look's signature: two thin slashes of light at the inner end of a team block. */
function Glint({ at, h = 1 }: { at: 'left' | 'right'; h?: number }) {
  const bar = (offset: number, w: number, o: number): CSSProperties => ({ position: 'absolute', top: 0, bottom: 0, [at]: offset * h, width: w * h, background: `rgba(255,255,255,${o})`, transform: 'skewX(-20deg)', pointerEvents: 'none' });
  return (
    <>
      <span aria-hidden style={bar(10, 9, 0.14)} />
      <span aria-hidden style={bar(25, 4, 0.1)} />
    </>
  );
}

/** A crest; a team with no logo gets its letters on a darker square of its colour, so it shows on its own block. */
function Crest({ tm, size }: { tm: RenderTeam; size: number }) {
  return <Logo url={tm.logoUrl} label={tm.abbreviation} size={size} color={mix(tm.primaryColor, '#000000', 0.3)} radius={Math.round(size * 0.18)} />;
}

/** A faint, washed-out crest inside a big team block. Nothing for a team with no logo. */
function Watermark({ tm, size, style }: { tm: RenderTeam; size: number; style: CSSProperties }) {
  if (!tm.logoUrl) return null;
  return (
    <span aria-hidden style={{ position: 'absolute', opacity: 0.11, filter: 'grayscale(1) brightness(1.8)', pointerEvents: 'none', ...style }}>
      <Logo url={tm.logoUrl} label="" size={size} color="transparent" />
    </span>
  );
}

function Ball({ size, sport }: { size: number; sport: string }) {
  if (sport === 'rugby_league')
    return (
      <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} style={{ flex: 'none' }}>
        <ellipse cx="12" cy="12" rx="10.5" ry="6.6" transform="rotate(-35 12 12)" fill="#FFFFFF" stroke={INK} strokeWidth="1.6" />
        <path d="M8.2 15.8 15.8 8.2M10 12.4l1.6 1.6M11.6 10.8l1.6 1.6" stroke={INK} strokeWidth="1.4" fill="none" />
      </svg>
    );
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="10.5" fill="#FFFFFF" stroke={INK} strokeWidth="1.6" />
      <polygon points="12,7.4 15.8,10.2 14.4,14.6 9.6,14.6 8.2,10.2" fill={INK} />
      <path d="M12 7.4V3.4M15.8 10.2l3.7-1.3M14.4 14.6l2.3 3.2M9.6 14.6l-2.3 3.2M8.2 10.2 4.5 8.9" stroke={INK} strokeWidth="1.4" fill="none" />
    </svg>
  );
}

/** "N. MAIERONI": the initial in a light weight, the surname in capitals in the heavy one, fitted to the width. */
function PlayerName({ p, pl, fallback, width, px, colour = INK }: { p: GraphicProps; pl: RenderPlayer | null; fallback: string; width: number; px: number; colour?: string }) {
  const parts = (pl?.displayName ?? '').trim().split(/\s+/).filter(Boolean);
  const first = pl && parts.length > 1 ? `${parts[0]![0]!.toUpperCase()}.` : '';
  const last = (pl ? (parts.length > 1 ? parts.slice(1).join(' ') : parts[0] ?? '') : fallback).toUpperCase();
  const full = first ? `${first} ${last}` : last;
  const r = fitLabel({ full, maxWidth: width, fontPx: px, minFontPx: Math.round(px * 0.7), measure: p.measure });
  const cut = r.text !== full;
  return (
    <span title={pl?.displayName ?? fallback} style={{ display: 'inline-block', maxWidth: width, whiteSpace: 'nowrap', overflow: 'hidden', fontSize: r.fontPx, lineHeight: 1.1, color: colour }}>
      {cut ? <b style={{ fontWeight: 900 }}>{r.text}</b> : (
        <>
          {first ? <span style={{ fontWeight: 500 }}>{first} </span> : null}
          <b style={{ fontWeight: 900 }}>{last}</b>
        </>
      )}
    </span>
  );
}

const SCORER_SPORTS = ['football', 'futsal', 'hockey', 'rugby_league'];
/** Who scored for a team: goals (an own goal goes under the team it counted for), or a rugby league team's tries. */
function scorersOf(p: GraphicProps, s: Side) {
  const sport = p.data.match.sport;
  if (!SCORER_SPORTS.includes(sport)) return [];
  return (p.data.match.events ?? [])
    .filter((e) => e.group === 'score' && (e.type === 'own_goal' ? e.side === other(s) : e.side === s))
    .filter((e) => sport !== 'rugby_league' || e.type === 'try' || e.type === 'penalty_try')
    .map((e) => ({ id: e.id, minute: e.minute ? (e.minute.endsWith("'") ? e.minute : `${e.minute}'`) : '', player: e.playerId ? (p.data.players[e.playerId] ?? null) : null, note: e.type === 'own_goal' ? t(p, 'OG') : e.type === 'penalty_scored' ? t(p, 'PEN') : null }));
}

/** One scorer's line: the ball, the minute, the name and (OG) or (PEN). */
function ScorerLine({ p, x, s, colour, muted, px, width }: { p: GraphicProps; x: ReturnType<typeof scorersOf>[number]; s: Side; colour: string; muted: string; px: number; width: number }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: Math.round(px * 0.55) }}>
      <Ball size={Math.round(px * 0.95)} sport={p.data.match.sport} />
      <span style={{ minWidth: px * 2.1, fontSize: px * 0.92, fontWeight: 700, color: muted, fontVariantNumeric: 'tabular-nums' }}>{x.minute}</span>
      <PlayerName p={p} pl={x.player} fallback={team(p, s).shortName} width={width} px={px} colour={colour} />
      {x.note ? <span style={{ fontSize: px * 0.7, fontWeight: 800, color: muted, letterSpacing: 1 }}>({x.note})</span> : null}
    </span>
  );
}

/** The heading tab over a board: the look's colour, both ends cut on a slant. */
function TitleTab({ p, text, width, delayMs = 0 }: { p: GraphicProps; text: ReactNode; width: number; delayMs?: number }) {
  const hot = p.data.theme.primary;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
      <div style={{ minWidth: width, height: 50, padding: '0 46px', display: 'grid', placeItems: 'center', background: `linear-gradient(180deg, ${mix(hot, '#ffffff', 0.12)}, ${hot})`, color: inkOn(hot), fontSize: 24, fontWeight: 900, letterSpacing: 5, textTransform: 'uppercase', clipPath: 'polygon(20px 0, calc(100% - 20px) 0, 100% 100%, 0 100%)', ...animStyle(p, 'wipe', delayMs, 380) }}>{text}</div>
    </div>
  );
}

function detail(p: GraphicProps, s: Side): string | null {
  const d = p.display;
  const det = d.scoreDetail?.[s]?.split(' ')[0];
  const fouls = d.fouls ? `F ${d.fouls[s]}${d.bonus?.[s] ? ' ◆' : ''}` : null;
  return det || fouls ? [det, fouls].filter(Boolean).join(' · ') : null;
}
const digits = (p: GraphicProps, s: Side, min: number) => (
  <span style={{ minWidth: min, textAlign: 'center' }}>
    <span style={changeStyle(p, `score-${s}`, p.display.score[s])}>{p.display.score[s]}</span>
  </span>
);

// ------------------------------------------------------------------ scorebug, and events through it

/** The clock's words at a break and after the match ("HALF TIME", "FULL TIME"); null while the clock is the clock. */
function breakWord(p: GraphicProps): string | null {
  const m = p.data.match;
  const a = getAdapter(m.sport);
  const cfg = m.rulesConfig as never;
  const kind = a.phase(cfg, m.projection.phase)?.kind;
  // a walk-out step during the break still reads as the break itself
  if (kind === 'break') return t(p, (a.phase(cfg, m.projection.breakPhase ?? m.projection.phase)?.label ?? p.display.periodLabel).toUpperCase());
  if (kind === 'final') return t(p, m.sport === 'basketball' ? 'FINAL' : 'FULL TIME');
  return null;
}

/** What the clock tab says: the period, the clock and any added time; at a break or after the match, the words. */
function ClockText({ p, px }: { p: GraphicProps; px: number }) {
  const d = p.display;
  const th = p.data.theme;
  const word = breakWord(p);
  const stop = stoppageLabel(p);
  // evaluated every render so a change itself animates
  const stoppage = changeStyle(p, 'stoppage', !!d.stoppageText, 'flip');
  const flip = changeStyle(p, 'clock-word', word ?? '', 'flip');
  if (word) return <span data-clock-word style={{ ...flip, fontSize: Math.round(px * 0.82), fontWeight: 900, letterSpacing: 2, lineHeight: 1 }}>{word}</span>;
  return (
    <>
      <span style={{ fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: 1.5, textTransform: 'uppercase', ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
      <span style={{ ...flip, fontSize: px, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{clockLabel(p)}</span>
      {stop ? <span style={{ ...stoppage, padding: '3px 7px', background: th.primary, color: inkOn(th.primary), fontSize: Math.round(px * 0.7), fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{stop}</span> : null}
    </>
  );
}

/** The events that come up through the scorebug rather than as a strap of their own. */
const THROUGH_BUG = ['builtin:goal', 'builtin:score', 'builtin:card', 'builtin:substitution'];
/** The goal, card or substitution on air, as its own props, when the scorebug is to draw it. */
function eventOnAir(p: GraphicProps): GraphicProps | null {
  const e = p.layers?.event;
  if (!e || !THROUGH_BUG.includes(e.cue.templateKey)) return null;
  return { ...p, cue: e.cue, t: e.t, phase: e.phase, offsetMs: e.offsetMs };
}

/** Sizes shared by the scorebug and the events drawn in its place. */
function bugSize(p: GraphicProps) {
  const slim = p.data.theme.scorebug?.variant === 'strip';
  const H = slim ? 42 : 50;
  const CREST = slim ? 52 : 64;
  const hang = Math.round(CREST * 0.38); // how far a crest hangs past its block
  return { slim, H, CREST, hang, inset: CREST - hang + 10 };
}

/**
 * A goal, card or substitution in the scorebug's place: the team's crest breaking out of the end of its block, the
 * event beside it, and the player in light rows underneath with the clock beside the first. The scorebug draws it
 * over its own score (it wipes across and back); with the scorebug off it stands alone in the same place.
 */
function EventBody({ ep, host }: { ep: GraphicProps; host: GraphicProps | null }) {
  const key = ep.cue.templateKey.replace('builtin:', '');
  const tm = team(ep);
  const { slim, H, CREST, hang, inset } = bugSize(ep);
  const R = slim ? 34 : 38;
  const px = slim ? 19 : 22;
  const abbr = (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', paddingLeft: inset, paddingRight: 18, background: blockBg(tm, 'left'), color: inkOn(tm.primaryColor), ...animStyle(ep, 'wipe', 0, 340) }}>
      <span style={{ fontSize: slim ? 26 : 32, fontWeight: 900, lineHeight: 1, letterSpacing: 0.5 }}>{tm.abbreviation}</span>
      <Glint at="right" h={slim ? 0.8 : 1} />
    </div>
  );
  const wordBlock = (bg: string, ink: string, word: ReactNode) => (
    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', padding: '0 26px 0 20px', minWidth: slim ? 220 : 260, background: bg, color: ink, fontSize: slim ? 22 : 27, fontWeight: 900, letterSpacing: 1.5, whiteSpace: 'nowrap', ...animStyle(ep, 'wipe', 120, 360) }}>
      <span style={animStyle(ep, 'rise', 260, 300)}>{word}</span>
    </div>
  );
  const number = (pl: RenderPlayer | null) => (pl?.number != null ? <span style={{ minWidth: 26, fontWeight: 900, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{pl.number}</span> : null);
  let head: ReactNode;
  let rows: ReactNode[];
  if (key === 'goal' || key === 'score') {
    const pts = ep.cue.variables.points;
    const word = key === 'goal' ? `${eventWord(ep)}!` : `+${typeof pts === 'number' ? pts : ''}`;
    const sc = ep.data.match.projection.score;
    head = (
      <div style={{ position: 'relative', overflow: 'hidden', flex: 1, display: 'flex', alignItems: 'center', gap: 14, paddingLeft: inset, paddingRight: 34, minWidth: slim ? 360 : 430, background: blockBg(tm, 'left'), color: nameInk(tm), ...animStyle(ep, 'wipe', 0, 400) }}>
        <Watermark tm={tm} size={H * 2.4} style={{ right: -H * 0.3, top: '50%', transform: 'translateY(-50%)' }} />
        <span style={{ position: 'relative', fontSize: slim ? 30 : 38, fontWeight: 900, fontStyle: key === 'goal' ? 'italic' : undefined, letterSpacing: 1, lineHeight: 1, ...animStyle(ep, 'zoom', 200, 380) }}>{word}</span>
        <span style={{ position: 'relative', fontSize: slim ? 12 : 14, fontWeight: 800, letterSpacing: 4, opacity: 0.9, ...animStyle(ep, 'rise', 300, 320) }}>{(tm.shortName || tm.name).toUpperCase()}</span>
        <Glint at="right" h={slim ? 0.8 : 1} />
      </div>
    );
    rows = [
      <>
        {key === 'goal' ? <Ball size={px + 2} sport={ep.data.match.sport} /> : null}
        <PlayerName p={ep} pl={player(ep)} fallback={tm.name} width={300} px={px + 1} />
        {key === 'goal' ? (
          <span style={{ marginLeft: 'auto', paddingLeft: 18, display: 'flex', alignItems: 'center', gap: 6, fontSize: px - 4, fontWeight: 900 }}>
            {team(ep, 'home').abbreviation}
            <span style={{ padding: '2px 8px', background: INK, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{sc.home}–{sc.away}</span>
            {team(ep, 'away').abbreviation}
          </span>
        ) : null}
      </>,
    ];
  } else if (key === 'card') {
    const cs = cardStyle(ep);
    const fill = CARD_FILL[String(ep.cue.variables.cardType ?? 'yellow')] ?? cs.colour;
    const pl = player(ep);
    head = <>{abbr}{wordBlock(fill, inkOn(fill), cs.word)}</>;
    rows = [
      <>
        <span aria-hidden style={{ width: 15, height: 21, flex: 'none', borderRadius: 2, background: fill, boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
        {number(pl)}
        <PlayerName p={ep} pl={pl} fallback={tm.name} width={300} px={px + 1} />
      </>,
    ];
  } else {
    const line = (arrow: string, colour: string, pl: RenderPlayer | null) => (
      <>
        <span style={{ width: 18, color: colour, fontSize: px - 4, fontWeight: 900 }}>{arrow}</span>
        {number(pl)}
        <PlayerName p={ep} pl={pl} fallback={tm.name} width={300} px={px + 1} />
      </>
    );
    head = <>{abbr}{wordBlock(PLATE, INK, t(ep, 'SUBSTITUTION'))}</>;
    rows = [line('▲', ON_GREEN, player(ep, 'playerIn')), line('▼', OFF_RED, player(ep, 'playerOut'))];
  }
  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column' }} data-scorebug-event={key}>
      <div style={{ display: 'flex', alignItems: 'stretch', height: H }}>{head}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'stretch', minHeight: R, background: i % 2 ? TAB : ROW, color: INK, ...animStyle(ep, 'drop', 240 + i * 80, 320) }}>
          <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: `0 18px 0 ${inset}px`, fontSize: px }}>{r}</span>
          {i === 0 && host ? <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', background: TAB, whiteSpace: 'nowrap' }}><ClockText p={host} px={px} /></span> : null}
        </div>
      ))}
      <span style={{ position: 'absolute', left: -hang, top: (H - CREST) / 2, ...animStyle(ep, 'zoom', 160, 380) }}><Crest tm={tm} size={CREST} /></span>
    </div>
  );
}

/**
 * [crest|HOME] [2 | 1] [AWAY|crest], each team's block in its colour with the crest breaking out of the end, the
 * clock in a grey tab under the score plate (the strip variant: beside the bug); added time runs in a tab in the
 * look's colour beside the clock, and at a break and after the match the tab says HALF TIME or FULL TIME. A goal,
 * card or substitution comes up through the scorebug: it wipes across the score and the bug comes back after it.
 */
function Scorebug(p: GraphicProps) {
  const d = p.display;
  const { slim, H, CREST, hang, inset } = bugSize(p);
  const ev = eventOnAir(p);
  // while an event holds the bug's place the bug stays underneath, out of sight; it shows through as the event wipes
  // in and is uncovered as it wipes out
  const covered = ev?.phase === 'hold';
  const box = slim ? 62 : 74; // the letters' box
  const block = (s: Side, i: number) => {
    const tm = team(p, s);
    const away = s === 'away';
    const det = detail(p, s);
    const ink = inkOn(tm.primaryColor);
    return (
      <div style={{ ...RED_CARD_BOX, ...animStyle(p, away ? 'slide-right' : 'slide-left', 120 + i * 60, 360) }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flexDirection: away ? 'row-reverse' : 'row', height: H, [away ? 'paddingRight' : 'paddingLeft']: inset, [away ? 'paddingLeft' : 'paddingRight']: 16, background: blockBg(tm, away ? 'right' : 'left'), color: ink }}>
          <Glint at={away ? 'left' : 'right'} h={slim ? 0.8 : 1} />
          <span style={{ position: 'absolute', top: (H - CREST) / 2, [away ? 'right' : 'left']: -hang, ...animStyle(p, 'zoom', 220 + i * 60, 380) }}><Crest tm={tm} size={CREST} /></span>
          <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: away ? 'flex-end' : 'flex-start', minWidth: box }}>
            <span style={{ fontSize: slim ? 26 : 32, fontWeight: 900, lineHeight: 1, letterSpacing: 0.5 }}>{tm.abbreviation}</span>
            {det ? <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.82, lineHeight: 1.25, letterSpacing: 0.5 }}>{det}</span> : null}
          </span>
          {d.possession === s ? <span style={{ position: 'relative', width: 8, height: 8, borderRadius: 4, background: ink, margin: '0 8px' }} /> : null}
        </div>
        {/* above the team's letters */}
        {covered ? null : <RedCardTab p={p} side={s} from={away ? 'right' : 'left'} x={inset + box / 2} size={slim ? 24 : 28} />}
      </div>
    );
  };
  const plate = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: H, background: PLATE, color: INK, fontSize: slim ? 30 : 36, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1, ...animStyle(p, 'drop', 200, 360) }}>
      {digits(p, 'home', slim ? 24 : 28)}
      <span style={{ width: 2, height: '52%', background: '#C7CAD1' }} />
      {digits(p, 'away', slim ? 24 : 28)}
    </div>
  );
  const clock = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: slim ? H : 32, padding: '0 12px', background: TAB, color: INK, whiteSpace: 'nowrap', ...animStyle(p, 'drop', 300, 340) }}>
      <ClockText p={p} px={22} />
    </div>
  );
  const tab: CSSProperties = { display: 'grid', placeItems: 'center', height: H, padding: '0 12px', fontWeight: 900, ...animStyle(p, 'zoom', 320, 360) };
  const extras = (
    <div style={{ display: 'flex', gap: 6, marginLeft: hang + 8 }}>
      {slim ? clock : null}
      {d.shotClockText ? <div style={{ ...tab, minWidth: 62, background: INK, color: '#FFFFFF', fontSize: 30, fontVariantNumeric: 'tabular-nums' }}>{d.shotClockText}</div> : null}
      {d.shootout ? (
        <div style={{ ...tab, display: 'flex', gap: 8, background: PLATE, color: INK, fontSize: 22 }}>
          <span style={{ fontSize: 12, color: MUTED, letterSpacing: 2 }}>{t(p, 'PENS')}</span>
          <span style={changeStyle(p, 'pens', `${d.shootout.home}-${d.shootout.away}`)}>{d.shootout.home}–{d.shootout.away}</span>
        </div>
      ) : null}
      {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <div style={{ ...tab, background: 'rgba(255,255,255,.96)' }}><SponsorMark p={p} placement="scorebug_logo" height={slim ? 28 : 36} /></div> : null}
    </div>
  );
  const pos = p.data.theme.scorebug?.position ?? 'left';
  return (
    <div style={{ top: SY + (CREST - H) / 2, ...font(p), ...scorebugPosition(p, SX + hang), ...animStyle(p, 'wipe') }} data-graphic="scorebug">
      <div style={{ display: 'grid' }}>
        <div style={{ gridArea: '1 / 1', display: 'grid', gridTemplateColumns: 'auto auto auto auto', alignItems: 'start', filter: SHADOW, visibility: covered ? 'hidden' : undefined }}>
          {block('home', 0)}
          {plate}
          {block('away', 1)}
          {extras}
          {/* centred under the plate, as wide as it needs (a zero-width cell, so the plate keeps its own width) */}
          {!slim ? <div style={{ gridColumn: 2, justifySelf: 'center', width: 0, display: 'flex', justifyContent: 'center' }}>{clock}</div> : null}
        </div>
        {ev ? <div style={{ gridArea: '1 / 1', justifySelf: pos === 'right' ? 'end' : pos === 'centre' ? 'center' : 'start', zIndex: 1, filter: SHADOW }}><EventBody ep={ev} host={p} /></div> : null}
      </div>
      <ScorebugTabs p={p} />
    </div>
  );
}

/** A goal, card or substitution: drawn by the scorebug when it is up; on its own in the scorebug's place when not. */
function EventInBugPlace(p: GraphicProps) {
  if (p.layers?.scoreboard) return null;
  const { CREST, H, hang } = bugSize(p);
  return (
    <div style={{ top: SY + (CREST - H) / 2, ...font(p), ...scorebugPosition(p, SX + hang) }} data-graphic={p.t.key.replace('builtin:', '')}>
      <div style={{ filter: SHADOW }}><EventBody ep={p} host={null} /></div>
    </div>
  );
}

// ------------------------------------------------------------------ boards

/** A team name over two lines ("BRISBANE / ROAR"), split near the middle; one word stays on one line. */
function twoLines(name: string): [string, string | null] {
  const w = name.trim().toUpperCase().split(/\s+/);
  if (w.length < 2) return [w[0] ?? '', null];
  let best = 1;
  let gap = Infinity;
  for (let i = 1; i < w.length; i++) {
    const d = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length);
    if (d < gap) [best, gap] = [i, d];
  }
  return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
}

/** The score on a plate, "2 | 0", each number popping when it changes. */
function ScoreDigits({ p, px, rule }: { p: GraphicProps; px: number; rule: number }) {
  const d = p.display;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: Math.round(px * 0.24), fontSize: px, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
      <span style={changeStyle(p, 'score-home', d.score.home)}>{d.score.home}</span>
      <span style={{ width: px > 80 ? 3 : 2, height: rule, background: '#C7CAD1' }} />
      <span style={changeStyle(p, 'score-away', d.score.away)}>{d.score.away}</span>
    </span>
  );
}

/**
 * The boards' row: each team's block in its colour with the crest breaking out of the end and the name over two
 * lines (a faint crest and the look's slashes behind it), and a white plate between them.
 */
function TeamBlocks({ p, W, H, crest, plate, centre, namePx }: { p: GraphicProps; W: number; H: number; crest: number; plate: number; centre: ReactNode; namePx: number }) {
  const hang = Math.round(crest * 0.29);
  const inset = crest - hang + 26;
  const nameW = (W - plate) / 2 - inset - 40;
  const side = (s: Side, i: number) => {
    const tm = team(p, s);
    const away = s === 'away';
    const fits = (n: string) => twoLines(n).every((l) => !l || p.measure(l, Math.round(namePx * 0.8)) <= nameW);
    const [l1, l2] = twoLines(fits(tm.name) || !tm.shortName ? tm.name : tm.shortName);
    return (
      <div style={{ position: 'relative', flex: 1, ...animStyle(p, away ? 'slide-right' : 'slide-left', 160 + i * 60, 440) }}>
        <div style={{ position: 'relative', overflow: 'hidden', height: H, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: away ? 'flex-end' : 'flex-start', [away ? 'paddingRight' : 'paddingLeft']: inset, background: blockBg(tm, away ? 'right' : 'left'), color: nameInk(tm) }}>
          <Watermark tm={tm} size={Math.round(H * 1.5)} style={{ [away ? 'left' : 'right']: 30, top: '50%', transform: 'translateY(-50%)' }} />
          <Glint at={away ? 'left' : 'right'} h={H / 84} />
          <span style={{ position: 'relative', ...animStyle(p, 'rise', 320 + i * 60, 360) }}><Fitted full={l1} width={nameW} fontPx={namePx} weight={900} measure={p.measure} style={{ lineHeight: 1 }} /></span>
          {l2 ? <span style={{ position: 'relative', ...animStyle(p, 'rise', 380 + i * 60, 360) }}><Fitted full={l2} width={nameW} fontPx={namePx} weight={900} measure={p.measure} style={{ lineHeight: 1 }} /></span> : null}
        </div>
        <span style={{ position: 'absolute', top: (H - crest) / 2, [away ? 'right' : 'left']: -hang, zIndex: 1, ...animStyle(p, 'zoom', 260 + i * 60, 460) }}><Crest tm={tm} size={crest} /></span>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      {side('home', 0)}
      <div style={{ width: plate, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: PLATE, color: INK, ...animStyle(p, 'zoom', 300, 460) }}>{centre}</div>
      {side('away', 1)}
    </div>
  );
}

/**
 * Half time, full time and the other breaks: the same banner as the kick-off, headed by the break ("HALF TIME"), with
 * the competition (or the shoot-out score) in the grey tab under the score.
 */
function BreakScore(p: GraphicProps) {
  const d = p.display;
  const heading = t(p, ((p.cue.variables.label as string) || d.periodLabel).toUpperCase());
  const sub = d.shootout ? `${t(p, 'PENALTIES')} ${d.shootout.home}–${d.shootout.away}` : occasionLine(p.data.match);
  return Banner(p, heading, sub, p.cue.variables.showSponsor !== false ? 'detached_logo' : null);
}

/**
 * The match header: the competition in a tab, the two team blocks with VS on the plate (the score once under way),
 * the ground and kick-off time (or the break) in a grey strip, and the countdown to kick-off or the restart.
 */
function Ident(p: GraphicProps) {
  const info = identInfo(p);
  const comp = p.data.match;
  const W = 1400;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', top: 300, width: W, ...font(p), ...animStyle(p, 'slide-up') }} data-graphic="ident">
      <TitleTab p={p} text={<span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>{badgeUrl(p) ? <span style={{ display: 'grid', placeItems: 'center', height: 40, padding: '0 6px', background: 'rgba(255,255,255,.96)' }}><ThemeBadge p={p} height={32} /></span> : null}{occasionLine(comp)}</span>} width={640} delayMs={60} />
      <div style={{ filter: SHADOW }}>
        <TeamBlocks p={p} W={W} H={176} crest={232} plate={300} namePx={54} centre={info.started ? <ScoreDigits p={p} px={104} rule={80} /> : <span style={{ fontSize: 64, fontWeight: 900, letterSpacing: 2, ...animStyle(p, 'zoom', 420, 400) }}>{info.centre}</span>} />
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ minWidth: 520, padding: '12px 30px', background: TAB, color: INK, textAlign: 'center', fontSize: info.started ? 24 : 21, fontWeight: info.started ? 900 : 700, letterSpacing: info.started ? 4 : 1, textTransform: 'uppercase', ...animStyle(p, 'drop', 460, 360) }}>{info.line}</div>
        </div>
      </div>
      {info.countdown ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', marginTop: 22, filter: SHADOW, ...animStyle(p, 'zoom', 560, 420) }}>
          <span style={{ display: 'grid', placeItems: 'center', padding: '0 20px', background: p.data.theme.primary, color: inkOn(p.data.theme.primary), fontSize: 18, fontWeight: 900, letterSpacing: 3 }}>{info.countdown.label}</span>
          <span style={{ padding: '6px 22px', background: PLATE, color: INK, fontSize: 52, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{info.countdown.text}</span>
        </div>
      ) : null}
      {info.message ? <div style={{ marginTop: 26, textAlign: 'center', color: '#FFFFFF', fontSize: 46, fontWeight: 900, letterSpacing: 3, textTransform: 'uppercase', textShadow: '0 4px 18px rgba(0,0,0,.55)', ...animStyle(p, 'rise', 620, 380) }}>{info.message}</div> : null}
      {p.creative('detached_logo', p.cue) ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}><span style={{ background: 'rgba(255,255,255,.96)', padding: '8px 18px', ...animStyle(p, 'fade', 640, 300) }}><SponsorMark p={p} placement="detached_logo" height={50} /></span></div> : null}
    </div>
  );
}

/** The kick-off and period banner: the heading in a tab over a small board of the two teams and the score. */
function PeriodBanner(p: GraphicProps) {
  const { heading, period } = periodBanner(p);
  return Banner(p, t(p, heading), period, 'lower_third_banner');
}

/** The banner the kick-off and the breaks share: the heading in a slanted tab, the two teams with the score, a grey tab. */
function Banner(p: GraphicProps, heading: string, period: string, sponsor: string | null) {
  const H = 84;
  const CREST = 112;
  const hang = 40;
  const inset = CREST - hang + 18;
  const side = (s: Side, i: number) => {
    const tm = team(p, s);
    const away = s === 'away';
    return (
      <div style={{ position: 'relative', flex: 1, ...animStyle(p, away ? 'slide-right' : 'slide-left', 180 + i * 60, 400) }}>
        <div style={{ position: 'relative', overflow: 'hidden', height: H, display: 'flex', alignItems: 'center', justifyContent: away ? 'flex-end' : 'flex-start', [away ? 'paddingRight' : 'paddingLeft']: inset, background: blockBg(tm, away ? 'right' : 'left'), color: nameInk(tm) }}>
          <Glint at={away ? 'left' : 'right'} h={1.4} />
          <span style={{ position: 'relative' }}><Fitted full={(tm.shortName || tm.name).toUpperCase()} width={300} fontPx={40} weight={900} measure={p.measure} /></span>
        </div>
        <span style={{ position: 'absolute', top: (H - CREST) / 2, [away ? 'right' : 'left']: -hang, ...animStyle(p, 'zoom', 260 + i * 60, 420) }}><Crest tm={tm} size={CREST} /></span>
      </div>
    );
  };
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', bottom: SY + 50, width: 1100, ...font(p), ...animStyle(p, 'slide-up') }} data-graphic={p.t.key.replace('builtin:', '')}>
      <TitleTab p={p} text={heading} width={380} />
      <div style={{ display: 'flex', alignItems: 'stretch', filter: SHADOW }}>
        {side('home', 0)}
        <div style={{ width: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: PLATE, color: INK, ...animStyle(p, 'zoom', 300, 420) }}>
          <ScoreDigits p={p} px={50} rule={36} />
        </div>
        {side('away', 1)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span style={{ padding: '6px 22px', background: TAB, color: INK, fontSize: 16, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', ...animStyle(p, 'drop', 380, 320) }}>{period}</span>
      </div>
      {sponsor && p.creative(sponsor, p.cue) ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}><span style={{ background: 'rgba(255,255,255,.96)', padding: '6px 16px', ...animStyle(p, 'fade', 480, 300) }}><SponsorMark p={p} placement={sponsor} height={36} /></span></div> : null}
    </div>
  );
}

/** Up to eight rows (the template's own choice, or the sport's first eight) with both teams' values. */
function statRows8(p: GraphicProps) {
  const keys = typeof p.cue.variables.rows === 'string' && p.cue.variables.rows ? (p.cue.variables.rows as string).split(',').map((s) => s.trim()) : null;
  const rows = keys ? p.data.match.statRows.filter((r) => keys.includes(r.key)) : p.data.match.statRows.slice(0, 8);
  const st = p.data.match.projection.stats;
  return rows.slice(0, 8).map((r) => ({ ...r, home: st.home?.[r.key], away: st.away?.[r.key] }));
}

/**
 * The statistics board, filling the screen: each team's panel in its colour down the side (its crest, its score in a
 * box and its scorers inside a ruled frame, its name running up the edge), and between them, on light grey, the
 * competition's badge, "HALF TIME STATS" and a row per statistic with both values and a bar split in the teams'
 * colours.
 */
function Stats(p: GraphicProps) {
  const d = p.display;
  const rows = statRows8(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  const pl = d.periodLabel.toUpperCase();
  const heavy = /HALF TIME|FULL TIME|BREAK|INTERVAL|TIME OUT/.test(pl) ? t(p, pl) : t(p, 'MATCH');
  const PANEL = 470;
  const panel = (s: Side) => {
    const tm = team(p, s);
    const away = s === 'away';
    const ink = inkOn(tm.primaryColor);
    const xs = scorersOf(p, s).slice(0, 5);
    return (
      <div style={{ position: 'relative', overflow: 'hidden', width: PANEL, background: `linear-gradient(180deg, ${mix(tm.primaryColor, '#ffffff', 0.06)} 0%, ${tm.primaryColor} 45%, ${mix(tm.primaryColor, '#000000', 0.16)} 100%)`, color: ink, ...animStyle(p, away ? 'slide-right' : 'slide-left', 0, 480) }}>
        <div style={{ position: 'absolute', top: 54, bottom: 54, [away ? 'left' : 'right']: 34, [away ? 'right' : 'left']: 104, border: `2px solid ${alpha(ink, 0.32)}`, borderRadius: 22, ...animStyle(p, 'fade', 260, 420) }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, [away ? 'right' : 'left']: 40, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', ...animStyle(p, 'fade', 360, 420) }}>
          <span style={{ writingMode: 'vertical-rl', transform: away ? undefined : 'rotate(180deg)', whiteSpace: 'nowrap', fontSize: 20, fontWeight: 700, letterSpacing: 12, opacity: 0.75 }}>{(tm.name.length > 24 && tm.shortName ? tm.shortName : tm.name).toUpperCase()}</span>
        </div>
        <div style={{ position: 'absolute', top: 54, bottom: 54, [away ? 'left' : 'right']: 34, [away ? 'right' : 'left']: 104, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 70 }}>
          <span style={animStyle(p, 'zoom', 220, 480)}><Crest tm={tm} size={230} /></span>
          <div style={{ marginTop: 70, width: 184, height: 184, display: 'grid', placeItems: 'center', border: `3px solid ${alpha(ink, 0.85)}`, background: alpha(ink === '#FFFFFF' ? '#FFFFFF' : INK, 0.08), fontSize: 140, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'zoom', 360, 460) }}>
            <span style={changeStyle(p, `score-${s}`, d.score[s])}>{d.score[s]}</span>
          </div>
          <div style={{ marginTop: 50, display: 'grid', gap: 12 }}>
            {xs.map((x, i) => (
              <div key={x.id} style={stagger(p, i, 'rise', 560, 70)}>
                <ScorerLine p={p} x={x} s={s} colour={ink} muted={alpha(ink, 0.8)} px={22} width={200} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };
  const bar = (r: (typeof rows)[number], i: number) => {
    const hv = Number(r.home ?? 0);
    const av = Number(r.away ?? 0);
    const tot = hv + av;
    const share = tot ? hv / tot : 0.5;
    const grow = (from: 'left' | 'right'): CSSProperties => ({ transformOrigin: from, ...animStyle(p, 'grow-x', 420 + i * 70, 460) });
    return (
      <div style={{ display: 'flex', height: 16, gap: 4, marginTop: 8 }}>
        {tot ? (
          <>
            <span style={{ width: `calc(${share * 100}% - 2px)`, background: `linear-gradient(180deg, ${mix(h.primaryColor, '#ffffff', 0.12)}, ${h.primaryColor})`, ...grow('left') }} />
            <span style={{ flex: 1, background: `linear-gradient(180deg, ${mix(a.primaryColor, '#ffffff', 0.12)}, ${a.primaryColor})`, ...grow('right') }} />
          </>
        ) : <span style={{ flex: 1, background: '#D6D8DE' }} />}
      </div>
    );
  };
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', ...font(p), ...animStyle(p, 'fade', 0, 360) }} data-graphic="stats">
      {panel('home')}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 100px 0', background: '#F1F2F4', color: INK, ...animStyle(p, 'fade', 120, 420) }}>
        <div style={{ height: 62, display: 'flex', alignItems: 'center', ...animStyle(p, 'fade', 240, 380) }}>
          {badgeUrl(p) ? <ThemeBadge p={p} height={60} /> : <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: 2, color: '#8C909B' }}>{(p.data.match.competition.shortName || p.data.match.competition.name).toUpperCase()}</span>}
        </div>
        <div style={{ marginTop: 18, fontSize: 72, lineHeight: 1, whiteSpace: 'nowrap', ...animStyle(p, 'rise', 300, 420) }}>
          <b style={{ fontWeight: 900 }}>{heavy}</b> <span style={{ fontWeight: 500 }}>{t(p, 'STATS')}</span>
        </div>
        <div style={{ alignSelf: 'stretch', marginTop: 48, display: 'grid', gap: 16 }}>
          {rows.map((r, i) => (
            <div key={r.key} style={stagger(p, i, 'rise', 380, 70)}>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 130px', alignItems: 'baseline', fontWeight: 900 }}>
                <span style={{ fontSize: 34, fontVariantNumeric: 'tabular-nums' }}><span style={changeStyle(p, `h-${r.key}`, r.home)}>{r.home == null ? '—' : String(r.home)}</span>{r.unit ?? ''}</span>
                <span style={{ textAlign: 'center', fontSize: 27, fontWeight: 800, letterSpacing: 0.5 }}>{r.label.toUpperCase()}</span>
                <span style={{ textAlign: 'right', fontSize: 34, fontVariantNumeric: 'tabular-nums' }}><span style={changeStyle(p, `a-${r.key}`, r.away)}>{r.away == null ? '—' : String(r.away)}</span>{r.unit ?? ''}</span>
              </div>
              {bar(r, i)}
            </div>
          ))}
          {!rows.length ? <div style={{ textAlign: 'center', color: MUTED, fontSize: 28 }}>{t(p, 'No statistics recorded yet')}</div> : null}
        </div>
        {p.creative('detached_logo', p.cue) ? <div style={{ marginTop: 'auto', paddingBottom: 34, ...animStyle(p, 'fade', 600, 300) }}><SponsorMark p={p} placement="detached_logo" height={44} /></div> : null}
      </div>
      {panel('away')}
    </div>
  );
}

/** The broadcast pack engine draws the rest: white panels, title bars in the look's colour, team-colour rules. */
const DERBY_PACK: Pack = { key: 'derby', surface: 'paper', texture: 'none', corner: 'square', gap: 0, caps: true, italic: false, weight: 800, title: 'bar', rule: 'team', scorebug: 'row', brandTab: false, plate: 'deep', kicker: 'side', kickerColour: 'team', crest: 'plain', versus: 'badge', mark: 'slash', enter: 'wipe', shine: false, backdrop: 'glow' };

export const derbyTheme: ThemeComponents = {
  ...packTheme(DERBY_PACK),
  scorebug: Scorebug,
  goal: EventInBugPlace,
  score: EventInBugPlace,
  card: EventInBugPlace,
  substitution: EventInBugPlace,
  break_score: BreakScore,
  ident: Ident,
  period_banner: PeriodBanner,
  stats: Stats,
};
