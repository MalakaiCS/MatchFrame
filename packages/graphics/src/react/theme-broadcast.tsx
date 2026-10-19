'use client';
// "Broadcast" theme: dark angled panels, team-colour stripes, slide motion, stacked two-row scorebug.
import type { CSSProperties } from 'react';
import { animStyle, type GraphicProps, type ThemeComponents } from './stage';
import { FullFrameMedia, Fitted, Logo, Photo, SponsorMark, kickoffCountdown, minute, personOrTeam, player, side, slateMessage, statRows, team, tickerSpeed } from './common';

const SX = 96; // 5% title-safe
const SY = 54;
const angled = (cut = 18): CSSProperties => ({ clipPath: `polygon(0 0, 100% 0, calc(100% - ${cut}px) 100%, 0 100%)` });

function Panel({ p, children, style }: { p: GraphicProps; children: React.ReactNode; style?: CSSProperties }) {
  return <div style={{ background: p.data.theme.panel, color: p.data.theme.text, fontFamily: p.data.theme.font, ...style }}>{children}</div>;
}

function Scorebug(p: GraphicProps) {
  const d = p.display;
  const th = p.data.theme;
  const row = (s: 'home' | 'away') => {
    const t = team(p, s);
    return (
      <div style={{ display: 'flex', alignItems: 'center', height: 46, gap: 10, paddingRight: 12 }}>
        <span style={{ width: 8, alignSelf: 'stretch', background: t.primaryColor }} />
        <Logo url={t.logoUrl} label={t.abbreviation} size={32} color={t.primaryColor} radius={4} />
        <span style={{ width: 84, fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>{t.abbreviation}</span>
        {d.possession === s ? <span style={{ color: th.accent, fontSize: 22 }}>●</span> : <span style={{ width: 14 }} />}
        <span style={{ minWidth: 52, textAlign: 'right', fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{d.score[s]}</span>
        {d.fouls ? <span style={{ fontSize: 16, opacity: 0.8, width: 64 }}>F {d.fouls[s]}{d.bonus?.[s] ? ' ◆' : ''}</span> : null}
      </div>
    );
  };
  return (
    <div style={{ position: 'absolute', left: SX, top: SY, display: 'flex', alignItems: 'stretch', ...animStyle(p, 'slide-left') }} data-graphic="scorebug">
      <Panel p={p} style={{ ...angled(), paddingRight: 24 }}>
        {row('home')}
        <div style={{ height: 2, background: 'rgba(255,255,255,.08)' }} />
        {row('away')}
      </Panel>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', marginLeft: -10, background: th.primary, color: th.secondary, padding: '0 22px 0 30px', ...angled() }}>
        <span style={{ fontSize: 18, fontWeight: 700, opacity: 0.85 }}>{d.periodShort}</span>
        <span style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{d.clockText}</span>
        {d.stoppageText ? <span style={{ fontSize: 20, fontWeight: 800, color: '#7a0010' }}>{d.stoppageText}</span> : null}
      </div>
      {d.shotClockText ? <div style={{ display: 'grid', placeItems: 'center', marginLeft: 8, width: 70, background: '#FF5263', color: '#fff', fontSize: 34, fontWeight: 800 }}>{d.shotClockText}</div> : null}
      {d.shootout ? <Panel p={p} style={{ display: 'grid', placeItems: 'center', marginLeft: 8, padding: '0 16px', fontSize: 22, fontWeight: 700 }}>PENS {d.shootout.home}–{d.shootout.away}</Panel> : null}
      {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <div style={{ display: 'grid', placeItems: 'center', marginLeft: 8, padding: '0 12px', background: 'rgba(255,255,255,.95)' }}><SponsorMark p={p} placement="scorebug_logo" height={44} /></div> : null}
    </div>
  );
}

function EventBar(p: GraphicProps, label: string, accent: string, body: React.ReactNode) {
  const t = team(p);
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 70, display: 'flex', alignItems: 'stretch', fontFamily: p.data.theme.font, ...animStyle(p, 'slide-left') }} data-graphic={p.t.key}>
      <div style={{ background: accent, color: '#0B1220', fontSize: 34, fontWeight: 900, padding: '0 28px', display: 'grid', placeItems: 'center', letterSpacing: 2, ...angled(22) }}>{label}</div>
      <Panel p={p} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 40px 14px 30px', marginLeft: -12, minWidth: 620, ...angled(22) }}>
        <span style={{ width: 10, alignSelf: 'stretch', background: t.primaryColor }} />
        <Logo url={t.logoUrl} label={t.abbreviation} size={64} color={t.primaryColor} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>{body}</div>
      </Panel>
      <SponsorBox p={p} placement="event_partner" />
    </div>
  );
}

function SponsorBox({ p, placement }: { p: GraphicProps; placement: string }) {
  const c = p.creative(placement, p.cue);
  if (!c) return null;
  return <div style={{ display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.95)', padding: '0 18px', marginLeft: 8 }}><SponsorMark p={p} placement={placement} height={60} /></div>;
}

function Goal(p: GraphicProps) {
  const who = personOrTeam(p);
  const label = p.cue.variables.eventType === 'own_goal' ? 'OWN GOAL' : p.cue.variables.eventType === 'penalty_scored' ? 'PENALTY' : 'GOAL';
  const sc = p.data.match.projection.score;
  return EventBar(p, label, p.data.theme.accent, (
    <>
      <Fitted full={who.primary} short={who.short} width={460} fontPx={42} measure={p.measure} style={{ color: p.data.theme.text }} />
      <span style={{ fontSize: 24, opacity: 0.8 }}>{team(p).shortName} {minute(p)} · {team(p, 'home').abbreviation} {sc.home}–{sc.away} {team(p, 'away').abbreviation}</span>
    </>
  ));
}

function Score(p: GraphicProps) {
  const who = personOrTeam(p);
  const pts = p.cue.variables.points;
  return EventBar(p, `+${typeof pts === 'number' ? pts : ''}`, p.data.theme.accent, (
    <>
      <Fitted full={who.primary} short={who.short} width={460} fontPx={40} measure={p.measure} />
      <span style={{ fontSize: 22, opacity: 0.8 }}>{team(p).shortName}</span>
    </>
  ));
}

function Card(p: GraphicProps) {
  const ct = p.cue.variables.cardType;
  const color = ct === 'red' || ct === 'second_yellow' ? '#E5484D' : '#FFCE66';
  const who = personOrTeam(p);
  return EventBar(p, ct === 'red' ? 'RED CARD' : ct === 'second_yellow' ? '2ND YELLOW' : 'YELLOW CARD', color, (
    <>
      <Fitted full={who.primary} short={who.short} width={460} fontPx={40} measure={p.measure} />
      <span style={{ fontSize: 22, opacity: 0.8 }}>{team(p).shortName} {minute(p)}</span>
    </>
  ));
}

function Substitution(p: GraphicProps) {
  const off = player(p, 'playerOut');
  const on = player(p, 'playerIn');
  const line = (arrow: string, c: string, pl: typeof off) => (
    <span style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 30 }}>
      <span style={{ color: c, fontWeight: 900 }}>{arrow}</span>
      <span style={{ width: 44, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{pl?.number ?? ''}</span>
      <Fitted full={pl?.displayName ?? team(p).name} short={pl?.shortName} width={400} fontPx={30} measure={p.measure} />
    </span>
  );
  return EventBar(p, 'SUB', p.data.theme.primary, (
    <>
      {line('▲', '#55D99D', on)}
      {line('▼', '#FF5263', off)}
      <span style={{ fontSize: 20, opacity: 0.7 }}>{team(p).shortName} {minute(p)}</span>
    </>
  ));
}

function LowerThird(p: GraphicProps) {
  const img = p.cue.variables.image as string | undefined;
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 40, display: 'flex', alignItems: 'stretch', fontFamily: p.data.theme.font, ...animStyle(p, 'slide-left') }} data-graphic="lower_third">
      <div style={{ width: 12, background: p.data.theme.primary }} />
      {img && p.data.assets[img] ? (
        <img alt="" src={p.data.assets[img]} style={{ width: 120, height: 120, objectFit: 'cover' }} />
      ) : null}
      <Panel p={p} style={{ padding: '18px 48px 18px 28px', minWidth: 700, ...angled(26) }}>
        <Fitted full={String(p.cue.variables.heading ?? '')} width={880} fontPx={48} measure={p.measure} />
        {p.cue.variables.subtitle ? <div style={{ fontSize: 28, opacity: 0.8, marginTop: 4 }}><Fitted full={String(p.cue.variables.subtitle)} width={880} fontPx={28} weight={500} measure={p.measure} /></div> : null}
      </Panel>
      <SponsorBox p={p} placement="lower_third_banner" />
    </div>
  );
}

function PlayerCard(p: GraphicProps) {
  const pl = player(p);
  const t = team(p);
  const stat = p.cue.variables.stat as string | undefined;
  const tally = pl ? p.data.match.projection.players[pl.playerId] : null;
  const statVal = stat && tally ? (tally as Record<string, unknown>)[stat] : null;
  return (
    <div style={{ position: 'absolute', right: SX, bottom: SY + 60, width: 560, fontFamily: p.data.theme.font, ...animStyle(p, 'slide-right') }} data-graphic="player_card">
      <Panel p={p} style={{ padding: 28, display: 'flex', gap: 24, alignItems: 'center', borderTop: `8px solid ${t.primaryColor}` }}>
        <Photo url={pl?.photoUrl} size={150} name={pl?.displayName ?? t.name} />
        <div>
          <div style={{ fontSize: 64, fontWeight: 900, color: t.primaryColor, lineHeight: 1 }}>{pl?.number ?? ''}</div>
          <Fitted full={pl?.displayName ?? t.name} short={pl?.shortName} width={320} fontPx={40} measure={p.measure} />
          <div style={{ fontSize: 22, opacity: 0.8 }}>{pl?.position ?? ''} · {t.shortName}</div>
          {statVal != null ? <div style={{ fontSize: 26, marginTop: 8 }}>{stat}: <b>{String(statVal)}</b></div> : null}
        </div>
      </Panel>
    </div>
  );
}

function FullPanel({ p, title, children, width = 1100 }: { p: GraphicProps; title: React.ReactNode; children: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: 'absolute', left: (1920 - width) / 2, top: 140, width, fontFamily: p.data.theme.font, ...animStyle(p, 'slide-up') }} data-graphic={p.t.key}>
      <div style={{ background: p.data.theme.primary, color: p.data.theme.secondary, padding: '16px 32px', fontSize: 34, fontWeight: 900, letterSpacing: 1, ...angled(30) }}>{title}</div>
      <Panel p={p} style={{ padding: 32 }}>{children}</Panel>
    </div>
  );
}

function TeamsHeader({ p }: { p: GraphicProps }) {
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end' }}><Fitted full={h.name} short={h.shortName} width={330} fontPx={40} measure={p.measure} /><Logo url={h.logoUrl} label={h.abbreviation} size={96} color={h.primaryColor} /></div>
      <span style={{ fontSize: 30, opacity: 0.6 }}>v</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}><Logo url={a.logoUrl} label={a.abbreviation} size={96} color={a.primaryColor} /><Fitted full={a.name} short={a.shortName} width={330} fontPx={40} measure={p.measure} /></div>
    </div>
  );
}

function Ident(p: GraphicProps) {
  const cd = p.cue.variables.showCountdown !== false ? kickoffCountdown(p) : null;
  const when = new Intl.DateTimeFormat('en-AU', { timeZone: p.data.match.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(p.data.match.scheduledAt));
  return (
    <FullPanel p={p} title={p.data.match.competition.name}>
      <TeamsHeader p={p} />
      <div style={{ textAlign: 'center', marginTop: 28, fontSize: 28, opacity: 0.85 }}>{p.data.match.venue ?? ''}{p.data.match.venue ? ' · ' : ''}{when}</div>
      {cd ? <div style={{ textAlign: 'center', marginTop: 16, fontSize: 56, fontWeight: 900, color: p.data.theme.accent, fontVariantNumeric: 'tabular-nums' }}>{cd}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}><SponsorMark p={p} placement="detached_logo" height={70} /></div>
    </FullPanel>
  );
}

export function lineupPage(p: GraphicProps, perPage = 11) {
  const s = side(p);
  const list = p.data.match.lineup[s];
  const starters = list.filter((x) => x.starter);
  const bench = list.filter((x) => !x.starter);
  const pages = Math.max(1, Math.ceil(starters.length / perPage));
  const page = Math.min(pages, Math.max(1, Number(p.cue.variables.page ?? 1)));
  return { s, starters: starters.slice((page - 1) * perPage, page * perPage), bench, page, pages };
}

function Lineup(p: GraphicProps) {
  const { s, starters, bench, page, pages } = lineupPage(p);
  const t = team(p, s);
  return (
    <FullPanel p={p} width={980} title={<span style={{ display: 'flex', alignItems: 'center', gap: 16 }}><Logo url={t.logoUrl} label={t.abbreviation} size={44} color={t.primaryColor} /> {t.name.toUpperCase()}{pages > 1 ? ` (${page}/${pages})` : ''}</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 40px' }}>
        {starters.map((x) => (
          <div key={x.playerId} style={{ display: 'flex', gap: 16, alignItems: 'baseline', fontSize: 30 }}>
            <span style={{ width: 48, textAlign: 'right', color: t.primaryColor, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{x.number ?? ''}</span>
            <Fitted full={x.displayName} short={x.shortName} width={330} fontPx={30} measure={p.measure} />
            {x.captain ? <span style={{ fontSize: 18, opacity: 0.7 }}>(C)</span> : null}
          </div>
        ))}
      </div>
      {bench.length ? <div style={{ marginTop: 20, fontSize: 22, opacity: 0.75 }}>Bench: {bench.map((x) => `${x.number ?? ''} ${x.shortName ?? x.displayName}`).join(' · ')}</div> : null}
      {!starters.length ? <div style={{ fontSize: 26, opacity: 0.7 }}>Lineup to be confirmed</div> : null}
    </FullPanel>
  );
}

function Stats(p: GraphicProps) {
  const rows = statRows(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <FullPanel p={p} width={900} title="MATCH STATS">
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px', fontSize: 30, gap: '10px 0' }}>
        <span style={{ fontWeight: 900, color: h.primaryColor }}>{h.abbreviation}</span><span /><span style={{ fontWeight: 900, color: a.primaryColor, textAlign: 'right' }}>{a.abbreviation}</span>
        {rows.map((r) => (
          <div key={r.key} style={{ display: 'contents' }}>
            <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{r.home ?? '—'}{r.unit ?? ''}</span>
            <span style={{ textAlign: 'center', opacity: 0.85 }}>{r.label}</span>
            <span style={{ fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.away ?? '—'}{r.unit ?? ''}</span>
          </div>
        ))}
      </div>
      {!rows.length ? <div style={{ opacity: 0.7, fontSize: 26 }}>No statistics recorded yet</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><SponsorMark p={p} placement="detached_logo" height={50} /></div>
    </FullPanel>
  );
}

function BreakScore(p: GraphicProps) {
  const d = p.display;
  const label = (p.cue.variables.label as string) || d.periodLabel.toUpperCase();
  return (
    <FullPanel p={p} title={label} width={1000}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 30 }}>
        <div style={{ textAlign: 'right' }}><Fitted full={team(p, 'home').name} short={team(p, 'home').shortName} width={330} fontPx={40} measure={p.measure} /></div>
        <div style={{ fontSize: 96, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{d.score.home}–{d.score.away}</div>
        <div><Fitted full={team(p, 'away').name} short={team(p, 'away').shortName} width={330} fontPx={40} measure={p.measure} /></div>
      </div>
      {d.shootout ? <div style={{ textAlign: 'center', fontSize: 30 }}>Penalties {d.shootout.home}–{d.shootout.away}</div> : null}
      <div style={{ textAlign: 'center', marginTop: 10, fontSize: 24, opacity: 0.8 }}>{p.data.match.competition.name}</div>
      {p.cue.variables.showSponsor !== false ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}><SponsorMark p={p} placement="detached_logo" height={64} /></div> : null}
    </FullPanel>
  );
}

function Sponsor(p: GraphicProps) {
  const placement = (p.cue.variables.placement as string) ?? 'detached_logo';
  const c = p.creative(placement, p.cue) ?? (p.cue.variables.creative ? p.data.creatives[p.cue.variables.creative as string] : null);
  if (!c) return null;
  if (placement === 'full_frame_image') return <FullFrameMedia p={{ ...p, cue: { ...p.cue, variables: { ...p.cue.variables, creative: c.id } } }} />;
  const box: CSSProperties = placement === 'lower_third_banner' ? { left: SX, bottom: SY, height: 110 } : { right: SX, top: SY, height: 100 };
  return (
    <div style={{ position: 'absolute', ...box, background: 'rgba(255,255,255,.96)', padding: 14, display: 'grid', placeItems: 'center', ...animStyle(p, 'fade') }} data-graphic="sponsor">
      
      <img alt={c.brandName} src={c.url} style={{ height: '100%', objectFit: 'contain' }} data-sponsor-creative={c.id} />
    </div>
  );
}

function Ticker(p: GraphicProps) {
  const text = String(p.cue.variables.text ?? '');
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: SY - 10, height: 56, background: p.data.theme.panel, color: p.data.theme.text, overflow: 'hidden', fontFamily: p.data.theme.font, display: 'flex', alignItems: 'center', ...animStyle(p, 'slide-up') }} data-graphic="ticker">
      <div style={{ background: p.data.theme.primary, color: p.data.theme.secondary, fontWeight: 900, padding: '0 24px', height: '100%', display: 'grid', placeItems: 'center', zIndex: 1 }}>LATEST</div>
      <div style={{ whiteSpace: 'nowrap', fontSize: 28, animation: `bs-ticker ${tickerSpeed(p)}s linear infinite`, paddingLeft: 40 }}>
        {text} &nbsp;&nbsp;•&nbsp;&nbsp; {text} &nbsp;&nbsp;•&nbsp;&nbsp;
      </div>
    </div>
  );
}

function Slate(p: GraphicProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${p.data.theme.secondary} 0%, ${p.data.theme.panel} 100%)`, color: p.data.theme.text, fontFamily: p.data.theme.font, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, ...animStyle(p, 'fade') }} data-graphic="slate">
      <TeamsHeaderStandalone p={p} />
      <div style={{ fontSize: 52, fontWeight: 800 }}>{slateMessage(p)}</div>
      <div style={{ fontSize: 28, opacity: 0.7 }}>{p.data.match.competition.name}</div>
      <SponsorMark p={p} placement="detached_logo" height={80} />
    </div>
  );
}

function TeamsHeaderStandalone({ p }: { p: GraphicProps }) {
  return <div style={{ width: 1100 }}><TeamsHeader p={p} /></div>;
}

export const broadcastTheme: ThemeComponents = {
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
