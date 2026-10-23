'use client';
// "Minimal" theme: light flat panels, hairline rules, single-row scorebug, bar-chart stats.
// Quiet motion: panels fade and rise, rules draw across, text settles in on a short stagger.
import type { CSSProperties } from 'react';
import { occasionLine } from '../data';
import { animStyle, changeStyle, stagger, type GraphicProps, type ThemeComponents } from './stage';
import { FullFrameMedia, Fitted, Logo, Photo, SponsorMark, ThemeBadge, cardStyle, clockLabel, eventWord, identInfo, minute, periodBanner, personOrTeam, player, scorebugPosition, side, slateMessage, statRows, stoppageLabel, t, team, tickerText, tickerSpeed, ScorebugTabs } from './common';
import { sharedGraphics, type Chrome } from './shared-graphics';
import { lineupPage } from './theme-broadcast';

const SX = 96;
const SY = 54;
const light = (p: GraphicProps): CSSProperties => ({ background: 'rgba(250,251,253,.97)', color: '#0B1220', fontFamily: p.data.theme.font, boxShadow: '0 2px 18px rgba(0,0,0,.25)', borderRadius: p.data.theme.radius });

function Scorebug(p: GraphicProps) {
  const d = p.display;
  const stoppage = changeStyle(p, 'stoppage', !!d.stoppageText, 'flip');
  const cell = (s: 'home' | 'away', i: number) => {
    const t = team(p, s);
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderLeft: s === 'away' ? '1px solid #d5dbe5' : undefined, flexDirection: s === 'away' ? 'row-reverse' : 'row', ...animStyle(p, 'rise', 100 + i * 80, 320) }}>
        <span style={{ width: 4, height: 30, background: t.primaryColor, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 60 + i * 80, 280) }} />
        <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: 2 }}>{t.abbreviation}</span>
        <span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'center' }}><span style={changeStyle(p, `score-${s}`, d.score[s])}>{d.score[s]}</span></span>
        {d.possession === s ? <span style={{ fontSize: 14, color: p.data.theme.accent }}>◆</span> : null}
      </span>
    );
  };
  return (
    <div style={{ top: SY, display: 'flex', alignItems: 'center', height: 52, ...light(p), ...scorebugPosition(p, SX), ...animStyle(p, 'wipe') }} data-graphic="scorebug">
      {cell('home', 0)}
      {cell('away', 1)}
      <span style={{ padding: '0 18px', borderLeft: '1px solid #d5dbe5', fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'rise', 260, 320) }}>
        <span style={{ fontSize: 16, color: '#5b6577', marginRight: 10, ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
        {clockLabel(p)}
        {d.stoppageText ? <span style={{ color: '#c0182d', marginLeft: 8, ...stoppage }}>{stoppageLabel(p)}</span> : null}
      </span>
      {d.shotClockText ? <span style={{ padding: '0 14px', borderLeft: '1px solid #d5dbe5', color: '#c0182d', fontSize: 26, fontWeight: 800 }}>{d.shotClockText}</span> : null}
      {d.fouls ? <span style={{ padding: '0 14px', borderLeft: '1px solid #d5dbe5', fontSize: 16, color: '#5b6577' }}>FOULS {d.fouls.home}{d.bonus?.home ? '•' : ''}–{d.fouls.away}{d.bonus?.away ? '•' : ''}</span> : null}
      {d.shootout ? <span style={{ padding: '0 14px', borderLeft: '1px solid #d5dbe5', fontSize: 18 }}>(<span style={changeStyle(p, 'pens', `${d.shootout.home}-${d.shootout.away}`)}>{d.shootout.home}–{d.shootout.away}</span> p)</span> : null}
      {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <span style={{ padding: '0 12px', borderLeft: '1px solid #d5dbe5', ...animStyle(p, 'fade', 360, 320) }}><SponsorMark p={p} placement="scorebug_logo" height={34} /></span> : null}
      <ScorebugTabs p={p} />
    </div>
  );
}

const PHOTO_EVENTS = ['builtin:goal', 'builtin:card', 'builtin:player_of_match'];

function Strip(p: GraphicProps, kicker: string, kickerColor: string, title: React.ReactNode, sub: React.ReactNode, sponsorPlacement?: string) {
  const tm = team(p);
  const pl = PHOTO_EVENTS.includes(p.t.key) ? player(p) : null;
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 50, minWidth: 640, ...light(p), padding: '18px 28px', borderLeft: `6px solid ${tm.primaryColor}`, display: 'flex', gap: 22, alignItems: 'center', ...animStyle(p, 'rise') }} data-graphic={p.t.key}>
      {pl?.photoUrl ? <span style={animStyle(p, 'zoom', 160, 400)}><Photo url={pl.photoUrl} size={84} name={pl.displayName} /></span> : null}
      <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 18, letterSpacing: 3, fontWeight: 700, color: kickerColor, ...animStyle(p, 'wipe', 120, 360) }}>
        {kicker}
        {sponsorPlacement && p.creative(sponsorPlacement, p.cue) ? <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, color: '#5b6577', letterSpacing: 1, fontWeight: 500, ...animStyle(p, 'fade', 420, 320) }}>with <SponsorMark p={p} placement={sponsorPlacement} height={30} /></span> : null}
      </div>
      <div style={{ marginTop: 6, ...animStyle(p, 'rise', 200, 340) }}>{title}</div>
      <div style={{ fontSize: 22, color: '#5b6577', marginTop: 2, ...animStyle(p, 'rise', 280, 320) }}>{sub}</div>
      </div>
    </div>
  );
}

function Goal(p: GraphicProps) {
  const who = personOrTeam(p);
  const sc = p.data.match.projection.score;
  const kind = eventWord(p);
  return Strip(p, kind, p.data.theme.accent, <Fitted full={who.primary} short={who.short} width={560} fontPx={40} measure={p.measure} />, <>{team(p).name} {minute(p)} — {sc.home}–{sc.away}</>, 'event_partner');
}
function Score(p: GraphicProps) {
  const who = personOrTeam(p);
  return Strip(p, `+${String(p.cue.variables.points ?? '')} POINTS`, p.data.theme.accent, <Fitted full={who.primary} short={who.short} width={560} fontPx={38} measure={p.measure} />, team(p).name, 'event_partner');
}
function Card(p: GraphicProps) {
  const cs = cardStyle(p);
  const who = personOrTeam(p);
  return Strip(p, cs.word, cs.dark ? '#b88a00' : '#c0182d', <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 18, height: 26, borderRadius: 3, background: cs.colour }} /><Fitted full={who.primary} short={who.short} width={520} fontPx={40} measure={p.measure} /></span>, <>{team(p).name} {minute(p)}</>);
}
function Substitution(p: GraphicProps) {
  const on = player(p, 'playerIn');
  const off = player(p, 'playerOut');
  return Strip(p, 'SUBSTITUTION', '#2563eb', (
    <div style={{ display: 'grid', gap: 4, fontSize: 30 }}>
      <span style={animStyle(p, 'rise', 260, 320)}><span style={{ color: '#16a34a' }}>IN </span><Fitted full={on?.displayName ?? '—'} short={on?.shortName} width={480} fontPx={30} measure={p.measure} /></span>
      <span style={animStyle(p, 'rise', 360, 320)}><span style={{ color: '#c0182d' }}>OUT </span><Fitted full={off?.displayName ?? '—'} short={off?.shortName} width={480} fontPx={30} measure={p.measure} /></span>
    </div>
  ), <>{team(p).name} {minute(p)}</>);
}

function LowerThird(p: GraphicProps) {
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 30, fontFamily: p.data.theme.font, color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,.6)', ...animStyle(p, 'fade') }} data-graphic="lower_third">
      <div style={animStyle(p, 'rise', 60, 360)}><Fitted full={String(p.cue.variables.heading ?? '')} width={1100} fontPx={54} measure={p.measure} /></div>
      <div style={{ height: 3, width: 220, background: p.data.theme.accent, margin: '8px 0', transformOrigin: 'left', ...animStyle(p, 'grow-x', 160, 380) }} />
      {p.cue.variables.subtitle ? <div style={animStyle(p, 'rise', 260, 340)}><Fitted full={String(p.cue.variables.subtitle)} width={1100} fontPx={30} weight={500} measure={p.measure} /></div> : null}
      {p.creative('lower_third_banner', p.cue) ? <div style={{ marginTop: 10, ...animStyle(p, 'fade', 360, 320) }}><SponsorMark p={p} placement="lower_third_banner" height={40} /></div> : null}
    </div>
  );
}

function PlayerCard(p: GraphicProps) {
  const pl = player(p);
  const t = team(p);
  return (
    <div style={{ position: 'absolute', right: SX, bottom: SY + 50, width: 520, ...light(p), padding: 26, display: 'flex', gap: 22, alignItems: 'center', ...animStyle(p, 'rise') }} data-graphic="player_card">
      <span style={animStyle(p, 'fade', 120, 380)}><Photo url={pl?.photoUrl} size={130} name={pl?.displayName ?? t.name} /></span>
      <div>
        <div style={{ fontSize: 18, letterSpacing: 3, color: '#5b6577', ...animStyle(p, 'wipe', 180, 340) }}>{t.name.toUpperCase()}</div>
        <div style={animStyle(p, 'rise', 250, 320)}><Fitted full={pl?.displayName ?? t.name} short={pl?.shortName} width={320} fontPx={38} measure={p.measure} /></div>
        <div style={{ fontSize: 22, color: '#5b6577', ...animStyle(p, 'rise', 320, 320) }}>#{pl?.number ?? '–'}{pl?.position ? ` · ${pl.position}` : ''}</div>
      </div>
    </div>
  );
}

function Card2({ p, title, children, width = 1000 }: { p: GraphicProps; title: React.ReactNode; children: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', top: 150, width, ...light(p), padding: '34px 44px', ...animStyle(p, 'rise') }} data-graphic={p.t.key}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18, ...animStyle(p, 'wipe', 100, 380) }}>
        <div style={{ fontSize: 20, letterSpacing: 4, color: '#5b6577' }}>{title}</div>
        <ThemeBadge p={p} height={34} />
      </div>
      {children}
    </div>
  );
}

function Versus({ p, delayMs = 180, centre = 'vs', score = false }: { p: GraphicProps; delayMs?: number; centre?: string; score?: boolean }) {
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 16, ...animStyle(p, 'rise', delayMs, 360) }}><Logo url={h.logoUrl} label={h.abbreviation} size={72} color={h.primaryColor} /><Fitted full={h.name} short={h.shortName} width={300} fontPx={40} measure={p.measure} /></span>
      <span style={{ ...(score ? { color: '#0B1220', fontSize: 56, fontWeight: 700, fontVariantNumeric: 'tabular-nums' } : { color: '#8a93a3', fontSize: 26 }), ...animStyle(p, 'fade', delayMs + 120, 320) }}><span style={score ? changeStyle(p, 'score', centre) : undefined}>{centre}</span></span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 16, ...animStyle(p, 'rise', delayMs + 80, 360) }}><Fitted full={a.name} short={a.shortName} width={300} fontPx={40} measure={p.measure} /><Logo url={a.logoUrl} label={a.abbreviation} size={72} color={a.primaryColor} /></span>
    </div>
  );
}

function Ident(p: GraphicProps) {
  const info = identInfo(p);
  return (
    <Card2 p={p} title={p.data.match.competition.name.toUpperCase()}>
      <Versus p={p} centre={info.started ? info.centre : info.centre.toLowerCase()} score={info.started} />
      <div style={{ marginTop: 22, fontSize: 24, color: '#5b6577', letterSpacing: info.started ? 3 : 0, ...animStyle(p, 'rise', 380, 320) }}>{info.line}{info.countdown ? <> · {info.countdown.label.charAt(0)}{info.countdown.label.slice(1).toLowerCase()} <b style={{ color: '#0B1220', fontVariantNumeric: 'tabular-nums' }}>{info.countdown.text}</b></> : null}</div>
      {info.message ? <div style={{ marginTop: 14, fontSize: 30, fontWeight: 600, color: '#0B1220', ...animStyle(p, 'rise', 460, 320) }}>{info.message}</div> : null}
      <div style={{ marginTop: 12, ...animStyle(p, 'fade', 460, 320) }}><SponsorMark p={p} placement="detached_logo" height={50} /></div>
    </Card2>
  );
}

function Lineup(p: GraphicProps) {
  const { s, starters, bench, page, pages } = lineupPage(p, 12);
  const t = team(p, s);
  return (
    <Card2 p={p} width={760} title={`${t.name.toUpperCase()} LINEUP${pages > 1 ? ` ${page}/${pages}` : ''}`}>
      {starters.map((x, i) => (
        <div key={x.playerId} style={{ display: 'flex', gap: 14, fontSize: 28, padding: '5px 0', borderBottom: '1px solid #e4e8ef', ...stagger(p, i, 'rise', 200, 40) }}>
          <span style={{ width: 40, color: '#8a93a3', fontVariantNumeric: 'tabular-nums' }}>{x.number ?? ''}</span>
          <Fitted full={x.displayName} short={x.shortName} width={520} fontPx={28} weight={600} measure={p.measure} />
          <span style={{ marginLeft: 'auto', color: '#8a93a3', fontSize: 20 }}>{x.position ?? ''}</span>
        </div>
      ))}
      {bench.length ? <div style={{ marginTop: 14, fontSize: 20, color: '#5b6577', ...stagger(p, starters.length + 1, 'fade', 200, 40) }}>Substitutes: {bench.map((x) => x.shortName ?? x.displayName).join(', ')}</div> : null}
      {!starters.length ? <div style={{ fontSize: 24, color: '#5b6577' }}>Lineup to be confirmed</div> : null}
    </Card2>
  );
}

function Stats(p: GraphicProps) {
  const rows = statRows(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  const d = p.display;
  return (
    <Card2 p={p} width={900} title="MATCH STATISTICS">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 20, marginBottom: 8, ...animStyle(p, 'rise', 160, 340) }}>
        <Fitted full={h.name} short={h.shortName} width={330} fontPx={30} measure={p.measure} />
        <span style={{ fontSize: 44, fontWeight: 300, fontVariantNumeric: 'tabular-nums' }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home} – {d.score.away}</span></span>
        <span style={{ textAlign: 'right' }}><Fitted full={a.name} short={a.shortName} width={330} fontPx={30} measure={p.measure} /></span>
      </div>
      {rows.map((r, i) => {
        const hv = Number(r.home ?? 0);
        const av = Number(r.away ?? 0);
        const tot = hv + av || 1;
        return (
          <div key={r.key} style={{ margin: '12px 0', ...stagger(p, i, 'rise', 200, 60) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26 }}><b style={changeStyle(p, `h-${r.key}`, r.home)}>{r.home ?? '—'}</b><span style={{ color: '#5b6577' }}>{r.label}</span><b style={changeStyle(p, `a-${r.key}`, r.away)}>{r.away ?? '—'}</b></div>
            <div style={{ display: 'flex', height: 8, marginTop: 6, gap: 4 }}>
              <span style={{ flex: hv / tot, background: h.primaryColor, transformOrigin: 'right', ...animStyle(p, 'grow-x', 280 + i * 60, 460) }} />
              <span style={{ flex: av / tot, background: a.primaryColor, transformOrigin: 'left', ...animStyle(p, 'grow-x', 280 + i * 60, 460) }} />
            </div>
          </div>
        );
      })}
      {!rows.length ? <div style={{ color: '#5b6577', fontSize: 24 }}>No statistics recorded yet</div> : null}
    </Card2>
  );
}

function BreakScore(p: GraphicProps) {
  const d = p.display;
  return (
    <Card2 p={p} width={1000} title={t(p, ((p.cue.variables.label as string) || d.periodLabel).toUpperCase())}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
        <span style={animStyle(p, 'rise', 180, 360)}><Fitted full={team(p, 'home').name} short={team(p, 'home').shortName} width={340} fontPx={40} measure={p.measure} /></span>
        <span style={{ fontSize: 88, fontWeight: 300, fontVariantNumeric: 'tabular-nums', padding: '0 30px', ...animStyle(p, 'fade', 260, 460) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home} – {d.score.away}</span></span>
        <span style={{ textAlign: 'right', ...animStyle(p, 'rise', 220, 360) }}><Fitted full={team(p, 'away').name} short={team(p, 'away').shortName} width={340} fontPx={40} measure={p.measure} /></span>
      </div>
      {d.shootout ? <div style={{ textAlign: 'center', color: '#5b6577', fontSize: 26 }}>Penalties {d.shootout.home}–{d.shootout.away}</div> : null}
      {p.cue.variables.showSponsor !== false ? <div style={{ textAlign: 'center', marginTop: 12, ...animStyle(p, 'fade', 420, 320) }}><SponsorMark p={p} placement="detached_logo" height={50} /></div> : null}
    </Card2>
  );
}

function PeriodBanner(p: GraphicProps) {
  const { heading, period } = periodBanner(p);
  const d = p.display;
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: SY + 50, margin: '0 auto', width: 760, ...light(p), padding: '22px 36px', textAlign: 'center', ...animStyle(p, 'rise') }} data-graphic="period_banner">
      <div style={{ fontSize: 20, letterSpacing: 6, color: p.data.theme.accent, fontWeight: 700, ...animStyle(p, 'wipe', 100, 400) }}>{t(p, heading)}</div>
      <div style={{ height: 1, background: '#d5dbe5', margin: '12px 0', ...animStyle(p, 'grow-x', 180, 420) }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 20 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', ...animStyle(p, 'rise', 240, 340) }}><b style={{ fontSize: 28, letterSpacing: 2 }}>{h.abbreviation}</b><span style={{ width: 4, height: 28, background: h.primaryColor }} /></span>
        <span style={{ fontSize: 40, fontWeight: 300, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'fade', 300, 400) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home} – {d.score.away}</span></span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, ...animStyle(p, 'rise', 280, 340) }}><span style={{ width: 4, height: 28, background: a.primaryColor }} /><b style={{ fontSize: 28, letterSpacing: 2 }}>{a.abbreviation}</b></span>
      </div>
      <div style={{ fontSize: 20, color: '#5b6577', marginTop: 6, ...animStyle(p, 'rise', 360, 320) }}>{period}</div>
    </div>
  );
}

function Sponsor(p: GraphicProps) {
  const placement = (p.cue.variables.placement as string) ?? 'detached_logo';
  const c = p.creative(placement, p.cue) ?? (p.cue.variables.creative ? p.data.creatives[p.cue.variables.creative as string] : null);
  if (!c) return null;
  if (placement === 'full_frame_image') return <FullFrameMedia p={{ ...p, cue: { ...p.cue, variables: { ...p.cue.variables, creative: c.id } } }} />;
  return (
    <div style={{ position: 'absolute', right: SX, top: SY, height: 80, ...light(p), padding: 12, ...animStyle(p, 'rise') }} data-graphic="sponsor">
      <img alt={c.brandName} src={c.url} style={{ height: '100%', objectFit: 'contain', ...animStyle(p, 'fade', 150, 320) }} data-sponsor-creative={c.id} />
    </div>
  );
}

function Ticker(p: GraphicProps) {
  const text = tickerText(p);
  return (
    <div style={{ position: 'absolute', left: SX, right: SX, bottom: SY, height: 46, ...light(p), overflow: 'hidden', display: 'flex', alignItems: 'center', ...animStyle(p, 'wipe') }} data-graphic="ticker">
      <div style={animStyle(p, 'fade', 200, 400)}>
        <div style={{ whiteSpace: 'nowrap', fontSize: 24, animation: `bs-ticker ${tickerSpeed(p)}s linear infinite`, paddingLeft: 20 }}>{text} &nbsp; · &nbsp; {text} &nbsp; · &nbsp;</div>
      </div>
    </div>
  );
}

function Slate(p: GraphicProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#F3F6FB', color: '#0B1220', fontFamily: p.data.theme.font, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 220px', gap: 26, ...animStyle(p, 'fade') }} data-graphic="slate">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...animStyle(p, 'wipe', 150, 420) }}><span style={{ fontSize: 22, letterSpacing: 5, color: '#5b6577' }}>{occasionLine(p.data.match).toUpperCase()}</span><ThemeBadge p={p} height={56} /></div>
      <Versus p={p} delayMs={260} />
      <div style={{ fontSize: 46, fontWeight: 300, ...animStyle(p, 'rise', 460, 400) }}>{slateMessage(p)}</div>
      <div style={animStyle(p, 'fade', 560, 400)}><SponsorMark p={p} placement="detached_logo" height={60} /></div>
    </div>
  );
}

export const minimalChrome: Chrome = {
  frame: (p, title, children, width) => <Card2 p={p} title={title} width={width}>{children}</Card2>,
  strip: (p, kicker, colour, body, sponsorPlacement) => Strip(p, kicker, colour, body, '', sponsorPlacement),
  event: (p, label, accent, body) => Strip(p, label, accent, body, '', 'event_partner'),
  text: () => '#0B1220',
  muted: () => '#5b6577',
  rule: () => '#d5dbe5',
};

export const minimalTheme: ThemeComponents = {
  ...sharedGraphics(minimalChrome),
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

export { side };
