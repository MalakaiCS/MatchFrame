'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { breakCountdown, getAdapter } from '@bs/domain';
import { fitLabel } from '../fit';
import { occasionLine, type RenderPlayer, type RenderTeam } from '../data';
import { animStyle, changeStyle, useAudioPolicy, type GraphicProps } from './stage';

export function side(p: GraphicProps): 'home' | 'away' {
  return p.cue.variables.team === 'away' ? 'away' : 'home';
}
export function team(p: GraphicProps, s = side(p)): RenderTeam {
  return p.data.match.teams[s];
}
export function player(p: GraphicProps, key = 'player'): RenderPlayer | null {
  const id = p.cue.variables[key];
  return typeof id === 'string' ? (p.data.players[id] ?? null) : null;
}
/** Event graphics fall back to the team name when no player was recorded — never invent a player. */
export function personOrTeam(p: GraphicProps, key = 'player') {
  const pl = player(p, key);
  return pl ? { primary: pl.displayName, short: pl.shortName ?? null, number: pl.number } : { primary: team(p).name, short: team(p).shortName, number: null };
}
export function minute(p: GraphicProps): string {
  const m = p.cue.variables.minute;
  return typeof m === 'string' && m ? (m.endsWith("'") ? m : `${m}'`) : '';
}

export function Fitted({ full, short, width, fontPx, minFontPx, measure, style, weight = 700 }: { full: string; short?: string | null; width: number; fontPx: number; minFontPx?: number; measure: GraphicProps['measure']; style?: CSSProperties; weight?: number }) {
  const r = fitLabel({ full, short, maxWidth: width, fontPx, minFontPx: minFontPx ?? Math.round(fontPx * 0.65), measure });
  return (
    <span title={full} style={{ display: 'inline-block', maxWidth: width, whiteSpace: 'nowrap', overflow: 'hidden', fontSize: r.fontPx, fontWeight: weight, lineHeight: 1.1, ...style }}>
      {r.text}
    </span>
  );
}

/** Logo with a local placeholder: missing/broken images never block output. */
export function Logo({ url, label, size, color, radius = 6 }: { url: string | null | undefined; label: string; size: number; color: string; radius?: number }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken)
    return (
      <span aria-hidden style={{ width: size, height: size, borderRadius: radius, background: color, display: 'inline-grid', placeItems: 'center', color: '#fff', fontSize: size * 0.36, fontWeight: 800, flex: 'none' }}>
        {label.slice(0, 3).toUpperCase()}
      </span>
    );
  return <img alt="" src={url} onError={() => setBroken(true)} style={{ width: size, height: size, objectFit: 'contain', flex: 'none' }} />;
}

export function Photo({ url, size, name }: { url: string | null | undefined; size: number; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken)
    return (
      <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: '#8a93a3', display: 'inline-grid', placeItems: 'center', color: '#ffffff', fontSize: size * 0.32, fontWeight: 700 }}>
        {name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
      </span>
    );
  return <img alt="" src={url} onError={() => setBroken(true)} style={{ width: size, height: size, objectFit: 'cover', borderRadius: '50%' }} />;
}

export function statRows(p: GraphicProps) {
  const keys = typeof p.cue.variables.rows === 'string' && p.cue.variables.rows ? (p.cue.variables.rows as string).split(',').map((s) => s.trim()) : null;
  const rows = keys ? p.data.match.statRows.filter((r) => keys.includes(r.key)) : p.data.match.statRows.slice(0, 6);
  const st = p.data.match.projection.stats;
  return rows.map((r) => ({ ...r, home: st.home?.[r.key], away: st.away?.[r.key] }));
}

export function SponsorMark({ p, placement, height, light }: { p: GraphicProps; placement: string; height: number; light?: boolean }) {
  const c = p.creative(placement, p.cue);
  if (!c) return null;
  return <img alt={c.brandName} src={c.url} style={{ height, maxWidth: height * 4, objectFit: 'contain', filter: light ? 'none' : undefined }} data-sponsor-creative={c.id} />;
}

/** Full-frame media with explicit audio policy; programme gain is restored when the cue ends or is interrupted. */
export function FullFrameMedia({ p }: { p: GraphicProps }) {
  const audio = useAudioPolicy();
  const ref = useRef<HTMLVideoElement>(null);
  const creativeId = p.cue.variables.creative as string | undefined;
  const assetId = p.cue.variables.image as string | undefined;
  const c = creativeId ? p.data.creatives[creativeId] : null;
  const url = c?.url ?? (assetId ? p.data.assets[assetId] : null);
  const isVideo = c ? c.kind === 'video' : !!url && /\.(mp4|webm)(\?|$)/.test(url);
  const policy = (p.cue.variables.audio as string) ?? 'muted';
  useEffect(() => {
    if (!isVideo || p.phase === 'out') return;
    if (policy === 'replace') audio?.setProgrammeGain(0);
    if (policy === 'duck') audio?.setProgrammeGain(0.2);
    return () => audio?.setProgrammeGain(1);
  }, [isVideo, policy, audio, p.phase]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = policy === 'muted';
    const target = p.offsetMs / 1000;
    if (Math.abs(v.currentTime - target) > 0.5) v.currentTime = target;
    void v.play().catch(() => undefined);
  }, [policy, p.offsetMs]);
  if (!url) return <div style={{ position: 'absolute', inset: 0, background: '#0B1220' }} />;
  const fit = (p.cue.variables.fit as 'contain' | 'cover') ?? 'contain';
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      {isVideo ? (
        <video ref={ref} src={url} playsInline preload="auto" style={{ width: '100%', height: '100%', objectFit: fit }} data-sponsor-creative={c?.id} />
      ) : (
        <img alt="" src={url} style={{ width: '100%', height: '100%', objectFit: fit }} data-sponsor-creative={c?.id} />
      )}
    </div>
  );
}

export function tickerSpeed(p: GraphicProps) {
  const s = p.cue.variables.speed;
  return s === 'slow' ? 60 : s === 'fast' ? 20 : 35;
}

export function slateMessage(p: GraphicProps): string {
  const custom = p.cue.variables.text;
  if (typeof custom === 'string' && custom) return custom;
  switch (p.cue.variables.message) {
    case 'pre_game': return 'Coverage starts soon';
    case 'interval': return 'Back after the break';
    case 'end': return 'Thanks for watching';
    default: return 'Waiting for the feed';
  }
}

/** Time to kick-off however far away: "14:58", "2:14:58", or "3d 02:14:58" more than a day out (`at`: another match's kick-off). */
export function kickoffCountdown(p: GraphicProps, at: string = p.data.match.scheduledAt): string | null {
  const ms = new Date(at).getTime() - p.now;
  if (!(ms > 0)) return null;
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}`;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${s}`;
  return `${m}:${s}`;
}

/** The logo for the title bars of full-screen graphics and the slate: the competition's when it has one, else the look's own. */
export function badgeUrl(p: GraphicProps): string | null {
  return p.data.match.competition.logoUrl || p.data.theme.logoUrl || null;
}

/** The competition's (or else the look's) logo, shown in the title bars of full-screen graphics and on the slate. */
export function ThemeBadge({ p, height }: { p: GraphicProps; height: number }) {
  const [broken, setBroken] = useState(false);
  const url = badgeUrl(p);
  if (!url || broken) return null;
  return <img alt="" src={url} onError={() => setBroken(true)} style={{ height, maxWidth: height * 3, objectFit: 'contain', flex: 'none' }} />;
}

/** Heading and period for the kick-off / period banner. */
export function periodBanner(p: GraphicProps): { heading: string; period: string } {
  const heading = typeof p.cue.variables.heading === 'string' && p.cue.variables.heading ? p.cue.variables.heading : 'KICK-OFF';
  const period = typeof p.cue.variables.period === 'string' && p.cue.variables.period ? p.cue.variables.period : p.display.periodLabel;
  // a banner headed by the period itself ("HALF TIME") names the competition under the score instead of repeating it
  return { heading: heading.toUpperCase(), period: period.toUpperCase() === heading.toUpperCase() ? occasionLine(p.data.match) : period };
}

// ---------------------------------------------------------------- wording, clock and score helpers shared by every theme

/** On-air wording with the look's overrides applied (keyed by the default English label). */
export function t(p: GraphicProps, label: string): string {
  return p.data.theme.wording?.[label] ?? label;
}

/** The clock as the look wants it: "63:12", or "63'" when seconds are hidden. */
export function clockLabel(p: GraphicProps): string {
  const txt = p.display.clockText;
  if (p.data.theme.clock?.hideSeconds) {
    const m = /^(\d+):(\d\d)$/.exec(txt);
    if (m) return `${m[1]}'`;
  }
  return txt;
}

/** Added time as "+2:14" or, with the label style, "ADDED TIME 2:14". */
export function stoppageLabel(p: GraphicProps): string | null {
  const s = p.display.stoppageText;
  if (!s) return null;
  return p.data.theme.clock?.stoppage === 'label' ? `${t(p, 'ADDED TIME')} ${s.replace(/^\+/, '')}` : s;
}

/** The score as the sport prints it (AFL "12.7 (79)"), else the number. */
export function scoreText(p: GraphicProps, s: 'home' | 'away'): string {
  return p.display.scoreDetail?.[s] ?? String(p.display.score[s]);
}

const EVENT_WORDS: Record<string, string> = {
  goal: 'GOAL', own_goal: 'OWN GOAL', penalty_scored: 'PENALTY', try: 'TRY', penalty_try: 'PENALTY TRY', conversion: 'CONVERSION',
  penalty_goal: 'PENALTY GOAL', field_goal: 'FIELD GOAL', behind: 'BEHIND', rushed_behind: 'RUSHED BEHIND',
};
/** The headline word for a scoring event, by code: GOAL, TRY, PENALTY GOAL, SUPER SHOT… */
export function eventWord(p: GraphicProps): string {
  const et = String(p.cue.variables.eventType ?? 'goal');
  const pts = Number(p.cue.variables.points ?? 0);
  if (p.data.match.sport === 'netball' && pts === 2) return t(p, 'SUPER SHOT');
  if (et === 'field_goal' && pts === 2) return `${t(p, 'FIELD GOAL')} (2)`;
  return t(p, EVENT_WORDS[et] ?? 'GOAL');
}

const CARDS: Record<string, { word: string; colour: string; dark: boolean }> = {
  yellow: { word: 'YELLOW CARD', colour: '#FFCE66', dark: true },
  second_yellow: { word: 'SECOND YELLOW', colour: '#E5484D', dark: false },
  red: { word: 'RED CARD', colour: '#E5484D', dark: false },
  green: { word: 'GREEN CARD', colour: '#55D99D', dark: true },
  sin_bin: { word: 'SIN BIN', colour: '#FFCE66', dark: true },
};
/** Card wording and colour for football, hockey and rugby league cards. */
export function cardStyle(p: GraphicProps): { word: string; colour: string; dark: boolean } {
  const c = CARDS[String(p.cue.variables.cardType ?? 'yellow')] ?? CARDS.yellow!;
  return { ...c, word: t(p, c.word) };
}

const shortTime = (iso: string, tz: string) => {
  try {
    return new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return '';
  }
};
/** Ticker content: the operator's text, or the other scores around the grounds. */
export function tickerText(p: GraphicProps): string {
  if (p.cue.variables.mode === 'scores') {
    const list = p.data.season?.otherScores ?? [];
    if (!list.length) return t(p, 'No other matches today');
    return list
      .map((f) => (f.score ? `${f.home.abbreviation} ${f.scoreDetail?.home ?? f.score.home}–${f.scoreDetail?.away ?? f.score.away} ${f.away.abbreviation}${f.live ? ` (${t(p, 'LIVE')})` : ''}` : `${f.home.abbreviation} v ${f.away.abbreviation} ${shortTime(f.scheduledAt, p.data.match.timezone)}`))
      .join('   •   ');
  }
  return String(p.cue.variables.text ?? '');
}

const WEATHER_GLYPH: Record<string, string> = { sunny: '☀', cloudy: '☁', rain: '☂', wind: '≋', storm: '⚡', snow: '❄', indoor: '⌂' };
/** "Bayside Oval · Referee: Sam Lee · 1,204 · ☀ 24°" from the match information fields. */
export function matchInfoItems(p: GraphicProps): { label: string; value: string }[] {
  const m = p.data.match;
  const out: { label: string; value: string }[] = [];
  if (m.venue) out.push({ label: t(p, 'VENUE'), value: m.venue });
  const offs = m.officials ?? [];
  const ref = offs.find((o) => o.role === 'referee' || o.role === 'umpire');
  if (ref) out.push({ label: t(p, ref.role === 'umpire' ? 'UMPIRE' : 'REFEREE'), value: ref.name });
  const assistants = offs.filter((o) => o.role.startsWith('assistant') || o.role === 'touch_judge').map((o) => o.name);
  if (assistants.length) out.push({ label: t(p, 'ASSISTANTS'), value: assistants.join(', ') });
  if (m.attendance != null) out.push({ label: t(p, 'ATTENDANCE'), value: m.attendance.toLocaleString('en-AU') });
  if (m.weather && (m.weather.tempC != null || m.weather.condition || m.weather.summary)) {
    const g = m.weather.condition ? WEATHER_GLYPH[m.weather.condition] ?? '' : '';
    out.push({ label: t(p, 'WEATHER'), value: [g, m.weather.tempC != null ? `${Math.round(m.weather.tempC)}°` : '', m.weather.summary ?? ''].filter(Boolean).join(' ') });
  }
  return out;
}

/** Scorebug anchoring from the look's position setting (left is the default). */
export function scorebugPosition(p: GraphicProps, inset: number): CSSProperties {
  const pos = p.data.theme.scorebug?.position ?? 'left';
  if (pos === 'right') return { position: 'absolute', right: inset };
  if (pos === 'centre') return { position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', width: 'fit-content' };
  return { position: 'absolute', left: inset };
}

/**
 * Small tabs just below the scorebug: the added time announced for the period ("ADDED +4") and each team's timed
 * suspension (a rugby league sin bin, futsal's time a player short after a send-off) with its countdown. Every
 * look's scorebug places this as its last child, so it sits under the bug whatever the bug's height and side.
 */
export function ScorebugTabs({ p }: { p: GraphicProps }) {
  const d = p.display;
  const th = p.data.theme;
  const timers = d.timers ?? [];
  // evaluated on every render, so a tab appearing (or a new sin bin) flips in on air
  const pop = changeStyle(p, 'scorebug-tabs', `${d.addedMinutes ?? ''}|${timers.map((x) => `${x.side}:${x.kind}:${x.count}`).join(',')}`, 'flip');
  if (!d.addedMinutes && !timers.length) return null;
  const pos = th.scorebug?.position ?? 'left';
  const radius = Math.min(th.radius, 8);
  const tab: CSSProperties = { display: 'inline-flex', alignItems: 'stretch', height: 40, background: th.panel, color: th.text, borderRadius: radius, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,.35)', fontSize: 19, fontWeight: 700, lineHeight: 1 };
  const word: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 12px', letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 16 };
  const pill: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 12px', background: th.accent, color: inkOn(th.accent), fontVariantNumeric: 'tabular-nums', fontSize: 22, fontWeight: 800 };
  return (
    <div data-scorebug-tabs style={{ position: 'absolute', top: 'calc(100% + 8px)', ...(pos === 'right' ? { right: 0 } : pos === 'centre' ? { left: '50%', transform: 'translateX(-50%)' } : { left: 0 }), display: 'flex', gap: 6, whiteSpace: 'nowrap', fontFamily: th.font, ...animStyle(p, 'fade', 360, 300) }}>
      <span style={{ ...pop, display: 'flex', gap: 6 }}>
        {d.addedMinutes ? (
          <span data-tab="added" style={tab}>
            <span style={word}>{t(p, 'ADDED')}</span>
            <span style={pill}>+{d.addedMinutes}</span>
          </span>
        ) : null}
        {timers.map((x) => {
          const tm = p.data.match.teams[x.side];
          return (
            <span key={`${x.side}-${x.kind}`} data-tab={x.kind} data-side={x.side} style={tab}>
              <span style={{ width: 7, background: tm.primaryColor }} />
              <span style={{ ...word, paddingRight: 0, fontSize: 19, letterSpacing: 0.5 }}>{tm.abbreviation}</span>
              <span style={word}>{x.count > 1 ? `${x.count}× ` : ''}{t(p, x.kind === 'sin_bin' ? 'SIN BIN' : 'SENT OFF')}</span>
              <span style={pill}>{x.remainingText}</span>
            </span>
          );
        })}
      </span>
    </div>
  );
}

/** How many players a team has had sent off: red cards (and second yellows), or a rugby league send-off. */
export function redCards(p: GraphicProps, s: 'home' | 'away'): number {
  const st = p.data.match.projection.stats?.[s] ?? {};
  return (st.red_cards ?? 0) + (st.send_offs ?? 0);
}

/**
 * The red card for a team that has had a player sent off: a small red card standing on the scorebug's top edge above
 * the team's crest, tucked behind the bug, with the number on it from two (`edge: 'left'`: lying out of the left end
 * of the team's row, for a scorebug with a row per team). It sits in a box laid over the bug's panel that is a
 * stacking context (`RED_CARD_BOX`): `x` is the crest's centre from that side of the box, `y` the row's centre.
 */
export function RedCardTab({ p, side, size = 24, edge = 'top', from = 'left', x = 0, y = 0 }: { p: GraphicProps; side: 'home' | 'away'; size?: number; edge?: 'top' | 'left'; from?: 'left' | 'right'; x?: number; y?: number }) {
  const n = redCards(p, side);
  // evaluated on every render, so a card shown during the match pops up on air
  const pop = changeStyle(p, `red-${side}`, n);
  if (!n) return null;
  const tm = p.data.match.teams[side];
  const short = Math.round(size * 0.7);
  const tuck = Math.round(size * 0.26);
  const [w, h] = edge === 'top' ? [short, size] : [size, short];
  const place: CSSProperties = edge === 'top' ? { bottom: `calc(100% - ${tuck}px)`, [from]: Math.round(x - w / 2), paddingBottom: tuck } : { right: `calc(100% - ${tuck}px)`, top: Math.round(y - h / 2), paddingRight: tuck };
  return (
    <span data-red-cards={side} data-count={n} role="img" aria-label={`${tm.shortName || tm.name}: ${n} red card${n > 1 ? 's' : ''}`} style={{ ...pop, position: 'absolute', zIndex: -1, visibility: 'visible', ...place, display: 'grid', placeItems: 'center', boxSizing: 'border-box', width: w, height: h, borderRadius: Math.max(2, Math.round(size * 0.1)), background: 'linear-gradient(160deg, #FF2A2A 0%, #D5101A 75%)', boxShadow: '0 1px 4px rgba(0,0,0,.45)', color: '#FFFFFF', fontSize: Math.round(short * 0.72), fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n > 1 ? n : null}</span>
  );
}

/** The box a scorebug panel goes in for its red cards: they stand behind the panel and out of its edge. */
export const RED_CARD_BOX: CSSProperties = { position: 'relative', zIndex: 0, display: 'flex' };

/** "PRESENTED BY" caption used beside moment sponsors (goals, cards, player of the match). */
export function presentedBy(p: GraphicProps): string {
  return t(p, 'PRESENTED BY');
}

// ---------------------------------------------------------------- match header (ident) and animated background

/** Dark ink on a light colour, white on a dark one (6-digit hex; anything else counts as dark). */
export function inkOn(bg: string, dark = '#0B1220'): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg);
  if (!m) return '#FFFFFF';
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.6 ? dark : '#FFFFFF';
}

/** "#38003C" at 0.6 → "rgba(56,0,60,0.6)"; anything that is not a 6-digit hex is returned unchanged. */
export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${a})`;
}

const mmss = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * Countdown to the restart during a break ("2nd Half in 8:42"): from when the break began, its length in the rules
 * (half time, quarter breaks, extra-time and overtime breaks) and the next playing period. Null when the length is
 * unknown or the time has passed.
 */
export function restartCountdown(p: GraphicProps): { label: string; text: string } | null {
  const m = p.data.match;
  const left = breakCountdown(m.sport, m.rulesConfig, m.projection, p.now);
  return left ? { label: t(p, `${left.next.toUpperCase()} IN`), text: mmss(left.msLeft) } : null;
}

export interface IdentInfo {
  /** true once the match has kicked off: the header shows the score instead of "VS" */
  started: boolean;
  centre: string;
  /** pre-match: "Bayside Oval · Saturday 21 October, 3:00 pm"; later: "HALF TIME", "FULL TIME" */
  line: string;
  countdown: { label: string; text: string } | null;
  message: string | null;
}

/** What the match header shows right now, shared by every look so they all tell the same story. */
export function identInfo(p: GraphicProps): IdentInfo {
  const m = p.data.match;
  const adapter = getAdapter(m.sport);
  const cfg = m.rulesConfig as never;
  const def = adapter.phase(cfg, m.projection.phase);
  const kind = def?.kind ?? 'pre';
  const show = String(p.cue.variables.show ?? 'auto');
  const started = show === 'score' || (show !== 'countdown' && (kind === 'play' || kind === 'break' || kind === 'final'));
  const wantCountdown = p.cue.variables.showCountdown !== false;
  const d = p.display;
  let line: string;
  if (!started) {
    let when = '';
    try {
      when = new Intl.DateTimeFormat('en-AU', { timeZone: m.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(m.scheduledAt));
    } catch {
      when = '';
    }
    line = [m.venue, when].filter(Boolean).join(' · ');
  } else {
    // a walk-out step during the break still reads as the break itself ("HALF TIME", not "PLAYERS ENTERING")
    const label = kind === 'break' ? adapter.phase(cfg, m.projection.breakPhase ?? m.projection.phase)?.label ?? d.periodLabel : kind === 'final' ? (m.sport === 'basketball' ? 'Final' : 'Full Time') : d.periodLabel;
    line = t(p, label.toUpperCase());
    if (d.shootout) line += ` · ${d.shootout.home}–${d.shootout.away} ${t(p, 'ON PENALTIES')}`;
  }
  let countdown: IdentInfo['countdown'] = null;
  if (wantCountdown && !started) {
    const cd = kickoffCountdown(p);
    if (cd) countdown = { label: t(p, 'KICK-OFF IN'), text: cd };
  } else if (wantCountdown && kind === 'break') countdown = restartCountdown(p);
  const msg = typeof p.cue.variables.message === 'string' && p.cue.variables.message.trim() ? t(p, p.cue.variables.message.trim()) : null;
  return { started, centre: started ? `${d.score.home}–${d.score.away}` : t(p, 'VS'), line, countdown, message: msg };
}
