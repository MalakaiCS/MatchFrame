'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { fitLabel } from '../fit';
import type { RenderPlayer, RenderTeam } from '../data';
import { useAudioPolicy, type GraphicProps } from './stage';

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

export function kickoffCountdown(p: GraphicProps): string | null {
  const ms = new Date(p.data.match.scheduledAt).getTime() - p.now;
  if (!(ms > 0)) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 99 ? null : `${m}:${String(s).padStart(2, '0')}`;
}

/** The look's own logo (league or broadcaster), shown in the title bars of full-screen graphics and on the slate. */
export function ThemeBadge({ p, height }: { p: GraphicProps; height: number }) {
  const [broken, setBroken] = useState(false);
  const url = p.data.theme.logoUrl;
  if (!url || broken) return null;
  return <img alt="" src={url} onError={() => setBroken(true)} style={{ height, maxWidth: height * 3, objectFit: 'contain', flex: 'none' }} />;
}

/** Heading and period for the kick-off / period banner. */
export function periodBanner(p: GraphicProps): { heading: string; period: string } {
  const heading = typeof p.cue.variables.heading === 'string' && p.cue.variables.heading ? p.cue.variables.heading : 'KICK-OFF';
  const period = typeof p.cue.variables.period === 'string' && p.cue.variables.period ? p.cue.variables.period : p.display.periodLabel;
  return { heading: heading.toUpperCase(), period };
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

/** "PRESENTED BY" caption used beside moment sponsors (goals, cards, player of the match). */
export function presentedBy(p: GraphicProps): string {
  return t(p, 'PRESENTED BY');
}
