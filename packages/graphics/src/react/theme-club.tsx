'use client';
// "Club" theme: team colours forward, rounded pills, large badges, centred compositions, scale motion.
import type { CSSProperties } from 'react';
import { animStyle, type GraphicProps, type ThemeComponents } from './stage';
import { FullFrameMedia, Fitted, Logo, Photo, SponsorMark, kickoffCountdown, minute, personOrTeam, player, slateMessage, statRows, team, tickerSpeed } from './common';
import { lineupPage } from './theme-broadcast';

const SY = 54;
const pill = (p: GraphicProps, bg: string): CSSProperties => ({ background: bg, color: '#fff', borderRadius: 999, fontFamily: p.data.theme.font, boxShadow: '0 8px 30px rgba(0,0,0,.35)' });

function Scorebug(p: GraphicProps) {
  const d = p.display;
  const h = team(p, 'home');
  const a = team(p, 'away');
  const side = (s: 'home' | 'away') => {
    const t = s === 'home' ? h : a;
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: '100%', background: t.primaryColor, flexDirection: s === 'away' ? 'row-reverse' : 'row', borderRadius: s === 'home' ? '999px 0 0 999px' : '0 999px 999px 0' }}>
        <Logo url={t.logoUrl} label={t.abbreviation} size={44} color="rgba(0,0,0,.25)" radius={22} />
        <span style={{ fontSize: 26, fontWeight: 800 }}>{t.abbreviation}</span>
        <span style={{ fontSize: 40, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{d.score[s]}</span>
        {d.possession === s ? <span>●</span> : null}
      </span>
    );
  };
  return (
    <div style={{ position: 'absolute', left: '50%', top: SY, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, fontFamily: p.data.theme.font, ...animStyle(p, 'scale') }} data-graphic="scorebug">
      <div style={{ display: 'flex', alignItems: 'stretch', height: 64, color: '#fff', borderRadius: 999, boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}>
        {side('home')}
        <span style={{ display: 'grid', placeItems: 'center', background: '#0B1220', padding: '0 22px', fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 130 }}>
          {d.clockText}
        </span>
        {side('away')}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ ...pill(p, 'rgba(11,18,32,.85)'), padding: '4px 16px', fontSize: 18, fontWeight: 700 }}>{d.periodLabel}{d.stoppageText ? ` ${d.stoppageText}` : ''}</span>
        {d.shotClockText ? <span style={{ ...pill(p, '#E5484D'), padding: '4px 16px', fontSize: 18, fontWeight: 800 }}>{d.shotClockText}</span> : null}
        {d.fouls ? <span style={{ ...pill(p, 'rgba(11,18,32,.85)'), padding: '4px 16px', fontSize: 16 }}>Fouls {d.fouls.home}–{d.fouls.away}</span> : null}
        {d.shootout ? <span style={{ ...pill(p, 'rgba(11,18,32,.85)'), padding: '4px 16px', fontSize: 18 }}>Pens {d.shootout.home}–{d.shootout.away}</span> : null}
        {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <span style={{ ...pill(p, 'rgba(255,255,255,.95)'), padding: '4px 14px' }}><SponsorMark p={p} placement="scorebug_logo" height={24} /></span> : null}
      </div>
    </div>
  );
}

function Burst(p: GraphicProps, title: string, lines: React.ReactNode, color?: string) {
  const t = team(p);
  return (
    <div style={{ position: 'absolute', left: '50%', bottom: SY + 70, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 22, ...pill(p, color ?? t.primaryColor), padding: '16px 44px 16px 16px', ...animStyle(p, 'scale') }} data-graphic={p.t.key}>
      <span style={{ width: 120, height: 120, borderRadius: '50%', background: 'rgba(0,0,0,.2)', display: 'grid', placeItems: 'center' }}><Logo url={t.logoUrl} label={t.abbreviation} size={84} color="transparent" radius={42} /></span>
      <div>
        <div style={{ fontSize: 46, fontWeight: 900, letterSpacing: 2 }}>{title}</div>
        {lines}
      </div>
      {p.creative('event_partner', p.cue) ? <span style={{ background: '#fff', borderRadius: 999, padding: '10px 20px', marginLeft: 10 }}><SponsorMark p={p} placement="event_partner" height={50} /></span> : null}
    </div>
  );
}

function Goal(p: GraphicProps) {
  const who = personOrTeam(p);
  const sc = p.data.match.projection.score;
  return Burst(p, p.cue.variables.eventType === 'own_goal' ? 'OWN GOAL' : 'GOAL!', (
    <div style={{ fontSize: 30 }}>
      <Fitted full={who.primary} short={who.short} width={520} fontPx={32} measure={p.measure} style={{ color: '#fff' }} /> <span style={{ opacity: 0.85 }}>{minute(p)}</span>
      <div style={{ fontSize: 24, opacity: 0.9 }}>{team(p, 'home').abbreviation} {sc.home} – {sc.away} {team(p, 'away').abbreviation}</div>
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
      <span>▲ {on ? `${on.number ?? ''} ${on.displayName}` : '—'}</span>
      <span style={{ opacity: 0.8 }}>▼ {off ? `${off.number ?? ''} ${off.displayName}` : '—'}</span>
    </div>
  ));
}

function LowerThird(p: GraphicProps) {
  return (
    <div style={{ position: 'absolute', left: '50%', bottom: SY + 40, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, ...animStyle(p, 'scale') }} data-graphic="lower_third">
      <span style={{ ...pill(p, p.data.theme.primary), color: p.data.theme.secondary, padding: '14px 40px' }}><Fitted full={String(p.cue.variables.heading ?? '')} width={1100} fontPx={46} measure={p.measure} /></span>
      {p.cue.variables.subtitle ? <span style={{ ...pill(p, 'rgba(11,18,32,.9)'), padding: '8px 28px' }}><Fitted full={String(p.cue.variables.subtitle)} width={1000} fontPx={28} weight={500} measure={p.measure} /></span> : null}
      {p.creative('lower_third_banner', p.cue) ? <span style={{ ...pill(p, '#fff'), padding: '6px 22px' }}><SponsorMark p={p} placement="lower_third_banner" height={36} /></span> : null}
    </div>
  );
}

function PlayerCard(p: GraphicProps) {
  const pl = player(p);
  const t = team(p);
  return (
    <div style={{ position: 'absolute', right: 120, bottom: SY + 60, width: 440, padding: '40px 30px 30px', textAlign: 'center', background: t.primaryColor, color: '#fff', borderRadius: 36, fontFamily: p.data.theme.font, boxShadow: '0 10px 40px rgba(0,0,0,.4)', ...animStyle(p, 'scale') }} data-graphic="player_card">
      <Photo url={pl?.photoUrl} size={170} name={pl?.displayName ?? t.name} />
      <div style={{ fontSize: 70, fontWeight: 900, lineHeight: 1, marginTop: 10 }}>{pl?.number ?? ''}</div>
      <Fitted full={pl?.displayName ?? t.name} short={pl?.shortName} width={380} fontPx={36} measure={p.measure} />
      <div style={{ fontSize: 22, opacity: 0.85 }}>{pl?.position ?? ''}</div>
    </div>
  );
}

function Big({ p, title, children, width = 1100, color }: { p: GraphicProps; title: React.ReactNode; children: React.ReactNode; width?: number; color?: string }) {
  return (
    <div style={{ position: 'absolute', left: (1920 - width) / 2, top: 130, width, borderRadius: 40, overflow: 'hidden', fontFamily: p.data.theme.font, color: '#fff', boxShadow: '0 10px 50px rgba(0,0,0,.45)', ...animStyle(p, 'scale') }} data-graphic={p.t.key}>
      <div style={{ background: color ?? p.data.theme.primary, color: color ? '#fff' : p.data.theme.secondary, padding: '22px 40px', fontSize: 38, fontWeight: 900, textAlign: 'center' }}>{title}</div>
      <div style={{ background: p.data.theme.panel, padding: '30px 44px' }}>{children}</div>
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
        <div><Logo url={h.logoUrl} label={h.abbreviation} size={150} color={h.primaryColor} radius={75} /><div style={{ marginTop: 10 }}><Fitted full={h.name} short={h.shortName} width={380} fontPx={38} measure={p.measure} /></div></div>
        <div style={{ fontSize: 42, fontWeight: 900, opacity: 0.6 }}>VS</div>
        <div><Logo url={a.logoUrl} label={a.abbreviation} size={150} color={a.primaryColor} radius={75} /><div style={{ marginTop: 10 }}><Fitted full={a.name} short={a.shortName} width={380} fontPx={38} measure={p.measure} /></div></div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 28 }}>{p.data.match.venue ?? ''}{cd ? <b style={{ marginLeft: 16, color: p.data.theme.primary }}>{cd}</b> : null}</div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}><SponsorMark p={p} placement="detached_logo" height={60} /></div>
    </Big>
  );
}

function Lineup(p: GraphicProps) {
  const { s, starters, bench, page, pages } = lineupPage(p, 12);
  const t = team(p, s);
  return (
    <Big p={p} width={1240} color={t.primaryColor} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 16 }}><Logo url={t.logoUrl} label={t.abbreviation} size={56} color="rgba(0,0,0,.2)" radius={28} />{t.name}{pages > 1 ? ` ${page}/${pages}` : ''}</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {starters.map((x) => (
          <div key={x.playerId} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,.07)', borderRadius: 999, padding: '8px 18px' }}>
            <span style={{ width: 44, height: 44, borderRadius: '50%', background: t.primaryColor, display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 22 }}>{x.number ?? ''}</span>
            <Fitted full={x.displayName} short={x.shortName} width={260} fontPx={26} measure={p.measure} />
          </div>
        ))}
      </div>
      {bench.length ? <div style={{ marginTop: 18, fontSize: 22, opacity: 0.8, textAlign: 'center' }}>Bench: {bench.map((x) => x.shortName ?? x.displayName).join(' · ')}</div> : null}
      {!starters.length ? <div style={{ fontSize: 26, opacity: 0.8, textAlign: 'center' }}>Lineup to be confirmed</div> : null}
    </Big>
  );
}

function Stats(p: GraphicProps) {
  const rows = statRows(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <Big p={p} width={1000} title="STATS">
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px', alignItems: 'center', margin: '10px 0', fontSize: 30 }}>
          <span style={{ ...pill(p, h.primaryColor), textAlign: 'center', fontWeight: 900 }}>{r.home ?? '—'}</span>
          <span style={{ textAlign: 'center' }}>{r.label}</span>
          <span style={{ ...pill(p, a.primaryColor), textAlign: 'center', fontWeight: 900 }}>{r.away ?? '—'}</span>
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
        <div><Logo url={h.logoUrl} label={h.abbreviation} size={120} color={h.primaryColor} radius={60} /><div><Fitted full={h.shortName} width={320} fontPx={34} measure={p.measure} /></div></div>
        <div style={{ fontSize: 110, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{d.score.home}–{d.score.away}</div>
        <div><Logo url={a.logoUrl} label={a.abbreviation} size={120} color={a.primaryColor} radius={60} /><div><Fitted full={a.shortName} width={320} fontPx={34} measure={p.measure} /></div></div>
      </div>
      {d.shootout ? <div style={{ textAlign: 'center', fontSize: 28 }}>Penalties {d.shootout.home}–{d.shootout.away}</div> : null}
      {p.cue.variables.showSponsor !== false ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}><SponsorMark p={p} placement="detached_logo" height={60} /></div> : null}
    </Big>
  );
}

function Sponsor(p: GraphicProps) {
  const placement = (p.cue.variables.placement as string) ?? 'detached_logo';
  const c = p.creative(placement, p.cue) ?? (p.cue.variables.creative ? p.data.creatives[p.cue.variables.creative as string] : null);
  if (!c) return null;
  if (placement === 'full_frame_image') return <FullFrameMedia p={{ ...p, cue: { ...p.cue, variables: { ...p.cue.variables, creative: c.id } } }} />;
  return (
    <div style={{ position: 'absolute', right: 96, top: SY, height: 96, ...pill(p, '#fff'), padding: '14px 30px', ...animStyle(p, 'scale') }} data-graphic="sponsor">
      
      <img alt={c.brandName} src={c.url} style={{ height: '100%', objectFit: 'contain' }} data-sponsor-creative={c.id} />
    </div>
  );
}

function Ticker(p: GraphicProps) {
  const text = String(p.cue.variables.text ?? '');
  return (
    <div style={{ position: 'absolute', left: 120, right: 120, bottom: SY, height: 54, ...pill(p, p.data.theme.panel), overflow: 'hidden', display: 'flex', alignItems: 'center', ...animStyle(p, 'scale') }} data-graphic="ticker">
      <div style={{ whiteSpace: 'nowrap', fontSize: 26, animation: `bs-ticker ${tickerSpeed(p)}s linear infinite`, paddingLeft: 30 }}>{text} &nbsp;★&nbsp; {text} &nbsp;★&nbsp;</div>
    </div>
  );
}

function Slate(p: GraphicProps) {
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${h.primaryColor} 0%, ${h.primaryColor} 50%, ${a.primaryColor} 50%, ${a.primaryColor} 100%)`, fontFamily: p.data.theme.font, color: '#fff', display: 'grid', placeItems: 'center', ...animStyle(p, 'fade') }} data-graphic="slate">
      <div style={{ background: 'rgba(11,18,32,.85)', borderRadius: 48, padding: '50px 90px', textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 60, justifyContent: 'center', alignItems: 'center' }}><Logo url={h.logoUrl} label={h.abbreviation} size={140} color={h.primaryColor} radius={70} /><b style={{ fontSize: 40 }}>VS</b><Logo url={a.logoUrl} label={a.abbreviation} size={140} color={a.primaryColor} radius={70} /></div>
        <div style={{ fontSize: 54, fontWeight: 900, marginTop: 24 }}>{slateMessage(p)}</div>
        <div style={{ fontSize: 26, opacity: 0.8 }}>{p.data.match.competition.name}</div>
        <div style={{ marginTop: 16 }}><SponsorMark p={p} placement="detached_logo" height={64} /></div>
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
  sponsor: Sponsor,
  full_frame_media: (p) => <FullFrameMedia p={p} />,
  ticker: Ticker,
  slate: Slate,
};
