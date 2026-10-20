'use client';
// "Club" theme: team colours forward, rounded pills, large badges, centred compositions.
// Lively motion: pills zoom and drop in with a little overshoot, badges pop, rows cascade.
import type { CSSProperties } from 'react';
import { animStyle, changeStyle, stagger, type GraphicProps, type ThemeComponents } from './stage';
import { FullFrameMedia, Fitted, Logo, Photo, SponsorMark, ThemeBadge, kickoffCountdown, minute, periodBanner, personOrTeam, player, slateMessage, statRows, team, tickerSpeed } from './common';
import { lineupPage } from './theme-broadcast';

const SY = 54;
const pill = (p: GraphicProps, bg: string): CSSProperties => ({ background: bg, color: '#fff', borderRadius: 999, fontFamily: p.data.theme.font, boxShadow: '0 8px 30px rgba(0,0,0,.35)' });
// Centred graphics use auto margins rather than translateX(-50%): the entrance/exit transforms would otherwise
// replace the centring transform and knock the graphic off centre while it animates.
const centred: CSSProperties = { position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', width: 'fit-content' };

function Scorebug(p: GraphicProps) {
  const d = p.display;
  const h = team(p, 'home');
  const a = team(p, 'away');
  const stoppage = changeStyle(p, 'stoppage', !!d.stoppageText, 'flip');
  const side = (s: 'home' | 'away') => {
    const t = s === 'home' ? h : a;
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: '100%', background: t.primaryColor, flexDirection: s === 'away' ? 'row-reverse' : 'row', borderRadius: s === 'home' ? '999px 0 0 999px' : '0 999px 999px 0', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', 120, 380) }}>
        <span style={animStyle(p, 'zoom', 220, 400)}><Logo url={t.logoUrl} label={t.abbreviation} size={44} color="rgba(0,0,0,.25)" radius={22} /></span>
        <span style={{ fontSize: 26, fontWeight: 800 }}>{t.abbreviation}</span>
        <span style={{ fontSize: 40, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}><span style={changeStyle(p, `score-${s}`, d.score[s])}>{d.score[s]}</span></span>
        {d.possession === s ? <span>●</span> : null}
      </span>
    );
  };
  return (
    <div style={{ ...centred, top: SY, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, fontFamily: p.data.theme.font, ...animStyle(p, 'drop') }} data-graphic="scorebug">
      <div style={{ display: 'flex', alignItems: 'stretch', height: 64, color: '#fff', borderRadius: 999, boxShadow: '0 8px 30px rgba(0,0,0,.35)', ...animStyle(p, 'zoom', 0, 420) }}>
        {side('home')}
        <span style={{ display: 'grid', placeItems: 'center', background: '#0B1220', padding: '0 22px', fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 130 }}>
          {d.clockText}
        </span>
        {side('away')}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ ...pill(p, 'rgba(11,18,32,.85)'), padding: '4px 16px', fontSize: 18, fontWeight: 700, ...animStyle(p, 'rise', 300, 340) }}><span style={changeStyle(p, 'period', d.periodLabel, 'flip')}>{d.periodLabel}</span>{d.stoppageText ? <span style={stoppage}> {d.stoppageText}</span> : null}</span>
        {d.shotClockText ? <span style={{ ...pill(p, '#E5484D'), padding: '4px 16px', fontSize: 18, fontWeight: 800, ...animStyle(p, 'rise', 360, 340) }}>{d.shotClockText}</span> : null}
        {d.fouls ? <span style={{ ...pill(p, 'rgba(11,18,32,.85)'), padding: '4px 16px', fontSize: 16, ...animStyle(p, 'rise', 360, 340) }}>Fouls {d.fouls.home}–{d.fouls.away}</span> : null}
        {d.shootout ? <span style={{ ...pill(p, 'rgba(11,18,32,.85)'), padding: '4px 16px', fontSize: 18, ...animStyle(p, 'rise', 360, 340) }}>Pens <span style={changeStyle(p, 'pens', `${d.shootout.home}-${d.shootout.away}`)}>{d.shootout.home}–{d.shootout.away}</span></span> : null}
        {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <span style={{ ...pill(p, 'rgba(255,255,255,.95)'), padding: '4px 14px', ...animStyle(p, 'rise', 420, 340) }}><SponsorMark p={p} placement="scorebug_logo" height={24} /></span> : null}
      </div>
    </div>
  );
}

function Burst(p: GraphicProps, title: string, lines: React.ReactNode, color?: string) {
  const t = team(p);
  return (
    <div style={{ ...centred, bottom: SY + 70, display: 'flex', alignItems: 'center', gap: 22, ...pill(p, color ?? t.primaryColor), padding: '16px 44px 16px 16px', ...animStyle(p, 'zoom') }} data-graphic={p.t.key}>
      <span style={{ width: 120, height: 120, borderRadius: '50%', background: 'rgba(0,0,0,.2)', display: 'grid', placeItems: 'center', ...animStyle(p, 'zoom', 160, 420) }}><Logo url={t.logoUrl} label={t.abbreviation} size={84} color="transparent" radius={42} /></span>
      <div>
        <div style={{ fontSize: 46, fontWeight: 900, letterSpacing: 2, ...animStyle(p, 'drop', 240, 400) }}>{title}</div>
        <div style={animStyle(p, 'rise', 340, 360)}>{lines}</div>
      </div>
      {p.creative('event_partner', p.cue) ? <span style={{ background: '#fff', borderRadius: 999, padding: '10px 20px', marginLeft: 10, ...animStyle(p, 'zoom', 460, 400) }}><SponsorMark p={p} placement="event_partner" height={50} /></span> : null}
    </div>
  );
}

function Goal(p: GraphicProps) {
  const who = personOrTeam(p);
  const sc = p.data.match.projection.score;
  return Burst(p, p.cue.variables.eventType === 'own_goal' ? 'OWN GOAL' : 'GOAL!', (
    <div style={{ fontSize: 30 }}>
      <Fitted full={who.primary} short={who.short} width={520} fontPx={32} measure={p.measure} style={{ color: '#fff' }} /> <span style={{ opacity: 0.85 }}>{minute(p)}</span>
      <div style={{ fontSize: 24, opacity: 0.9, ...animStyle(p, 'rise', 460, 320) }}>{team(p, 'home').abbreviation} {sc.home} – {sc.away} {team(p, 'away').abbreviation}</div>
    </div>
  ));
}
function Score(p: GraphicProps) {
  const who = personOrTeam(p);
  return Burst(p, `+${String(p.cue.variables.points ?? '')}`, <Fitted full={who.primary} short={who.short} width={520} fontPx={30} measure={p.measure} style={{ color: '#fff' }} />);
}
function Card(p: GraphicProps) {
  const ct = p.cue.variables.cardType;
  const who = personOrTeam(p);
  return Burst(p, ct === 'red' ? 'RED CARD' : ct === 'second_yellow' ? 'SECOND YELLOW' : 'YELLOW CARD', <div style={{ fontSize: 28 }}><Fitted full={who.primary} short={who.short} width={480} fontPx={30} measure={p.measure} style={{ color: ct === 'yellow' ? '#0B1220' : '#fff' }} /> {minute(p)}</div>, ct === 'yellow' ? '#FFCE66' : '#E5484D');
}
function Substitution(p: GraphicProps) {
  const on = player(p, 'playerIn');
  const off = player(p, 'playerOut');
  return Burst(p, 'CHANGE', (
    <div style={{ fontSize: 26, display: 'grid', gap: 2 }}>
      <span style={animStyle(p, 'slide-left', 380, 360)}>▲ {on ? `${on.number ?? ''} ${on.displayName}` : '—'}</span>
      <span style={{ opacity: 0.8, ...animStyle(p, 'slide-left', 480, 360) }}>▼ {off ? `${off.number ?? ''} ${off.displayName}` : '—'}</span>
    </div>
  ));
}

function LowerThird(p: GraphicProps) {
  return (
    <div style={{ ...centred, bottom: SY + 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, ...animStyle(p, 'rise') }} data-graphic="lower_third">
      <span style={{ ...pill(p, p.data.theme.primary), color: p.data.theme.secondary, padding: '14px 40px', ...animStyle(p, 'zoom', 0, 420) }}><Fitted full={String(p.cue.variables.heading ?? '')} width={1100} fontPx={46} measure={p.measure} /></span>
      {p.cue.variables.subtitle ? <span style={{ ...pill(p, 'rgba(11,18,32,.9)'), padding: '8px 28px', ...animStyle(p, 'drop', 180, 400) }}><Fitted full={String(p.cue.variables.subtitle)} width={1000} fontPx={28} weight={500} measure={p.measure} /></span> : null}
      {p.creative('lower_third_banner', p.cue) ? <span style={{ ...pill(p, '#fff'), padding: '6px 22px', ...animStyle(p, 'drop', 320, 400) }}><SponsorMark p={p} placement="lower_third_banner" height={36} /></span> : null}
    </div>
  );
}

function PlayerCard(p: GraphicProps) {
  const pl = player(p);
  const t = team(p);
  return (
    <div style={{ position: 'absolute', right: 120, bottom: SY + 60, width: 440, padding: '40px 30px 30px', textAlign: 'center', background: t.primaryColor, color: '#fff', borderRadius: 36, fontFamily: p.data.theme.font, boxShadow: '0 10px 40px rgba(0,0,0,.4)', ...animStyle(p, 'zoom') }} data-graphic="player_card">
      <span style={{ display: 'inline-block', ...animStyle(p, 'zoom', 180, 440) }}><Photo url={pl?.photoUrl} size={170} name={pl?.displayName ?? t.name} /></span>
      <div style={{ fontSize: 70, fontWeight: 900, lineHeight: 1, marginTop: 10, ...animStyle(p, 'drop', 300, 420) }}>{pl?.number ?? ''}</div>
      <div style={animStyle(p, 'rise', 380, 340)}><Fitted full={pl?.displayName ?? t.name} short={pl?.shortName} width={380} fontPx={36} measure={p.measure} /></div>
      <div style={{ fontSize: 22, opacity: 0.85, ...animStyle(p, 'rise', 440, 320) }}>{pl?.position ?? ''}</div>
    </div>
  );
}

function Big({ p, title, children, width = 1100, color }: { p: GraphicProps; title: React.ReactNode; children: React.ReactNode; width?: number; color?: string }) {
  return (
    <div style={{ position: 'absolute', left: (1920 - width) / 2, top: 130, width, borderRadius: 40, overflow: 'hidden', fontFamily: p.data.theme.font, color: '#fff', boxShadow: '0 10px 50px rgba(0,0,0,.45)', ...animStyle(p, 'zoom') }} data-graphic={p.t.key}>
      <div style={{ background: color ?? p.data.theme.primary, color: color ? '#fff' : p.data.theme.secondary, padding: '22px 40px', fontSize: 38, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, ...animStyle(p, 'slide-down', 100, 400) }}><ThemeBadge p={p} height={44} />{title}</div>
      <div style={{ background: p.data.theme.panel, padding: '30px 44px', transformOrigin: 'top', ...animStyle(p, 'grow-y', 160, 400) }}>{children}</div>
    </div>
  );
}

function Ident(p: GraphicProps) {
  const h = team(p, 'home');
  const a = team(p, 'away');
  const cd = p.cue.variables.showCountdown !== false ? kickoffCountdown(p) : null;
  return (
    <Big p={p} title={p.data.match.competition.name}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', textAlign: 'center' }}>
        <div style={animStyle(p, 'zoom', 300, 460)}><Logo url={h.logoUrl} label={h.abbreviation} size={150} color={h.primaryColor} radius={75} /><div style={{ marginTop: 10, ...animStyle(p, 'rise', 420, 340) }}><Fitted full={h.name} short={h.shortName} width={380} fontPx={38} measure={p.measure} /></div></div>
        <div style={{ fontSize: 42, fontWeight: 900, opacity: 0.6, ...animStyle(p, 'flip', 400, 460) }}>VS</div>
        <div style={animStyle(p, 'zoom', 360, 460)}><Logo url={a.logoUrl} label={a.abbreviation} size={150} color={a.primaryColor} radius={75} /><div style={{ marginTop: 10, ...animStyle(p, 'rise', 480, 340) }}><Fitted full={a.name} short={a.shortName} width={380} fontPx={38} measure={p.measure} /></div></div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 28, ...animStyle(p, 'rise', 540, 340) }}>{p.data.match.venue ?? ''}{cd ? <b style={{ marginLeft: 16, color: p.data.theme.primary, display: 'inline-block', ...animStyle(p, 'zoom', 620, 420) }}>{cd}</b> : null}</div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14, ...animStyle(p, 'fade', 700, 320) }}><SponsorMark p={p} placement="detached_logo" height={60} /></div>
    </Big>
  );
}

function Lineup(p: GraphicProps) {
  const { s, starters, bench, page, pages } = lineupPage(p, 12);
  const t = team(p, s);
  return (
    <Big p={p} width={1240} color={t.primaryColor} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 16 }}><span style={animStyle(p, 'zoom', 240, 420)}><Logo url={t.logoUrl} label={t.abbreviation} size={56} color="rgba(0,0,0,.2)" radius={28} /></span>{t.name}{pages > 1 ? ` ${page}/${pages}` : ''}</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {starters.map((x, i) => (
          <div key={x.playerId} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,.07)', borderRadius: 999, padding: '8px 18px', ...stagger(p, i, 'zoom', 300, 50) }}>
            <span style={{ width: 44, height: 44, borderRadius: '50%', background: t.primaryColor, display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 22 }}>{x.number ?? ''}</span>
            <Fitted full={x.displayName} short={x.shortName} width={260} fontPx={26} measure={p.measure} />
          </div>
        ))}
      </div>
      {bench.length ? <div style={{ marginTop: 18, fontSize: 22, opacity: 0.8, textAlign: 'center', ...stagger(p, starters.length + 1, 'rise', 300, 50) }}>Bench: {bench.map((x) => x.shortName ?? x.displayName).join(' · ')}</div> : null}
      {!starters.length ? <div style={{ fontSize: 26, opacity: 0.8, textAlign: 'center' }}>Lineup to be confirmed</div> : null}
    </Big>
  );
}

function Stats(p: GraphicProps) {
  const rows = statRows(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  const d = p.display;
  return (
    <Big p={p} width={1000} title="STATS">
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px', alignItems: 'center', margin: '0 0 16px', fontSize: 30, ...animStyle(p, 'rise', 200, 340) }}>
        <b style={{ textAlign: 'center' }}>{h.abbreviation}</b>
        <span style={{ textAlign: 'center', fontSize: 46, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></span>
        <b style={{ textAlign: 'center' }}>{a.abbreviation}</b>
      </div>
      {rows.map((r, i) => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px', alignItems: 'center', margin: '10px 0', fontSize: 30, ...stagger(p, i, 'rise', 280, 70) }}>
          <span style={{ ...pill(p, h.primaryColor), textAlign: 'center', fontWeight: 900, ...animStyle(p, 'slide-left', 340 + i * 70, 400) }}><span style={changeStyle(p, `h-${r.key}`, r.home)}>{r.home ?? '—'}</span></span>
          <span style={{ textAlign: 'center' }}>{r.label}</span>
          <span style={{ ...pill(p, a.primaryColor), textAlign: 'center', fontWeight: 900, ...animStyle(p, 'slide-right', 340 + i * 70, 400) }}><span style={changeStyle(p, `a-${r.key}`, r.away)}>{r.away ?? '—'}</span></span>
        </div>
      ))}
      {!rows.length ? <div style={{ textAlign: 'center', opacity: 0.8, fontSize: 26 }}>No statistics recorded yet</div> : null}
    </Big>
  );
}

function BreakScore(p: GraphicProps) {
  const d = p.display;
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <Big p={p} width={1100} title={(p.cue.variables.label as string) || d.periodLabel}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', textAlign: 'center' }}>
        <div style={animStyle(p, 'zoom', 300, 460)}><Logo url={h.logoUrl} label={h.abbreviation} size={120} color={h.primaryColor} radius={60} /><div style={animStyle(p, 'rise', 400, 340)}><Fitted full={h.shortName} width={320} fontPx={34} measure={p.measure} /></div></div>
        <div style={{ fontSize: 110, fontWeight: 900, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'drop', 380, 480) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></div>
        <div style={animStyle(p, 'zoom', 340, 460)}><Logo url={a.logoUrl} label={a.abbreviation} size={120} color={a.primaryColor} radius={60} /><div style={animStyle(p, 'rise', 440, 340)}><Fitted full={a.shortName} width={320} fontPx={34} measure={p.measure} /></div></div>
      </div>
      {d.shootout ? <div style={{ textAlign: 'center', fontSize: 28, ...animStyle(p, 'rise', 520, 340) }}>Penalties {d.shootout.home}–{d.shootout.away}</div> : null}
      {p.cue.variables.showSponsor !== false ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14, ...animStyle(p, 'fade', 600, 320) }}><SponsorMark p={p} placement="detached_logo" height={60} /></div> : null}
    </Big>
  );
}

function PeriodBanner(p: GraphicProps) {
  const { heading, period } = periodBanner(p);
  const d = p.display;
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <div style={{ ...centred, bottom: SY + 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, fontFamily: p.data.theme.font, ...animStyle(p, 'rise') }} data-graphic="period_banner">
      <span style={{ ...pill(p, p.data.theme.primary), color: p.data.theme.secondary, padding: '10px 40px', fontSize: 40, fontWeight: 900, letterSpacing: 4, ...animStyle(p, 'zoom', 0, 460) }}>{heading}</span>
      <div style={{ display: 'flex', alignItems: 'stretch', height: 70, color: '#fff', borderRadius: 999, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,.35)', ...animStyle(p, 'drop', 200, 420) }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', background: h.primaryColor, ...animStyle(p, 'slide-left', 300, 380) }}><Logo url={h.logoUrl} label={h.abbreviation} size={44} color="rgba(0,0,0,.25)" radius={22} /><b style={{ fontSize: 28 }}>{h.abbreviation}</b></span>
        <span style={{ display: 'grid', placeItems: 'center', background: '#0B1220', padding: '0 26px', fontSize: 36, fontWeight: 900, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'flip', 360, 440) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', background: a.primaryColor, flexDirection: 'row-reverse', ...animStyle(p, 'slide-right', 300, 380) }}><Logo url={a.logoUrl} label={a.abbreviation} size={44} color="rgba(0,0,0,.25)" radius={22} /><b style={{ fontSize: 28 }}>{a.abbreviation}</b></span>
      </div>
      <span style={{ ...pill(p, 'rgba(11,18,32,.85)'), padding: '4px 20px', fontSize: 20, fontWeight: 700, ...animStyle(p, 'rise', 440, 340) }}>{period}</span>
    </div>
  );
}

function Sponsor(p: GraphicProps) {
  const placement = (p.cue.variables.placement as string) ?? 'detached_logo';
  const c = p.creative(placement, p.cue) ?? (p.cue.variables.creative ? p.data.creatives[p.cue.variables.creative as string] : null);
  if (!c) return null;
  if (placement === 'full_frame_image') return <FullFrameMedia p={{ ...p, cue: { ...p.cue, variables: { ...p.cue.variables, creative: c.id } } }} />;
  return (
    <div style={{ position: 'absolute', right: 96, top: SY, height: 96, ...pill(p, '#fff'), padding: '14px 30px', ...animStyle(p, 'zoom') }} data-graphic="sponsor">
      <img alt={c.brandName} src={c.url} style={{ height: '100%', objectFit: 'contain', ...animStyle(p, 'fade', 160, 320) }} data-sponsor-creative={c.id} />
    </div>
  );
}

function Ticker(p: GraphicProps) {
  const text = String(p.cue.variables.text ?? '');
  return (
    <div style={{ position: 'absolute', left: 120, right: 120, bottom: SY, height: 54, ...pill(p, p.data.theme.panel), overflow: 'hidden', display: 'flex', alignItems: 'center', ...animStyle(p, 'rise') }} data-graphic="ticker">
      <div style={animStyle(p, 'fade', 220, 400)}>
        <div style={{ whiteSpace: 'nowrap', fontSize: 26, animation: `bs-ticker ${tickerSpeed(p)}s linear infinite`, paddingLeft: 30 }}>{text} &nbsp;★&nbsp; {text} &nbsp;★&nbsp;</div>
      </div>
    </div>
  );
}

function Slate(p: GraphicProps) {
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${h.primaryColor} 0%, ${h.primaryColor} 50%, ${a.primaryColor} 50%, ${a.primaryColor} 100%)`, fontFamily: p.data.theme.font, color: '#fff', display: 'grid', placeItems: 'center', ...animStyle(p, 'fade') }} data-graphic="slate">
      <div style={{ background: 'rgba(11,18,32,.85)', borderRadius: 48, padding: '50px 90px', textAlign: 'center', ...animStyle(p, 'zoom', 150, 460) }}>
        <div style={{ display: 'flex', gap: 60, justifyContent: 'center', alignItems: 'center' }}>
          <span style={animStyle(p, 'zoom', 340, 440)}><Logo url={h.logoUrl} label={h.abbreviation} size={140} color={h.primaryColor} radius={70} /></span>
          <b style={{ fontSize: 40, ...animStyle(p, 'flip', 440, 440) }}>VS</b>
          <span style={animStyle(p, 'zoom', 400, 440)}><Logo url={a.logoUrl} label={a.abbreviation} size={140} color={a.primaryColor} radius={70} /></span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20, ...animStyle(p, 'fade', 480, 400) }}><ThemeBadge p={p} height={60} /></div>
        <div style={{ fontSize: 54, fontWeight: 900, marginTop: 24, ...animStyle(p, 'rise', 540, 400) }}>{slateMessage(p)}</div>
        <div style={{ fontSize: 26, opacity: 0.8, ...animStyle(p, 'rise', 620, 360) }}>{p.data.match.competition.name}</div>
        <div style={{ marginTop: 16, ...animStyle(p, 'fade', 720, 400) }}><SponsorMark p={p} placement="detached_logo" height={64} /></div>
      </div>
    </div>
  );
}

export const clubTheme: ThemeComponents = {
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
