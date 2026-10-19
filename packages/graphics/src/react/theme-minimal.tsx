'use client';
// "Minimal" theme: light flat panels, hairline rules, single-row scorebug, fade-only motion, bar-chart stats.
import type { CSSProperties } from 'react';
import { animStyle, type GraphicProps, type ThemeComponents } from './stage';
import { FullFrameMedia, Fitted, Logo, Photo, SponsorMark, kickoffCountdown, minute, personOrTeam, player, side, slateMessage, statRows, team, tickerSpeed } from './common';
import { lineupPage } from './theme-broadcast';

const SX = 96;
const SY = 54;
const light = (p: GraphicProps): CSSProperties => ({ background: 'rgba(250,251,253,.97)', color: '#0B1220', fontFamily: p.data.theme.font, boxShadow: '0 2px 18px rgba(0,0,0,.25)', borderRadius: p.data.theme.radius });

function Scorebug(p: GraphicProps) {
  const d = p.display;
  const cell = (s: 'home' | 'away') => {
    const t = team(p, s);
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderLeft: s === 'away' ? '1px solid #d5dbe5' : undefined, flexDirection: s === 'away' ? 'row-reverse' : 'row' }}>
        <span style={{ width: 4, height: 30, background: t.primaryColor }} />
        <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: 2 }}>{t.abbreviation}</span>
        <span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'center' }}>{d.score[s]}</span>
        {d.possession === s ? <span style={{ fontSize: 14, color: p.data.theme.accent }}>◆</span> : null}
      </span>
    );
  };
  return (
    <div style={{ position: 'absolute', left: SX, top: SY, display: 'flex', alignItems: 'center', height: 52, ...light(p), ...animStyle(p, 'fade') }} data-graphic="scorebug">
      {cell('home')}
      {cell('away')}
      <span style={{ padding: '0 18px', borderLeft: '1px solid #d5dbe5', fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: 16, color: '#5b6577', marginRight: 10 }}>{d.periodShort}</span>
        {d.clockText}
        {d.stoppageText ? <span style={{ color: '#c0182d', marginLeft: 8 }}>{d.stoppageText}</span> : null}
      </span>
      {d.shotClockText ? <span style={{ padding: '0 14px', borderLeft: '1px solid #d5dbe5', color: '#c0182d', fontSize: 26, fontWeight: 800 }}>{d.shotClockText}</span> : null}
      {d.fouls ? <span style={{ padding: '0 14px', borderLeft: '1px solid #d5dbe5', fontSize: 16, color: '#5b6577' }}>FOULS {d.fouls.home}{d.bonus?.home ? '•' : ''}–{d.fouls.away}{d.bonus?.away ? '•' : ''}</span> : null}
      {d.shootout ? <span style={{ padding: '0 14px', borderLeft: '1px solid #d5dbe5', fontSize: 18 }}>({d.shootout.home}–{d.shootout.away} p)</span> : null}
      {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <span style={{ padding: '0 12px', borderLeft: '1px solid #d5dbe5' }}><SponsorMark p={p} placement="scorebug_logo" height={34} /></span> : null}
    </div>
  );
}

function Strip(p: GraphicProps, kicker: string, kickerColor: string, title: React.ReactNode, sub: React.ReactNode, sponsorPlacement?: string) {
  const t = team(p);
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 50, minWidth: 640, ...light(p), padding: '18px 28px', borderLeft: `6px solid ${t.primaryColor}`, ...animStyle(p, 'fade') }} data-graphic={p.t.key}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 18, letterSpacing: 3, fontWeight: 700, color: kickerColor }}>
        {kicker}
        {sponsorPlacement && p.creative(sponsorPlacement, p.cue) ? <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, color: '#5b6577', letterSpacing: 1, fontWeight: 500 }}>with <SponsorMark p={p} placement={sponsorPlacement} height={30} /></span> : null}
      </div>
      <div style={{ marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 22, color: '#5b6577', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Goal(p: GraphicProps) {
  const who = personOrTeam(p);
  const sc = p.data.match.projection.score;
  const kind = p.cue.variables.eventType === 'own_goal' ? 'OWN GOAL' : p.cue.variables.eventType === 'penalty_scored' ? 'PENALTY GOAL' : 'GOAL';
  return Strip(p, kind, p.data.theme.accent, <Fitted full={who.primary} short={who.short} width={560} fontPx={40} measure={p.measure} />, <>{team(p).name} {minute(p)} — {sc.home}–{sc.away}</>, 'event_partner');
}
function Score(p: GraphicProps) {
  const who = personOrTeam(p);
  return Strip(p, `+${String(p.cue.variables.points ?? '')} POINTS`, p.data.theme.accent, <Fitted full={who.primary} short={who.short} width={560} fontPx={38} measure={p.measure} />, team(p).name, 'event_partner');
}
function Card(p: GraphicProps) {
  const ct = p.cue.variables.cardType;
  const who = personOrTeam(p);
  return Strip(p, ct === 'red' ? 'RED CARD' : ct === 'second_yellow' ? 'SECOND YELLOW' : 'YELLOW CARD', ct === 'yellow' ? '#b88a00' : '#c0182d', <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 22, height: 30, borderRadius: 3, background: ct === 'yellow' ? '#FFCE66' : '#E5484D' }} /><Fitted full={who.primary} short={who.short} width={520} fontPx={38} measure={p.measure} /></span>, <>{team(p).name} {minute(p)}</>);
}
function Substitution(p: GraphicProps) {
  const on = player(p, 'playerIn');
  const off = player(p, 'playerOut');
  return Strip(p, 'SUBSTITUTION', '#2563eb', (
    <div style={{ display: 'grid', gap: 4, fontSize: 30 }}>
      <span><span style={{ color: '#16a34a' }}>IN </span><Fitted full={on?.displayName ?? '—'} short={on?.shortName} width={480} fontPx={30} measure={p.measure} /></span>
      <span><span style={{ color: '#c0182d' }}>OUT </span><Fitted full={off?.displayName ?? '—'} short={off?.shortName} width={480} fontPx={30} measure={p.measure} /></span>
    </div>
  ), <>{team(p).name} {minute(p)}</>);
}

function LowerThird(p: GraphicProps) {
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 30, fontFamily: p.data.theme.font, color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,.6)', ...animStyle(p, 'fade') }} data-graphic="lower_third">
      <Fitted full={String(p.cue.variables.heading ?? '')} width={1100} fontPx={54} measure={p.measure} />
      <div style={{ height: 3, width: 220, background: p.data.theme.accent, margin: '8px 0' }} />
      {p.cue.variables.subtitle ? <Fitted full={String(p.cue.variables.subtitle)} width={1100} fontPx={30} weight={500} measure={p.measure} /> : null}
      {p.creative('lower_third_banner', p.cue) ? <div style={{ marginTop: 10 }}><SponsorMark p={p} placement="lower_third_banner" height={40} /></div> : null}
    </div>
  );
}

function PlayerCard(p: GraphicProps) {
  const pl = player(p);
  const t = team(p);
  return (
    <div style={{ position: 'absolute', right: SX, bottom: SY + 50, width: 520, ...light(p), padding: 26, display: 'flex', gap: 22, alignItems: 'center', ...animStyle(p, 'fade') }} data-graphic="player_card">
      <Photo url={pl?.photoUrl} size={130} name={pl?.displayName ?? t.name} />
      <div>
        <div style={{ fontSize: 18, letterSpacing: 3, color: '#5b6577' }}>{t.name.toUpperCase()}</div>
        <Fitted full={pl?.displayName ?? t.name} short={pl?.shortName} width={320} fontPx={38} measure={p.measure} />
        <div style={{ fontSize: 22, color: '#5b6577' }}>#{pl?.number ?? '–'} · {pl?.position ?? ''}</div>
      </div>
    </div>
  );
}

function Card2({ p, title, children, width = 1000 }: { p: GraphicProps; title: string; children: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: 'absolute', left: (1920 - width) / 2, top: 150, width, ...light(p), padding: '34px 44px', ...animStyle(p, 'fade') }} data-graphic={p.t.key}>
      <div style={{ fontSize: 20, letterSpacing: 4, color: '#5b6577', marginBottom: 18 }}>{title}</div>
      {children}
    </div>
  );
}

function Versus({ p }: { p: GraphicProps }) {
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}><Logo url={h.logoUrl} label={h.abbreviation} size={72} color={h.primaryColor} /><Fitted full={h.name} short={h.shortName} width={300} fontPx={40} measure={p.measure} /></span>
      <span style={{ color: '#8a93a3', fontSize: 26 }}>vs</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}><Fitted full={a.name} short={a.shortName} width={300} fontPx={40} measure={p.measure} /><Logo url={a.logoUrl} label={a.abbreviation} size={72} color={a.primaryColor} /></span>
    </div>
  );
}

function Ident(p: GraphicProps) {
  const cd = p.cue.variables.showCountdown !== false ? kickoffCountdown(p) : null;
  return (
    <Card2 p={p} title={p.data.match.competition.name.toUpperCase()}>
      <Versus p={p} />
      <div style={{ marginTop: 22, fontSize: 24, color: '#5b6577' }}>{p.data.match.venue ?? ''}{cd ? ` · Kick-off in ${cd}` : ''}</div>
      <div style={{ marginTop: 12 }}><SponsorMark p={p} placement="detached_logo" height={50} /></div>
    </Card2>
  );
}

function Lineup(p: GraphicProps) {
  const { s, starters, bench, page, pages } = lineupPage(p, 12);
  const t = team(p, s);
  return (
    <Card2 p={p} width={760} title={`${t.name.toUpperCase()} LINEUP${pages > 1 ? ` ${page}/${pages}` : ''}`}>
      {starters.map((x) => (
        <div key={x.playerId} style={{ display: 'flex', gap: 14, fontSize: 28, padding: '5px 0', borderBottom: '1px solid #e4e8ef' }}>
          <span style={{ width: 40, color: '#8a93a3', fontVariantNumeric: 'tabular-nums' }}>{x.number ?? ''}</span>
          <Fitted full={x.displayName} short={x.shortName} width={520} fontPx={28} weight={600} measure={p.measure} />
          <span style={{ marginLeft: 'auto', color: '#8a93a3', fontSize: 20 }}>{x.position ?? ''}</span>
        </div>
      ))}
      {bench.length ? <div style={{ marginTop: 14, fontSize: 20, color: '#5b6577' }}>Substitutes: {bench.map((x) => x.shortName ?? x.displayName).join(', ')}</div> : null}
      {!starters.length ? <div style={{ fontSize: 24, color: '#5b6577' }}>Lineup to be confirmed</div> : null}
    </Card2>
  );
}

function Stats(p: GraphicProps) {
  const rows = statRows(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <Card2 p={p} width={900} title="MATCH STATISTICS">
      {rows.map((r) => {
        const hv = Number(r.home ?? 0);
        const av = Number(r.away ?? 0);
        const tot = hv + av || 1;
        return (
          <div key={r.key} style={{ margin: '12px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26 }}><b>{r.home ?? '—'}</b><span style={{ color: '#5b6577' }}>{r.label}</span><b>{r.away ?? '—'}</b></div>
            <div style={{ display: 'flex', height: 8, marginTop: 6, gap: 4 }}><span style={{ flex: hv / tot, background: h.primaryColor }} /><span style={{ flex: av / tot, background: a.primaryColor }} /></div>
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
    <Card2 p={p} width={1000} title={((p.cue.variables.label as string) || d.periodLabel).toUpperCase()}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
        <Fitted full={team(p, 'home').name} short={team(p, 'home').shortName} width={340} fontPx={40} measure={p.measure} />
        <span style={{ fontSize: 88, fontWeight: 300, fontVariantNumeric: 'tabular-nums', padding: '0 30px' }}>{d.score.home} – {d.score.away}</span>
        <span style={{ textAlign: 'right' }}><Fitted full={team(p, 'away').name} short={team(p, 'away').shortName} width={340} fontPx={40} measure={p.measure} /></span>
      </div>
      {d.shootout ? <div style={{ textAlign: 'center', color: '#5b6577', fontSize: 26 }}>Penalties {d.shootout.home}–{d.shootout.away}</div> : null}
      {p.cue.variables.showSponsor !== false ? <div style={{ textAlign: 'center', marginTop: 12 }}><SponsorMark p={p} placement="detached_logo" height={50} /></div> : null}
    </Card2>
  );
}

function Sponsor(p: GraphicProps) {
  const placement = (p.cue.variables.placement as string) ?? 'detached_logo';
  const c = p.creative(placement, p.cue) ?? (p.cue.variables.creative ? p.data.creatives[p.cue.variables.creative as string] : null);
  if (!c) return null;
  if (placement === 'full_frame_image') return <FullFrameMedia p={{ ...p, cue: { ...p.cue, variables: { ...p.cue.variables, creative: c.id } } }} />;
  return (
    <div style={{ position: 'absolute', right: SX, top: SY, height: 80, ...light(p), padding: 12, ...animStyle(p, 'fade') }} data-graphic="sponsor">
      
      <img alt={c.brandName} src={c.url} style={{ height: '100%', objectFit: 'contain' }} data-sponsor-creative={c.id} />
    </div>
  );
}

function Ticker(p: GraphicProps) {
  const text = String(p.cue.variables.text ?? '');
  return (
    <div style={{ position: 'absolute', left: SX, right: SX, bottom: SY, height: 46, ...light(p), overflow: 'hidden', display: 'flex', alignItems: 'center', ...animStyle(p, 'fade') }} data-graphic="ticker">
      <div style={{ whiteSpace: 'nowrap', fontSize: 24, animation: `bs-ticker ${tickerSpeed(p)}s linear infinite`, paddingLeft: 20 }}>{text} &nbsp; · &nbsp; {text} &nbsp; · &nbsp;</div>
    </div>
  );
}

function Slate(p: GraphicProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#F3F6FB', color: '#0B1220', fontFamily: p.data.theme.font, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 220px', gap: 26, ...animStyle(p, 'fade') }} data-graphic="slate">
      <div style={{ fontSize: 22, letterSpacing: 5, color: '#5b6577' }}>{p.data.match.competition.name.toUpperCase()}</div>
      <Versus p={p} />
      <div style={{ fontSize: 46, fontWeight: 300 }}>{slateMessage(p)}</div>
      <SponsorMark p={p} placement="detached_logo" height={60} />
    </div>
  );
}

export const minimalTheme: ThemeComponents = {
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

export { side };
