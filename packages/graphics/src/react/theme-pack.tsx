'use client';
// Broadcast packs: six more built-in looks drawn by one engine, each in the style of a different kind of broadcast.
//   Liga         Spanish top flight: white rounded cards, coral red, wide geometric type, a pill scorebug
//   Major        North American streaming: smoked glass, events in the scoring team's colour, clean type
//   Southern     Australian league: flat black, chunky capitals, square blocks and a four-colour band
//   Continental  European club nights: deep navy, a starfield, silver hairlines, light wide-tracked capitals
//   Primetime    US network: brushed metal, red, condensed italic capitals, a stacked scorebug
//   Meister      German top flight: white panels, red, slanted cuts and italic capitals
// A look is a `Pack`: what panels are made of, their corners and texture, how titles, scores and event words are
// shown, how things arrive and what the animated background draws. Every look is an original design in that
// spirit and carries no league or broadcaster marks, names or typefaces.
import type { CSSProperties, ReactNode } from 'react';
import { occasionLine, type RenderTeam } from '../data';
import { animStyle, changeStyle, stagger, type AnimKind, type GraphicProps, type ThemeComponents } from './stage';
import { FullFrameMedia, Fitted, Logo, Photo, SponsorMark, ThemeBadge, badgeUrl, cardStyle, clockLabel, eventWord, identInfo, minute, periodBanner, personOrTeam, player, scorebugPosition, slateMessage, statRows, stoppageLabel, t, team, tickerText, tickerSpeed, ScorebugTabs, RedCard } from './common';
import { PresentedBy, sharedGraphics, type Chrome } from './shared-graphics';
import { lineupPage } from './theme-broadcast';

export interface Pack {
  key: string;
  /** what panels are made of */
  surface: 'paper' | 'smoke' | 'flat' | 'navy' | 'metal';
  /** pattern inside panels */
  texture: 'arcs' | 'stars' | 'stripes' | 'brushed' | 'slashes' | 'none';
  /** round: the theme's corner radius; square: the same, kept small; slant: both ends cut on one slant */
  corner: 'round' | 'square' | 'slant';
  /** space between neighbouring pieces */
  gap: number;
  /** names in capitals */
  caps: boolean;
  italic: boolean;
  /** weight of names and headings */
  weight: number;
  /** how a full-frame board shows its title */
  title: 'bar' | 'tab' | 'eyebrow' | 'block' | 'centre';
  /** the line along the bottom of panels ('team': the team's colour, on team graphics only) */
  rule: 'hot' | 'spectrum' | 'silver' | 'team' | 'none';
  scorebug: 'row' | 'pill' | 'stacked' | 'blocks';
  /** a small brand tab at the start of the scorebug (the organisation's logo, or the look's mark) */
  brandTab: boolean;
  /** what the score sits on */
  plate: 'deep' | 'paper' | 'hot' | 'glow' | 'clear';
  /** event word beside the panel, or as a tab above it */
  kicker: 'side' | 'tab';
  /** event word colour: the look's hot colour, or the scoring team's colour */
  kickerColour: 'hot' | 'team';
  crest: 'plain' | 'ring' | 'glow';
  /** the "v" between teams */
  versus: 'badge' | 'quiet' | 'ring';
  mark: 'dot' | 'quad' | 'star' | 'bars' | 'slash';
  /** how boards and bars arrive */
  enter: AnimKind;
  /** a light sweep across panels as they land */
  shine: boolean;
  backdrop: 'arcs' | 'glow' | 'spectrum' | 'stars' | 'slashes' | 'shards';
}

const SX = 96; // 5% title-safe
const SY = 54;
const SLANT = 16;
const SILVER = '#C9D3E8';
/** Which graphics show a player photo beside the team badge when one is on file. */
const PHOTO_EVENTS = ['builtin:goal', 'builtin:card', 'builtin:player_of_match'];
const ON_GREEN = '#2BD96B';

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
/** White, or the given dark ink, whichever reads on the colour. */
function inkOn(hex: string, dark: string): string {
  const c = rgb(hex);
  if (!c) return '#ffffff';
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150 ? dark : '#ffffff';
}

/** A fixed scatter of stars for the starfield texture and background (same on every render). */
const STARS: [number, number, number][] = (() => {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 70 }, () => [r() * 200, r() * 100, 0.25 + r() * 0.6] as [number, number, number]);
})();

/** Colours and type of one look for one render. `on` is text on the look's panels; `hi` highlights on them. */
function look(p: GraphicProps, k: Pack) {
  const th = p.data.theme;
  const deep = th.secondary;
  const hot = th.primary;
  const electric = th.accent;
  const light = k.surface === 'paper';
  const on = light ? th.text : inkOn(deep, '#111114');
  return {
    k,
    deep,
    hot,
    electric,
    paper: th.panel,
    ink: th.text,
    font: th.font,
    radius: k.corner === 'slant' ? 0 : th.radius,
    light,
    on,
    hi: light ? hot : electric,
    muted: alpha(on, 0.64),
    rule: alpha(on, 0.14),
    spectrum: [hot, '#FF8A00', '#C8FF00', electric],
  };
}
type L = ReturnType<typeof look>;

const root = (c: L): CSSProperties => ({ fontFamily: c.font, fontStyle: c.k.italic ? 'italic' : undefined });
const caps = (spacing = 1.5): CSSProperties => ({ textTransform: 'uppercase', letterSpacing: spacing });
/** A name as the look sets it (capitals or as written); `upShort` keeps a missing short name missing. */
const up = (c: L, s: string) => (c.k.caps ? s.toUpperCase() : s);
const upShort = (c: L, s: string | null | undefined) => (s ? up(c, s) : s);
/** Margin that joins a piece to the one before it: a gap, or an overlap so slanted ends sit side by side. */
const join = (c: L, gap = c.k.gap): CSSProperties => ({ marginLeft: c.k.corner === 'slant' ? gap - SLANT : gap });
const pad = (c: L, x: number) => (c.k.corner === 'slant' ? x + SLANT : x);

function surface(c: L): { style: CSSProperties; inset?: string } {
  switch (c.k.surface) {
    case 'paper':
      return { style: { background: c.paper, color: c.ink } };
    case 'smoke':
      return { style: { background: alpha(c.deep, 0.86), color: c.on }, inset: `inset 0 0 0 1px ${alpha('#ffffff', 0.12)}` };
    case 'flat':
      return { style: { background: c.deep, color: c.on } };
    case 'navy':
      return { style: { background: `linear-gradient(160deg, ${mix(c.deep, c.hot, 0.32)} 0%, ${c.deep} 60%, ${mix(c.deep, '#000000', 0.3)} 100%)`, color: c.on }, inset: `inset 0 0 0 1px ${alpha(SILVER, 0.32)}` };
    case 'metal':
      return { style: { background: `linear-gradient(180deg, ${mix(c.deep, '#ffffff', 0.2)} 0%, ${c.deep} 46%, ${mix(c.deep, '#000000', 0.38)} 100%)`, color: c.on }, inset: `inset 0 1px 0 ${alpha('#ffffff', 0.3)}` };
  }
}

/** Corners of a piece. Slanted looks cut one or both ends; the rest round every corner by the theme radius. */
function shape(c: L, ends: 'both' | 'left' | 'right' | 'none' = 'both', radius = c.radius): CSSProperties {
  if (c.k.corner !== 'slant') return { borderRadius: radius };
  if (ends === 'none') return {};
  const l = ends === 'both' || ends === 'left' ? `${SLANT}px` : '0px';
  const r = ends === 'both' || ends === 'right' ? `calc(100% - ${SLANT}px)` : '100%';
  return { clipPath: `polygon(${l} 0, 100% 0, ${r} 100%, 0 100%)` };
}

/** The pattern inside a panel. */
function Texture({ c, strength = 1 }: { c: L; strength?: number }) {
  const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' };
  const tint = c.light ? c.hot : '#ffffff';
  switch (c.k.texture) {
    case 'none':
      return null;
    case 'brushed':
      return <span aria-hidden style={{ ...fill, background: `repeating-linear-gradient(100deg, transparent 0 5px, ${alpha('#ffffff', 0.03 * strength)} 5px 6px)` }} />;
    case 'stripes':
      return <span aria-hidden style={{ ...fill, background: `repeating-linear-gradient(135deg, transparent 0 22px, ${alpha(tint, 0.045 * strength)} 22px 34px)` }} />;
    case 'slashes':
      return (
        <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" style={fill}>
          <polygon points="80,0 88,0 72,100 64,100" fill={alpha(c.hot, 0.1 * strength)} />
          <polygon points="92,0 95,0 79,100 76,100" fill={alpha(c.hot, 0.07 * strength)} />
        </svg>
      );
    case 'arcs':
      return (
        <svg aria-hidden viewBox="0 0 200 100" preserveAspectRatio="xMaxYMid slice" style={fill}>
          <circle cx="205" cy="50" r="72" fill="none" stroke={alpha(tint, 0.08 * strength)} strokeWidth="16" />
          <circle cx="205" cy="50" r="42" fill="none" stroke={alpha(tint, 0.05 * strength)} strokeWidth="7" />
        </svg>
      );
    case 'stars':
      return (
        <svg aria-hidden viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" style={fill}>
          {STARS.slice(0, 40).map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r * 0.7} fill="#ffffff" opacity={(0.12 + (i % 4) * 0.08) * strength} />)}
        </svg>
      );
  }
}

/** The line along the bottom of a panel. */
function Rule({ p, c, height = 4, delayMs = 280, teamColour, top = false }: { p: GraphicProps; c: L; height?: number; delayMs?: number; teamColour?: string; top?: boolean }) {
  const k = c.k.rule;
  if (k === 'none' || (k === 'team' && !teamColour)) return null;
  const [a, b, d, e] = c.spectrum as [string, string, string, string];
  const bg =
    k === 'hot' ? c.hot
    : k === 'team' ? teamColour!
    : k === 'silver' ? `linear-gradient(90deg, ${alpha(SILVER, 0)}, ${SILVER} 30%, ${SILVER} 70%, ${alpha(SILVER, 0)})`
    : `linear-gradient(90deg, ${a} 0 25%, ${b} 25% 50%, ${d} 50% 75%, ${e} 75% 100%)`;
  return <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: k === 'silver' ? Math.min(height, 2) : height, background: bg, transformOrigin: 'left', ...animStyle(p, 'grow-x', delayMs, 420) }} />;
}

/** One light sweep across a panel as it lands. */
function Shine({ p, c, delayMs = 300 }: { p: GraphicProps; c: L; delayMs?: number }) {
  if (!c.k.shine || p.phase === 'out') return null;
  const a = animStyle(p, 'shine', delayMs, 900);
  if (!a.animationName) return null;
  return <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '35%', background: `linear-gradient(90deg, transparent, ${c.light ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.28)'}, transparent)`, opacity: 0, pointerEvents: 'none', ...a }} />;
}

/** A panel of the look's surface with its texture behind the content. */
function Panel({ c, children, style, inner, ends = 'both', texture = true, radius }: { c: L; children: ReactNode; style?: CSSProperties; inner?: CSSProperties; ends?: 'both' | 'left' | 'right' | 'none'; texture?: boolean; radius?: number | string }) {
  const s = surface(c);
  const slant = c.k.corner === 'slant';
  const drop = slant ? undefined : c.light ? '0 14px 36px rgba(0,0,0,.28)' : '0 16px 44px rgba(0,0,0,.4)';
  return (
    <div style={{ position: 'relative', overflow: 'hidden', ...root(c), ...s.style, boxShadow: [s.inset, drop].filter(Boolean).join(', ') || undefined, ...shape(c, ends), ...(radius != null && !slant ? { borderRadius: radius } : {}), ...style }}>
      {texture ? <Texture c={c} /> : null}
      <div style={{ position: 'relative', height: '100%', ...inner }}>{children}</div>
    </div>
  );
}
/** Slanted looks cast their shadow from the whole group (clip-path would cut a box shadow off). */
const groupShadow = (c: L): CSSProperties => (c.k.corner === 'slant' ? { filter: 'drop-shadow(0 12px 26px rgba(0,0,0,.4))' } : {});

/** The look's own mark for a brand tab when the organisation has no logo. */
function Mark({ c, size }: { c: L; size: number }) {
  const on = inkOn(c.hot, c.deep);
  switch (c.k.mark) {
    case 'star':
      return <svg aria-hidden viewBox="0 0 40 40" width={size} height={size}><polygon points="20,4 24.5,15 36,15.5 27,23 30,34.5 20,28 10,34.5 13,23 4,15.5 15.5,15" fill={on} /></svg>;
    case 'quad':
      return (
        <svg aria-hidden viewBox="0 0 40 40" width={size} height={size}>
          {c.spectrum.map((col, i) => <rect key={i} x={6 + (i % 2) * 15} y={6 + Math.floor(i / 2) * 15} width={13} height={13} fill={col} />)}
        </svg>
      );
    case 'slash':
      return <svg aria-hidden viewBox="0 0 40 40" width={size} height={size}><polygon points="10,34 22,6 30,6 18,34" fill={on} /></svg>;
    case 'bars':
      return <svg aria-hidden viewBox="0 0 40 40" width={size} height={size}><polygon points="5,34 19,6 26,6 12,34" fill={on} /><polygon points="16,34 30,6 37,6 23,34" fill={c.electric} /></svg>;
    case 'dot':
      return <svg aria-hidden viewBox="0 0 40 40" width={size} height={size}><circle cx="20" cy="20" r="11" fill={on} /></svg>;
  }
}

/** What a score or a key number sits on. */
function plate(c: L, extra?: CSSProperties): CSSProperties {
  const base: CSSProperties = { fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1, borderRadius: c.k.corner === 'round' ? Math.max(6, c.radius - 6) : c.radius };
  switch (c.k.plate) {
    case 'deep':
      return { ...base, background: c.deep, color: inkOn(c.deep, '#111114'), ...extra };
    case 'paper':
      return { ...base, background: c.paper, color: c.ink, ...extra };
    case 'hot':
      return { ...base, background: c.hot, color: inkOn(c.hot, c.deep), ...extra };
    case 'glow':
      return { ...base, background: `linear-gradient(180deg, ${mix(c.hot, '#ffffff', 0.18)}, ${c.hot})`, color: inkOn(c.hot, c.deep), boxShadow: `0 0 22px ${alpha(c.hot, 0.6)}`, ...extra };
    case 'clear':
      return { ...base, background: 'transparent', color: c.on, ...extra };
  }
}

function Crest({ c, tm, size }: { c: L; tm: RenderTeam; size: number }) {
  const logo = <Logo url={tm.logoUrl} label={tm.abbreviation} size={size} color={tm.primaryColor} radius={c.k.corner === 'round' ? Math.round(size * 0.16) : 2} />;
  if (c.k.crest === 'glow')
    return <span style={{ display: 'grid', placeItems: 'center', width: Math.round(size * 1.7), height: Math.round(size * 1.7), margin: Math.round(size * -0.1), borderRadius: '50%', background: `radial-gradient(closest-side, ${alpha(tm.primaryColor, 0.7)} 0%, ${alpha(tm.primaryColor, 0.25)} 62%, transparent 100%)` }}>{logo}</span>;
  if (c.k.crest === 'ring')
    return <span style={{ display: 'grid', placeItems: 'center', width: size + 34, height: size + 34, borderRadius: '50%', boxShadow: `inset 0 0 0 2px ${alpha(SILVER, 0.75)}, 0 0 34px ${alpha(c.hot, 0.4)}` }}>{logo}</span>;
  return logo;
}

/** A sponsor's logo, on a white plate when the panel is dark. Nothing when there is no sponsor. */
function SponsorPlate({ p, c, placement, height, delayMs = 560 }: { p: GraphicProps; c: L; placement: string; height: number; delayMs?: number }) {
  if (!p.creative(placement, p.cue)) return null;
  return (
    <span style={{ display: 'inline-grid', placeItems: 'center', ...(c.light ? {} : { background: 'rgba(255,255,255,.96)', padding: '6px 16px', borderRadius: Math.max(4, c.radius / 2) }), ...animStyle(p, 'fade', delayMs, 300) }}>
      <SponsorMark p={p} placement={placement} height={height} />
    </span>
  );
}

export function packTheme(k: Pack): ThemeComponents {
  const brand = (p: GraphicProps, c: L, H: number) => (badgeUrl(p) ? <ThemeBadge p={p} height={H - 18} /> : <Mark c={c} size={H - 22} />);

  /** Stoppage time, shot clock, shoot-out and the scorebug sponsor: small pieces after the clock. */
  const extras = (p: GraphicProps, c: L, H: number, slim: boolean) => {
    const d = p.display;
    const tab: CSSProperties = { display: 'grid', placeItems: 'center', fontWeight: 800, ...join(c, 6), ...shape(c) };
    const stoppage = changeStyle(p, 'stoppage', !!d.stoppageText, 'flip'); // evaluated every render so the appearance itself animates
    return (
      <>
        {d.stoppageText ? <div style={{ ...tab, padding: `0 ${pad(c, 12)}px`, background: c.electric, color: inkOn(c.electric, c.deep), fontSize: slim ? 20 : 24, ...animStyle(p, 'zoom', 320, 360) }}><span style={stoppage}>{stoppageLabel(p)}</span></div> : null}
        {d.shotClockText ? <div style={{ ...tab, minWidth: 66, padding: `0 ${pad(c, 8)}px`, background: c.hot, color: inkOn(c.hot, c.deep), fontSize: 32, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'zoom', 300, 360) }}>{d.shotClockText}</div> : null}
        {d.shootout ? (
          <div style={{ ...join(c, 6), ...animStyle(p, 'zoom', 300, 360) }}>
            <Panel c={c} texture={false} style={{ height: '100%' }} inner={{ display: 'flex', alignItems: 'center', gap: 8, padding: `0 ${pad(c, 14)}px`, fontSize: 20, fontWeight: 700 }}>
              <span style={{ color: c.hi, fontSize: 13, ...caps(2) }}>{t(p, 'PENS')}</span>
              <span style={changeStyle(p, 'pens', `${d.shootout.home}-${d.shootout.away}`)}>{d.shootout.home}–{d.shootout.away}</span>
            </Panel>
          </div>
        ) : null}
        {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <div style={{ ...tab, padding: `0 ${pad(c, 12)}px`, background: 'rgba(255,255,255,.96)', ...animStyle(p, 'zoom', 340, 380) }}><SponsorMark p={p} placement="scorebug_logo" height={slim ? 30 : Math.min(40, H - 16)} /></div> : null}
      </>
    );
  };

  const digits = (p: GraphicProps, s: 'home' | 'away', min = 30) => (
    <span style={{ minWidth: min, textAlign: 'center' }}>
      <span style={changeStyle(p, `score-${s}`, p.display.score[s])}>{p.display.score[s]}</span>
    </span>
  );
  const detail = (p: GraphicProps, s: 'home' | 'away') => {
    const d = p.display;
    const det = d.scoreDetail?.[s]?.split(' ')[0];
    const fouls = d.fouls ? `F ${d.fouls[s]}${d.bonus?.[s] ? ' ◆' : ''}` : null;
    return det || fouls ? [det, fouls].filter(Boolean).join(' · ') : null;
  };

  /** Row scorebug: [brand] HOME [2 | 1] AWAY · clock. */
  const RowBug = (p: GraphicProps, c: L, slim: boolean) => {
    const d = p.display;
    const H = slim ? 46 : 56;
    const cell = (s: 'home' | 'away', i: number) => {
      const tm = team(p, s);
      const away = s === 'away';
      const det = detail(p, s);
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: away ? `0 ${pad(c, 16)}px 0 12px` : `0 12px 0 ${pad(c, 16)}px`, flexDirection: away ? 'row-reverse' : 'row', ...animStyle(p, away ? 'slide-right' : 'slide-left', 140 + i * 60, 360) }}>
          <span style={{ width: 6, height: H - 24, borderRadius: c.k.corner === 'round' ? 3 : 0, background: tm.primaryColor, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 120 + i * 60, 300) }} />
          {!slim ? <Logo url={tm.logoUrl} label={tm.abbreviation} size={30} color={tm.primaryColor} radius={c.k.corner === 'round' ? 6 : 2} /> : null}
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: away ? 'flex-end' : 'flex-start', minWidth: 58 }}>
            <span style={{ fontSize: slim ? 22 : 25, fontWeight: Math.max(700, k.weight), lineHeight: 1, letterSpacing: 1 }}>{tm.abbreviation}</span>
            {det ? <span style={{ fontSize: 12, color: c.muted, letterSpacing: 1, lineHeight: 1.25 }}>{det}</span> : null}
          </span>
          <RedCard p={p} side={s} size={slim ? 22 : 26} />
          {d.possession === s ? <span style={{ width: 8, height: 8, borderRadius: 4, background: c.hi }} /> : null}
        </div>
      );
    };
    return (
      <>
        {k.brandTab ? <div style={{ display: 'grid', placeItems: 'center', minWidth: H, padding: `0 ${pad(c, badgeUrl(p) ? 8 : 0)}px`, background: `linear-gradient(135deg, ${c.hot}, ${mix(c.hot, c.deep, 0.4)})`, transformOrigin: 'top', ...shape(c, c.k.corner === 'slant' ? 'right' : 'both'), ...animStyle(p, 'grow-y', 0, 320) }}>{brand(p, c, H)}</div> : null}
        <div style={k.brandTab ? join(c, 4) : undefined}>
          <Panel c={c} texture={false} style={{ height: '100%' }} inner={{ display: 'flex', alignItems: 'stretch' }}>
            {cell('home', 0)}
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '7px 0', padding: '0 8px', fontSize: slim ? 26 : 30, ...plate(c), ...animStyle(p, 'drop', 220, 380) }}>
              {digits(p, 'home', 28)}
              <span style={{ width: 2, height: '50%', background: k.plate === 'clear' ? c.rule : alpha(plate(c).color as string, 0.25) }} />
              {digits(p, 'away', 28)}
            </span>
            {cell('away', 1)}
            <Rule p={p} c={c} height={3} delayMs={260} />
            <Shine p={p} c={c} delayMs={380} />
          </Panel>
        </div>
        <div style={{ ...join(c, 6), ...animStyle(p, 'drop', 280, 380) }}>
          <Panel c={c} texture={false} style={{ height: '100%' }} inner={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: `0 ${pad(c, 16)}px`, minWidth: 100 }}>
            <span style={{ fontSize: slim ? 22 : 27, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{clockLabel(p)}</span>
            <span style={{ fontSize: 11, color: c.hi, fontWeight: 700, lineHeight: 1.3, ...caps(2), ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
          </Panel>
        </div>
      </>
    );
  };

  /** Pill scorebug: one rounded pill, crest · HOME [2 – 1] AWAY · crest, then the clock in a hot pill. */
  const PillBug = (p: GraphicProps, c: L, slim: boolean) => {
    const d = p.display;
    const H = slim ? 46 : 56;
    const side = (s: 'home' | 'away', i: number) => {
      const tm = team(p, s);
      const det = detail(p, s);
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: s === 'away' ? 'row-reverse' : 'row', ...animStyle(p, s === 'away' ? 'slide-right' : 'slide-left', 140 + i * 60, 360) }}>
          <Logo url={tm.logoUrl} label={tm.abbreviation} size={H - 18} color={tm.primaryColor} radius={(H - 18) / 2} />
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: s === 'away' ? 'flex-end' : 'flex-start' }}>
            <span style={{ fontSize: slim ? 21 : 24, fontWeight: Math.max(700, k.weight), lineHeight: 1 }}>{tm.abbreviation}</span>
            {det ? <span style={{ fontSize: 12, color: c.muted, lineHeight: 1.25 }}>{det}</span> : null}
          </span>
          <RedCard p={p} side={s} size={slim ? 22 : 26} />
          {d.possession === s ? <span style={{ width: 8, height: 8, borderRadius: 4, background: c.hot }} /> : null}
        </span>
      );
    };
    return (
      <>
        <Panel c={c} texture={false} radius={H / 2} style={{ height: '100%' }} inner={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 9px' }}>
          {side('home', 0)}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: slim ? 24 : 28, ...plate(c, { borderRadius: 999 }), ...animStyle(p, 'zoom', 220, 380) }}>
            {digits(p, 'home', 20)}
            <span style={{ opacity: 0.5 }}>–</span>
            {digits(p, 'away', 20)}
          </span>
          {side('away', 1)}
          <Shine p={p} c={c} delayMs={380} />
        </Panel>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minWidth: 96, padding: '0 16px', marginLeft: 8, borderRadius: H / 2, background: c.hot, color: inkOn(c.hot, c.deep), ...root(c), ...animStyle(p, 'zoom', 280, 380) }}>
          <span style={{ fontSize: slim ? 21 : 25, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{clockLabel(p)}</span>
          <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.3, opacity: 0.85, ...caps(2), ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
        </div>
      </>
    );
  };

  /** Stacked scorebug: two team rows with scores on plates, the clock in a hot block beside them. */
  const StackedBug = (p: GraphicProps, c: L, slim: boolean) => {
    const d = p.display;
    const R = slim ? 32 : 38;
    const row = (s: 'home' | 'away', i: number) => {
      const tm = team(p, s);
      const det = detail(p, s);
      return (
        <div style={{ display: 'flex', alignItems: 'stretch', height: R, ...animStyle(p, 'slide-left', 120 + i * 70, 340) }}>
          <span style={{ width: 10, background: tm.primaryColor }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', minWidth: 132 }}>
            <span style={{ fontSize: slim ? 21 : 25, fontWeight: 800, letterSpacing: 1 }}>{tm.abbreviation}</span>
            <RedCard p={p} side={s} size={slim ? 20 : 24} />
            {det ? <span style={{ fontSize: 12, color: c.muted }}>{det}</span> : null}
            {d.possession === s ? <span style={{ width: 8, height: 8, borderRadius: 4, background: c.electric, marginLeft: 'auto' }} /> : null}
          </span>
          <span style={{ display: 'grid', placeItems: 'center', minWidth: 46, fontSize: slim ? 24 : 28, ...plate(c, { borderRadius: 0 }) }}>{digits(p, s, 30)}</span>
        </div>
      );
    };
    return (
      <>
        <Panel c={c} texture={false} ends="none" style={{ height: 'auto' }} inner={{ display: 'flex', flexDirection: 'column' }}>
          {row('home', 0)}
          <span style={{ height: 1, background: c.rule }} />
          {row('away', 1)}
          <Rule p={p} c={c} height={3} delayMs={260} />
          <Shine p={p} c={c} delayMs={380} />
        </Panel>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: `0 ${pad(c, 14)}px 0 ${pad(c, 12) - (c.k.corner === 'slant' ? SLANT : 0)}px`, minWidth: 104, background: `linear-gradient(180deg, ${mix(c.hot, '#ffffff', 0.12)}, ${mix(c.hot, '#000000', 0.2)})`, color: inkOn(c.hot, c.deep), ...shape(c, 'right'), ...root(c), ...animStyle(p, 'wipe', 220, 380) }}>
          <span style={{ fontSize: slim ? 24 : 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{clockLabel(p)}</span>
          <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4, opacity: 0.9, ...caps(2), ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
        </div>
      </>
    );
  };

  /** Block scorebug: square blocks side by side, a four-colour band underneath. */
  const BlocksBug = (p: GraphicProps, c: L, slim: boolean) => {
    const d = p.display;
    const H = slim ? 46 : 58;
    const cell = (s: 'home' | 'away', i: number) => {
      const tm = team(p, s);
      const det = detail(p, s);
      return (
        <span style={{ display: 'flex', alignItems: 'stretch', flexDirection: s === 'away' ? 'row-reverse' : 'row', ...animStyle(p, s === 'away' ? 'slide-right' : 'slide-left', 140 + i * 60, 340) }}>
          <span style={{ width: 12, background: tm.primaryColor, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 100 + i * 60, 280) }} />
          <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: s === 'away' ? 'flex-end' : 'flex-start', padding: '0 14px', minWidth: 76 }}>
            <span style={{ fontSize: slim ? 23 : 27, fontWeight: 900, lineHeight: 1, letterSpacing: 0.5 }}>{tm.abbreviation}</span>
            {det ? <span style={{ fontSize: 12, color: c.muted, lineHeight: 1.25 }}>{det}</span> : null}
          </span>
          <RedCard p={p} side={s} size={slim ? 22 : 26} />
          {d.possession === s ? <span style={{ alignSelf: 'center', width: 8, height: 8, background: c.electric }} /> : null}
        </span>
      );
    };
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', paddingBottom: 6 }}>
        <span style={{ display: 'grid', placeItems: 'center', width: H, background: mix(c.deep, '#ffffff', 0.12), ...animStyle(p, 'grow-y', 0, 300) }}>{badgeUrl(p) ? <ThemeBadge p={p} height={H - 18} /> : <Mark c={c} size={H - 16} />}</span>
        <Panel c={c} texture={false} radius={0} style={{ height: '100%' }} inner={{ display: 'flex', alignItems: 'stretch' }}>
          {cell('home', 0)}
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 10px', fontSize: slim ? 28 : 34, ...plate(c, { borderRadius: 0, fontWeight: 900 }), ...animStyle(p, 'wipe-up', 200, 340) }}>
            {digits(p, 'home', 26)}
            <span style={{ width: 3, height: '46%', background: alpha(c.ink, 0.25) }} />
            {digits(p, 'away', 26)}
          </span>
          {cell('away', 1)}
          <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 16px', minWidth: 98, background: mix(c.deep, '#ffffff', 0.1) }}>
            <span style={{ fontSize: slim ? 22 : 27, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{clockLabel(p)}</span>
            <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1.3, color: c.electric, ...caps(2), ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
          </span>
        </Panel>
        <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, background: `linear-gradient(90deg, ${c.spectrum.map((col, i) => `${col} ${i * 25}% ${(i + 1) * 25}%`).join(', ')})`, transformOrigin: 'left', ...animStyle(p, 'grow-x', 240, 420) }} />
      </div>
    );
  };

  function Scorebug(p: GraphicProps) {
    const c = look(p, k);
    const slim = p.data.theme.scorebug?.variant === 'strip';
    const H = k.scorebug === 'stacked' ? undefined : k.scorebug === 'blocks' ? (slim ? 52 : 64) : slim ? 46 : 56;
    const body = k.scorebug === 'pill' ? PillBug(p, c, slim) : k.scorebug === 'stacked' ? StackedBug(p, c, slim) : k.scorebug === 'blocks' ? BlocksBug(p, c, slim) : RowBug(p, c, slim);
    return (
      <div style={{ top: SY, display: 'flex', alignItems: 'stretch', height: H, ...root(c), ...groupShadow(c), ...scorebugPosition(p, SX), ...animStyle(p, 'wipe') }} data-graphic="scorebug">
        {body}
        {extras(p, c, H ?? 78, slim)}
        <ScorebugTabs p={p} />
      </div>
    );
  }

  function SponsorBox({ p, c, placement, delayMs = 400 }: { p: GraphicProps; c: L; placement: string; delayMs?: number }) {
    if (!p.creative(placement, p.cue)) return null;
    return (
      <div style={{ position: 'relative', overflow: 'hidden', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.96)', padding: `4px ${pad(c, 18)}px 8px`, ...join(c, 8), ...shape(c), ...animStyle(p, 'zoom', delayMs, 400) }}>
        <PresentedBy p={p} placement={placement} height={52} />
        <Rule p={p} c={c} delayMs={delayMs + 120} />
      </div>
    );
  }

  /** A team event: the event word beside the panel (or as a tab above it), then badge, name and detail. */
  function EventBar(p: GraphicProps, label: string, accent: string, body: ReactNode) {
    const c = look(p, k);
    const tm = team(p);
    const pl = PHOTO_EVENTS.includes(p.t.key) ? player(p) : null;
    const colour = k.kickerColour === 'team' && accent === c.hot ? tm.primaryColor : accent;
    const ink = inkOn(colour, c.light ? c.ink : c.deep);
    const content = (
      <>
        <span style={{ width: 8, alignSelf: 'stretch', borderRadius: c.k.corner === 'round' ? 4 : 0, background: tm.primaryColor, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 220, 300) }} />
        <span style={animStyle(p, 'zoom', 260, 420)}><Logo url={tm.logoUrl} label={tm.abbreviation} size={66} color={tm.primaryColor} radius={c.k.corner === 'round' ? 10 : 2} /></span>
        {pl?.photoUrl ? <span style={animStyle(p, 'zoom', 300, 420)}><Photo url={pl.photoUrl} size={76} name={pl.displayName} /></span> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...animStyle(p, 'rise', 320, 360) }}>{body}</div>
        <Rule p={p} c={c} delayMs={300} teamColour={tm.primaryColor} />
        <Shine p={p} c={c} delayMs={460} />
      </>
    );
    if (k.kicker === 'tab')
      return (
        <div style={{ position: 'absolute', left: SX, bottom: SY + 64, ...root(c), ...animStyle(p, 'slide-up') }} data-graphic={p.t.key}>
          <div style={{ display: 'flex' }}>
            <span style={{ position: 'relative', zIndex: 1, marginLeft: 26, marginBottom: -16, padding: '9px 24px', background: colour, color: ink, fontSize: 24, fontWeight: 900, ...caps(3), borderRadius: c.k.corner === 'round' ? 999 : c.radius, boxShadow: '0 8px 20px rgba(0,0,0,.25)', ...animStyle(p, 'zoom', 200, 420) }}>{label}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <div style={animStyle(p, 'wipe', 60, 420)}>
              <Panel c={c} style={{ height: '100%', minWidth: 680 }} inner={{ display: 'flex', alignItems: 'center', gap: 18, padding: '28px 46px 20px 30px' }}>{content}</Panel>
            </div>
            <SponsorBox p={p} c={c} placement="event_partner" delayMs={480} />
          </div>
        </div>
      );
    return (
      <div style={{ position: 'absolute', left: SX, bottom: SY + 64, display: 'flex', alignItems: 'stretch', ...root(c), ...groupShadow(c), ...animStyle(p, 'slide-left') }} data-graphic={p.t.key}>
        <div style={{ position: 'relative', zIndex: 1, ...animStyle(p, 'zoom', 0, 460) }}>
          <div style={{ position: 'relative', overflow: 'hidden', height: '100%', display: 'grid', placeItems: 'center', padding: `0 ${pad(c, 34)}px 0 ${c.k.corner === 'slant' ? 30 : 32}px`, background: `linear-gradient(135deg, ${mix(colour, '#ffffff', 0.1)}, ${mix(colour, c.deep, 0.25)})`, color: ink, fontSize: 44, fontWeight: 900, ...caps(3), ...shape(c, c.k.corner === 'slant' ? 'right' : 'both') }}>
            <span style={{ position: 'relative' }}>{label}</span>
          </div>
        </div>
        <div style={{ ...join(c, k.gap), ...animStyle(p, 'wipe', 120, 420) }}>
          <Panel c={c} ends={c.k.corner === 'slant' ? 'both' : 'both'} style={{ height: '100%', minWidth: 660 }} inner={{ display: 'flex', alignItems: 'center', gap: 18, padding: `16px ${pad(c, 44)}px 20px ${pad(c, 30)}px` }}>{content}</Panel>
        </div>
        <SponsorBox p={p} c={c} placement="event_partner" delayMs={480} />
      </div>
    );
  }

  const nameLine = (p: GraphicProps, c: L, full: string, short: string | null | undefined, px = 42) => <Fitted full={up(c, full)} short={upShort(c, short)} width={480} fontPx={px} weight={k.weight} measure={p.measure} />;
  const subline = (p: GraphicProps, c: L, text: string, delayMs = 420) => <span style={{ fontSize: 20, color: c.hi, fontWeight: 700, ...caps(1.5), ...animStyle(p, 'rise', delayMs, 320) }}>{text}</span>;

  function Goal(p: GraphicProps) {
    const c = look(p, k);
    const who = personOrTeam(p);
    const sc = p.data.match.projection.score;
    return EventBar(p, eventWord(p), c.hot, (
      <>
        {nameLine(p, c, who.primary, who.short, 44)}
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {subline(p, c, `${team(p).shortName} ${minute(p)}`)}
          <span style={{ fontSize: 19, padding: '4px 10px', ...plate(c, c.k.plate === 'clear' ? { background: alpha(c.on, 0.12) } : undefined), ...animStyle(p, 'zoom', 480, 340) }}>{team(p, 'home').abbreviation} {sc.home}–{sc.away} {team(p, 'away').abbreviation}</span>
        </span>
      </>
    ));
  }

  function Score(p: GraphicProps) {
    const c = look(p, k);
    const who = personOrTeam(p);
    const pts = p.cue.variables.points;
    return EventBar(p, `+${typeof pts === 'number' ? pts : ''}`, c.hot, (
      <>
        {nameLine(p, c, who.primary, who.short)}
        {subline(p, c, team(p).shortName)}
      </>
    ));
  }

  function Card(p: GraphicProps) {
    const c = look(p, k);
    const cs = cardStyle(p);
    const who = personOrTeam(p);
    return EventBar(p, cs.word, cs.colour, (
      <>
        {nameLine(p, c, who.primary, who.short)}
        {subline(p, c, `${team(p).shortName} ${minute(p)}`)}
      </>
    ));
  }

  function Substitution(p: GraphicProps) {
    const c = look(p, k);
    const off = player(p, 'playerOut');
    const on = player(p, 'playerIn');
    const line = (arrow: string, colour: string, pl: typeof off, i: number) => (
      <span style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 30, ...animStyle(p, i ? 'slide-right' : 'slide-left', 360 + i * 120, 360) }}>
        <span style={{ color: colour, fontWeight: 900 }}>{arrow}</span>
        <span style={{ width: 44, color: c.muted, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pl?.number ?? ''}</span>
        <Fitted full={up(c, pl?.displayName ?? team(p).name)} short={upShort(c, pl?.shortName)} width={420} fontPx={30} weight={k.weight} measure={p.measure} />
      </span>
    );
    return EventBar(p, t(p, 'SUB'), k.kickerColour === 'team' ? c.hot : c.electric, (
      <>
        {line('▲', ON_GREEN, on, 0)}
        {line('▼', c.light ? c.hot : '#FF5A5F', off, 1)}
        {subline(p, c, `${team(p).shortName} ${minute(p)}`, 600)}
      </>
    ));
  }

  function LowerThird(p: GraphicProps) {
    const c = look(p, k);
    const img = p.cue.variables.image as string | undefined;
    return (
      <div style={{ position: 'absolute', left: SX, bottom: SY + 40, display: 'flex', alignItems: 'stretch', ...root(c), ...groupShadow(c), ...animStyle(p, 'slide-left') }} data-graphic="lower_third">
        <div style={{ width: 14, background: k.rule === 'spectrum' ? `linear-gradient(180deg, ${c.spectrum.join(', ')})` : c.hot, transformOrigin: 'bottom', ...shape(c, 'right'), ...animStyle(p, 'grow-y', 0, 300) }} />
        {img && p.data.assets[img] ? <img alt="" src={p.data.assets[img]} style={{ width: 124, height: 124, objectFit: 'cover', ...join(c, 4), ...animStyle(p, 'zoom', 120, 380) }} /> : null}
        <div style={{ ...join(c, 4), ...animStyle(p, 'wipe', 100, 420) }}>
          <Panel c={c} style={{ height: '100%', minWidth: 760 }} inner={{ padding: `18px ${pad(c, 64)}px 20px ${pad(c, 30)}px` }}>
            <div style={animStyle(p, 'rise', 220, 340)}><Fitted full={up(c, String(p.cue.variables.heading ?? ''))} width={900} fontPx={48} weight={k.weight} measure={p.measure} /></div>
            <div style={{ height: 4, width: 150, borderRadius: 2, background: k.rule === 'silver' ? SILVER : k.rule === 'spectrum' ? `linear-gradient(90deg, ${c.spectrum.join(', ')})` : c.hot, margin: '8px 0', transformOrigin: 'left', ...animStyle(p, 'grow-x', 300, 380) }} />
            {p.cue.variables.subtitle ? <div style={{ color: c.hi, ...animStyle(p, 'rise', 340, 340) }}><Fitted full={String(p.cue.variables.subtitle).toUpperCase()} width={900} fontPx={23} weight={600} measure={p.measure} style={{ letterSpacing: 1.5 }} /></div> : null}
            <Shine p={p} c={c} delayMs={420} />
          </Panel>
        </div>
        <SponsorBox p={p} c={c} placement="lower_third_banner" delayMs={420} />
      </div>
    );
  }

  function PlayerCard(p: GraphicProps) {
    const c = look(p, k);
    const pl = player(p);
    const tm = team(p);
    const stat = p.cue.variables.stat as string | undefined;
    const tally = pl ? p.data.match.projection.players[pl.playerId] : null;
    const statVal = stat && tally ? (tally as Record<string, unknown>)[stat] : null;
    return (
      <div style={{ position: 'absolute', right: SX, bottom: SY + 60, width: 590, ...root(c), ...groupShadow(c), ...animStyle(p, 'slide-right') }} data-graphic="player_card">
        <Panel c={c} inner={{ padding: `28px ${pad(c, 28)}px`, display: 'flex', gap: 24, alignItems: 'center' }}>
          <span style={{ padding: 4, borderRadius: '50%', background: tm.primaryColor, display: 'grid', ...animStyle(p, 'zoom', 160, 420) }}><Photo url={pl?.photoUrl} size={140} name={pl?.displayName ?? tm.name} /></span>
          <div>
            <div style={{ fontSize: 66, fontWeight: 900, color: c.hi, lineHeight: 1, ...animStyle(p, 'drop', 240, 400) }}>{pl?.number ?? ''}</div>
            <div style={animStyle(p, 'rise', 320, 340)}><Fitted full={up(c, pl?.displayName ?? tm.name)} short={upShort(c, pl?.shortName)} width={330} fontPx={38} weight={k.weight} measure={p.measure} /></div>
            <div style={{ fontSize: 17, color: c.muted, fontWeight: 600, ...caps(), ...animStyle(p, 'rise', 390, 320) }}>{[pl?.position, tm.shortName].filter(Boolean).join(' · ')}</div>
            {statVal != null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 17, color: c.muted, ...caps(), ...animStyle(p, 'rise', 460, 320) }}>
                {stat}
                <b style={{ fontSize: 23, padding: '4px 10px', ...plate(c, c.k.plate === 'clear' ? { background: alpha(c.on, 0.12) } : undefined), ...changeStyle(p, 'stat', statVal) }}>{String(statVal)}</b>
              </div>
            ) : null}
          </div>
          <Rule p={p} c={c} delayMs={360} teamColour={tm.primaryColor} />
          <Shine p={p} c={c} delayMs={420} />
        </Panel>
      </div>
    );
  }

  /** Full-frame board with the look's title treatment. */
  function Board({ p, title, children, width = 1100 }: { p: GraphicProps; title: ReactNode; children: ReactNode; width?: number }) {
    const c = look(p, k);
    const titleText: CSSProperties = { fontSize: 30, fontWeight: Math.min(900, k.weight + 100), ...caps(2.5) };
    const inside =
      k.title === 'eyebrow' ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingBottom: 14, marginBottom: 24, borderBottom: `1px solid ${c.rule}`, ...animStyle(p, 'rise', 180, 340) }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: c.muted, ...caps(3.5) }}>{title}</span>
          <ThemeBadge p={p} height={36} />
        </div>
      ) : k.title === 'centre' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 26, ...animStyle(p, 'fade', 160, 420) }}>
          <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${alpha(SILVER, 0)}, ${SILVER})` }} />
          <span style={{ fontSize: 24, fontWeight: 500, ...caps(6) }}>{title}</span>
          <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${SILVER}, ${alpha(SILVER, 0)})` }} />
        </div>
      ) : null;
    const top = k.title === 'tab' ? 46 : 34;
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', top: 130, width, ...root(c), ...groupShadow(c), ...animStyle(p, k.enter === 'slide-left' ? 'slide-left' : 'slide-up') }} data-graphic={p.t.key}>
        {k.title === 'bar' ? (
          <div style={{ position: 'relative', overflow: 'hidden', height: 66, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${pad(c, 34)}px 0 ${pad(c, 26)}px`, marginBottom: 6, background: `linear-gradient(100deg, ${c.hot} 0%, ${c.hot} 60%, ${mix(c.hot, '#000000', 0.25)} 100%)`, color: inkOn(c.hot, c.deep), ...titleText, ...shape(c, 'both', c.radius), ...animStyle(p, 'wipe', 60, 440) }}>
            <span style={animStyle(p, 'rise', 180, 340)}>{title}</span>
            <ThemeBadge p={p} height={40} />
            <Shine p={p} c={c} delayMs={360} />
          </div>
        ) : null}
        {k.title === 'block' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <span style={{ background: c.paper, color: c.ink, padding: '10px 26px', ...titleText, fontSize: 34, fontWeight: 900, ...animStyle(p, 'wipe', 40, 380) }}>{title}</span>
              <ThemeBadge p={p} height={40} />
            </div>
            <div style={{ height: 8, background: `linear-gradient(90deg, ${c.spectrum.map((col, i) => `${col} ${i * 25}% ${(i + 1) * 25}%`).join(', ')})`, transformOrigin: 'left', ...animStyle(p, 'grow-x', 120, 420) }} />
          </>
        ) : null}
        <div style={{ transformOrigin: 'top', ...animStyle(p, k.enter, 120, 420) }}>
          <Panel c={c} radius={k.title === 'block' ? 0 : undefined} inner={{ padding: `${top}px ${pad(c, 34)}px 34px` }}>
            {inside}
            {children}
            {k.title === 'tab' || k.title === 'eyebrow' ? <Rule p={p} c={c} delayMs={300} /> : null}
            {k.title !== 'bar' ? <Shine p={p} c={c} delayMs={380} /> : null}
          </Panel>
        </div>
        {k.title === 'tab' ? (
          <span style={{ position: 'absolute', top: -20, left: 30, zIndex: 2, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 24px', borderRadius: 999, background: c.hot, color: inkOn(c.hot, c.deep), boxShadow: '0 10px 24px rgba(0,0,0,.25)', ...titleText, fontSize: 22, ...animStyle(p, 'zoom', 200, 420) }}>{title}</span>
        ) : null}
      </div>
    );
  }

  function Versus({ p, c, text, delayMs }: { p: GraphicProps; c: L; text: string; delayMs: number }) {
    if (k.versus === 'quiet') return <span style={{ fontSize: 28, color: c.muted, fontWeight: 500, ...animStyle(p, 'fade', delayMs, 400) }}>{text.toLowerCase()}</span>;
    if (k.versus === 'ring') return <span style={{ width: 84, height: 84, display: 'grid', placeItems: 'center', borderRadius: '50%', boxShadow: `inset 0 0 0 1px ${SILVER}, 0 0 30px ${alpha(c.hot, 0.5)}`, fontSize: 24, fontWeight: 500, ...caps(3), ...animStyle(p, 'zoom', delayMs, 420) }}>{text}</span>;
    const round = k.corner === 'round';
    return <span style={{ minWidth: 84, height: 84, padding: '0 16px', display: 'grid', placeItems: 'center', borderRadius: round ? 42 : c.radius, background: c.hot, color: inkOn(c.hot, c.deep), fontSize: text.length > 3 ? 22 : 30, fontWeight: 900, ...caps(1), ...shape(c, 'both', round ? 42 : c.radius), ...animStyle(p, 'zoom', delayMs, 420) }}>{text}</span>;
  }

  function TeamsHeader({ p, delayMs = 220, centre = 'VS', score = false, crest = 96 }: { p: GraphicProps; delayMs?: number; centre?: string; score?: boolean; crest?: number }) {
    const c = look(p, k);
    const side = (s: 'home' | 'away') => {
      const tm = team(p, s);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', delayMs, 440) }}>
          <Crest c={c} tm={tm} size={crest} />
          <Fitted full={up(c, tm.name)} short={upShort(c, tm.shortName)} width={340} fontPx={36} weight={k.weight} measure={p.measure} />
        </div>
      );
    };
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 28 }}>
        {side('home')}
        {score ? (
          <span style={{ fontSize: 74, padding: '10px 30px', ...plate(c, { borderRadius: k.corner === 'round' ? Math.max(10, c.radius) : c.radius }), ...animStyle(p, 'zoom', delayMs + 120, 400) }}><span style={changeStyle(p, 'score', centre)}>{centre}</span></span>
        ) : (
          <Versus p={p} c={c} text={centre} delayMs={delayMs + 120} />
        )}
        {side('away')}
      </div>
    );
  }

  function Ident(p: GraphicProps) {
    const c = look(p, k);
    const info = identInfo(p);
    return (
      <Board p={p} title={p.data.match.competition.name} width={1160}>
        <TeamsHeader p={p} centre={info.centre} score={info.started} crest={116} />
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: info.started ? 26 : 21, fontWeight: info.started ? 800 : 500, color: info.started ? c.hi : c.muted, ...caps(info.started ? 4 : 1.5), ...animStyle(p, 'rise', 420, 340) }}>{info.line}</div>
        {info.countdown ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 16, ...animStyle(p, 'zoom', 500, 420) }}>
            <span style={{ background: c.hot, color: inkOn(c.hot, c.deep), fontSize: 17, fontWeight: 800, padding: `8px ${pad(c, 20)}px`, ...caps(2.5), ...shape(c, 'both', k.corner === 'round' ? 999 : c.radius) }}>{info.countdown.label}</span>
            <span style={{ fontSize: 60, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{info.countdown.text}</span>
          </div>
        ) : null}
        {info.message ? (
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 40, fontWeight: Math.min(900, k.weight + 100), ...caps(2), ...animStyle(p, 'rise', 520, 360) }}>
            {info.message}
            <div style={{ height: 5, width: 180, margin: '12px auto 0', borderRadius: 3, background: k.rule === 'silver' ? SILVER : k.rule === 'spectrum' ? `linear-gradient(90deg, ${c.spectrum.join(', ')})` : c.hot, transformOrigin: 'center', ...animStyle(p, 'grow-x', 640, 360) }} />
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}><SponsorPlate p={p} c={c} placement="detached_logo" height={60} delayMs={580} /></div>
      </Board>
    );
  }

  function Lineup(p: GraphicProps) {
    const c = look(p, k);
    const { s, starters, bench, page, pages } = lineupPage(p);
    const tm = team(p, s);
    const formation = p.data.match.lineup.formations?.[s];
    return (
      <Board p={p} width={1160} title={`${t(p, 'STARTING LINE-UP')}${pages > 1 ? ` (${page}/${pages})` : ''}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: 40, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, paddingTop: 10, ...animStyle(p, 'slide-left', 200, 440) }}>
            <Crest c={c} tm={tm} size={150} />
            <Fitted full={up(c, tm.name)} short={upShort(c, tm.shortName)} width={320} fontPx={34} weight={k.weight} measure={p.measure} />
            {formation ? <span style={{ fontSize: 17, color: c.muted, fontWeight: 600, ...caps(2) }}>{t(p, 'FORMATION')} <b style={{ color: c.hi }}>{formation}</b></span> : null}
          </div>
          <div>
            {starters.map((x, i) => (
              <div key={x.playerId} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 0', borderBottom: `1px solid ${c.rule}`, ...stagger(p, i, 'slide-right', 260, 45) }}>
                <span style={{ width: 52, height: 36, flex: 'none', display: 'grid', placeItems: 'center', background: alpha(c.hi, 0.14), color: c.hi, fontSize: 21, fontWeight: 900, fontVariantNumeric: 'tabular-nums', ...shape(c, 'both', k.corner === 'round' ? 8 : c.radius) }}>{x.number ?? ''}</span>
                <Fitted full={up(c, x.displayName)} short={upShort(c, x.shortName)} width={520} fontPx={27} weight={Math.min(700, k.weight)} measure={p.measure} />
                {x.captain ? <span style={{ width: 26, height: 26, flex: 'none', borderRadius: k.corner === 'round' ? '50%' : 2, background: c.hot, color: inkOn(c.hot, c.deep), fontSize: 14, fontWeight: 800, display: 'grid', placeItems: 'center' }}>C</span> : null}
                {x.position ? <span style={{ marginLeft: 'auto', color: c.muted, fontSize: 15, fontWeight: 600, ...caps() }}>{x.position}</span> : null}
              </div>
            ))}
            {!starters.length ? <div style={{ fontSize: 26, color: c.muted, paddingTop: 20 }}>{t(p, 'Lineup to be confirmed')}</div> : null}
          </div>
        </div>
        {bench.length ? (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${c.rule}`, fontSize: 18, color: c.muted, ...stagger(p, starters.length + 1, 'rise', 260, 45) }}>
            <span style={{ color: c.hi, fontWeight: 800, ...caps(2) }}>{t(p, 'SUBSTITUTES')}</span> {bench.map((x) => `${x.number ?? ''} ${x.shortName ?? x.displayName}`.trim()).join(' · ')}
          </div>
        ) : null}
      </Board>
    );
  }

  function Stats(p: GraphicProps) {
    const c = look(p, k);
    const rows = statRows(p);
    const h = team(p, 'home');
    const a = team(p, 'away');
    const d = p.display;
    const head = (tm: RenderTeam, s: 'home' | 'away') => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexDirection: s === 'home' ? 'row' : 'row-reverse', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', 220, 360) }}>
        <Logo url={tm.logoUrl} label={tm.abbreviation} size={46} color={tm.primaryColor} radius={k.corner === 'round' ? 8 : 2} />
        <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>{tm.abbreviation}</span>
      </span>
    );
    return (
      <Board p={p} width={960} title={t(p, 'MATCH STATS')}>
        <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 170px', alignItems: 'center', gap: '12px 0' }}>
          {head(h, 'home')}
          <span style={{ justifySelf: 'center', fontSize: 38, padding: '6px 20px', ...plate(c, c.k.plate === 'clear' ? { background: alpha(c.on, 0.1) } : undefined), ...animStyle(p, 'zoom', 260, 400) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></span>
          {head(a, 'away')}
          {rows.map((r, i) => {
            const hv = Number(r.home ?? 0);
            const av = Number(r.away ?? 0);
            const tot = hv + av || 1;
            const lead = hv === av ? null : hv > av ? 'home' : 'away';
            const row = stagger(p, i, 'rise', 300, 70);
            const val = (s: 'home' | 'away', v: unknown) => (
              <span style={{ fontSize: 29, fontWeight: 800, fontVariantNumeric: 'tabular-nums', textAlign: s === 'home' ? 'left' : 'right', color: lead === s || !lead ? c.on : c.muted, ...row }}>
                <span style={changeStyle(p, `${s === 'home' ? 'h' : 'a'}-${r.key}`, v)}>{v == null ? '—' : String(v)}</span>{r.unit ?? ''}
              </span>
            );
            const bar = (s: 'home' | 'away', share: number, colour: string) => (
              <span style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', flexDirection: s === 'home' ? 'row' : 'row-reverse', background: c.rule, borderRadius: k.corner === 'round' ? 4 : 0, overflow: 'hidden' }}>
                <span style={{ width: `${share * 100}%`, background: colour, borderRadius: k.corner === 'round' ? 4 : 0, transformOrigin: s === 'home' ? 'right' : 'left', ...animStyle(p, 'grow-x', 380 + i * 70, 420) }} />
              </span>
            );
            return (
              <div key={r.key} style={{ display: 'contents' }}>
                {val('home', r.home)}
                <span style={{ textAlign: 'center', ...row }}>
                  <span style={{ fontSize: 15, color: c.muted, fontWeight: 600, ...caps(2) }}>{r.label.toUpperCase()}</span>
                  <span style={{ display: 'flex', height: 8, gap: 4, marginTop: 6 }}>
                    {bar('home', hv / tot, h.primaryColor)}
                    {bar('away', av / tot, a.primaryColor)}
                  </span>
                </span>
                {val('away', r.away)}
              </div>
            );
          })}
        </div>
        {!rows.length ? <div style={{ color: c.muted, fontSize: 26 }}>{t(p, 'No statistics recorded yet')}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><SponsorPlate p={p} c={c} placement="detached_logo" height={44} delayMs={300 + rows.length * 70} /></div>
      </Board>
    );
  }

  function BreakScore(p: GraphicProps) {
    const c = look(p, k);
    const d = p.display;
    const label = t(p, ((p.cue.variables.label as string) || d.periodLabel).toUpperCase());
    const side = (s: 'home' | 'away') => {
      const tm = team(p, s);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', 220, 420) }}>
          <Crest c={c} tm={tm} size={108} />
          <Fitted full={up(c, tm.name)} short={upShort(c, tm.shortName)} width={330} fontPx={34} weight={k.weight} measure={p.measure} />
        </div>
      );
    };
    return (
      <Board p={p} title={label} width={1080}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 30 }}>
          {side('home')}
          <div style={{ fontSize: 100, padding: '12px 34px', ...plate(c, { borderRadius: k.corner === 'round' ? Math.max(12, c.radius) : c.radius }), ...animStyle(p, 'zoom', 300, 460) }}>
            <span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}<span style={{ color: k.plate === 'hot' || k.plate === 'glow' ? 'inherit' : c.hot, margin: '0 6px', opacity: k.plate === 'hot' || k.plate === 'glow' ? 0.6 : 1 }}>–</span>{d.score.away}</span>
          </div>
          {side('away')}
        </div>
        {d.shootout ? <div style={{ textAlign: 'center', marginTop: 14, fontSize: 25, color: c.hi, fontWeight: 700, ...caps(), ...animStyle(p, 'rise', 420, 320) }}>{t(p, 'Penalties')} {d.shootout.home}–{d.shootout.away}</div> : null}
        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 19, color: c.muted, fontWeight: 600, ...caps(2), ...animStyle(p, 'rise', 460, 320) }}>{occasionLine(p.data.match)}</div>
        {p.cue.variables.showSponsor !== false ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}><SponsorPlate p={p} c={c} placement="detached_logo" height={56} delayMs={540} /></div> : null}
      </Board>
    );
  }

  function PeriodBanner(p: GraphicProps) {
    const c = look(p, k);
    const { heading, period } = periodBanner(p);
    const d = p.display;
    const side = (s: 'home' | 'away') => {
      const tm = team(p, s);
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'flex-end', flexDirection: s === 'home' ? 'row' : 'row-reverse', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', 260, 400) }}>
          <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: 1 }}>{tm.abbreviation}</span>
          <Logo url={tm.logoUrl} label={tm.abbreviation} size={56} color={tm.primaryColor} radius={k.corner === 'round' ? 10 : 2} />
        </div>
      );
    };
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', bottom: SY + 50, width: 980, ...root(c), ...groupShadow(c), ...animStyle(p, 'slide-up') }} data-graphic="period_banner">
        <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
          <div style={{ background: c.hot, color: inkOn(c.hot, c.deep), fontSize: 34, fontWeight: 900, padding: `10px ${pad(c, 50)}px`, marginBottom: k.corner === 'round' ? -10 : 0, ...caps(5), ...shape(c, 'both', k.corner === 'round' ? 999 : c.radius), ...animStyle(p, 'zoom', 0, 460) }}>{t(p, heading)}</div>
        </div>
        <div style={animStyle(p, 'wipe', 140, 440)}>
          <Panel c={c} inner={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 26, padding: `22px ${pad(c, 36)}px 24px` }}>
            {side('home')}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, ...animStyle(p, 'flip', 320, 460) }}>
              <span style={{ fontSize: 48, padding: '6px 20px', ...plate(c, c.k.plate === 'clear' ? { background: alpha(c.on, 0.1) } : undefined) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></span>
              <span style={{ fontSize: 15, color: c.hi, fontWeight: 800, ...caps(3) }}>{period}</span>
            </div>
            {side('away')}
            <Rule p={p} c={c} delayMs={300} />
            <Shine p={p} c={c} delayMs={440} />
          </Panel>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}><SponsorPlate p={p} c={c} placement="lower_third_banner" height={40} delayMs={480} /></div>
      </div>
    );
  }

  function Sponsor(p: GraphicProps) {
    const c = look(p, k);
    const placement = (p.cue.variables.placement as string) ?? 'detached_logo';
    const cr = p.creative(placement, p.cue) ?? (p.cue.variables.creative ? p.data.creatives[p.cue.variables.creative as string] : null);
    if (!cr) return null;
    if (placement === 'full_frame_image') return <FullFrameMedia p={{ ...p, cue: { ...p.cue, variables: { ...p.cue.variables, creative: cr.id } } }} />;
    const h = placement === 'lower_third_banner' ? 110 : 100;
    const box: CSSProperties = placement === 'lower_third_banner' ? { left: SX, bottom: SY, height: h } : { right: SX, top: SY, height: h };
    return (
      <div style={{ position: 'absolute', ...box, overflow: 'hidden', background: 'rgba(255,255,255,.96)', padding: `14px ${pad(c, 14)}px 18px`, display: 'grid', placeItems: 'center', boxShadow: '0 12px 36px rgba(0,0,0,.3)', ...shape(c), ...animStyle(p, placement === 'lower_third_banner' ? 'wipe' : 'zoom') }} data-graphic="sponsor">
        <img alt={cr.brandName} src={cr.url} style={{ height: h - 32, maxWidth: (h - 32) * 4, objectFit: 'contain', ...animStyle(p, 'fade', 150, 300) }} data-sponsor-creative={cr.id} />
        <Rule p={p} c={c} delayMs={200} />
      </div>
    );
  }

  function Ticker(p: GraphicProps) {
    const c = look(p, k);
    const text = tickerText(p);
    const s = surface(c);
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: SY - 10, height: 58, overflow: 'hidden', ...root(c), ...s.style, boxShadow: s.inset, display: 'flex', alignItems: 'center', ...animStyle(p, 'slide-up') }} data-graphic="ticker">
        <Rule p={p} c={c} height={3} delayMs={60} top />
        <div style={{ background: c.hot, color: inkOn(c.hot, c.deep), fontWeight: 900, padding: `0 ${pad(c, 30)}px 0 24px`, height: '100%', display: 'grid', placeItems: 'center', zIndex: 1, ...caps(2.5), ...shape(c, 'right', 0), ...animStyle(p, 'wipe', 100, 340) }}>{t(p, 'LATEST')}</div>
        <div style={animStyle(p, 'fade', 240, 400)}>
          <div style={{ whiteSpace: 'nowrap', fontSize: 25, fontWeight: 600, ...caps(1), animation: `bs-ticker ${tickerSpeed(p)}s linear infinite`, paddingLeft: 40 }}>
            {text} &nbsp;&nbsp;<span style={{ color: c.hi }}>◆</span>&nbsp;&nbsp; {text} &nbsp;&nbsp;<span style={{ color: c.hi }}>◆</span>&nbsp;&nbsp;
          </div>
        </div>
      </div>
    );
  }

  /** The look's full-screen canvas: shared by the holding slate (still) and the animated background. */
  function Canvas({ p, c, moving }: { p: GraphicProps; c: L; moving: boolean }) {
    const run = (name: string, seconds: number, reverse = false): CSSProperties => (!moving ? {} : { animation: `${name} ${seconds}s ease-in-out ${reverse ? '-3s' : '0s'} infinite alternate${reverse ? '-reverse' : ''}`, willChange: 'transform, opacity' });
    const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
    const home = p.data.match.teams.home.primaryColor;
    const away = p.data.match.teams.away.primaryColor;
    const gid = `${k.key}-${p.cue.cueId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    let art: ReactNode = null;
    switch (k.backdrop) {
      case 'arcs':
        art = (
          <svg aria-hidden viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ ...fill, ...run('bs-bd-drift', 24) }}>
            <circle cx="1520" cy="540" r="640" fill="none" stroke={alpha(c.hot, 0.55)} strokeWidth="130" />
            <circle cx="1520" cy="540" r="430" fill="none" stroke={alpha(c.hot, 0.22)} strokeWidth="44" />
            <circle cx="1520" cy="540" r="880" fill="none" stroke={alpha('#ffffff', 0.07)} strokeWidth="3" />
            <circle cx="240" cy="1000" r="320" fill={alpha(c.electric, 0.1)} />
          </svg>
        );
        break;
      case 'glow':
        art = (
          <>
            <div style={{ position: 'absolute', left: -300, top: -260, width: 1300, height: 1300, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(home, 0.42)}, transparent 66%)`, ...run('bs-bd-glow', 8) }} />
            <div style={{ position: 'absolute', right: -320, bottom: -380, width: 1300, height: 1300, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(away, 0.38)}, transparent 66%)`, ...run('bs-bd-glow', 9, true) }} />
            <div style={{ ...fill, background: `linear-gradient(180deg, transparent 60%, ${alpha('#000000', 0.5)})` }} />
          </>
        );
        break;
      case 'spectrum':
        art = (
          <svg aria-hidden viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ ...fill, ...run('bs-bd-drift', 20, true) }}>
            {c.spectrum.map((col, i) => <polygon key={i} points={`${1180 + i * 150},0 ${1300 + i * 150},0 ${980 + i * 150},1080 ${860 + i * 150},1080`} fill={col} opacity={0.85} />)}
            <polygon points="0,840 520,1080 0,1080" fill={alpha('#ffffff', 0.06)} />
          </svg>
        );
        break;
      case 'stars':
        art = (
          <>
            <svg aria-hidden viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" style={{ ...fill, ...run('bs-bd-glow', 6) }}>
              {STARS.map(([x, y, r], i) => (i % 2 ? <circle key={i} cx={x} cy={y} r={r * 0.45} fill="#ffffff" opacity={0.3 + (i % 5) * 0.12} /> : null))}
            </svg>
            <svg aria-hidden viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" style={{ ...fill, ...run('bs-bd-glow', 7.5, true) }}>
              {STARS.map(([x, y, r], i) => (i % 2 ? null : <circle key={i} cx={(x + 37) % 200} cy={(y + 23) % 100} r={r * 0.4} fill={SILVER} opacity={0.25 + (i % 4) * 0.12} />))}
            </svg>
            <div style={{ position: 'absolute', left: '-10%', top: '-30%', width: '60%', height: '160%', background: `linear-gradient(90deg, transparent, ${alpha(c.electric, 0.12)}, transparent)`, transform: 'rotate(18deg)', ...run('bs-bd-sweep', 14) }} />
          </>
        );
        break;
      case 'slashes':
        art = (
          <>
            <div style={{ ...fill, background: `repeating-linear-gradient(100deg, transparent 0 5px, ${alpha('#ffffff', 0.025)} 5px 6px)` }} />
            <svg aria-hidden viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ ...fill, ...run('bs-bd-drift', 18) }}>
              <polygon points="1240,0 1560,0 1180,1080 860,1080" fill={alpha(c.hot, 0.85)} />
              <polygon points="1600,0 1660,0 1280,1080 1220,1080" fill={alpha(c.hot, 0.5)} />
              <polygon points="1700,0 1720,0 1340,1080 1320,1080" fill={alpha(c.electric, 0.7)} />
            </svg>
          </>
        );
        break;
      case 'shards':
        art = (
          <svg aria-hidden viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ ...fill, ...run('bs-bd-drift', 22, true) }}>
            <defs>
              <linearGradient id={`pk-${gid}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={c.hot} stopOpacity={0.95} />
                <stop offset="1" stopColor={c.hot} stopOpacity={0.55} />
              </linearGradient>
            </defs>
            <polygon points="1100,0 1920,0 1920,1080 700,1080" fill={`url(#pk-${gid})`} />
            <polygon points="1400,0 1440,0 1040,1080 1000,1080" fill={alpha('#ffffff', 0.85)} />
            <polygon points="0,0 360,0 0,420" fill={alpha('#ffffff', 0.05)} />
          </svg>
        );
        break;
    }
    return (
      <>
        <div style={{ ...fill, background: `radial-gradient(ellipse at 30% 20%, ${mix(c.deep, c.hot, 0.16)} 0%, ${c.deep} 55%, ${mix(c.deep, '#000000', 0.4)} 100%)` }} />
        {art}
        <div style={{ ...fill, background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.4) 100%)' }} />
      </>
    );
  }

  function Backdrop(p: GraphicProps) {
    const c = look(p, k);
    const moving = p.data.theme.motion !== 'none' && p.cue.variables.motion !== false;
    return (
      <div data-graphic="backdrop" style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...animStyle(p, 'fade', 0, 600) }}>
        <Canvas p={p} c={c} moving={moving} />
      </div>
    );
  }

  function Slate(p: GraphicProps) {
    const c = look(p, k);
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', color: '#fff', ...root(c), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34, ...animStyle(p, 'fade') }} data-graphic="slate">
        <Canvas p={p} c={c} moving={false} />
        <div style={{ position: 'relative', ...animStyle(p, 'fade', 100, 400) }}><ThemeBadge p={p} height={84} /></div>
        <div style={{ position: 'relative', width: 1160 }}>
          <Panel c={c} inner={{ padding: '30px 36px' }}><TeamsHeader p={p} delayMs={200} crest={98} centre={t(p, 'VS')} /></Panel>
        </div>
        <div style={{ position: 'relative', fontSize: 52, fontWeight: Math.min(900, k.weight + 100), ...caps(3), ...animStyle(p, 'rise', 420, 420) }}>{slateMessage(p)}</div>
        <div style={{ position: 'relative', fontSize: 21, opacity: 0.75, fontWeight: 600, ...caps(2), ...animStyle(p, 'rise', 500, 360) }}>{occasionLine(p.data.match)}</div>
        <div style={{ position: 'relative', ...animStyle(p, 'fade', 600, 400) }}><SponsorMark p={p} placement="detached_logo" height={80} light /></div>
      </div>
    );
  }

  /** Lower-anchored strip (vertical kicker + panel) used by the shared match-information graphic. */
  function LowerStrip(p: GraphicProps, kicker: string, color: string, body: ReactNode, sponsorPlacement?: string) {
    const c = look(p, k);
    return (
      <div style={{ position: 'absolute', left: SX, bottom: SY + 40, display: 'flex', alignItems: 'stretch', ...root(c), ...groupShadow(c), ...animStyle(p, 'slide-left') }} data-graphic={p.t.key}>
        {/* rotated half a turn, so its right-hand corners are the ones on the left */}
        <div style={{ background: color, color: inkOn(color, c.deep), fontSize: 17, fontWeight: 900, padding: '0 18px', display: 'grid', placeItems: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', ...caps(3), ...(k.corner === 'slant' ? {} : { borderRadius: `0 ${c.radius}px ${c.radius}px 0` }), ...animStyle(p, 'wipe', 0, 360) }}>{kicker}</div>
        <div style={{ ...join(c, 4), ...animStyle(p, 'wipe', 100, 420) }}>
          <Panel c={c} ends={k.corner === 'slant' ? 'right' : 'both'} style={{ height: '100%', minWidth: 720, maxWidth: 1340 }} inner={{ padding: `18px ${pad(c, 46)}px 22px 30px` }}>
            {body}
            <Rule p={p} c={c} delayMs={300} />
            <Shine p={p} c={c} delayMs={420} />
          </Panel>
        </div>
        {sponsorPlacement ? <SponsorBox p={p} c={c} placement={sponsorPlacement} delayMs={420} /> : null}
      </div>
    );
  }

  const chrome: Chrome = {
    frame: (p, title, children, width) => <Board p={p} title={title} width={width}>{children}</Board>,
    strip: LowerStrip,
    event: EventBar,
    text: (p) => look(p, k).on,
    muted: (p) => look(p, k).muted,
    rule: (p) => look(p, k).rule,
    card: (p) => {
      const c = look(p, k);
      const s = surface(c);
      return { ...s.style, ...root(c), boxShadow: [s.inset, '0 16px 44px rgba(0,0,0,.35)'].filter(Boolean).join(', '), ...shape(c) };
    },
  };

  return {
    ...sharedGraphics(chrome),
    backdrop: Backdrop,
    scorebug: Scorebug,
    ident: Ident,
    lineup: Lineup,
    goal: Goal,
    score: Score,
    card: Card,
    substitution: Substitution,
    lower_third: LowerThird,
    player_card: PlayerCard,
    stats: Stats,
    break_score: BreakScore,
    period_banner: PeriodBanner,
    sponsor: Sponsor,
    full_frame_media: (p) => <FullFrameMedia p={p} />,
    ticker: Ticker,
    slate: Slate,
  };
}

export const PACKS: Record<'liga' | 'major' | 'southern' | 'continental' | 'primetime' | 'meister', Pack> = {
  liga: { key: 'liga', surface: 'paper', texture: 'arcs', corner: 'round', gap: 8, caps: false, italic: false, weight: 800, title: 'tab', rule: 'hot', scorebug: 'pill', brandTab: false, plate: 'deep', kicker: 'tab', kickerColour: 'hot', crest: 'plain', versus: 'badge', mark: 'dot', enter: 'scale', shine: false, backdrop: 'arcs' },
  major: { key: 'major', surface: 'smoke', texture: 'none', corner: 'round', gap: 6, caps: false, italic: false, weight: 600, title: 'eyebrow', rule: 'team', scorebug: 'row', brandTab: false, plate: 'clear', kicker: 'side', kickerColour: 'team', crest: 'plain', versus: 'quiet', mark: 'dot', enter: 'rise', shine: false, backdrop: 'glow' },
  southern: { key: 'southern', surface: 'flat', texture: 'stripes', corner: 'square', gap: 0, caps: true, italic: false, weight: 800, title: 'block', rule: 'spectrum', scorebug: 'blocks', brandTab: true, plate: 'paper', kicker: 'side', kickerColour: 'hot', crest: 'plain', versus: 'badge', mark: 'quad', enter: 'wipe-up', shine: false, backdrop: 'spectrum' },
  continental: { key: 'continental', surface: 'navy', texture: 'stars', corner: 'square', gap: 6, caps: true, italic: false, weight: 500, title: 'centre', rule: 'silver', scorebug: 'row', brandTab: true, plate: 'glow', kicker: 'tab', kickerColour: 'hot', crest: 'ring', versus: 'ring', mark: 'star', enter: 'fade', shine: true, backdrop: 'stars' },
  primetime: { key: 'primetime', surface: 'metal', texture: 'brushed', corner: 'slant', gap: 4, caps: true, italic: true, weight: 700, title: 'bar', rule: 'hot', scorebug: 'stacked', brandTab: false, plate: 'paper', kicker: 'side', kickerColour: 'hot', crest: 'plain', versus: 'badge', mark: 'bars', enter: 'wipe', shine: true, backdrop: 'slashes' },
  meister: { key: 'meister', surface: 'paper', texture: 'slashes', corner: 'slant', gap: 4, caps: true, italic: true, weight: 700, title: 'bar', rule: 'hot', scorebug: 'row', brandTab: true, plate: 'hot', kicker: 'side', kickerColour: 'hot', crest: 'plain', versus: 'badge', mark: 'slash', enter: 'wipe', shine: false, backdrop: 'shards' },
};

export const ligaTheme = packTheme(PACKS.liga);
export const majorTheme = packTheme(PACKS.major);
export const southernTheme = packTheme(PACKS.southern);
export const continentalTheme = packTheme(PACKS.continental);
export const primetimeTheme = packTheme(PACKS.primetime);
export const meisterTheme = packTheme(PACKS.meister);
