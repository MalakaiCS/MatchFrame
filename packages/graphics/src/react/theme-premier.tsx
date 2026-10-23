'use client';
// "Premier" look: the top-flight football broadcast style of a motion graphics pack. Deep purple glass panels cut
// with angular facets, a cyan-to-magenta signature rule, white plates for the numbers that matter, crests on a soft
// glow and a geometric sans. Graphics build in layers: the panel wipes in, a light sweep crosses it, the words rise.
// An original design in that spirit: no league marks, lions or wordmarks anywhere.
import type { CSSProperties, ReactNode } from 'react';
import { occasionLine, type RenderTeam } from '../data';
import { animStyle, changeStyle, stagger, type GraphicProps, type ThemeComponents } from './stage';
import { FullFrameMedia, Fitted, Logo, Photo, SponsorMark, ThemeBadge, badgeUrl, cardStyle, clockLabel, eventWord, identInfo, minute, periodBanner, personOrTeam, player, scorebugPosition, slateMessage, statRows, stoppageLabel, t, team, tickerText, tickerSpeed, ScorebugTabs } from './common';
import { PresentedBy, sharedGraphics, type Chrome } from './shared-graphics';
import { lineupPage } from './theme-broadcast';

const SX = 96; // 5% title-safe
const SY = 54;
const CAPS: CSSProperties = { textTransform: 'uppercase', letterSpacing: 1.5 };
/** Which graphics show a player photo beside the team badge when one is on file. */
const PHOTO_EVENTS = ['builtin:goal', 'builtin:card', 'builtin:player_of_match'];
/** The substitution "on" arrow: a fixed bright green that reads on any of the look's panels. */
const ON_GREEN = '#00FF85';

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}
/** "#37003C" at 60% → rgba(). */
function alpha(hex: string, a: number): string {
  const c = rgb(hex);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex;
}
/** a → b by t (0..1), as hex: lighter and darker shades of the look's own colours without color-mix(). */
function mix(a: string, b: string, k: number): string {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, '0')).join('')}`;
}
/** White, or the given dark ink, whichever reads on the colour. */
function inkOn(hex: string, dark: string): string {
  const c = rgb(hex);
  if (!c) return '#fff';
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150 ? dark : '#fff';
}
const cutRight = (n = 18): CSSProperties => ({ clipPath: `polygon(0 0, 100% 0, calc(100% - ${n}px) 100%, 0 100%)` });
const cutLeft = (n = 18): CSSProperties => ({ clipPath: `polygon(${n}px 0, 100% 0, 100% 100%, 0 100%)` });

/**
 * Colour roles. deep (secondary) is the glass every panel is made of, hot (primary) shouts, electric (accent)
 * points; paper and ink (panel, text) are the white plates that carry scores. `on` is the text colour on glass.
 */
function roles(p: GraphicProps) {
  const th = p.data.theme;
  const deep = th.secondary;
  const hot = th.primary;
  const electric = th.accent;
  const on = inkOn(deep, '#1A0420');
  return {
    deep,
    hot,
    electric,
    paper: th.panel,
    ink: th.text,
    font: th.font,
    on,
    onMuted: alpha(on, 0.68),
    onRule: alpha(on, 0.14),
    glass: `linear-gradient(135deg, ${mix(deep, hot, 0.12)} 0%, ${deep} 50%, ${mix(deep, '#000000', 0.3)} 100%)`,
    signature: `linear-gradient(90deg, ${electric}, ${hot})`,
  };
}
type Roles = ReturnType<typeof roles>;

/** The white plate a score or a key number sits on. */
const plate = (c: Roles, extra?: CSSProperties): CSSProperties => ({ background: c.paper, color: c.ink, borderRadius: 8, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1, ...extra });

/** Angular shards cut across a panel: the look's texture. They move with the panel's own entrance. */
function Facets({ p, flip = false, strength = 1 }: { p: GraphicProps; flip?: boolean; strength?: number }) {
  const c = roles(p);
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', transform: flip ? 'scaleX(-1)' : undefined }}>
      <polygon points="62,0 100,0 100,100 34,100" fill={alpha(c.hot, 0.11 * strength)} />
      <polygon points="80,0 100,0 100,58" fill={alpha(c.electric, 0.12 * strength)} />
      <polygon points="44,0 50,0 22,100 16,100" fill={alpha('#ffffff', 0.05 * strength)} />
      <polygon points="0,70 14,100 0,100" fill={alpha(c.electric, 0.1 * strength)} />
    </svg>
  );
}

/** One light sweep across a panel as it lands. Nothing is drawn once it has passed (or with motion off). */
function Shine({ p, delayMs = 300 }: { p: GraphicProps; delayMs?: number }) {
  if (p.phase === 'out') return null;
  const a = animStyle(p, 'shine', delayMs, 900);
  if (!a.animationName) return null;
  return <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '35%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent)', opacity: 0, pointerEvents: 'none', ...a }} />;
}

/** The signature rule along the bottom edge of a panel. */
function EdgeRule({ p, delayMs = 280, height = 4 }: { p: GraphicProps; delayMs?: number; height?: number }) {
  return <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height, background: roles(p).signature, transformOrigin: 'left', ...animStyle(p, 'grow-x', delayMs, 420) }} />;
}

/** A deep glass panel with the facet texture behind its content. */
function Glass({ p, children, style, inner, radius = 10, facets = true, flip }: { p: GraphicProps; children: ReactNode; style?: CSSProperties; inner?: CSSProperties; radius?: number | string; facets?: boolean; flip?: boolean }) {
  const c = roles(p);
  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: c.glass, color: c.on, fontFamily: c.font, borderRadius: radius, boxShadow: '0 18px 48px rgba(12,0,24,.42)', ...style }}>
      {facets ? <Facets p={p} flip={flip} /> : null}
      <div style={{ position: 'relative', height: '100%', ...inner }}>{children}</div>
    </div>
  );
}

/** The look's own mark for the brand tab when the organisation has no logo: two parallel shards. */
function Mark({ p, size }: { p: GraphicProps; size: number }) {
  return (
    <svg aria-hidden viewBox="0 0 40 40" width={size} height={size}>
      <polygon points="5,34 19,6 26,6 12,34" fill="#ffffff" />
      <polygon points="16,34 30,6 37,6 23,34" fill={roles(p).electric} />
    </svg>
  );
}

/** A team crest on a soft glow of the team's colour. */
function Crest({ tm, size }: { tm: RenderTeam; size: number }) {
  return (
    <span style={{ display: 'grid', placeItems: 'center', width: Math.round(size * 1.7), height: Math.round(size * 1.7), margin: Math.round(size * -0.1), borderRadius: '50%', background: `radial-gradient(closest-side, ${alpha(tm.primaryColor, 0.7)} 0%, ${alpha(tm.primaryColor, 0.25)} 62%, transparent 100%)` }}>
      <Logo url={tm.logoUrl} label={tm.abbreviation} size={size} color={tm.primaryColor} radius={Math.round(size * 0.12)} />
    </span>
  );
}

/** A sponsor's logo on a white plate, so a dark logo still reads on the glass. Nothing when there is no sponsor. */
function SponsorPlate({ p, placement, height, delayMs = 560 }: { p: GraphicProps; placement: string; height: number; delayMs?: number }) {
  if (!p.creative(placement, p.cue)) return null;
  return (
    <span style={{ display: 'inline-grid', placeItems: 'center', background: 'rgba(255,255,255,.96)', padding: '6px 16px', borderRadius: 8, ...animStyle(p, 'fade', delayMs, 300) }}>
      <SponsorMark p={p} placement={placement} height={height} />
    </span>
  );
}

/** One-row scorebug: brand tab · HOME [2 | 1] AWAY, then the clock. The strip variant is the same bug, slimmer. */
function Scorebug(p: GraphicProps) {
  const slim = p.data.theme.scorebug?.variant === 'strip';
  const d = p.display;
  const c = roles(p);
  const H = slim ? 46 : 58;
  const stoppage = changeStyle(p, 'stoppage', !!d.stoppageText, 'flip'); // evaluated every render so the appearance itself animates
  const teamCell = (s: 'home' | 'away', i: number) => {
    const tm = team(p, s);
    const away = s === 'away';
    const detail = d.scoreDetail?.[s]?.split(' ')[0];
    const fouls = d.fouls ? `F ${d.fouls[s]}${d.bonus?.[s] ? ' ◆' : ''}` : null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: away ? '0 16px 0 12px' : '0 12px 0 16px', flexDirection: away ? 'row-reverse' : 'row', ...animStyle(p, away ? 'slide-right' : 'slide-left', 140 + i * 60, 360) }}>
        <span style={{ width: 6, height: H - 24, borderRadius: 3, background: tm.primaryColor, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 120 + i * 60, 300) }} />
        {!slim ? <Logo url={tm.logoUrl} label={tm.abbreviation} size={32} color={tm.primaryColor} radius={6} /> : null}
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: away ? 'flex-end' : 'flex-start', minWidth: 60 }}>
          <span style={{ fontSize: slim ? 22 : 26, fontWeight: 700, lineHeight: 1, letterSpacing: 1 }}>{tm.abbreviation}</span>
          {detail || fouls ? <span style={{ fontSize: 12, color: c.onMuted, letterSpacing: 1, lineHeight: 1.25 }}>{[detail, fouls].filter(Boolean).join(' · ')}</span> : null}
        </span>
        {d.possession === s ? <span style={{ width: 8, height: 8, borderRadius: 4, background: c.electric, boxShadow: `0 0 10px ${c.electric}` }} /> : null}
      </div>
    );
  };
  const score = (s: 'home' | 'away') => (
    <span style={{ minWidth: slim ? 26 : 32, textAlign: 'center' }}>
      <span style={changeStyle(p, `score-${s}`, d.score[s])}>{d.score[s]}</span>
    </span>
  );
  const tab: CSSProperties = { display: 'grid', placeItems: 'center', borderRadius: 8, fontWeight: 800 };
  return (
    <div style={{ top: SY, display: 'flex', alignItems: 'stretch', gap: 6, height: H, fontFamily: c.font, ...scorebugPosition(p, SX), ...animStyle(p, 'wipe') }} data-graphic="scorebug">
      <Glass p={p} radius={8} facets={false} inner={{ display: 'flex', alignItems: 'stretch' }}>
        <span style={{ minWidth: H, display: 'grid', placeItems: 'center', padding: badgeUrl(p) ? '0 8px' : 0, background: `linear-gradient(135deg, ${c.hot}, ${mix(c.hot, c.deep, 0.45)})`, transformOrigin: 'top', ...animStyle(p, 'grow-y', 0, 320) }}>
          {badgeUrl(p) ? <ThemeBadge p={p} height={H - 18} /> : <Mark p={p} size={H - 20} />}
        </span>
        {teamCell('home', 0)}
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, margin: '7px 0', padding: '0 6px', fontSize: slim ? 26 : 32, ...plate(c), ...animStyle(p, 'drop', 220, 380) }}>
          {score('home')}
          <span style={{ width: 2, height: '50%', background: alpha(c.ink, 0.22) }} />
          {score('away')}
        </span>
        {teamCell('away', 1)}
        <EdgeRule p={p} delayMs={260} height={3} />
        <Shine p={p} delayMs={380} />
      </Glass>
      <Glass p={p} radius={8} facets={false} style={animStyle(p, 'drop', 280, 380)} inner={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 16px', minWidth: 104 }}>
        <span style={{ fontSize: slim ? 23 : 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{clockLabel(p)}</span>
        <span style={{ fontSize: 11, letterSpacing: 2, color: c.electric, fontWeight: 700, lineHeight: 1.3, ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
      </Glass>
      {d.stoppageText ? <div style={{ ...tab, padding: '0 12px', background: c.electric, color: inkOn(c.electric, c.deep), fontSize: slim ? 20 : 24, ...animStyle(p, 'zoom', 320, 360) }}><span style={stoppage}>{stoppageLabel(p)}</span></div> : null}
      {d.shotClockText ? <div style={{ ...tab, width: 66, background: c.hot, color: inkOn(c.hot, c.deep), fontSize: 32, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'zoom', 300, 360) }}>{d.shotClockText}</div> : null}
      {d.shootout ? (
        <Glass p={p} radius={8} facets={false} style={animStyle(p, 'zoom', 300, 360)} inner={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', fontSize: 20, fontWeight: 700 }}>
          <span style={{ color: c.electric, fontSize: 13, letterSpacing: 2 }}>{t(p, 'PENS')}</span>
          <span style={changeStyle(p, 'pens', `${d.shootout.home}-${d.shootout.away}`)}>{d.shootout.home}–{d.shootout.away}</span>
        </Glass>
      ) : null}
      {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <div style={{ ...tab, padding: '0 12px', background: 'rgba(255,255,255,.96)', ...animStyle(p, 'zoom', 340, 380) }}><SponsorMark p={p} placement="scorebug_logo" height={slim ? 30 : 40} /></div> : null}
      <ScorebugTabs p={p} />
    </div>
  );
}

function SponsorBox({ p, placement, delayMs = 400 }: { p: GraphicProps; placement: string; delayMs?: number }) {
  const c = p.creative(placement, p.cue);
  if (!c) return null;
  return (
    <div style={{ position: 'relative', overflow: 'hidden', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.96)', padding: '4px 18px 8px', marginLeft: 8, borderRadius: 10, ...animStyle(p, 'zoom', delayMs, 400) }}>
      <PresentedBy p={p} placement={placement} height={52} />
      <EdgeRule p={p} delayMs={delayMs + 120} />
    </div>
  );
}

/** Kicker word on a faceted block, then a glass body with the team's colour bar and badge. */
function EventBar(p: GraphicProps, label: string, accent: string, body: ReactNode) {
  const c = roles(p);
  const tm = team(p);
  const pl = PHOTO_EVENTS.includes(p.t.key) ? player(p) : null;
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 64, display: 'flex', alignItems: 'stretch', fontFamily: c.font, ...animStyle(p, 'slide-left') }} data-graphic={p.t.key}>
      <div style={{ position: 'relative', zIndex: 1, ...animStyle(p, 'zoom', 0, 460) }}>
        <div style={{ position: 'relative', overflow: 'hidden', height: '100%', display: 'grid', placeItems: 'center', padding: '0 46px 0 30px', borderRadius: '10px 0 0 10px', background: `linear-gradient(135deg, ${mix(accent, '#ffffff', 0.12)}, ${mix(accent, c.deep, 0.3)})`, color: inkOn(accent, c.deep), fontSize: 46, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', ...cutRight(24) }}>
          <Facets p={p} strength={0.7} />
          <span style={{ position: 'relative' }}>{label}</span>
        </div>
      </div>
      <div style={{ marginLeft: -24, ...animStyle(p, 'wipe', 120, 420) }}>
        <Glass p={p} radius="0 10px 10px 0" style={{ height: '100%', minWidth: 680, ...cutLeft(24) }} inner={{ display: 'flex', alignItems: 'center', gap: 18, padding: '16px 46px 20px 50px' }}>
          <span style={{ width: 8, alignSelf: 'stretch', borderRadius: 4, background: tm.primaryColor, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 220, 300) }} />
          <span style={animStyle(p, 'zoom', 260, 420)}><Logo url={tm.logoUrl} label={tm.abbreviation} size={68} color={tm.primaryColor} /></span>
          {pl?.photoUrl ? <span style={animStyle(p, 'zoom', 300, 420)}><Photo url={pl.photoUrl} size={78} name={pl.displayName} /></span> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...animStyle(p, 'rise', 320, 360) }}>{body}</div>
          <EdgeRule p={p} delayMs={300} />
          <Shine p={p} delayMs={460} />
        </Glass>
      </div>
      <SponsorBox p={p} placement="event_partner" delayMs={480} />
    </div>
  );
}

const subline = (c: Roles, p: GraphicProps, text: string, delayMs = 420): ReactNode => (
  <span style={{ fontSize: 21, color: c.electric, fontWeight: 600, ...CAPS, ...animStyle(p, 'rise', delayMs, 320) }}>{text}</span>
);

function Goal(p: GraphicProps) {
  const c = roles(p);
  const who = personOrTeam(p);
  const sc = p.data.match.projection.score;
  return EventBar(p, eventWord(p), c.hot, (
    <>
      <Fitted full={who.primary} short={who.short} width={480} fontPx={44} measure={p.measure} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {subline(c, p, `${team(p).shortName} ${minute(p)}`)}
        <span style={{ fontSize: 20, padding: '4px 10px', ...plate(c, { borderRadius: 6 }), ...animStyle(p, 'zoom', 480, 340) }}>{team(p, 'home').abbreviation} {sc.home}–{sc.away} {team(p, 'away').abbreviation}</span>
      </span>
    </>
  ));
}

function Score(p: GraphicProps) {
  const c = roles(p);
  const who = personOrTeam(p);
  const pts = p.cue.variables.points;
  return EventBar(p, `+${typeof pts === 'number' ? pts : ''}`, c.hot, (
    <>
      <Fitted full={who.primary} short={who.short} width={480} fontPx={42} measure={p.measure} />
      {subline(c, p, team(p).shortName)}
    </>
  ));
}

function Card(p: GraphicProps) {
  const c = roles(p);
  const cs = cardStyle(p);
  const who = personOrTeam(p);
  return EventBar(p, cs.word, cs.colour, (
    <>
      <Fitted full={who.primary} short={who.short} width={480} fontPx={42} measure={p.measure} />
      {subline(c, p, `${team(p).shortName} ${minute(p)}`)}
    </>
  ));
}

function Substitution(p: GraphicProps) {
  const c = roles(p);
  const off = player(p, 'playerOut');
  const on = player(p, 'playerIn');
  const line = (arrow: string, colour: string, pl: typeof off, i: number) => (
    <span style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 30, ...animStyle(p, i ? 'slide-right' : 'slide-left', 360 + i * 120, 360) }}>
      <span style={{ color: colour, fontWeight: 800 }}>{arrow}</span>
      <span style={{ width: 44, color: c.onMuted, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pl?.number ?? ''}</span>
      <Fitted full={pl?.displayName ?? team(p).name} short={pl?.shortName} width={420} fontPx={30} measure={p.measure} />
    </span>
  );
  return EventBar(p, t(p, 'SUB'), c.electric, (
    <>
      {line('▲', ON_GREEN, on, 0)}
      {line('▼', c.hot, off, 1)}
      {subline(c, p, `${team(p).shortName} ${minute(p)}`, 600)}
    </>
  ));
}

function LowerThird(p: GraphicProps) {
  const c = roles(p);
  const img = p.cue.variables.image as string | undefined;
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 40, display: 'flex', alignItems: 'stretch', fontFamily: c.font, ...animStyle(p, 'slide-left') }} data-graphic="lower_third">
      <div style={{ width: 16, borderRadius: '10px 0 0 10px', background: `linear-gradient(180deg, ${c.electric}, ${c.hot})`, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 0, 300) }} />
      {img && p.data.assets[img] ? <img alt="" src={p.data.assets[img]} style={{ width: 124, height: 124, objectFit: 'cover', ...animStyle(p, 'zoom', 120, 380) }} /> : null}
      <div style={animStyle(p, 'wipe', 100, 420)}>
        <Glass p={p} radius="0 10px 10px 0" style={{ height: '100%', minWidth: 760 }} inner={{ padding: '18px 64px 20px 30px' }}>
          <div style={animStyle(p, 'rise', 220, 340)}><Fitted full={String(p.cue.variables.heading ?? '')} width={900} fontPx={50} measure={p.measure} /></div>
          <div style={{ height: 4, width: 150, borderRadius: 2, background: c.signature, margin: '8px 0', transformOrigin: 'left', ...animStyle(p, 'grow-x', 300, 380) }} />
          {p.cue.variables.subtitle ? <div style={{ color: c.electric, ...animStyle(p, 'rise', 340, 340) }}><Fitted full={String(p.cue.variables.subtitle).toUpperCase()} width={900} fontPx={24} weight={600} measure={p.measure} style={{ letterSpacing: 1.5 }} /></div> : null}
          <Shine p={p} delayMs={420} />
        </Glass>
      </div>
      <SponsorBox p={p} placement="lower_third_banner" delayMs={420} />
    </div>
  );
}

function PlayerCard(p: GraphicProps) {
  const c = roles(p);
  const pl = player(p);
  const tm = team(p);
  const stat = p.cue.variables.stat as string | undefined;
  const tally = pl ? p.data.match.projection.players[pl.playerId] : null;
  const statVal = stat && tally ? (tally as Record<string, unknown>)[stat] : null;
  return (
    <div style={{ position: 'absolute', right: SX, bottom: SY + 60, width: 580, fontFamily: c.font, ...animStyle(p, 'slide-right') }} data-graphic="player_card">
      <div style={{ height: 6, borderRadius: '10px 10px 0 0', background: `linear-gradient(90deg, ${tm.primaryColor} 0 55%, ${c.electric} 55%, ${c.hot} 100%)`, transformOrigin: 'left', ...animStyle(p, 'grow-x', 60, 380) }} />
      <Glass p={p} radius="0 0 10px 10px" inner={{ padding: 28, display: 'flex', gap: 24, alignItems: 'center' }}>
        <span style={{ padding: 4, borderRadius: '50%', background: c.signature, display: 'grid', ...animStyle(p, 'zoom', 160, 420) }}><Photo url={pl?.photoUrl} size={146} name={pl?.displayName ?? tm.name} /></span>
        <div>
          <div style={{ fontSize: 68, fontWeight: 800, color: c.electric, lineHeight: 1, ...animStyle(p, 'drop', 240, 400) }}>{pl?.number ?? ''}</div>
          <div style={animStyle(p, 'rise', 320, 340)}><Fitted full={pl?.displayName ?? tm.name} short={pl?.shortName} width={320} fontPx={40} measure={p.measure} /></div>
          <div style={{ fontSize: 18, color: c.onMuted, fontWeight: 600, ...CAPS, ...animStyle(p, 'rise', 390, 320) }}>{[pl?.position, tm.shortName].filter(Boolean).join(' · ')}</div>
          {statVal != null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 18, color: c.onMuted, ...CAPS, ...animStyle(p, 'rise', 460, 320) }}>
              {stat}
              <b style={{ fontSize: 24, padding: '4px 10px', ...plate(c, { borderRadius: 6 }), ...changeStyle(p, 'stat', statVal) }}>{String(statVal)}</b>
            </div>
          ) : null}
        </div>
        <EdgeRule p={p} delayMs={360} />
        <Shine p={p} delayMs={420} />
      </Glass>
    </div>
  );
}

/** Full-frame board: a faceted title bar with a light sweep, the signature rule, then the glass body. */
function FullPanel({ p, title, children, width = 1100 }: { p: GraphicProps; title: ReactNode; children: ReactNode; width?: number }) {
  const c = roles(p);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', top: 130, width, fontFamily: c.font, ...animStyle(p, 'slide-up') }} data-graphic={p.t.key}>
      <div style={{ display: 'flex', alignItems: 'stretch', height: 74 }}>
        <div style={{ width: 22, borderRadius: '10px 0 0 0', background: `linear-gradient(180deg, ${c.electric}, ${c.hot})`, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 0, 320) }} />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', borderRadius: '0 10px 0 0', background: `linear-gradient(100deg, ${mix(c.deep, '#000000', 0.18)} 0%, ${c.deep} 52%, ${mix(c.deep, c.hot, 0.6)} 100%)`, color: c.on, ...animStyle(p, 'wipe', 60, 460) }}>
          <Facets p={p} strength={0.8} />
          <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '0 34px 0 26px', fontSize: 32, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase' }}>
            <div style={animStyle(p, 'rise', 180, 340)}>{title}</div>
            <ThemeBadge p={p} height={42} />
          </div>
          <Shine p={p} delayMs={380} />
        </div>
      </div>
      <div style={{ height: 5, background: c.signature, transformOrigin: 'left', ...animStyle(p, 'grow-x', 160, 380) }} />
      <div style={{ transformOrigin: 'top', ...animStyle(p, 'grow-y', 120, 400) }}>
        <Glass p={p} radius="0 0 12px 12px" inner={{ padding: 34 }}>{children}</Glass>
      </div>
    </div>
  );
}

function TeamsHeader({ p, delayMs = 220, centre = 'VS', score = false, crest = 96 }: { p: GraphicProps; delayMs?: number; centre?: string; score?: boolean; crest?: number }) {
  const c = roles(p);
  const side = (s: 'home' | 'away') => {
    const tm = team(p, s);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', delayMs, 440) }}>
        <Crest tm={tm} size={crest} />
        <Fitted full={tm.name} short={tm.shortName} width={340} fontPx={38} measure={p.measure} />
      </div>
    );
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 28 }}>
      {side('home')}
      {score ? (
        <span style={{ fontSize: 76, padding: '10px 30px', ...plate(c, { borderRadius: 12 }), ...animStyle(p, 'zoom', delayMs + 120, 400) }}><span style={changeStyle(p, 'score', centre)}>{centre}</span></span>
      ) : (
        <span style={{ minWidth: 88, height: 88, padding: '0 18px', borderRadius: 44, display: 'grid', placeItems: 'center', background: c.signature, color: '#fff', fontSize: centre.length > 3 ? 24 : 32, fontWeight: 800, letterSpacing: 1, boxShadow: `0 0 40px ${alpha(c.hot, 0.45)}`, ...animStyle(p, 'zoom', delayMs + 120, 400) }}>{centre}</span>
      )}
      {side('away')}
    </div>
  );
}

function Ident(p: GraphicProps) {
  const c = roles(p);
  const info = identInfo(p);
  return (
    <FullPanel p={p} title={p.data.match.competition.name} width={1160}>
      <TeamsHeader p={p} centre={info.centre} score={info.started} crest={120} />
      <div style={{ textAlign: 'center', marginTop: 24, fontSize: info.started ? 28 : 22, fontWeight: info.started ? 800 : 500, color: info.started ? c.electric : c.onMuted, letterSpacing: info.started ? 4 : 1.5, textTransform: 'uppercase', ...animStyle(p, 'rise', 420, 340) }}>{info.line}</div>
      {info.countdown ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 16, ...animStyle(p, 'zoom', 500, 420) }}>
          <span style={{ background: c.hot, color: inkOn(c.hot, c.deep), fontSize: 18, fontWeight: 800, letterSpacing: 2.5, padding: '8px 22px', borderRadius: 8, ...cutRight(10) }}>{info.countdown.label}</span>
          <span style={{ fontSize: 62, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{info.countdown.text}</span>
        </div>
      ) : null}
      {info.message ? (
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 42, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', ...animStyle(p, 'rise', 520, 360) }}>
          {info.message}
          <div style={{ height: 5, width: 180, margin: '12px auto 0', borderRadius: 3, background: c.signature, transformOrigin: 'center', ...animStyle(p, 'grow-x', 640, 360) }} />
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}><SponsorPlate p={p} placement="detached_logo" height={62} delayMs={580} /></div>
    </FullPanel>
  );
}

function Lineup(p: GraphicProps) {
  const c = roles(p);
  const { s, starters, bench, page, pages } = lineupPage(p);
  const tm = team(p, s);
  const formation = p.data.match.lineup.formations?.[s];
  return (
    <FullPanel p={p} width={1160} title={`${t(p, 'STARTING LINE-UP')}${pages > 1 ? ` (${page}/${pages})` : ''}`}>
      <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: 40, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, paddingTop: 10, ...animStyle(p, 'slide-left', 200, 440) }}>
          <Crest tm={tm} size={150} />
          <Fitted full={tm.name} short={tm.shortName} width={320} fontPx={36} measure={p.measure} />
          {formation ? <span style={{ fontSize: 18, letterSpacing: 2, color: c.onMuted, fontWeight: 600 }}>{t(p, 'FORMATION')} <b style={{ color: c.electric }}>{formation}</b></span> : null}
        </div>
        <div>
          {starters.map((x, i) => (
            <div key={x.playerId} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 0', borderBottom: `1px solid ${c.onRule}`, ...stagger(p, i, 'slide-right', 260, 45) }}>
              <span style={{ width: 52, height: 36, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 6, background: alpha(c.electric, 0.16), color: c.electric, fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{x.number ?? ''}</span>
              <Fitted full={x.displayName} short={x.shortName} width={520} fontPx={28} weight={600} measure={p.measure} />
              {x.captain ? <span style={{ width: 26, height: 26, flex: 'none', borderRadius: '50%', background: c.hot, color: inkOn(c.hot, c.deep), fontSize: 14, fontWeight: 800, display: 'grid', placeItems: 'center' }}>C</span> : null}
              {x.position ? <span style={{ marginLeft: 'auto', color: c.onMuted, fontSize: 15, fontWeight: 600, ...CAPS }}>{x.position}</span> : null}
            </div>
          ))}
          {!starters.length ? <div style={{ fontSize: 26, color: c.onMuted, paddingTop: 20 }}>{t(p, 'Lineup to be confirmed')}</div> : null}
        </div>
      </div>
      {bench.length ? (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${c.onRule}`, fontSize: 19, color: c.onMuted, ...stagger(p, starters.length + 1, 'rise', 260, 45) }}>
          <span style={{ color: c.electric, fontWeight: 800, letterSpacing: 2 }}>{t(p, 'SUBSTITUTES')}</span> {bench.map((x) => `${x.number ?? ''} ${x.shortName ?? x.displayName}`.trim()).join(' · ')}
        </div>
      ) : null}
    </FullPanel>
  );
}

function Stats(p: GraphicProps) {
  const c = roles(p);
  const rows = statRows(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  const d = p.display;
  const head = (tm: RenderTeam, s: 'home' | 'away') => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexDirection: s === 'home' ? 'row' : 'row-reverse', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', 220, 360) }}>
      <Logo url={tm.logoUrl} label={tm.abbreviation} size={48} color={tm.primaryColor} />
      <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>{tm.abbreviation}</span>
    </span>
  );
  return (
    <FullPanel p={p} width={960} title={t(p, 'MATCH STATS')}>
      <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 170px', alignItems: 'center', gap: '12px 0' }}>
        {head(h, 'home')}
        <span style={{ justifySelf: 'center', fontSize: 40, padding: '6px 20px', ...plate(c), ...animStyle(p, 'zoom', 260, 400) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></span>
        {head(a, 'away')}
        {rows.map((r, i) => {
          const hv = Number(r.home ?? 0);
          const av = Number(r.away ?? 0);
          const tot = hv + av || 1;
          const lead = hv === av ? null : hv > av ? 'home' : 'away';
          const row = stagger(p, i, 'rise', 300, 70);
          const val = (s: 'home' | 'away', v: unknown) => (
            <span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', textAlign: s === 'home' ? 'left' : 'right', color: lead === s || !lead ? c.on : c.onMuted, ...row }}>
              <span style={changeStyle(p, `${s === 'home' ? 'h' : 'a'}-${r.key}`, v)}>{v == null ? '—' : String(v)}</span>{r.unit ?? ''}
            </span>
          );
          const bar = (s: 'home' | 'away', share: number, colour: string) => (
            <span style={{ flex: 1, display: 'flex', justifyContent: s === 'home' ? 'flex-end' : 'flex-start', background: c.onRule, borderRadius: 4, overflow: 'hidden' }}>
              <span style={{ width: `${share * 100}%`, background: colour, borderRadius: 4, transformOrigin: s === 'home' ? 'right' : 'left', ...animStyle(p, 'grow-x', 380 + i * 70, 420) }} />
            </span>
          );
          return (
            <div key={r.key} style={{ display: 'contents' }}>
              {val('home', r.home)}
              <span style={{ textAlign: 'center', ...row }}>
                <span style={{ fontSize: 16, letterSpacing: 2, color: c.onMuted, fontWeight: 600 }}>{r.label.toUpperCase()}</span>
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
      {!rows.length ? <div style={{ color: c.onMuted, fontSize: 26 }}>{t(p, 'No statistics recorded yet')}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><SponsorPlate p={p} placement="detached_logo" height={44} delayMs={300 + rows.length * 70} /></div>
    </FullPanel>
  );
}

function BreakScore(p: GraphicProps) {
  const c = roles(p);
  const d = p.display;
  const label = t(p, ((p.cue.variables.label as string) || d.periodLabel).toUpperCase());
  const side = (s: 'home' | 'away') => {
    const tm = team(p, s);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', 220, 420) }}>
        <Crest tm={tm} size={110} />
        <Fitted full={tm.name} short={tm.shortName} width={330} fontPx={36} measure={p.measure} />
      </div>
    );
  };
  return (
    <FullPanel p={p} title={label} width={1080}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 30 }}>
        {side('home')}
        <div style={{ fontSize: 104, padding: '12px 34px', ...plate(c, { borderRadius: 14 }), ...animStyle(p, 'zoom', 300, 460) }}>
          <span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}<span style={{ color: c.hot, margin: '0 6px' }}>–</span>{d.score.away}</span>
        </div>
        {side('away')}
      </div>
      {d.shootout ? <div style={{ textAlign: 'center', marginTop: 14, fontSize: 26, color: c.electric, fontWeight: 700, ...CAPS, ...animStyle(p, 'rise', 420, 320) }}>{t(p, 'Penalties')} {d.shootout.home}–{d.shootout.away}</div> : null}
      <div style={{ textAlign: 'center', marginTop: 18, fontSize: 20, color: c.onMuted, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', ...animStyle(p, 'rise', 460, 320) }}>{occasionLine(p.data.match)}</div>
      {p.cue.variables.showSponsor !== false ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}><SponsorPlate p={p} placement="detached_logo" height={58} delayMs={540} /></div> : null}
    </FullPanel>
  );
}

function PeriodBanner(p: GraphicProps) {
  const c = roles(p);
  const { heading, period } = periodBanner(p);
  const d = p.display;
  const side = (s: 'home' | 'away') => {
    const tm = team(p, s);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'flex-end', flexDirection: s === 'home' ? 'row' : 'row-reverse', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', 260, 400) }}>
        <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: 1 }}>{tm.abbreviation}</span>
        <Logo url={tm.logoUrl} label={tm.abbreviation} size={58} color={tm.primaryColor} />
      </div>
    );
  };
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', bottom: SY + 50, width: 980, fontFamily: c.font, ...animStyle(p, 'slide-up') }} data-graphic="period_banner">
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ position: 'relative', overflow: 'hidden', background: `linear-gradient(90deg, ${c.hot}, ${mix(c.hot, c.deep, 0.35)})`, color: inkOn(c.hot, c.deep), fontSize: 36, fontWeight: 800, letterSpacing: 5, padding: '10px 52px', borderRadius: '10px 10px 0 0', ...animStyle(p, 'zoom', 0, 460) }}>
          <Facets p={p} strength={0.6} />
          <span style={{ position: 'relative' }}>{t(p, heading)}</span>
        </div>
      </div>
      <div style={animStyle(p, 'wipe', 140, 440)}>
        <Glass p={p} radius={12} inner={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 26, padding: '20px 36px 24px' }}>
          {side('home')}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, ...animStyle(p, 'flip', 320, 460) }}>
            <span style={{ fontSize: 50, padding: '6px 20px', ...plate(c) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></span>
            <span style={{ fontSize: 16, color: c.electric, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' }}>{period}</span>
          </div>
          {side('away')}
          <EdgeRule p={p} delayMs={300} />
          <Shine p={p} delayMs={440} />
        </Glass>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}><SponsorPlate p={p} placement="lower_third_banner" height={40} delayMs={480} /></div>
    </div>
  );
}

function Sponsor(p: GraphicProps) {
  const placement = (p.cue.variables.placement as string) ?? 'detached_logo';
  const c = p.creative(placement, p.cue) ?? (p.cue.variables.creative ? p.data.creatives[p.cue.variables.creative as string] : null);
  if (!c) return null;
  if (placement === 'full_frame_image') return <FullFrameMedia p={{ ...p, cue: { ...p.cue, variables: { ...p.cue.variables, creative: c.id } } }} />;
  const h = placement === 'lower_third_banner' ? 110 : 100;
  const box: CSSProperties = placement === 'lower_third_banner' ? { left: SX, bottom: SY, height: h } : { right: SX, top: SY, height: h };
  return (
    <div style={{ position: 'absolute', ...box, overflow: 'hidden', background: 'rgba(255,255,255,.96)', padding: '14px 14px 18px', display: 'grid', placeItems: 'center', borderRadius: 10, boxShadow: '0 12px 36px rgba(12,0,24,.35)', ...animStyle(p, placement === 'lower_third_banner' ? 'wipe' : 'zoom') }} data-graphic="sponsor">
      <img alt={c.brandName} src={c.url} style={{ height: h - 32, maxWidth: (h - 32) * 4, objectFit: 'contain', ...animStyle(p, 'fade', 150, 300) }} data-sponsor-creative={c.id} />
      <EdgeRule p={p} delayMs={200} />
    </div>
  );
}

function Ticker(p: GraphicProps) {
  const c = roles(p);
  const text = tickerText(p);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: SY - 10, height: 58, background: c.glass, color: c.on, overflow: 'hidden', fontFamily: c.font, display: 'flex', alignItems: 'center', ...animStyle(p, 'slide-up') }} data-graphic="ticker">
      <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: c.signature, transformOrigin: 'left', ...animStyle(p, 'grow-x', 60, 420) }} />
      <div style={{ background: `linear-gradient(135deg, ${c.hot}, ${mix(c.hot, c.deep, 0.35)})`, color: inkOn(c.hot, c.deep), fontWeight: 800, letterSpacing: 2.5, padding: '0 34px 0 24px', height: '100%', display: 'grid', placeItems: 'center', zIndex: 1, ...cutRight(16), ...animStyle(p, 'wipe', 100, 340) }}>{t(p, 'LATEST')}</div>
      <div style={animStyle(p, 'fade', 240, 400)}>
        <div style={{ whiteSpace: 'nowrap', fontSize: 26, fontWeight: 600, ...CAPS, letterSpacing: 1, animation: `bs-ticker ${tickerSpeed(p)}s linear infinite`, paddingLeft: 40 }}>
          {text} &nbsp;&nbsp;<span style={{ color: c.electric }}>◆</span>&nbsp;&nbsp; {text} &nbsp;&nbsp;<span style={{ color: c.electric }}>◆</span>&nbsp;&nbsp;
        </div>
      </div>
    </div>
  );
}

function Slate(p: GraphicProps) {
  const c = roles(p);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: `radial-gradient(ellipse at 72% 28%, ${mix(c.deep, c.hot, 0.35)} 0%, ${c.deep} 55%, ${mix(c.deep, '#000000', 0.35)} 100%)`, color: c.on, fontFamily: c.font, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 36, ...animStyle(p, 'fade') }} data-graphic="slate">
      <Facets p={p} strength={1.2} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '12%', height: 6, background: c.signature, opacity: 0.8, transformOrigin: 'left', ...animStyle(p, 'grow-x', 80, 600) }} />
      <div style={{ position: 'relative', ...animStyle(p, 'fade', 100, 400) }}><ThemeBadge p={p} height={84} /></div>
      <div style={{ position: 'relative', width: 1160 }}>
        <Glass p={p} radius={14} inner={{ padding: '30px 36px' }}><TeamsHeader p={p} delayMs={200} crest={100} centre={t(p, 'VS')} /></Glass>
      </div>
      <div style={{ position: 'relative', fontSize: 54, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', ...animStyle(p, 'rise', 420, 420) }}>{slateMessage(p)}</div>
      <div style={{ position: 'relative', fontSize: 22, color: c.onMuted, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', ...animStyle(p, 'rise', 500, 360) }}>{occasionLine(p.data.match)}</div>
      <div style={{ position: 'relative', ...animStyle(p, 'fade', 600, 400) }}><SponsorMark p={p} placement="detached_logo" height={80} light /></div>
    </div>
  );
}

/** Lower-anchored strip (vertical kicker + glass) used by the shared match-information graphic. */
function LowerStrip(p: GraphicProps, kicker: string, color: string, body: ReactNode, sponsorPlacement?: string) {
  const c = roles(p);
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 40, display: 'flex', alignItems: 'stretch', fontFamily: c.font, ...animStyle(p, 'slide-left') }} data-graphic={p.t.key}>
      {/* rotated half a turn, so its right-hand corners are the ones on the left */}
      <div style={{ background: `linear-gradient(0deg, ${color}, ${mix(color, c.deep, 0.35)})`, color: inkOn(color, c.deep), fontSize: 18, fontWeight: 800, letterSpacing: 3, padding: '0 18px', display: 'grid', placeItems: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', borderRadius: '0 10px 10px 0', ...animStyle(p, 'wipe', 0, 360) }}>{kicker}</div>
      <div style={animStyle(p, 'wipe', 100, 420)}>
        <Glass p={p} radius="0 10px 10px 0" style={{ height: '100%', minWidth: 720, maxWidth: 1340 }} inner={{ padding: '18px 46px 22px 30px' }}>
          {body}
          <EdgeRule p={p} delayMs={300} />
          <Shine p={p} delayMs={420} />
        </Glass>
      </div>
      {sponsorPlacement ? <SponsorBox p={p} placement={sponsorPlacement} delayMs={420} /> : null}
    </div>
  );
}

export const premierChrome: Chrome = {
  frame: (p, title, children, width) => <FullPanel p={p} title={title} width={width}>{children}</FullPanel>,
  strip: LowerStrip,
  event: EventBar,
  text: (p) => roles(p).on,
  muted: (p) => roles(p).onMuted,
  rule: (p) => roles(p).onRule,
  card: (p) => {
    const c = roles(p);
    return { background: c.glass, color: c.on, borderRadius: 12, boxShadow: '0 18px 48px rgba(12,0,24,.42)', borderBottom: `4px solid ${c.electric}` };
  },
};

export const premierTheme: ThemeComponents = {
  ...sharedGraphics(premierChrome),
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
