'use client';
// Graphics every look shares: league table, fixtures, formation, match summary, head-to-head, match information,
// shoot-out tracker, live statistic, top scorers, player of the match, timeout, added time, video review, the
// highlights title and the stinger wipe. Each look
// supplies its "chrome" (how it frames a full-frame board, a lower strip and a team event) so these read as part
// of that look without three copies of the content.
import type { CSSProperties, ReactNode } from 'react';
import { animStyle, changeStyle, stagger, type GraphicProps, type ThemeComponents } from './stage';
import { Fitted, Logo, Photo, SponsorMark, ThemeBadge, badgeUrl, clockLabel, eventWord, inkOn, matchInfoItems, player, presentedBy, scoreText, side, t, team, withAlpha } from './common';
import { reviewHeadline, reviewWords, shootoutLine, shootoutStatus } from '@bs/domain';
import { COLOUR_CLASH_THRESHOLD, colourDistance, type RenderFixture, type RenderStandingRow } from '../data';
import { fitLabel } from '../fit';
import { ReplayTransition } from './replay';

export interface Chrome {
  /** a full-frame board with a title bar, centred */
  frame: (p: GraphicProps, title: ReactNode, children: ReactNode, width?: number) => ReactNode;
  /** a lower-anchored strip with a kicker word */
  strip: (p: GraphicProps, kicker: string, kickerColor: string, body: ReactNode, sponsorPlacement?: string) => ReactNode;
  /** a team event (badge word + body) */
  event: (p: GraphicProps, label: string, accent: string, body: ReactNode) => ReactNode;
  text: (p: GraphicProps) => string;
  muted: (p: GraphicProps) => string;
  rule: (p: GraphicProps) => string;
  /** the floating card behind the shoot-out tracker and the live statistic (default: the theme's panel colours) */
  card?: (p: GraphicProps) => CSSProperties;
}

const OUTCOME_COLOUR: Record<string, string> = { W: '#55D99D', D: '#8a93a3', L: '#E5484D' };
const formDots = (p: GraphicProps, form: string[], delayMs: number) => (
  <span style={{ display: 'inline-flex', gap: 5 }}>
    {form.map((o, i) => (
      <span key={i} title={o} style={{ width: 16, height: 16, borderRadius: '50%', background: OUTCOME_COLOUR[o] ?? '#888', display: 'inline-grid', placeItems: 'center', fontSize: 10, fontWeight: 800, color: '#0B1220', ...animStyle(p, 'zoom', delayMs + i * 40, 260) }}>
        {o}
      </span>
    ))}
  </span>
);

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor((n % 100) / 10) === 1 ? 0 : n % 10]}`;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);

export const DEFAULT_FORMATIONS: Record<string, string> = { football: '4-4-2', hockey: '4-3-3', basketball: '2-3', netball: '2-3-2', rugby_league: '1-4-2-6', afl: '6-6-6', futsal: '1-2-1' };
const HAS_KEEPER: Record<string, boolean> = { football: true, hockey: true, futsal: true };

/** x/y (fractions of the pitch) for each starter from a "4-3-3" string; the keeper sits deepest when the code has one. */
export function formationSpots(formation: string, count: number, sport: string): { x: number; y: number }[] {
  const lines = formation.split('-').map((n) => Math.max(0, parseInt(n, 10) || 0)).filter((n) => n > 0);
  const keeper = HAS_KEEPER[sport] ? 1 : 0;
  const spots: { x: number; y: number }[] = [];
  if (keeper) spots.push({ x: 0.5, y: 0.9 });
  const total = lines.reduce((a, b) => a + b, 0) || Math.max(1, count - keeper);
  const rows = lines.length ? lines : [Math.max(1, count - keeper)];
  const top = 0.14, bottom = keeper ? 0.72 : 0.84;
  rows.forEach((n, r) => {
    const y = rows.length === 1 ? (top + bottom) / 2 : bottom - ((bottom - top) * r) / (rows.length - 1);
    for (let i = 0; i < n; i++) spots.push({ x: (i + 1) / (n + 1), y });
  });
  void total;
  // extra starters beyond the formation sit on a final line
  while (spots.length < count) spots.push({ x: ((spots.length % 5) + 1) / 6, y: 0.05 });
  return spots.slice(0, count);
}

/**
 * Full-screen animated background: the canvas the match header, stats and the full-time board sit on before the
 * match, at the break and after the whistle. Built from the look's colours (deep base, primary and accent light),
 * moving with slow transform-only drifts so it stays light in an OBS browser source. Fades in and out.
 */
export function Backdrop(p: GraphicProps) {
  const th = p.data.theme;
  const still = th.motion === 'none' || p.cue.variables.motion === false;
  const run = (name: string, seconds: number, reverse = false): CSSProperties => (still ? {} : { animation: `${name} ${seconds}s ease-in-out ${reverse ? '-3s' : '0s'} infinite alternate${reverse ? '-reverse' : ''}`, willChange: 'transform, opacity' });
  const deep = th.secondary;
  const lightBase = /^#?f/i.test(deep); // a light base (unusual): keep the light effects subtle
  const hot = th.primary;
  const glow = th.accent;
  const key = th.themeKey;
  const angle = key === 'club' ? -8 : key === 'minimal' ? 0 : -14;
  const gid = p.cue.cueId.replace(/[^a-zA-Z0-9_-]/g, ''); // SVG gradient ids, unique per background on the page
  const stripes = key === 'minimal'
    ? `repeating-linear-gradient(90deg, ${withAlpha('#ffffff', 0.025)} 0 1px, transparent 1px 96px)`
    : `repeating-linear-gradient(${90 + angle + 45}deg, transparent 0 120px, ${withAlpha(hot, lightBase ? 0.05 : 0.08)} 120px 210px, transparent 210px 400px, ${withAlpha(glow, 0.06)} 400px 440px)`;
  return (
    <div data-graphic="backdrop" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: `linear-gradient(135deg, ${deep} 0%, ${deep} 45%, ${withAlpha(hot, 0.35)} 160%), ${deep}`, ...animStyle(p, 'fade', 0, 600) }}>
      {/* drifting stripes */}
      <div style={{ position: 'absolute', left: '-15%', top: '-15%', width: '130%', height: '130%', background: stripes, ...run('bs-bd-drift', 18) }} />
      {/* two soft light sweeps on the look's angle */}
      <div style={{ position: 'absolute', left: '-20%', top: '48%', width: '140%', height: 0, transform: `rotate(${angle}deg)` }}>
        <div style={{ position: 'absolute', left: '25%', top: -260, width: 1500, height: 520, background: `radial-gradient(closest-side, ${withAlpha(hot, 0.42)}, transparent)`, ...run('bs-bd-sweep', 12) }} />
      </div>
      <div style={{ position: 'absolute', left: '-20%', top: '14%', width: '140%', height: 0, transform: `rotate(${-angle / 2}deg)` }}>
        <div style={{ position: 'absolute', left: '40%', top: -200, width: 1200, height: 400, background: `radial-gradient(closest-side, ${withAlpha(glow, 0.26)}, transparent)`, ...run('bs-bd-sweep', 16, true) }} />
      </div>
      {/* breathing glow in the corner */}
      <div style={{ position: 'absolute', right: -260, bottom: -360, width: 1100, height: 1100, borderRadius: '50%', background: `radial-gradient(circle, ${withAlpha(glow, 0.3)}, transparent 68%)`, ...run('bs-bd-glow', 7) }} />
      <div style={{ position: 'absolute', left: -300, top: -420, width: 1000, height: 1000, borderRadius: '50%', background: `radial-gradient(circle, ${withAlpha(hot, 0.22)}, transparent 70%)`, ...run('bs-bd-glow', 9, true) }} />
      {/* the look's signature edge: angular shards (premier), a slanted wedge (broadcast) or a soft band (club, minimal) */}
      {key === 'premier' ? (
        <svg aria-hidden viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', ...run('bs-bd-drift', 22, true) }}>
          <defs>
            <linearGradient id={`bd-hot-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={hot} stopOpacity={0.72} />
              <stop offset="1" stopColor={hot} stopOpacity={0.22} />
            </linearGradient>
            <linearGradient id={`bd-line-${gid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={glow} />
              <stop offset="1" stopColor={hot} />
            </linearGradient>
          </defs>
          <polygon points="1180,0 1920,0 1920,1080 760,1080" fill={`url(#bd-hot-${gid})`} />
          <polygon points="1500,0 1640,0 1180,1080 1040,1080" fill={withAlpha(glow, 0.16)} />
          <polygon points="1450,0 1462,0 1002,1080 990,1080" fill={withAlpha(glow, 0.55)} />
          <polygon points="1640,0 1920,0 1920,520" fill={withAlpha(deep, 0.55)} />
          <polygon points="0,0 420,0 0,300" fill={withAlpha(hot, 0.14)} />
          <polygon points="0,760 300,1080 0,1080" fill={withAlpha(glow, 0.12)} />
          <rect x="0" y="952" width="1920" height="6" fill={`url(#bd-line-${gid})`} opacity={0.7} />
        </svg>
      ) : key === 'broadcast' ? (
        <div style={{ position: 'absolute', right: -120, top: 0, bottom: 0, width: 720, background: `linear-gradient(180deg, ${withAlpha(hot, 0.55)}, ${withAlpha(hot, 0.25)})`, clipPath: 'polygon(42% 0, 100% 0, 100% 100%, 0 100%)', ...run('bs-bd-drift', 22, true) }} />
      ) : (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 260, background: `linear-gradient(0deg, ${withAlpha(hot, 0.35)}, transparent)` }} />
      )}
      {/* fine grid, faded towards the edges, then a vignette */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${withAlpha('#ffffff', 0.035)} 1px, transparent 1px), linear-gradient(90deg, ${withAlpha('#ffffff', 0.035)} 1px, transparent 1px)`, backgroundSize: '64px 64px', WebkitMaskImage: 'radial-gradient(ellipse at center, #000 25%, transparent 75%)', maskImage: 'radial-gradient(ellipse at center, #000 25%, transparent 75%)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.42) 100%)' }} />
    </div>
  );
}

export function sharedGraphics(C: Chrome): ThemeComponents {
  const cell = (p: GraphicProps, extra?: CSSProperties): CSSProperties => ({ color: C.text(p), fontVariantNumeric: 'tabular-nums', ...extra });

  const LeagueTable = (p: GraphicProps) => {
    const season = p.data.season;
    const sport = p.data.match.sport;
    const rows = Math.max(3, Math.min(20, num(p.cue.variables.rows, 10)));
    const hl = String(p.cue.variables.highlight ?? 'both');
    const ids = { home: p.data.match.teams.home.id, away: p.data.match.teams.away.id };
    const table = season?.standings ?? [];
    let shown: RenderStandingRow[] = table.slice(0, rows);
    for (const id of [ids.home, ids.away]) {
      if (shown.some((r) => r.team.id === id)) continue;
      const r = table.find((x) => x.team.id === id);
      if (r) shown = [...shown.slice(0, Math.max(1, rows - 1)), r];
    }
    shown.sort((a, b) => a.position - b.position);
    const pct = sport === 'afl' || sport === 'netball';
    const winPct = season?.rankBy === 'win_pct';
    const cols = winPct ? ['P', 'W', 'L', 'PCT'] : pct ? ['P', 'W', 'L', 'D', '%', 'PTS'] : ['P', 'W', 'D', 'L', season?.standingsUnit === 'points' ? '+/-' : 'GD', 'PTS'];
    const values = (r: RenderStandingRow) =>
      winPct ? [r.played, r.won, r.lost, (r.winPct * 100).toFixed(1)] : pct ? [r.played, r.won, r.lost, r.drawn, r.percentage.toFixed(1), r.points] : [r.played, r.won, r.drawn, r.lost, r.difference > 0 ? `+${r.difference}` : r.difference, r.points];
    const title = String(p.cue.variables.title ?? '') || `${season?.name ?? ''} ${t(p, sport === 'afl' || sport === 'netball' || sport === 'rugby_league' ? 'LADDER' : 'TABLE')}`.trim();
    const grid = `44px 1fr ${cols.map(() => '70px').join(' ')} 120px`;
    return C.frame(
      p,
      title.toUpperCase(),
      <div style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: '0 12px', fontSize: 24 }}>
        <span />
        <span style={{ color: C.muted(p), fontSize: 16, letterSpacing: 2 }}>{t(p, 'TEAM')}</span>
        {cols.map((c) => <span key={c} style={{ color: C.muted(p), fontSize: 16, letterSpacing: 2, textAlign: 'right' }}>{c}</span>)}
        <span style={{ color: C.muted(p), fontSize: 16, letterSpacing: 2, textAlign: 'right' }}>{t(p, 'FORM')}</span>
        {shown.map((r, i) => {
          const mine = (hl === 'both' || hl === 'home') && r.team.id === ids.home ? 'home' : (hl === 'both' || hl === 'away') && r.team.id === ids.away ? 'away' : null;
          const row = stagger(p, i, 'rise', 220, 50);
          const bg = mine ? { background: `${r.team.primaryColor}22`, boxShadow: `inset 6px 0 0 ${r.team.primaryColor}` } : {};
          return (
            <div key={r.team.id} style={{ display: 'contents' }}>
              <span style={{ ...cell(p, { fontWeight: 800, textAlign: 'center', padding: '6px 0', ...bg }), ...row }}>{r.position}</span>
              <span style={{ ...cell(p, { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', ...(mine ? { background: `${r.team.primaryColor}22` } : {}) }), ...row }}>
                <Logo url={r.team.logoUrl} label={r.team.abbreviation} size={32} color={r.team.primaryColor} radius={4} />
                <Fitted full={r.team.name} short={r.team.shortName} width={330} fontPx={26} measure={p.measure} style={{ color: C.text(p) }} />
              </span>
              {values(r).map((v, j) => <span key={j} style={{ ...cell(p, { textAlign: 'right', padding: '6px 0', fontWeight: j === cols.length - 1 ? 900 : 600, ...(mine ? { background: `${r.team.primaryColor}22` } : {}) }), ...row }}>{v}</span>)}
              <span style={{ textAlign: 'right', padding: '6px 0', ...(mine ? { background: `${r.team.primaryColor}22` } : {}), ...row }}>{formDots(p, r.form.slice(-5), 300 + i * 50)}</span>
            </div>
          );
        })}
        {!shown.length ? <span style={{ gridColumn: '1 / -1', color: C.muted(p), fontSize: 26, padding: 20 }}>{t(p, 'Table available once results are in')}</span> : null}
      </div>,
      1240,
    );
  };

  const fixtureRow = (p: GraphicProps, f: RenderFixture, i: number, current: boolean) => {
    const when = new Intl.DateTimeFormat('en-AU', { timeZone: p.data.match.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(f.scheduledAt));
    const middle = f.score ? `${f.scoreDetail?.home ?? f.score.home} – ${f.scoreDetail?.away ?? f.score.away}` : when;
    const row = stagger(p, i, 'rise', 220, 55);
    return (
      <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 220px 1fr', alignItems: 'center', gap: 16, padding: '10px 14px', borderRadius: 8, background: current ? `${p.data.theme.accent}22` : 'transparent', borderBottom: `1px solid ${C.rule(p)}`, ...row }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, ...cell(p) }}>
          <Fitted full={f.home.name} short={f.home.shortName} width={300} fontPx={26} measure={p.measure} style={{ color: C.text(p) }} />
          <Logo url={f.home.logoUrl} label={f.home.abbreviation} size={36} color={f.home.primaryColor} radius={4} />
        </span>
        <span style={{ textAlign: 'center', fontWeight: 900, fontSize: f.score ? 32 : 22, ...cell(p) }}>
          {middle}
          {f.live ? <span style={{ display: 'block', fontSize: 12, letterSpacing: 2, color: '#E5484D' }}>{t(p, 'LIVE')}</span> : null}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, ...cell(p) }}>
          <Logo url={f.away.logoUrl} label={f.away.abbreviation} size={36} color={f.away.primaryColor} radius={4} />
          <Fitted full={f.away.name} short={f.away.shortName} width={300} fontPx={26} measure={p.measure} style={{ color: C.text(p) }} />
        </span>
      </div>
    );
  };

  const Fixtures = (p: GraphicProps) => {
    const season = p.data.season;
    const mode = String(p.cue.variables.mode ?? 'round');
    const round = p.data.match.round ?? null;
    const all = season?.fixtures ?? [];
    const list = mode === 'results' ? all.filter((f) => f.score && !f.live) : mode === 'next' ? all.filter((f) => f.round !== round) : all.filter((f) => round === null || f.round === round);
    const title = String(p.cue.variables.title ?? '') || (mode === 'results' ? t(p, 'RESULTS') : mode === 'next' ? t(p, 'NEXT ROUND') : round ? (/^\d+$/.test(round) ? `${t(p, 'ROUND')} ${round}` : round) : t(p, 'FIXTURES'));
    return C.frame(
      p,
      title.toUpperCase(),
      <div>
        {list.slice(0, 9).map((f, i) => fixtureRow(p, f, i, f.id === p.data.match.id))}
        {!list.length ? <div style={{ color: C.muted(p), fontSize: 26, padding: 20 }}>{t(p, 'No fixtures to show')}</div> : null}
      </div>,
      1200,
    );
  };

  const Formation = (p: GraphicProps) => {
    const s = side(p);
    const tm = team(p, s);
    const list = p.data.match.lineup[s] ?? [];
    const starters = list.filter((x) => x.starter);
    const bench = list.filter((x) => !x.starter);
    const formation = p.data.match.lineup.formations?.[s] ?? DEFAULT_FORMATIONS[p.data.match.sport] ?? '4-4-2';
    const spots = formationSpots(formation, starters.length, p.data.match.sport);
    const W = 760, H = 520;
    const court = p.data.match.sport === 'basketball' || p.data.match.sport === 'netball' || p.data.match.sport === 'futsal';
    return C.frame(
      p,
      <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}><Logo url={tm.logoUrl} label={tm.abbreviation} size={44} color={tm.primaryColor} /> {tm.name.toUpperCase()} · {formation}</span>,
      <div>
        <div style={{ position: 'relative', width: W, height: H, margin: '0 auto', borderRadius: 14, background: court ? 'linear-gradient(180deg, #b9743a, #9a5a2a)' : 'linear-gradient(180deg, #2f7d3a, #256a30)', border: '3px solid rgba(255,255,255,.55)', overflow: 'hidden', ...animStyle(p, 'zoom', 120, 420) }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, background: 'rgba(255,255,255,.55)' }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: 120, height: 120, marginLeft: -60, marginTop: -60, borderRadius: '50%', border: '2px solid rgba(255,255,255,.55)' }} />
          <div style={{ position: 'absolute', left: '30%', right: '30%', bottom: 0, height: 70, border: '2px solid rgba(255,255,255,.45)', borderBottom: 'none' }} />
          <div style={{ position: 'absolute', left: '30%', right: '30%', top: 0, height: 70, border: '2px solid rgba(255,255,255,.45)', borderTop: 'none' }} />
          {starters.map((pl, i) => {
            const sp = spots[i]!;
            return (
              <div key={pl.playerId} style={{ position: 'absolute', left: sp.x * W - 48, top: sp.y * H - 40, width: 96, textAlign: 'center', ...stagger(p, i, 'zoom', 260, 45) }}>
                <div style={{ width: 52, height: 52, margin: '0 auto', borderRadius: '50%', background: tm.primaryColor, color: tm.secondaryColor, display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 900, boxShadow: '0 4px 14px rgba(0,0,0,.4)' }}>{pl.number ?? ''}</div>
                <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,.8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.shortName ?? pl.displayName}</div>
              </div>
            );
          })}
          {!starters.length ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 28 }}>{t(p, 'Lineup to be confirmed')}</div> : null}
        </div>
        {bench.length ? <div style={{ marginTop: 14, fontSize: 20, color: C.muted(p), textAlign: 'center', ...animStyle(p, 'rise', 700, 320) }}>{t(p, 'Bench')}: {bench.map((x) => `${x.number ?? ''} ${x.shortName ?? x.displayName}`.trim()).join(' · ')}</div> : null}
      </div>,
      900,
    );
  };

  const MatchSummary = (p: GraphicProps) => {
    const ev = p.data.match.events ?? [];
    const h = team(p, 'home');
    const a = team(p, 'away');
    const name = (id: string | null, s: 'home' | 'away') => (id && p.data.players[id] ? p.data.players[id]!.shortName ?? p.data.players[id]!.displayName : team(p, s).shortName);
    const column = (s: 'home' | 'away', align: 'left' | 'right') => {
      const scores = ev.filter((e) => e.group === 'score' && e.side === s);
      const cards = ev.filter((e) => e.group === 'discipline' && e.side === s);
      const subs = ev.filter((e) => e.group === 'change' && e.side === s).length;
      // group scorers: "Torres 23', 61'"
      const by = new Map<string, string[]>();
      for (const e of scores) {
        const k = name(e.playerId, s);
        if (!by.has(k)) by.set(k, []);
        by.get(k)!.push(`${e.minute ?? ''}${e.type === 'own_goal' ? ' (og)' : e.type === 'penalty_scored' || e.type === 'penalty_goal' ? ' (pen)' : ''}`.trim());
      }
      return (
        <div style={{ textAlign: align, fontSize: 24, ...cell(p) }}>
          {[...by.entries()].map(([k, mins], i) => <div key={k} style={{ ...stagger(p, i, 'rise', 300, 60) }}><b>{k}</b> <span style={{ color: C.muted(p) }}>{mins.join(', ')}</span></div>)}
          {!by.size ? <div style={{ color: C.muted(p) }}>—</div> : null}
          {cards.length ? <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', flexWrap: 'wrap', ...animStyle(p, 'rise', 520, 320) }}>{cards.map((c, i) => <span key={c.id} style={{ width: 16, height: 22, borderRadius: 3, background: /red|second|send/.test(c.type) ? '#E5484D' : /green/.test(c.type) ? '#55D99D' : '#FFCE66', display: 'inline-block', ...animStyle(p, 'zoom', 540 + i * 40, 260) }} title={c.type} />)}</div> : null}
          {subs ? <div style={{ marginTop: 6, fontSize: 18, color: C.muted(p), ...animStyle(p, 'rise', 600, 300) }}>{subs} {t(p, subs === 1 ? 'change' : 'changes')}</div> : null}
        </div>
      );
    };
    const label = String(p.cue.variables.label ?? '') || t(p, p.display.periodLabel.toUpperCase());
    return C.frame(
      p,
      label,
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end', ...animStyle(p, 'slide-left', 200, 400) }}><Fitted full={h.name} short={h.shortName} width={320} fontPx={36} measure={p.measure} style={{ color: C.text(p) }} /><Logo url={h.logoUrl} label={h.abbreviation} size={72} color={h.primaryColor} /></div>
          <div style={{ fontSize: p.display.scoreDetail ? 54 : 84, fontWeight: 900, fontVariantNumeric: 'tabular-nums', textAlign: 'center', ...cell(p), ...animStyle(p, 'zoom', 260, 460) }}>
            <span style={changeStyle(p, 'score', `${scoreText(p, 'home')}-${scoreText(p, 'away')}`)}>{scoreText(p, 'home')} – {scoreText(p, 'away')}</span>
            {p.display.shootout ? <div style={{ fontSize: 22, color: C.muted(p) }}>{t(p, 'Shoot-out')} {p.display.shootout.home}–{p.display.shootout.away}</div> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, ...animStyle(p, 'slide-right', 200, 400) }}><Logo url={a.logoUrl} label={a.abbreviation} size={72} color={a.primaryColor} /><Fitted full={a.name} short={a.shortName} width={320} fontPx={36} measure={p.measure} style={{ color: C.text(p) }} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 24, paddingTop: 18, borderTop: `1px solid ${C.rule(p)}` }}>
          {column('home', 'right')}
          {column('away', 'left')}
        </div>
      </div>,
      1200,
    );
  };

  const HeadToHead = (p: GraphicProps) => {
    const pv = p.data.preview;
    const h = team(p, 'home');
    const a = team(p, 'away');
    const big = (n: number, label: string, colour: string, delay: number) => (
      <div style={{ textAlign: 'center', ...animStyle(p, 'zoom', delay, 420) }}>
        <div style={{ fontSize: 72, fontWeight: 900, color: colour, lineHeight: 1 }}>{n}</div>
        <div style={{ fontSize: 16, letterSpacing: 3, color: C.muted(p), marginTop: 6 }}>{label}</div>
      </div>
    );
    const date = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: p.data.match.timezone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
    return C.frame(
      p,
      t(p, 'HEAD TO HEAD'),
      <div style={cell(p)}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto 1fr', alignItems: 'center', gap: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'flex-end', ...animStyle(p, 'slide-left', 180, 400) }}><Fitted full={h.name} short={h.shortName} width={300} fontPx={34} measure={p.measure} style={{ color: C.text(p) }} /><Logo url={h.logoUrl} label={h.abbreviation} size={64} color={h.primaryColor} /></div>
          {big(pv?.headToHead.homeWins ?? 0, `${h.abbreviation} ${t(p, 'WINS')}`, h.primaryColor, 260)}
          {big(pv?.headToHead.draws ?? 0, t(p, 'DRAWS'), C.muted(p), 320)}
          {big(pv?.headToHead.awayWins ?? 0, `${a.abbreviation} ${t(p, 'WINS')}`, a.primaryColor, 380)}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...animStyle(p, 'slide-right', 180, 400) }}><Logo url={a.logoUrl} label={a.abbreviation} size={64} color={a.primaryColor} /><Fitted full={a.name} short={a.shortName} width={300} fontPx={34} measure={p.measure} style={{ color: C.text(p) }} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 26, paddingTop: 16, borderTop: `1px solid ${C.rule(p)}`, fontSize: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'flex-end', ...animStyle(p, 'rise', 460, 320) }}>
            <span style={{ color: C.muted(p), letterSpacing: 2, fontSize: 15 }}>{t(p, 'FORM')}</span>{formDots(p, pv?.form.home ?? [], 500)}
            {pv?.positions?.home ? <span style={{ color: C.muted(p) }}>· {ordinal(pv.positions.home)}</span> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...animStyle(p, 'rise', 460, 320) }}>
            {pv?.positions?.away ? <span style={{ color: C.muted(p) }}>{ordinal(pv.positions.away)} ·</span> : null}
            {formDots(p, pv?.form.away ?? [], 500)}<span style={{ color: C.muted(p), letterSpacing: 2, fontSize: 15 }}>{t(p, 'FORM')}</span>
          </div>
        </div>
        <div style={{ marginTop: 18, fontSize: 22 }}>
          {(pv?.headToHead.meetings ?? []).slice(0, 5).map((m, i) => {
            const homeIsH = m.homeTeamId === h.id;
            return (
              <div key={m.matchId} style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto 1fr', gap: 16, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.rule(p)}`, ...stagger(p, i, 'rise', 560, 50) }}>
                <span style={{ color: C.muted(p), fontSize: 18 }}>{date(m.playedAt)}</span>
                <span style={{ textAlign: 'right' }}>{homeIsH ? h.shortName : a.shortName}</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{m.homeScore} – {m.awayScore}</b>
                <span>{homeIsH ? a.shortName : h.shortName}</span>
              </div>
            );
          })}
          {!pv?.headToHead.played ? <div style={{ color: C.muted(p), marginTop: 8 }}>{t(p, 'First meeting in this competition')}</div> : null}
        </div>
      </div>,
      1200,
    );
  };

  const MatchInfo = (p: GraphicProps) => {
    const items = matchInfoItems(p);
    return C.strip(
      p,
      t(p, 'MATCH INFORMATION'),
      p.data.theme.primary,
      <div style={{ display: 'flex', gap: 34, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 26 }}>
        {items.map((it, i) => (
          <span key={it.label} style={{ display: 'inline-flex', flexDirection: 'column', ...stagger(p, i, 'rise', 240, 60) }}>
            <span style={{ fontSize: 13, letterSpacing: 3, opacity: 0.7 }}>{it.label}</span>
            <span style={{ fontWeight: 700 }}>{it.value}</span>
          </span>
        ))}
        {!items.length ? <span style={{ opacity: 0.7 }}>{t(p, 'Add venue, officials, attendance or weather on the match page')}</span> : null}
      </div>,
      'lower_third_banner',
    );
  };

  // The shoot-out: one bar with the crests at its ends, the names and the score in the middle; under each name a
  // marker per kick (scored, missed, still to take, the next one ringed), and a line on where it stands: kick N of
  // five, sudden death, a kick that wins it or must be scored, and the winner once one team cannot be caught.
  const Shootout = (p: GraphicProps) => {
    const so = p.data.match.projection.shootout;
    const st = shootoutStatus(so, p.data.match.rulesConfig);
    const th = p.data.theme;
    const h = team(p, 'home');
    const a = team(p, 'away');
    const tm = (s: 'home' | 'away') => (s === 'home' ? h : a);
    const kicksOf = (s: 'home' | 'away') => (so?.kicks ?? []).filter((k) => k.side === s);
    // the first five always show; sudden death adds one per round reached (the last few if it runs long)
    const sdRounds = Math.max(0, Math.max(st.taken.home, st.taken.away, st.next ? st.round : 0) - st.rounds);
    const sdShown = Math.min(sdRounds, 3);
    const sdFrom = st.rounds + sdRounds - sdShown;
    const GREEN = '#2FBF71';
    const RED = '#E5484D';
    const dot = (s: 'home' | 'away', i: number) => {
      const kick = kicksOf(s)[i];
      const isNext = !kick && st.next === s && i === st.taken[s];
      const bg = !kick ? 'rgba(10,14,22,.72)' : kick.scored ? GREEN : RED;
      const unneeded = !kick && !!st.winner; // decided before this kick was needed
      return (
        <span key={i} aria-label={kick ? (kick.scored ? 'scored' : 'missed') : isNext ? 'next' : 'to take'} data-kick={kick ? (kick.scored ? 'scored' : 'missed') : isNext ? 'next' : 'pending'}
          style={{ width: 40, height: 40, borderRadius: '50%', flex: 'none', display: 'inline-grid', placeItems: 'center', background: bg, opacity: unneeded ? 0.4 : 1,
            boxShadow: isNext ? `0 0 0 3px ${th.accent}, 0 0 14px ${withAlpha(th.accent, 0.7)}` : kick ? 'inset 0 -3px 0 rgba(0,0,0,.22), 0 1px 3px rgba(0,0,0,.35)' : 'inset 0 2px 4px rgba(0,0,0,.6)',
            ...changeStyle(p, `k-${s}-${i}`, kick ? (kick.scored ? 'y' : 'n') : isNext ? 'next' : '-') }}>
          {kick ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {kick.scored ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />}
            </svg>
          ) : null}
        </span>
      );
    };
    const dots = (s: 'home' | 'away') => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: s === 'home' ? 'flex-start' : 'flex-end' }}>
        {Array.from({ length: st.rounds }, (_, i) => dot(s, i))}
        {sdShown ? <span style={{ width: 2, height: 26, background: withAlpha(th.text, 0.35), margin: '0 3px' }} aria-hidden /> : null}
        {Array.from({ length: sdShown }, (_, i) => dot(s, sdFrom + i))}
      </span>
    );
    const names = { home: h.shortName || h.name, away: a.shortName || a.name };
    let line = shootoutLine(st, names);
    if (!st.winner && !st.pressure && st.next) line += ` · ${names[st.next]} ${t(p, 'to kick')}`;
    const lineColour = st.winner ? tm(st.winner).primaryColor : st.pressure ? th.accent : null;
    // the score plate and title tab in the look's main colour, or its dark base where that matches the panel
    const plate = colourDistance(th.primary, th.panel) < COLOUR_CLASH_THRESHOLD ? th.secondary : th.primary;
    const crest = (s: 'home' | 'away') => (
      <span style={{ position: 'absolute', top: '50%', [s === 'home' ? 'left' : 'right']: -34, transform: 'translateY(-50%)', width: 104, height: 104, borderRadius: '50%', background: tm(s).primaryColor, border: `4px solid ${th.text}`, boxShadow: '0 6px 18px rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', overflow: 'hidden', ...animStyle(p, 'zoom', 160, 420) }}>
        <Logo url={tm(s).logoUrl} label={tm(s).abbreviation} size={78} color={tm(s).primaryColor} radius={39} />
      </span>
    );
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 96, marginLeft: 'auto', marginRight: 'auto', width: 1180, fontFamily: th.font, color: th.text, ...animStyle(p, 'slide-up') }} data-graphic="shootout" data-shootout-state={st.winner ? 'decided' : st.suddenDeath ? 'sudden_death' : 'regulation'}>
        {/* the title tab */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <span style={{ background: plate, color: inkOn(plate, th.secondary), padding: '7px 40px 9px', borderRadius: `${Math.min(th.radius, 14)}px ${Math.min(th.radius, 14)}px 0 0`, fontSize: 21, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', ...animStyle(p, 'rise', 80, 320) }}>
            {t(p, p.data.match.sport === 'hockey' ? 'Shoot-out' : p.data.match.sport === 'futsal' ? 'Kicks from the penalty mark' : 'Penalty shoot-out')}
          </span>
        </div>
        {/* names and score */}
        {/* crests outside the panel, so a look that cuts its panels (slants, notches) never clips them */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 230px 1fr', alignItems: 'center', height: 84, background: th.panel, borderRadius: th.radius, boxShadow: '0 10px 30px rgba(0,0,0,.4)', ...C.card?.(p) }}>
            <span style={{ paddingLeft: 96, paddingRight: 20, fontSize: 38, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right', ...animStyle(p, 'slide-left', 140, 380) }}>{names.home}</span>
            <span style={{ alignSelf: 'stretch', display: 'grid', placeItems: 'center', background: plate, color: inkOn(plate, th.secondary), clipPath: 'polygon(0 0, 100% 0, 88% 100%, 12% 100%)', fontSize: 58, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: 2 }}>
              <span>
                <span style={changeStyle(p, 'so-home', st.scored.home)}>{st.scored.home}</span>
                <span style={{ opacity: 0.7, margin: '0 12px' }}>:</span>
                <span style={changeStyle(p, 'so-away', st.scored.away)}>{st.scored.away}</span>
              </span>
            </span>
            <span style={{ paddingLeft: 20, paddingRight: 96, fontSize: 38, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...animStyle(p, 'slide-right', 140, 380) }}>{names.away}</span>
          </div>
          {crest('home')}
          {crest('away')}
        </div>
        {/* the kicks */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr', alignItems: 'center', margin: '0 70px', padding: '10px 26px', background: withAlpha(th.panel, 0.82), borderRadius: `0 0 ${th.radius}px ${th.radius}px`, boxShadow: '0 8px 20px rgba(0,0,0,.35)', ...animStyle(p, 'wipe-up', 220, 360) }}>
          <span style={{ paddingLeft: 40 }}>{dots('home')}</span>
          <span aria-hidden />
          <span style={{ paddingRight: 40 }}>{dots('away')}</span>
        </div>
        {/* where it stands */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <span data-shootout-line style={{ background: lineColour ?? withAlpha(th.panel, 0.9), color: lineColour ? inkOn(lineColour) : th.text, padding: '6px 22px', borderRadius: 999, fontSize: 20, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', ...changeStyle(p, 'so-line', line), ...animStyle(p, 'rise', 300, 320) }}>
            {line}
          </span>
        </div>
      </div>
    );
  };

  const StatCompare = (p: GraphicProps) => {
    const key = String(p.cue.variables.stat ?? '') || p.data.match.statRows[0]?.key || 'goals';
    const row = p.data.match.statRows.find((r) => r.key === key) ?? { key, label: key.replace(/_/g, ' '), unit: undefined as string | undefined };
    const st = p.data.match.projection.stats;
    const hv = Number(st.home?.[key] ?? 0);
    const av = Number(st.away?.[key] ?? 0);
    const tot = hv + av || 1;
    const h = team(p, 'home');
    const a = team(p, 'away');
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 130, marginLeft: 'auto', marginRight: 'auto', width: 1000, background: p.data.theme.panel, color: p.data.theme.text, fontFamily: p.data.theme.font, borderRadius: p.data.theme.radius, padding: '16px 28px', boxShadow: '0 8px 30px rgba(0,0,0,.35)', ...C.card?.(p), ...animStyle(p, 'slide-up') }} data-graphic="stat_compare">
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 160px', alignItems: 'center', gap: 20 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, ...animStyle(p, 'slide-left', 120, 360) }}><Logo url={h.logoUrl} label={h.abbreviation} size={40} color={h.primaryColor} radius={6} /><b style={{ fontSize: 40, fontVariantNumeric: 'tabular-nums', ...changeStyle(p, 'hv', hv) }}>{hv}{row.unit ?? ''}</b></span>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, letterSpacing: 3, opacity: 0.8, ...animStyle(p, 'rise', 160, 320) }}>{t(p, row.label.toUpperCase())}</div>
            <div style={{ display: 'flex', height: 12, gap: 4, marginTop: 8, borderRadius: 6, overflow: 'hidden' }}>
              <span style={{ flex: hv / tot, background: h.primaryColor, transformOrigin: 'right', ...animStyle(p, 'grow-x', 240, 460) }} />
              <span style={{ flex: av / tot, background: a.primaryColor, transformOrigin: 'left', ...animStyle(p, 'grow-x', 240, 460) }} />
            </div>
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', ...animStyle(p, 'slide-right', 120, 360) }}><b style={{ fontSize: 40, fontVariantNumeric: 'tabular-nums', ...changeStyle(p, 'av', av) }}>{av}{row.unit ?? ''}</b><Logo url={a.logoUrl} label={a.abbreviation} size={40} color={a.primaryColor} radius={6} /></span>
        </div>
      </div>
    );
  };

  const TopScorers = (p: GraphicProps) => {
    const metric = String(p.cue.variables.metric ?? 'goals') as 'goals' | 'points' | 'assists';
    const rows = Math.max(3, Math.min(10, num(p.cue.variables.rows, 5)));
    const list = [...(p.data.season?.topScorers ?? [])].sort((x, y) => y[metric] - x[metric]).filter((x) => x[metric] > 0).slice(0, rows);
    const title = t(p, metric === 'assists' ? 'MOST ASSISTS' : metric === 'points' ? 'TOP POINT SCORERS' : 'TOP SCORERS');
    return C.frame(
      p,
      `${p.data.season?.name ?? ''} ${title}`.trim(),
      <div style={cell(p)}>
        {list.map((r, i) => (
          <div key={r.playerId} style={{ display: 'grid', gridTemplateColumns: '50px 64px 1fr 110px 90px', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: `1px solid ${C.rule(p)}`, fontSize: 28, ...stagger(p, i, 'rise', 220, 60) }}>
            <span style={{ fontWeight: 900, color: C.muted(p) }}>{i + 1}</span>
            <Photo url={r.photoUrl} size={56} name={r.displayName} />
            <Fitted full={r.displayName} short={r.shortName} width={520} fontPx={30} measure={p.measure} style={{ color: C.text(p) }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted(p), fontSize: 20 }}>{r.team ? <><span style={{ width: 8, height: 24, background: r.team.primaryColor, borderRadius: 2 }} />{r.team.abbreviation}</> : null}</span>
            <b style={{ textAlign: 'right', fontSize: 36, fontVariantNumeric: 'tabular-nums' }}>{r[metric]}</b>
          </div>
        ))}
        {!list.length ? <div style={{ color: C.muted(p), fontSize: 26, padding: 20 }}>{t(p, 'No scorers recorded this season yet')}</div> : null}
      </div>,
      1000,
    );
  };

  const PlayerOfMatch = (p: GraphicProps) => {
    const pl = player(p);
    const tm = team(p);
    const tally = pl ? p.data.match.projection.players[pl.playerId] : null;
    const bits: string[] = [];
    if (tally?.goals) bits.push(`${tally.goals} ${t(p, tally.goals === 1 ? 'goal' : 'goals')}`);
    if (tally?.assists) bits.push(`${tally.assists} ${t(p, tally.assists === 1 ? 'assist' : 'assists')}`);
    if (tally?.points && !tally.goals) bits.push(`${tally.points} ${t(p, 'points')}`);
    return C.event(
      p,
      String(p.cue.variables.caption ?? '') || t(p, 'PLAYER OF THE MATCH'),
      p.data.theme.accent,
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <span style={animStyle(p, 'zoom', 300, 420)}><Photo url={pl?.photoUrl} size={96} name={pl?.displayName ?? tm.name} /></span>
        <div style={{ display: 'grid' }}>
          <Fitted full={pl?.displayName ?? tm.name} short={pl?.shortName} width={440} fontPx={40} measure={p.measure} />
          <div style={{ fontSize: 22, opacity: 0.85, ...animStyle(p, 'rise', 420, 320) }}>{pl?.number != null ? `#${pl.number} · ` : ''}{tm.shortName}{bits.length ? ` · ${bits.join(', ')}` : ''}</div>
        </div>
      </div>,
    );
  };

  const Timeout = (p: GraphicProps) => {
    const s = side(p);
    const left = p.display.timeouts?.[s];
    return C.event(
      p,
      t(p, 'TIMEOUT'),
      p.data.theme.primary,
      <div style={{ display: 'grid' }}>
        <Fitted full={team(p).name} short={team(p).shortName} width={460} fontPx={40} measure={p.measure} />
        <span style={{ fontSize: 22, opacity: 0.85, ...animStyle(p, 'rise', 420, 320) }}>{left != null ? `${left} ${t(p, left === 1 ? 'timeout remaining' : 'timeouts remaining')} · ` : ''}{p.display.periodShort} {clockLabel(p)}</span>
      </div>,
    );
  };

  // The fourth official's board: the minutes of added time lit on a dark board, in the look's strip.
  const AddedTime = (p: GraphicProps) => {
    const th = p.data.theme;
    const v = p.cue.variables.minutes;
    const mins = typeof v === 'number' && Number.isFinite(v) ? v : (p.data.match.projection.stoppageMinutes ?? p.display.addedMinutes ?? 0);
    // the digits glow in the look's accent when it is bright enough to read on the board, else in LED green
    const led = inkOn(th.accent) === '#FFFFFF' ? '#5BFF8A' : th.accent;
    return C.strip(
      p,
      t(p, 'ADDED TIME'),
      th.primary,
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <span data-added-minutes={mins} style={{ display: 'inline-grid', placeItems: 'center', minWidth: 140, height: 96, padding: '0 20px', borderRadius: 12, background: '#07090D', border: '3px solid rgba(255,255,255,.16)', boxShadow: 'inset 0 0 22px rgba(0,0,0,.85), 0 6px 18px rgba(0,0,0,.35)', color: led, fontSize: 78, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: 2, textShadow: `0 0 12px ${withAlpha(led, 0.85)}, 0 0 30px ${withAlpha(led, 0.45)}`, ...animStyle(p, 'zoom', 200, 380) }}>
          +{mins}
        </span>
        <span style={{ display: 'grid', gap: 4, ...animStyle(p, 'rise', 300, 320) }}>
          <span style={{ fontSize: 38, fontWeight: 700 }}>{mins} {t(p, mins === 1 ? 'minute' : 'minutes')}</span>
          <span style={{ fontSize: 21, color: C.muted(p) }}>{p.display.periodLabel}</span>
        </span>
      </div>,
      'event_partner',
    );
  };

  // A video review: the team, what is checked ("TRY?") while the video referee looks at it, then the decision in
  // green or red ("TRY" / "NO TRY"). It follows the scorer's review unless the operator set what it shows. It sits
  // above the event strap, which shows the try at the same time when one is awarded.
  const VideoReview = (p: GraphicProps) => {
    const th = p.data.theme;
    const v = p.cue.variables;
    const live = p.data.match.projection.review;
    const manual = v.outcome === 'pending' || v.outcome === 'awarded' || v.outcome === 'denied';
    // following the scorer with no review from them (one left open when the half ended is dropped): nothing to show
    if (!manual && !live) return null;
    const r: { subject: string; side: 'home' | 'away'; outcome: 'awarded' | 'denied' | null } =
      !manual && live ? live : { subject: String(v.subject ?? 'try'), side: v.team === 'away' ? 'away' : 'home', outcome: v.outcome === 'awarded' || v.outcome === 'denied' ? v.outcome : null };
    const words = reviewWords(r.subject);
    const headline = t(p, reviewHeadline(r.subject, r.outcome));
    const tm = team(p, r.side);
    const verdict = r.outcome === 'awarded' ? '#2FBF71' : r.outcome === 'denied' ? '#E5484D' : null;
    const plate = colourDistance(th.primary, th.panel) < COLOUR_CLASH_THRESHOLD ? th.secondary : th.primary;
    const tabRadius = Math.min(th.radius, 14);
    const dot = (i: number): CSSProperties => ({ width: 9, height: 9, borderRadius: '50%', background: th.accent, display: 'inline-block', animation: p.still || th.motion === 'none' ? undefined : `bs-pulse 1.2s ease-in-out ${i * 0.2}s infinite` });
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 290, marginLeft: 'auto', marginRight: 'auto', width: 980, fontFamily: th.font, color: th.text, ...animStyle(p, 'slide-up') }} data-graphic="review" data-review-state={r.outcome ?? 'pending'}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <span style={{ background: plate, color: inkOn(plate, th.secondary), padding: '7px 38px 9px', borderRadius: `${tabRadius}px ${tabRadius}px 0 0`, fontSize: 20, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', ...animStyle(p, 'rise', 80, 320) }}>{t(p, words.title)}</span>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', alignItems: 'stretch', height: 128, background: th.panel, borderRadius: th.radius, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,.4)', ...C.card?.(p) }}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, paddingLeft: 136, paddingRight: 24, minWidth: 0, ...animStyle(p, 'slide-left', 140, 380) }}>
              <span style={{ fontSize: 40, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tm.shortName || tm.name}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: C.muted(p) }}>
                {verdict ? t(p, 'Decision') : <>{t(p, 'Checking')} <span aria-hidden style={{ display: 'inline-flex', gap: 6 }}><span style={dot(0)} /><span style={dot(1)} /><span style={dot(2)} /></span></>}
              </span>
            </div>
            <div data-review-headline style={{ display: 'grid', placeItems: 'center', background: verdict ?? withAlpha(plate, 0.92), color: verdict ? '#FFFFFF' : inkOn(plate, th.secondary), clipPath: 'polygon(9% 0, 100% 0, 100% 100%, 0 100%)', paddingLeft: 30, ...animStyle(p, 'wipe', 220, 360) }}>
              <span style={{ ...changeStyle(p, 'review', r.outcome ?? 'pending', 'flip'), display: 'inline-flex', alignItems: 'center', gap: 16, fontSize: headline.length <= 6 ? 64 : headline.length <= 9 ? 50 : 40, fontWeight: 900, letterSpacing: 3, whiteSpace: 'nowrap' }}>
                {verdict ? (
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {r.outcome === 'awarded' ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />}
                  </svg>
                ) : null}
                {headline}
              </span>
            </div>
          </div>
          {/* the crest outside the panel, so a look that cuts its panels never clips it */}
          <span style={{ position: 'absolute', top: '50%', left: -30, transform: 'translateY(-50%)', width: 132, height: 132, borderRadius: '50%', background: tm.primaryColor, border: `4px solid ${th.text}`, boxShadow: '0 6px 18px rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', overflow: 'hidden', ...animStyle(p, 'zoom', 160, 420) }}>
            <Logo url={tm.logoUrl} label={tm.abbreviation} size={98} color={tm.primaryColor} radius={49} />
          </span>
        </div>
      </div>
    );
  };

  // The title panel of a match highlights package: a full-height panel down the left over the first clip, in the
  // look's colours, with the competition's logo, the title, both crests and names, and the round, ground and date.
  const HighlightsIntro = (p: GraphicProps) => {
    const th = p.data.theme;
    const m = p.data.match;
    const v = p.cue.variables;
    const plate = colourDistance(th.primary, th.panel) < COLOUR_CLASH_THRESHOLD ? th.secondary : th.primary;
    const ink = inkOn(plate, th.secondary);
    const words = t(p, String(v.title || 'MATCH HIGHLIGHTS')).toUpperCase().split(/\s+/);
    // a longer title keeps its last two words as the title and puts the rest on a small line above (EXTENDED)
    const kicker = words.length > 2 ? words.slice(0, -2).join(' ') : null;
    const main = kicker ? words.slice(-2) : words;
    const lines = main.length > 1 ? [main[0]!, main.slice(1).join(' ')] : main;
    // both lines at one size: the size the longer fits in the panel (measured a little narrow for the heavier weight)
    const titlePx = Math.min(...lines.map((l) => fitLabel({ full: l, maxWidth: 430, fontPx: lines.length > 1 ? 92 : 80, minFontPx: 44, measure: p.measure }).fontPx));
    let date = '';
    let time = '';
    try {
      date = new Intl.DateTimeFormat('en-AU', { timeZone: m.timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(m.scheduledAt));
      time = new Intl.DateTimeFormat('en-AU', { timeZone: m.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(m.scheduledAt)).replace(/\s/g, ' ');
    } catch {
      // an unknown time zone: no date or time
    }
    // the round, the ground, then the day and kick-off time
    const facts = [m.round, m.venue, [date, time].filter(Boolean).join(' · ')].filter((x): x is string => !!x).map((f) => f.toUpperCase());
    const rule = withAlpha(ink === '#FFFFFF' ? '#FFFFFF' : '#000000', 0.35);
    const crest = (s: 'home' | 'away', i: number) => {
      const tm = team(p, s);
      return (
        <span style={{ display: 'grid', justifyItems: 'center', gap: 10, width: 200, ...animStyle(p, 'zoom', 380 + i * 90, 420) }}>
          <Logo url={tm.logoUrl} label={tm.abbreviation} size={124} color={tm.primaryColor} radius={th.radius >= 12 ? 24 : 6} />
          <Fitted full={(tm.shortName || tm.name).toUpperCase()} short={tm.abbreviation} width={200} fontPx={26} measure={p.measure} weight={800} style={{ letterSpacing: 0.5 }} />
        </span>
      );
    };
    return (
      <div data-graphic="highlights_intro" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 560, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34, padding: '64px 44px', boxSizing: 'border-box', background: `linear-gradient(180deg, rgba(255,255,255,.08), rgba(0,0,0,.3)), ${plate}`, color: ink, fontFamily: th.font, boxShadow: '14px 0 44px rgba(0,0,0,.4)', ...animStyle(p, 'wipe', 0, 520) }}>
        {badgeUrl(p) ? <span style={animStyle(p, 'rise', 160, 380)}><ThemeBadge p={p} height={104} /></span> : <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', opacity: 0.85, ...animStyle(p, 'rise', 160, 380) }}>{m.competition.shortName || m.competition.name}</span>}
        <div style={{ display: 'grid', justifyItems: 'center', ...animStyle(p, 'rise', 240, 420) }}>
          {kicker ? (
            <span data-title-kicker style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, fontSize: Math.round(titlePx * 0.36), fontWeight: 800, letterSpacing: 6, whiteSpace: 'nowrap' }}>
              <span style={{ width: 34, height: 2, background: rule }} />
              {kicker}
              <span style={{ width: 34, height: 2, background: rule }} />
            </span>
          ) : null}
          {lines.map((l) => <span key={l} style={{ fontSize: titlePx, fontWeight: 900, lineHeight: 0.95, letterSpacing: 1, textAlign: 'center', whiteSpace: 'nowrap' }}>{l}</span>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 16 }}>
          {crest('home', 0)}
          {crest('away', 1)}
        </div>
        {facts.length ? (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 6, paddingTop: 22, borderTop: `2px solid ${withAlpha(ink === '#FFFFFF' ? '#FFFFFF' : '#000000', 0.25)}`, width: '86%', ...animStyle(p, 'rise', 560, 380) }}>
            {/* each on one line, smaller if it must be (measured narrow for the letter spacing) */}
            {facts.map((f, i) => <span key={f} style={{ fontSize: fitLabel({ full: f, maxWidth: 360, fontPx: i === 0 ? 24 : 21, minFontPx: 15, measure: p.measure }).fontPx, fontWeight: i === 0 ? 800 : 600, letterSpacing: 1.5, textAlign: 'center', whiteSpace: 'nowrap', opacity: i === 0 ? 1 : 0.85 }}>{f}</span>)}
          </div>
        ) : null}
        {v.line ? <span style={{ marginTop: 6, padding: '10px 22px', borderRadius: Math.min(th.radius, 10), background: th.accent, color: inkOn(th.accent), fontSize: 22, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', ...animStyle(p, 'rise', 660, 380) }}>{String(v.line)}</span> : null}
      </div>
    );
  };

  const Stinger = (p: GraphicProps) => {
    const h = team(p, 'home');
    const a = team(p, 'away');
    const text = String(p.cue.variables.text ?? '');
    const c = p.creative('detached_logo', p.cue);
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', fontFamily: p.data.theme.font, ...animStyle(p, 'wipe') }} data-graphic="stinger">
        <div style={{ position: 'absolute', inset: 0, background: p.data.theme.primary }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: '42%', height: '16%', background: `linear-gradient(90deg, ${h.primaryColor} 0 50%, ${a.primaryColor} 50% 100%)`, transformOrigin: 'left', ...animStyle(p, 'grow-x', 60, 380) }} />
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', ...animStyle(p, 'zoom', 140, 360) }}>
          <div style={{ background: 'rgba(255,255,255,.96)', borderRadius: 24, padding: '28px 48px', display: 'flex', alignItems: 'center', gap: 28, boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
            {c ? <SponsorMark p={p} placement="detached_logo" height={110} /> : <span style={{ fontSize: 60, fontWeight: 900, color: p.data.theme.secondary }}>{p.data.match.competition.shortName ?? p.data.match.competition.name}</span>}
            {text ? <span style={{ fontSize: 44, fontWeight: 800, color: '#0B1220' }}>{text}</span> : null}
          </div>
        </div>
      </div>
    );
  };

  return {
    backdrop: Backdrop,
    league_table: LeagueTable,
    fixtures: Fixtures,
    formation: Formation,
    match_summary: MatchSummary,
    head_to_head: HeadToHead,
    match_info: MatchInfo,
    shootout: Shootout,
    stat_compare: StatCompare,
    top_scorers: TopScorers,
    player_of_match: PlayerOfMatch,
    timeout: Timeout,
    added_time: AddedTime,
    review: VideoReview,
    highlights_intro: HighlightsIntro,
    stinger: Stinger,
    replay: ReplayTransition,
  };
}

/** The "presented by" badge every look places beside a moment sponsor. */
export function PresentedBy({ p, placement, height = 54, dark }: { p: GraphicProps; placement: string; height?: number; dark?: boolean }) {
  const c = p.creative(placement, p.cue);
  if (!c) return null;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 10, letterSpacing: 3, color: dark ? '#5b6577' : 'rgba(11,18,32,.6)', fontWeight: 700 }}>{presentedBy(p)}</span>
      <SponsorMark p={p} placement={placement} height={height} />
    </span>
  );
}

export { eventWord };
