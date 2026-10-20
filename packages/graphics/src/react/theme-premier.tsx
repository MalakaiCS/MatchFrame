'use client';
// "Premier" theme: the top-flight football broadcast look. Deep purple carries the brand, hot magenta shouts,
// electric teal points, white paper holds the words, and everything is set in condensed uppercase type on a
// shared slant. An original design in that spirit: no league marks, lions or wordmarks anywhere.
import type { CSSProperties } from 'react';
import { animStyle, changeStyle, stagger, type GraphicProps, type ThemeComponents } from './stage';
import { FullFrameMedia, Fitted, Logo, Photo, SponsorMark, ThemeBadge, cardStyle, clockLabel, eventWord, kickoffCountdown, minute, periodBanner, personOrTeam, player, scorebugPosition, slateMessage, statRows, stoppageLabel, t, team, tickerText, tickerSpeed } from './common';
import { PresentedBy, sharedGraphics, type Chrome } from './shared-graphics';
import { lineupPage } from './theme-broadcast';

const SX = 96; // 5% title-safe
const SY = 54;
const UPPER: CSSProperties = { textTransform: 'uppercase', letterSpacing: 0.5 };
/** Which graphics show a player photo beside the team badge when one is on file. */
const PHOTO_EVENTS = ['builtin:goal', 'builtin:card', 'builtin:player_of_match'];

/** "#38003C" at 60% → rgba(): the look's ink at reduced strength for secondary copy and rules. */
function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${a})`;
}
/** White or deep ink, whichever reads on the given colour (cards keep their own colours). */
function inkOn(hex: string, deep: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#fff';
  const [r, g, b] = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? deep : '#fff';
}
/** Both edges cut on the same slant: the parallelogram every strap and kicker in this look is built from. */
const slant = (cut = 16): CSSProperties => ({ clipPath: `polygon(${cut}px 0, 100% 0, calc(100% - ${cut}px) 100%, 0 100%)` });
/** Only the right edge cut, for the leftmost piece of a strap. */
const slantRight = (cut = 16): CSSProperties => ({ clipPath: `polygon(0 0, 100% 0, calc(100% - ${cut}px) 100%, 0 100%)` });

/** Colour roles: deep (secondary) carries the brand, hot (primary) shouts, electric (accent) points, paper holds the words. */
function roles(p: GraphicProps) {
  const th = p.data.theme;
  return { deep: th.secondary, hot: th.primary, electric: th.accent, paper: th.panel, ink: th.text, muted: alpha(th.text, 0.62), rule: alpha(th.text, 0.12), font: th.font };
}

function Paper({ p, children, style }: { p: GraphicProps; children: React.ReactNode; style?: CSSProperties }) {
  const c = roles(p);
  return <div style={{ background: c.paper, color: c.ink, fontFamily: c.font, ...style }}>{children}</div>;
}

/** One-row scorebug: brand tab · HOME · 2–1 · AWAY · clock. The strip variant is the same bug, slimmer. */
function Scorebug(p: GraphicProps) {
  const slim = p.data.theme.scorebug?.variant === 'strip';
  const d = p.display;
  const c = roles(p);
  const H = slim ? 46 : 60;
  const stoppage = changeStyle(p, 'stoppage', !!d.stoppageText, 'flip'); // evaluated every render so the appearance itself animates
  const teamCell = (s: 'home' | 'away', i: number) => {
    const tm = team(p, s);
    const away = s === 'away';
    const detail = d.scoreDetail?.[s]?.split(' ')[0];
    const fouls = d.fouls ? `F ${d.fouls[s]}${d.bonus?.[s] ? ' ◆' : ''}` : null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: away ? '0 0 0 12px' : '0 12px 0 0', flexDirection: away ? 'row-reverse' : 'row', ...animStyle(p, away ? 'slide-right' : 'slide-left', 80 + i * 60, 360) }}>
        <span style={{ width: 9, alignSelf: 'stretch', background: tm.primaryColor, transformOrigin: 'top', ...animStyle(p, 'grow-y', 60 + i * 60, 300) }} />
        {!slim ? <Logo url={tm.logoUrl} label={tm.abbreviation} size={34} color={tm.primaryColor} radius={4} /> : null}
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: away ? 'flex-end' : 'flex-start', minWidth: 66 }}>
          <span style={{ fontSize: slim ? 24 : 30, fontWeight: 700, lineHeight: 1, ...UPPER }}>{tm.abbreviation}</span>
          {detail || fouls ? <span style={{ fontSize: 13, color: c.muted, letterSpacing: 1, lineHeight: 1.1 }}>{[detail, fouls].filter(Boolean).join(' · ')}</span> : null}
        </span>
        {d.possession === s ? <span style={{ width: 8, height: 8, borderRadius: 4, background: c.hot }} /> : null}
      </div>
    );
  };
  const scoreCell = (s: 'home' | 'away') => (
    <span style={{ minWidth: slim ? 38 : 48, textAlign: 'center', fontSize: slim ? 30 : 38, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
      <span style={changeStyle(p, `score-${s}`, d.score[s])}>{d.score[s]}</span>
    </span>
  );
  return (
    <div style={{ top: SY, display: 'flex', alignItems: 'stretch', height: H, fontFamily: c.font, ...scorebugPosition(p, SX), ...animStyle(p, 'wipe') }} data-graphic="scorebug">
      <div style={{ width: 26, background: c.hot, borderLeft: `6px solid ${c.electric}`, ...slantRight(12), ...animStyle(p, 'grow-y', 0, 320) }} />
      <Paper p={p} style={{ display: 'flex', alignItems: 'stretch', marginLeft: -10, paddingLeft: 12, borderRadius: '0 6px 6px 0', overflow: 'hidden' }}>
        {teamCell('home', 0)}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: c.deep, color: '#fff', padding: '0 10px', ...animStyle(p, 'drop', 200, 360) }}>
          {scoreCell('home')}
          <span style={{ opacity: 0.55, fontSize: 22, lineHeight: 1 }}>–</span>
          {scoreCell('away')}
        </div>
        {teamCell('away', 1)}
      </Paper>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', marginLeft: 6, padding: '0 16px', minWidth: 96, background: c.paper, color: c.ink, borderTop: `5px solid ${c.hot}`, borderRadius: 6, fontFamily: c.font, ...animStyle(p, 'drop', 260, 380) }}>
        <span style={{ fontSize: slim ? 24 : 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{clockLabel(p)}</span>
        <span style={{ fontSize: 12, letterSpacing: 2, color: c.hot, fontWeight: 700, lineHeight: 1.2, ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
      </div>
      {d.stoppageText ? <div style={{ display: 'grid', placeItems: 'center', marginLeft: 6, padding: '0 12px', background: c.electric, color: c.deep, fontSize: slim ? 20 : 24, fontWeight: 700, borderRadius: 6, ...animStyle(p, 'zoom', 320, 360) }}><span style={stoppage}>{stoppageLabel(p)}</span></div> : null}
      {d.shotClockText ? <div style={{ display: 'grid', placeItems: 'center', marginLeft: 6, width: 66, background: c.hot, color: '#fff', fontSize: 32, fontWeight: 700, borderRadius: 6, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'zoom', 300, 360) }}>{d.shotClockText}</div> : null}
      {d.shootout ? <Paper p={p} style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6, padding: '0 14px', fontSize: 20, fontWeight: 700, borderRadius: 6, ...UPPER, ...animStyle(p, 'zoom', 300, 360) }}><span style={{ color: c.hot, fontSize: 14, letterSpacing: 2 }}>{t(p, 'PENS')}</span><span style={changeStyle(p, 'pens', `${d.shootout.home}-${d.shootout.away}`)}>{d.shootout.home}–{d.shootout.away}</span></Paper> : null}
      {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <div style={{ display: 'grid', placeItems: 'center', marginLeft: 6, padding: '0 12px', background: 'rgba(255,255,255,.96)', borderRadius: 6, ...animStyle(p, 'zoom', 340, 380) }}><SponsorMark p={p} placement="scorebug_logo" height={slim ? 30 : 40} /></div> : null}
    </div>
  );
}

function SponsorBox({ p, placement, delayMs = 400 }: { p: GraphicProps; placement: string; delayMs?: number }) {
  const c = p.creative(placement, p.cue);
  if (!c) return null;
  return <div style={{ display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.96)', padding: '4px 18px', marginLeft: 8, borderRadius: 6, ...animStyle(p, 'zoom', delayMs, 400) }}><PresentedBy p={p} placement={placement} height={52} /></div>;
}

/** Kicker word on a slanted block, white paper body with the team's colour bar, electric tail. */
function EventBar(p: GraphicProps, label: string, accent: string, body: React.ReactNode) {
  const c = roles(p);
  const tm = team(p);
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 70, display: 'flex', alignItems: 'stretch', fontFamily: c.font, ...animStyle(p, 'slide-left') }} data-graphic={p.t.key}>
      <div style={{ background: accent, color: inkOn(accent, c.deep), fontSize: 34, fontWeight: 700, ...UPPER, letterSpacing: 2, padding: '0 34px 0 26px', display: 'grid', placeItems: 'center', zIndex: 1, ...slantRight(20), ...animStyle(p, 'zoom', 0, 420) }}>{label}</div>
      <Paper p={p} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 44px 14px 36px', marginLeft: -16, minWidth: 640, ...slant(20), ...animStyle(p, 'wipe', 120, 380) }}>
        <span style={{ width: 10, alignSelf: 'stretch', background: tm.primaryColor, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 220, 300) }} />
        <span style={animStyle(p, 'zoom', 260, 400)}><Logo url={tm.logoUrl} label={tm.abbreviation} size={64} color={tm.primaryColor} /></span>
        {PHOTO_EVENTS.includes(p.t.key) && player(p)?.photoUrl ? <span style={animStyle(p, 'zoom', 300, 400)}><Photo url={player(p)!.photoUrl} size={76} name={player(p)!.displayName} /></span> : null}
        <div style={{ display: 'flex', flexDirection: 'column', ...UPPER, ...animStyle(p, 'rise', 320, 360) }}>{body}</div>
      </Paper>
      <div style={{ width: 10, background: c.electric, marginLeft: -8, ...slant(20), ...animStyle(p, 'wipe', 200, 380) }} />
      <SponsorBox p={p} placement="event_partner" delayMs={460} />
    </div>
  );
}

function Goal(p: GraphicProps) {
  const c = roles(p);
  const who = personOrTeam(p);
  const sc = p.data.match.projection.score;
  return EventBar(p, eventWord(p), c.hot, (
    <>
      <Fitted full={who.primary} short={who.short} width={460} fontPx={42} measure={p.measure} />
      <span style={{ fontSize: 22, color: c.hot, fontWeight: 600, letterSpacing: 1, ...animStyle(p, 'rise', 420, 320) }}>{team(p).shortName} {minute(p)} · {team(p, 'home').abbreviation} {sc.home}–{sc.away} {team(p, 'away').abbreviation}</span>
    </>
  ));
}

function Score(p: GraphicProps) {
  const c = roles(p);
  const who = personOrTeam(p);
  const pts = p.cue.variables.points;
  return EventBar(p, `+${typeof pts === 'number' ? pts : ''}`, c.hot, (
    <>
      <Fitted full={who.primary} short={who.short} width={460} fontPx={40} measure={p.measure} />
      <span style={{ fontSize: 22, color: c.hot, fontWeight: 600, letterSpacing: 1, ...animStyle(p, 'rise', 420, 320) }}>{team(p).shortName}</span>
    </>
  ));
}

function Card(p: GraphicProps) {
  const c = roles(p);
  const cs = cardStyle(p);
  const who = personOrTeam(p);
  return EventBar(p, cs.word, cs.colour, (
    <>
      <Fitted full={who.primary} short={who.short} width={460} fontPx={40} measure={p.measure} />
      <span style={{ fontSize: 22, color: c.hot, fontWeight: 600, letterSpacing: 1, ...animStyle(p, 'rise', 420, 320) }}>{team(p).shortName} {minute(p)}</span>
    </>
  ));
}

function Substitution(p: GraphicProps) {
  const c = roles(p);
  const off = player(p, 'playerOut');
  const on = player(p, 'playerIn');
  const line = (arrow: string, colour: string, pl: typeof off, i: number) => (
    <span style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 30, ...animStyle(p, i ? 'slide-right' : 'slide-left', 360 + i * 120, 360) }}>
      <span style={{ color: colour, fontWeight: 700 }}>{arrow}</span>
      <span style={{ width: 44, color: c.muted, fontVariantNumeric: 'tabular-nums' }}>{pl?.number ?? ''}</span>
      <Fitted full={pl?.displayName ?? team(p).name} short={pl?.shortName} width={400} fontPx={30} measure={p.measure} />
    </span>
  );
  return EventBar(p, t(p, 'SUB'), c.deep, (
    <>
      {line('▲', '#1DB954', on, 0)}
      {line('▼', c.hot, off, 1)}
      <span style={{ fontSize: 20, color: c.muted, letterSpacing: 1, ...animStyle(p, 'rise', 600, 300) }}>{team(p).shortName} {minute(p)}</span>
    </>
  ));
}

function LowerThird(p: GraphicProps) {
  const c = roles(p);
  const img = p.cue.variables.image as string | undefined;
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 40, display: 'flex', alignItems: 'stretch', fontFamily: c.font, ...animStyle(p, 'slide-left') }} data-graphic="lower_third">
      <div style={{ width: 28, background: c.deep, borderLeft: `6px solid ${c.hot}`, ...slantRight(12), transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 0, 300) }} />
      {img && p.data.assets[img] ? <img alt="" src={p.data.assets[img]} style={{ width: 120, height: 120, objectFit: 'cover', ...animStyle(p, 'zoom', 120, 380) }} /> : null}
      <Paper p={p} style={{ padding: '16px 56px 14px 32px', minWidth: 720, marginLeft: -10, ...slant(24), ...animStyle(p, 'wipe', 100, 400) }}>
        <div style={{ ...UPPER, ...animStyle(p, 'rise', 220, 340) }}><Fitted full={String(p.cue.variables.heading ?? '')} width={880} fontPx={48} measure={p.measure} /></div>
        <div style={{ height: 4, width: 120, background: c.electric, margin: '6px 0 6px', transformOrigin: 'left', ...animStyle(p, 'grow-x', 300, 360) }} />
        {p.cue.variables.subtitle ? <div style={{ fontSize: 26, color: c.hot, fontWeight: 600, letterSpacing: 1, ...UPPER, ...animStyle(p, 'rise', 340, 340) }}><Fitted full={String(p.cue.variables.subtitle)} width={880} fontPx={26} weight={600} measure={p.measure} /></div> : null}
      </Paper>
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
    <div style={{ position: 'absolute', right: SX, bottom: SY + 60, width: 560, fontFamily: c.font, ...animStyle(p, 'slide-right') }} data-graphic="player_card">
      <div style={{ height: 8, background: `linear-gradient(90deg, ${tm.primaryColor} 0 70%, ${c.hot} 70% 100%)`, transformOrigin: 'left', ...animStyle(p, 'grow-x', 60, 380) }} />
      <Paper p={p} style={{ padding: 28, display: 'flex', gap: 24, alignItems: 'center', borderRadius: '0 0 6px 6px' }}>
        <span style={animStyle(p, 'zoom', 160, 420)}><Photo url={pl?.photoUrl} size={150} name={pl?.displayName ?? tm.name} /></span>
        <div style={UPPER}>
          <div style={{ fontSize: 64, fontWeight: 700, color: c.hot, lineHeight: 1, ...animStyle(p, 'drop', 240, 400) }}>{pl?.number ?? ''}</div>
          <div style={animStyle(p, 'rise', 320, 340)}><Fitted full={pl?.displayName ?? tm.name} short={pl?.shortName} width={320} fontPx={40} measure={p.measure} /></div>
          <div style={{ fontSize: 20, color: c.muted, letterSpacing: 1, ...animStyle(p, 'rise', 390, 320) }}>{pl?.position ?? ''} · {tm.shortName}</div>
          {statVal != null ? <div style={{ fontSize: 26, marginTop: 8, ...animStyle(p, 'rise', 460, 320) }}>{stat}: <b style={{ color: c.hot, ...changeStyle(p, 'stat', statVal) }}>{String(statVal)}</b></div> : null}
        </div>
      </Paper>
    </div>
  );
}

/** Full-frame board: deep title bar with a hot sweep, electric rule, white paper body. */
function FullPanel({ p, title, children, width = 1100 }: { p: GraphicProps; title: React.ReactNode; children: React.ReactNode; width?: number }) {
  const c = roles(p);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', top: 140, width, fontFamily: c.font, ...animStyle(p, 'slide-up') }} data-graphic={p.t.key}>
      <div style={{ background: `linear-gradient(100deg, ${c.deep} 0%, ${c.deep} 64%, ${c.hot} 64%, ${c.hot} 100%)`, color: '#fff', padding: '16px 40px 16px 32px', fontSize: 34, fontWeight: 700, ...UPPER, letterSpacing: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderRadius: '6px 6px 0 0', ...animStyle(p, 'wipe', 60, 420) }}>
        <div style={animStyle(p, 'rise', 160, 320)}>{title}</div>
        <ThemeBadge p={p} height={40} />
      </div>
      <div style={{ height: 6, background: c.electric, transformOrigin: 'left', ...animStyle(p, 'grow-x', 140, 360) }} />
      <Paper p={p} style={{ padding: 32, transformOrigin: 'top', borderRadius: '0 0 6px 6px', ...animStyle(p, 'grow-y', 120, 380) }}>{children}</Paper>
    </div>
  );
}

function TeamsHeader({ p, delayMs = 220 }: { p: GraphicProps; delayMs?: number }) {
  const c = roles(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 24, ...UPPER }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end', ...animStyle(p, 'slide-left', delayMs, 420) }}><Fitted full={h.name} short={h.shortName} width={330} fontPx={40} measure={p.measure} /><Logo url={h.logoUrl} label={h.abbreviation} size={96} color={h.primaryColor} /></div>
      <span style={{ fontSize: 28, color: c.hot, fontWeight: 700, ...animStyle(p, 'zoom', delayMs + 120, 380) }}>v</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, ...animStyle(p, 'slide-right', delayMs, 420) }}><Logo url={a.logoUrl} label={a.abbreviation} size={96} color={a.primaryColor} /><Fitted full={a.name} short={a.shortName} width={330} fontPx={40} measure={p.measure} /></div>
    </div>
  );
}

function Ident(p: GraphicProps) {
  const c = roles(p);
  const cd = p.cue.variables.showCountdown !== false ? kickoffCountdown(p) : null;
  const when = new Intl.DateTimeFormat('en-AU', { timeZone: p.data.match.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(p.data.match.scheduledAt));
  return (
    <FullPanel p={p} title={p.data.match.competition.name}>
      <TeamsHeader p={p} />
      <div style={{ textAlign: 'center', marginTop: 28, fontSize: 26, color: c.muted, letterSpacing: 1, ...UPPER, ...animStyle(p, 'rise', 420, 340) }}>{p.data.match.venue ?? ''}{p.data.match.venue ? ' · ' : ''}{when}</div>
      {cd ? <div style={{ textAlign: 'center', marginTop: 14, fontSize: 60, fontWeight: 700, color: c.hot, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'zoom', 500, 420) }}>{cd}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18, ...animStyle(p, 'fade', 580, 300) }}><SponsorMark p={p} placement="detached_logo" height={70} /></div>
    </FullPanel>
  );
}

function Lineup(p: GraphicProps) {
  const c = roles(p);
  const { s, starters, bench, page, pages } = lineupPage(p);
  const tm = team(p, s);
  return (
    <FullPanel p={p} width={980} title={<span style={{ display: 'flex', alignItems: 'center', gap: 16 }}><span style={animStyle(p, 'zoom', 200, 400)}><Logo url={tm.logoUrl} label={tm.abbreviation} size={44} color={tm.primaryColor} /></span> {tm.name}{pages > 1 ? ` (${page}/${pages})` : ''}</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 40px', ...UPPER }}>
        {starters.map((x, i) => (
          <div key={x.playerId} style={{ display: 'flex', gap: 16, alignItems: 'baseline', fontSize: 30, ...stagger(p, i, 'slide-left', 240, 45) }}>
            <span style={{ width: 48, textAlign: 'right', color: c.hot, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{x.number ?? ''}</span>
            <Fitted full={x.displayName} short={x.shortName} width={330} fontPx={30} measure={p.measure} />
            {x.captain ? <span style={{ fontSize: 16, color: c.muted }}>(C)</span> : null}
          </div>
        ))}
      </div>
      {bench.length ? <div style={{ marginTop: 20, fontSize: 20, color: c.muted, letterSpacing: 1, ...UPPER, ...stagger(p, starters.length + 1, 'rise', 240, 45) }}><span style={{ color: c.hot, fontWeight: 700 }}>{t(p, 'BENCH')}</span> {bench.map((x) => `${x.number ?? ''} ${x.shortName ?? x.displayName}`).join(' · ')}</div> : null}
      {!starters.length ? <div style={{ fontSize: 26, color: c.muted }}>{t(p, 'Lineup to be confirmed')}</div> : null}
    </FullPanel>
  );
}

function Stats(p: GraphicProps) {
  const c = roles(p);
  const rows = statRows(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  const d = p.display;
  return (
    <FullPanel p={p} width={900} title={t(p, 'MATCH STATS')}>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px', fontSize: 30, gap: '10px 0', ...UPPER }}>
        <span style={{ fontWeight: 700, color: h.primaryColor, ...animStyle(p, 'slide-left', 220, 340) }}>{h.abbreviation}</span>
        <span style={{ textAlign: 'center', fontSize: 44, fontWeight: 700, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'zoom', 260, 400) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></span>
        <span style={{ fontWeight: 700, color: a.primaryColor, textAlign: 'right', ...animStyle(p, 'slide-right', 220, 340) }}>{a.abbreviation}</span>
        {rows.map((r, i) => {
          const hv = Number(r.home ?? 0);
          const av = Number(r.away ?? 0);
          const tot = hv + av || 1;
          const row = stagger(p, i, 'rise', 300, 70);
          return (
            <div key={r.key} style={{ display: 'contents' }}>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', ...row }}><span style={changeStyle(p, `h-${r.key}`, r.home)}>{r.home ?? '—'}</span>{r.unit ?? ''}</span>
              <span style={{ textAlign: 'center', fontSize: 20, color: c.muted, letterSpacing: 1.5, ...row }}>
                {r.label}
                <span style={{ display: 'flex', height: 6, gap: 3, marginTop: 5, background: c.rule, borderRadius: 3, overflow: 'hidden' }}>
                  <span style={{ flex: hv / tot, background: h.primaryColor, transformOrigin: 'right', ...animStyle(p, 'grow-x', 380 + i * 70, 420) }} />
                  <span style={{ flex: av / tot, background: a.primaryColor, transformOrigin: 'left', ...animStyle(p, 'grow-x', 380 + i * 70, 420) }} />
                </span>
              </span>
              <span style={{ fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...row }}><span style={changeStyle(p, `a-${r.key}`, r.away)}>{r.away ?? '—'}</span>{r.unit ?? ''}</span>
            </div>
          );
        })}
      </div>
      {!rows.length ? <div style={{ color: c.muted, fontSize: 26 }}>{t(p, 'No statistics recorded yet')}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, ...animStyle(p, 'fade', 300 + rows.length * 70, 300) }}><SponsorMark p={p} placement="detached_logo" height={50} /></div>
    </FullPanel>
  );
}

function BreakScore(p: GraphicProps) {
  const c = roles(p);
  const d = p.display;
  const label = t(p, ((p.cue.variables.label as string) || d.periodLabel).toUpperCase());
  return (
    <FullPanel p={p} title={label} width={1000}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 30, ...UPPER }}>
        <div style={{ textAlign: 'right', ...animStyle(p, 'slide-left', 220, 420) }}><Fitted full={team(p, 'home').name} short={team(p, 'home').shortName} width={330} fontPx={40} measure={p.measure} /></div>
        <div style={{ fontSize: 100, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1, ...animStyle(p, 'zoom', 300, 460) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}<span style={{ color: c.hot }}>–</span>{d.score.away}</span></div>
        <div style={animStyle(p, 'slide-right', 220, 420)}><Fitted full={team(p, 'away').name} short={team(p, 'away').shortName} width={330} fontPx={40} measure={p.measure} /></div>
      </div>
      {d.shootout ? <div style={{ textAlign: 'center', fontSize: 28, color: c.hot, fontWeight: 600, ...UPPER, ...animStyle(p, 'rise', 420, 320) }}>{t(p, 'Penalties')} {d.shootout.home}–{d.shootout.away}</div> : null}
      <div style={{ textAlign: 'center', marginTop: 10, fontSize: 22, color: c.muted, letterSpacing: 1.5, ...UPPER, ...animStyle(p, 'rise', 460, 320) }}>{p.data.match.competition.name}</div>
      {p.cue.variables.showSponsor !== false ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16, ...animStyle(p, 'fade', 540, 300) }}><SponsorMark p={p} placement="detached_logo" height={64} /></div> : null}
    </FullPanel>
  );
}

function PeriodBanner(p: GraphicProps) {
  const c = roles(p);
  const { heading, period } = periodBanner(p);
  const d = p.display;
  const h = team(p, 'home');
  const a = team(p, 'away');
  const W = 940;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', bottom: SY + 50, width: W, fontFamily: c.font, ...UPPER, ...animStyle(p, 'slide-up') }} data-graphic="period_banner">
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: c.hot, color: '#fff', fontSize: 38, fontWeight: 700, letterSpacing: 4, padding: '8px 44px', ...slant(18), ...animStyle(p, 'zoom', 0, 460) }}>{t(p, heading)}</div>
      </div>
      <Paper p={p} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 24, padding: '18px 34px', marginTop: -4, borderTop: `5px solid ${c.deep}`, borderRadius: 6, ...animStyle(p, 'wipe', 140, 420) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'flex-end', ...animStyle(p, 'slide-left', 260, 400) }}><span style={{ fontSize: 34, fontWeight: 700 }}>{h.abbreviation}</span><Logo url={h.logoUrl} label={h.abbreviation} size={56} color={h.primaryColor} /></div>
        <div style={{ textAlign: 'center', ...animStyle(p, 'flip', 320, 460) }}>
          <div style={{ fontSize: 48, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></div>
          <div style={{ fontSize: 18, color: c.hot, fontWeight: 700, letterSpacing: 3 }}>{period}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...animStyle(p, 'slide-right', 260, 400) }}><Logo url={a.logoUrl} label={a.abbreviation} size={56} color={a.primaryColor} /><span style={{ fontSize: 34, fontWeight: 700 }}>{a.abbreviation}</span></div>
      </Paper>
      {p.creative('lower_third_banner', p.cue) ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8, ...animStyle(p, 'fade', 480, 300) }}><span style={{ background: 'rgba(255,255,255,.96)', padding: '6px 16px', borderRadius: 6 }}><SponsorMark p={p} placement="lower_third_banner" height={40} /></span></div> : null}
    </div>
  );
}

function Sponsor(p: GraphicProps) {
  const placement = (p.cue.variables.placement as string) ?? 'detached_logo';
  const c = p.creative(placement, p.cue) ?? (p.cue.variables.creative ? p.data.creatives[p.cue.variables.creative as string] : null);
  if (!c) return null;
  if (placement === 'full_frame_image') return <FullFrameMedia p={{ ...p, cue: { ...p.cue, variables: { ...p.cue.variables, creative: c.id } } }} />;
  const box: CSSProperties = placement === 'lower_third_banner' ? { left: SX, bottom: SY, height: 110 } : { right: SX, top: SY, height: 100 };
  return (
    <div style={{ position: 'absolute', ...box, background: 'rgba(255,255,255,.96)', padding: 14, display: 'grid', placeItems: 'center', borderRadius: 6, borderTop: `5px solid ${roles(p).hot}`, ...animStyle(p, placement === 'lower_third_banner' ? 'wipe' : 'zoom') }} data-graphic="sponsor">
      <img alt={c.brandName} src={c.url} style={{ height: '100%', objectFit: 'contain', ...animStyle(p, 'fade', 150, 300) }} data-sponsor-creative={c.id} />
    </div>
  );
}

function Ticker(p: GraphicProps) {
  const c = roles(p);
  const text = tickerText(p);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: SY - 10, height: 56, background: c.deep, color: '#fff', overflow: 'hidden', fontFamily: c.font, display: 'flex', alignItems: 'center', ...animStyle(p, 'slide-up') }} data-graphic="ticker">
      <div style={{ background: c.hot, color: '#fff', fontWeight: 700, ...UPPER, letterSpacing: 2, padding: '0 28px 0 22px', height: '100%', display: 'grid', placeItems: 'center', zIndex: 1, ...slantRight(14), ...animStyle(p, 'wipe', 100, 340) }}>{t(p, 'LATEST')}</div>
      <div style={{ ...animStyle(p, 'fade', 240, 400) }}>
        <div style={{ whiteSpace: 'nowrap', fontSize: 28, fontWeight: 600, ...UPPER, letterSpacing: 1, animation: `bs-ticker ${tickerSpeed(p)}s linear infinite`, paddingLeft: 40 }}>
          {text} &nbsp;&nbsp;<span style={{ color: c.electric }}>◆</span>&nbsp;&nbsp; {text} &nbsp;&nbsp;<span style={{ color: c.electric }}>◆</span>&nbsp;&nbsp;
        </div>
      </div>
    </div>
  );
}

function Slate(p: GraphicProps) {
  const c = roles(p);
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(118deg, ${c.deep} 0%, ${c.deep} 58%, ${c.hot} 58%, ${c.hot} 100%)`, color: '#fff', fontFamily: c.font, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, ...UPPER, ...animStyle(p, 'fade') }} data-graphic="slate">
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '11%', height: 6, background: c.electric, opacity: 0.6, transformOrigin: 'left', ...animStyle(p, 'grow-x', 80, 600) }} />
      <div style={{ position: 'relative', ...animStyle(p, 'fade', 100, 400) }}><ThemeBadge p={p} height={80} /></div>
      <div style={{ position: 'relative', width: 1100, background: 'rgba(255,255,255,.08)', padding: '24px 32px', borderRadius: 8 }}><TeamsHeader p={p} delayMs={200} /></div>
      <div style={{ position: 'relative', fontSize: 54, fontWeight: 700, letterSpacing: 2, ...animStyle(p, 'rise', 420, 420) }}>{slateMessage(p)}</div>
      <div style={{ position: 'relative', fontSize: 24, opacity: 0.8, letterSpacing: 2, ...animStyle(p, 'rise', 500, 360) }}>{p.data.match.competition.name}</div>
      <div style={{ position: 'relative', ...animStyle(p, 'fade', 600, 400) }}><SponsorMark p={p} placement="detached_logo" height={80} light /></div>
    </div>
  );
}

/** Lower-anchored strip (vertical kicker + paper) used by the shared match-information graphic. */
function LowerStrip(p: GraphicProps, kicker: string, color: string, body: React.ReactNode, sponsorPlacement?: string) {
  const c = roles(p);
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 40, display: 'flex', alignItems: 'stretch', fontFamily: c.font, ...animStyle(p, 'slide-left') }} data-graphic={p.t.key}>
      <div style={{ background: color, color: inkOn(color, c.deep), fontSize: 20, fontWeight: 700, ...UPPER, letterSpacing: 3, padding: '0 20px', display: 'grid', placeItems: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', ...animStyle(p, 'wipe', 0, 360) }}>{kicker}</div>
      <Paper p={p} style={{ padding: '16px 44px 16px 30px', minWidth: 700, maxWidth: 1300, borderTop: `5px solid ${c.deep}`, ...slant(22), ...animStyle(p, 'wipe', 100, 400) }}>{body}</Paper>
      {sponsorPlacement ? <SponsorBox p={p} placement={sponsorPlacement} delayMs={420} /> : null}
    </div>
  );
}

export const premierChrome: Chrome = {
  frame: (p, title, children, width) => <FullPanel p={p} title={title} width={width}>{children}</FullPanel>,
  strip: LowerStrip,
  event: EventBar,
  text: (p) => p.data.theme.text,
  muted: (p) => alpha(p.data.theme.text, 0.62),
  rule: (p) => alpha(p.data.theme.text, 0.12),
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
