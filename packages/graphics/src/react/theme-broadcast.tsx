'use client';
// "Broadcast" theme: dark angled panels, team-colour stripes, slide/wipe motion, stacked two-row scorebug.
// Every graphic builds in parts (panel, stripe, badge, text) on a short stagger and exits as one.
import type { CSSProperties } from 'react';
import { occasionLine } from '../data';
import { animStyle, changeStyle, stagger, type GraphicProps, type ThemeComponents } from './stage';
import { FullFrameMedia, Fitted, Logo, Photo, SponsorMark, ThemeBadge, cardStyle, clockLabel, eventWord, identInfo, minute, periodBanner, personOrTeam, player, scorebugPosition, side, slateMessage, statRows, stoppageLabel, t, team, tickerText, tickerSpeed } from './common';
import { PresentedBy, sharedGraphics, type Chrome } from './shared-graphics';

const SX = 96; // 5% title-safe
const SY = 54;
const angled = (cut = 18): CSSProperties => ({ clipPath: `polygon(0 0, 100% 0, calc(100% - ${cut}px) 100%, 0 100%)` });

function Panel({ p, children, style }: { p: GraphicProps; children: React.ReactNode; style?: CSSProperties }) {
  return <div style={{ background: p.data.theme.panel, color: p.data.theme.text, fontFamily: p.data.theme.font, ...style }}>{children}</div>;
}

/** Which graphics show a player photo beside the team badge when one is on file. */
const PHOTO_EVENTS = ['builtin:goal', 'builtin:card', 'builtin:player_of_match'];

function Scorebug(p: GraphicProps) {
  return p.data.theme.scorebug?.variant === 'strip' ? ScorebugStrip(p) : ScorebugBox(p);
}

/** One-row scorebug: HOME 2 · 63:12 · 1 AWAY, for looks that want a slimmer bug. */
function ScorebugStrip(p: GraphicProps) {
  const d = p.display;
  const th = p.data.theme;
  const stoppage = changeStyle(p, 'stoppage', !!d.stoppageText, 'flip');
  const cell = (s: 'home' | 'away', i: number) => {
    const tm = team(p, s);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', flexDirection: s === 'away' ? 'row-reverse' : 'row', ...animStyle(p, s === 'home' ? 'slide-left' : 'slide-right', 80 + i * 60, 360) }}>
        <span style={{ width: 8, alignSelf: 'stretch', background: tm.primaryColor }} />
        <Logo url={tm.logoUrl} label={tm.abbreviation} size={34} color={tm.primaryColor} radius={4} />
        <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>{tm.abbreviation}</span>
        <span style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'center' }}><span style={changeStyle(p, `score-${s}`, d.score[s])}>{d.score[s]}</span></span>
        {d.scoreDetail ? <span style={{ fontSize: 16, opacity: 0.75 }}>{d.scoreDetail[s].split(' ')[0]}</span> : null}
        {d.fouls ? <span style={{ fontSize: 15, opacity: 0.8 }}>F {d.fouls[s]}{d.bonus?.[s] ? ' ◆' : ''}</span> : null}
      </div>
    );
  };
  return (
    <div style={{ top: SY, display: 'flex', alignItems: 'stretch', height: 56, ...scorebugPosition(p, SX), ...animStyle(p, 'wipe') }} data-graphic="scorebug">
      <Panel p={p} style={{ display: 'flex', alignItems: 'stretch', ...angled() }}>
        {cell('home', 0)}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', background: th.primary, color: th.secondary, ...animStyle(p, 'drop', 200, 360) }}>
          <span style={{ fontSize: 16, fontWeight: 700, opacity: 0.85, ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
          <span style={{ fontSize: 32, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{clockLabel(p)}</span>
          {d.stoppageText ? <span style={{ fontSize: 18, fontWeight: 800, color: '#7a0010', ...stoppage }}>{stoppageLabel(p)}</span> : null}
        </div>
        {cell('away', 1)}
      </Panel>
      {d.shotClockText ? <div style={{ display: 'grid', placeItems: 'center', marginLeft: 8, width: 64, background: '#FF5263', color: '#fff', fontSize: 30, fontWeight: 800, ...animStyle(p, 'zoom', 300, 360) }}>{d.shotClockText}</div> : null}
      {d.shootout ? <Panel p={p} style={{ display: 'grid', placeItems: 'center', marginLeft: 8, padding: '0 14px', fontSize: 20, fontWeight: 700, ...animStyle(p, 'zoom', 300, 360) }}>{t(p, 'PENS')} <span style={changeStyle(p, 'pens', `${d.shootout.home}-${d.shootout.away}`)}>{d.shootout.home}–{d.shootout.away}</span></Panel> : null}
      {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <div style={{ display: 'grid', placeItems: 'center', marginLeft: 8, padding: '0 12px', background: 'rgba(255,255,255,.95)', ...animStyle(p, 'zoom', 340, 380) }}><SponsorMark p={p} placement="scorebug_logo" height={34} /></div> : null}
    </div>
  );
}

function ScorebugBox(p: GraphicProps) {
  const d = p.display;
  const th = p.data.theme;
  const stoppage = changeStyle(p, 'stoppage', !!d.stoppageText, 'flip'); // evaluated every render so the appearance itself animates
  const row = (s: 'home' | 'away', i: number) => {
    const t = team(p, s);
    return (
      <div style={{ display: 'flex', alignItems: 'center', height: 46, gap: 10, paddingRight: 12, ...animStyle(p, 'slide-left', 80 + i * 70, 360) }}>
        <span style={{ width: 8, alignSelf: 'stretch', background: t.primaryColor, transformOrigin: 'top', ...animStyle(p, 'grow-y', 60 + i * 70, 300) }} />
        <Logo url={t.logoUrl} label={t.abbreviation} size={32} color={t.primaryColor} radius={4} />
        <span style={{ width: 84, fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>{t.abbreviation}</span>
        {d.possession === s ? <span style={{ color: th.accent, fontSize: 22 }}>●</span> : <span style={{ width: 14 }} />}
        <span style={{ minWidth: 52, textAlign: 'right', fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}><span style={changeStyle(p, `score-${s}`, d.score[s])}>{d.score[s]}</span></span>
        {d.scoreDetail ? <span style={{ fontSize: 15, opacity: 0.75, width: 48 }}>{d.scoreDetail[s].split(' ')[0]}</span> : null}
        {d.fouls ? <span style={{ fontSize: 16, opacity: 0.8, width: 64 }}>F {d.fouls[s]}{d.bonus?.[s] ? ' ◆' : ''}</span> : null}
      </div>
    );
  };
  return (
    <div style={{ top: SY, display: 'flex', alignItems: 'stretch', ...scorebugPosition(p, SX), ...animStyle(p, 'wipe') }} data-graphic="scorebug">
      <Panel p={p} style={{ ...angled(), paddingRight: 24 }}>
        {row('home', 0)}
        <div style={{ height: 2, background: 'rgba(255,255,255,.08)' }} />
        {row('away', 1)}
      </Panel>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', marginLeft: -10, background: th.primary, color: th.secondary, padding: '0 22px 0 30px', ...angled(), ...animStyle(p, 'drop', 220, 380) }}>
        <span style={{ fontSize: 18, fontWeight: 700, opacity: 0.85, ...changeStyle(p, 'period', d.periodShort, 'flip') }}>{d.periodShort}</span>
        <span style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{clockLabel(p)}</span>
        {d.stoppageText ? <span style={{ fontSize: 20, fontWeight: 800, color: '#7a0010', ...stoppage }}>{stoppageLabel(p)}</span> : null}
      </div>
      {d.shotClockText ? <div style={{ display: 'grid', placeItems: 'center', marginLeft: 8, width: 70, background: '#FF5263', color: '#fff', fontSize: 34, fontWeight: 800, ...animStyle(p, 'zoom', 300, 360) }}>{d.shotClockText}</div> : null}
      {d.shootout ? <Panel p={p} style={{ display: 'grid', placeItems: 'center', marginLeft: 8, padding: '0 16px', fontSize: 22, fontWeight: 700, ...animStyle(p, 'zoom', 300, 360) }}>PENS <span style={changeStyle(p, 'pens', `${d.shootout.home}-${d.shootout.away}`)}>{d.shootout.home}–{d.shootout.away}</span></Panel> : null}
      {p.cue.variables.showSponsor !== false && p.creative('scorebug_logo', p.cue) ? <div style={{ display: 'grid', placeItems: 'center', marginLeft: 8, padding: '0 12px', background: 'rgba(255,255,255,.95)', ...animStyle(p, 'zoom', 340, 380) }}><SponsorMark p={p} placement="scorebug_logo" height={44} /></div> : null}
    </div>
  );
}

function EventBar(p: GraphicProps, label: string, accent: string, body: React.ReactNode) {
  const t = team(p);
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 70, display: 'flex', alignItems: 'stretch', fontFamily: p.data.theme.font, ...animStyle(p, 'slide-left') }} data-graphic={p.t.key}>
      <div style={{ background: accent, color: '#0B1220', fontSize: 34, fontWeight: 900, padding: '0 28px', display: 'grid', placeItems: 'center', letterSpacing: 2, zIndex: 1, ...angled(22), ...animStyle(p, 'zoom', 0, 420) }}>{label}</div>
      <Panel p={p} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 40px 14px 30px', marginLeft: -12, minWidth: 620, ...angled(22), ...animStyle(p, 'wipe', 120, 380) }}>
        <span style={{ width: 10, alignSelf: 'stretch', background: t.primaryColor, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 220, 300) }} />
        <span style={animStyle(p, 'zoom', 260, 400)}><Logo url={t.logoUrl} label={t.abbreviation} size={64} color={t.primaryColor} /></span>
        {PHOTO_EVENTS.includes(p.t.key) && player(p)?.photoUrl ? <span style={animStyle(p, 'zoom', 300, 400)}><Photo url={player(p)!.photoUrl} size={76} name={player(p)!.displayName} /></span> : null}
        <div style={{ display: 'flex', flexDirection: 'column', ...animStyle(p, 'rise', 320, 360) }}>{body}</div>
      </Panel>
      <SponsorBox p={p} placement="event_partner" delayMs={460} />
    </div>
  );
}

function SponsorBox({ p, placement, delayMs = 400 }: { p: GraphicProps; placement: string; delayMs?: number }) {
  const c = p.creative(placement, p.cue);
  if (!c) return null;
  return <div style={{ display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.95)', padding: '4px 18px', marginLeft: 8, ...animStyle(p, 'zoom', delayMs, 400) }}><PresentedBy p={p} placement={placement} height={52} /></div>;
}

function Goal(p: GraphicProps) {
  const who = personOrTeam(p);
  const label = eventWord(p);
  const sc = p.data.match.projection.score;
  return EventBar(p, label, p.data.theme.accent, (
    <>
      <Fitted full={who.primary} short={who.short} width={460} fontPx={42} measure={p.measure} style={{ color: p.data.theme.text }} />
      <span style={{ fontSize: 24, opacity: 0.8, ...animStyle(p, 'rise', 420, 320) }}>{team(p).shortName} {minute(p)} · {team(p, 'home').abbreviation} {sc.home}–{sc.away} {team(p, 'away').abbreviation}</span>
    </>
  ));
}

function Score(p: GraphicProps) {
  const who = personOrTeam(p);
  const pts = p.cue.variables.points;
  return EventBar(p, `+${typeof pts === 'number' ? pts : ''}`, p.data.theme.accent, (
    <>
      <Fitted full={who.primary} short={who.short} width={460} fontPx={40} measure={p.measure} />
      <span style={{ fontSize: 22, opacity: 0.8, ...animStyle(p, 'rise', 420, 320) }}>{team(p).shortName}</span>
    </>
  ));
}

function Card(p: GraphicProps) {
  const cs = cardStyle(p);
  const who = personOrTeam(p);
  return EventBar(p, cs.word, cs.colour, (
    <>
      <Fitted full={who.primary} short={who.short} width={460} fontPx={40} measure={p.measure} />
      <span style={{ fontSize: 22, opacity: 0.8, ...animStyle(p, 'rise', 420, 320) }}>{team(p).shortName} {minute(p)}</span>
    </>
  ));
}

function Substitution(p: GraphicProps) {
  const off = player(p, 'playerOut');
  const on = player(p, 'playerIn');
  const line = (arrow: string, c: string, pl: typeof off, i: number) => (
    <span style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 30, ...animStyle(p, i ? 'slide-right' : 'slide-left', 360 + i * 120, 360) }}>
      <span style={{ color: c, fontWeight: 900 }}>{arrow}</span>
      <span style={{ width: 44, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{pl?.number ?? ''}</span>
      <Fitted full={pl?.displayName ?? team(p).name} short={pl?.shortName} width={400} fontPx={30} measure={p.measure} />
    </span>
  );
  return EventBar(p, 'SUB', p.data.theme.primary, (
    <>
      {line('▲', '#55D99D', on, 0)}
      {line('▼', '#FF5263', off, 1)}
      <span style={{ fontSize: 20, opacity: 0.7, ...animStyle(p, 'rise', 600, 300) }}>{team(p).shortName} {minute(p)}</span>
    </>
  ));
}

function LowerThird(p: GraphicProps) {
  const img = p.cue.variables.image as string | undefined;
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 40, display: 'flex', alignItems: 'stretch', fontFamily: p.data.theme.font, ...animStyle(p, 'slide-left') }} data-graphic="lower_third">
      <div style={{ width: 12, background: p.data.theme.primary, transformOrigin: 'bottom', ...animStyle(p, 'grow-y', 0, 300) }} />
      {img && p.data.assets[img] ? (
        <img alt="" src={p.data.assets[img]} style={{ width: 120, height: 120, objectFit: 'cover', ...animStyle(p, 'zoom', 120, 380) }} />
      ) : null}
      <Panel p={p} style={{ padding: '18px 48px 18px 28px', minWidth: 700, ...angled(26), ...animStyle(p, 'wipe', 100, 400) }}>
        <div style={animStyle(p, 'rise', 220, 340)}><Fitted full={String(p.cue.variables.heading ?? '')} width={880} fontPx={48} measure={p.measure} /></div>
        {p.cue.variables.subtitle ? <div style={{ fontSize: 28, opacity: 0.8, marginTop: 4, ...animStyle(p, 'rise', 310, 340) }}><Fitted full={String(p.cue.variables.subtitle)} width={880} fontPx={28} weight={500} measure={p.measure} /></div> : null}
      </Panel>
      <SponsorBox p={p} placement="lower_third_banner" delayMs={420} />
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
        <span style={animStyle(p, 'zoom', 160, 420)}><Photo url={pl?.photoUrl} size={150} name={pl?.displayName ?? t.name} /></span>
        <div>
          <div style={{ fontSize: 64, fontWeight: 900, color: t.primaryColor, lineHeight: 1, ...animStyle(p, 'drop', 240, 400) }}>{pl?.number ?? ''}</div>
          <div style={animStyle(p, 'rise', 320, 340)}><Fitted full={pl?.displayName ?? t.name} short={pl?.shortName} width={320} fontPx={40} measure={p.measure} /></div>
          <div style={{ fontSize: 22, opacity: 0.8, ...animStyle(p, 'rise', 390, 320) }}>{pl?.position ?? ''} · {t.shortName}</div>
          {statVal != null ? <div style={{ fontSize: 26, marginTop: 8, ...animStyle(p, 'rise', 460, 320) }}>{stat}: <b style={changeStyle(p, 'stat', statVal)}>{String(statVal)}</b></div> : null}
        </div>
      </Panel>
    </div>
  );
}

function FullPanel({ p, title, children, width = 1100 }: { p: GraphicProps; title: React.ReactNode; children: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', top: 140, width, fontFamily: p.data.theme.font, ...animStyle(p, 'slide-up') }} data-graphic={p.t.key}>
      <div style={{ background: p.data.theme.primary, color: p.data.theme.secondary, padding: '16px 48px 16px 32px', fontSize: 34, fontWeight: 900, letterSpacing: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, ...angled(30), ...animStyle(p, 'wipe', 60, 420) }}>
        <div style={animStyle(p, 'rise', 160, 320)}>{title}</div>
        <ThemeBadge p={p} height={40} />
      </div>
      <Panel p={p} style={{ padding: 32, transformOrigin: 'top', ...animStyle(p, 'grow-y', 120, 380) }}>{children}</Panel>
    </div>
  );
}

function TeamsHeader({ p, delayMs = 220, centre = 'v', score = false }: { p: GraphicProps; delayMs?: number; centre?: string; score?: boolean }) {
  const h = team(p, 'home');
  const a = team(p, 'away');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end', ...animStyle(p, 'slide-left', delayMs, 420) }}><Fitted full={h.name} short={h.shortName} width={330} fontPx={40} measure={p.measure} /><Logo url={h.logoUrl} label={h.abbreviation} size={96} color={h.primaryColor} /></div>
      <span style={{ ...(score ? { fontSize: 72, fontWeight: 900, fontVariantNumeric: 'tabular-nums', padding: '0 10px' } : { fontSize: 30, opacity: 0.6, ...(centre === 'v' ? {} : { fontWeight: 800, letterSpacing: 2 }) }), ...animStyle(p, 'zoom', delayMs + 120, 380) }}><span style={score ? changeStyle(p, 'score', centre) : undefined}>{centre}</span></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, ...animStyle(p, 'slide-right', delayMs, 420) }}><Logo url={a.logoUrl} label={a.abbreviation} size={96} color={a.primaryColor} /><Fitted full={a.name} short={a.shortName} width={330} fontPx={40} measure={p.measure} /></div>
    </div>
  );
}

function Ident(p: GraphicProps) {
  const info = identInfo(p);
  return (
    <FullPanel p={p} title={p.data.match.competition.name}>
      <TeamsHeader p={p} centre={info.centre} score={info.started} />
      <div style={{ textAlign: 'center', marginTop: 28, fontSize: info.started ? 30 : 28, fontWeight: info.started ? 800 : 400, letterSpacing: info.started ? 3 : 0, opacity: 0.85, ...animStyle(p, 'rise', 420, 340) }}>{info.line}</div>
      {info.countdown ? <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: 14, ...animStyle(p, 'zoom', 500, 420) }}><span style={{ fontSize: 22, letterSpacing: 3, opacity: 0.8 }}>{info.countdown.label}</span><span style={{ fontSize: 56, fontWeight: 900, color: p.data.theme.accent, fontVariantNumeric: 'tabular-nums' }}>{info.countdown.text}</span></div> : null}
      {info.message ? <div style={{ textAlign: 'center', marginTop: 18, fontSize: 40, fontWeight: 900, letterSpacing: 3, color: p.data.theme.accent, ...animStyle(p, 'rise', 520, 360) }}>{info.message.toUpperCase()}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18, ...animStyle(p, 'fade', 580, 300) }}><SponsorMark p={p} placement="detached_logo" height={70} /></div>
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
    <FullPanel p={p} width={980} title={<span style={{ display: 'flex', alignItems: 'center', gap: 16 }}><span style={animStyle(p, 'zoom', 200, 400)}><Logo url={t.logoUrl} label={t.abbreviation} size={44} color={t.primaryColor} /></span> {t.name.toUpperCase()}{pages > 1 ? ` (${page}/${pages})` : ''}</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 40px' }}>
        {starters.map((x, i) => (
          <div key={x.playerId} style={{ display: 'flex', gap: 16, alignItems: 'baseline', fontSize: 30, ...stagger(p, i, 'slide-left', 240, 45) }}>
            <span style={{ width: 48, textAlign: 'right', color: t.primaryColor, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{x.number ?? ''}</span>
            <Fitted full={x.displayName} short={x.shortName} width={330} fontPx={30} measure={p.measure} />
            {x.captain ? <span style={{ fontSize: 18, opacity: 0.7 }}>(C)</span> : null}
          </div>
        ))}
      </div>
      {bench.length ? <div style={{ marginTop: 20, fontSize: 22, opacity: 0.75, ...stagger(p, starters.length + 1, 'rise', 240, 45) }}>Bench: {bench.map((x) => `${x.number ?? ''} ${x.shortName ?? x.displayName}`).join(' · ')}</div> : null}
      {!starters.length ? <div style={{ fontSize: 26, opacity: 0.7 }}>Lineup to be confirmed</div> : null}
    </FullPanel>
  );
}

function Stats(p: GraphicProps) {
  const rows = statRows(p);
  const h = team(p, 'home');
  const a = team(p, 'away');
  const d = p.display;
  return (
    <FullPanel p={p} width={900} title="MATCH STATS">
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px', fontSize: 30, gap: '10px 0' }}>
        <span style={{ fontWeight: 900, color: h.primaryColor, ...animStyle(p, 'slide-left', 220, 340) }}>{h.abbreviation}</span>
        <span style={{ textAlign: 'center', fontSize: 40, fontWeight: 900, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'zoom', 260, 400) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></span>
        <span style={{ fontWeight: 900, color: a.primaryColor, textAlign: 'right', ...animStyle(p, 'slide-right', 220, 340) }}>{a.abbreviation}</span>
        {rows.map((r, i) => {
          const hv = Number(r.home ?? 0);
          const av = Number(r.away ?? 0);
          const tot = hv + av || 1;
          const row = stagger(p, i, 'rise', 300, 70);
          return (
            <div key={r.key} style={{ display: 'contents' }}>
              <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', ...row }}><span style={changeStyle(p, `h-${r.key}`, r.home)}>{r.home ?? '—'}</span>{r.unit ?? ''}</span>
              <span style={{ textAlign: 'center', opacity: 0.85, ...row }}>
                {r.label}
                <span style={{ display: 'flex', height: 5, gap: 3, marginTop: 4 }}>
                  <span style={{ flex: hv / tot, background: h.primaryColor, transformOrigin: 'right', ...animStyle(p, 'grow-x', 380 + i * 70, 420) }} />
                  <span style={{ flex: av / tot, background: a.primaryColor, transformOrigin: 'left', ...animStyle(p, 'grow-x', 380 + i * 70, 420) }} />
                </span>
              </span>
              <span style={{ fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...row }}><span style={changeStyle(p, `a-${r.key}`, r.away)}>{r.away ?? '—'}</span>{r.unit ?? ''}</span>
            </div>
          );
        })}
      </div>
      {!rows.length ? <div style={{ opacity: 0.7, fontSize: 26 }}>No statistics recorded yet</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, ...animStyle(p, 'fade', 300 + rows.length * 70, 300) }}><SponsorMark p={p} placement="detached_logo" height={50} /></div>
    </FullPanel>
  );
}

function BreakScore(p: GraphicProps) {
  const d = p.display;
  const label = t(p, ((p.cue.variables.label as string) || d.periodLabel).toUpperCase());
  return (
    <FullPanel p={p} title={label} width={1000}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 30 }}>
        <div style={{ textAlign: 'right', ...animStyle(p, 'slide-left', 220, 420) }}><Fitted full={team(p, 'home').name} short={team(p, 'home').shortName} width={330} fontPx={40} measure={p.measure} /></div>
        <div style={{ fontSize: 96, fontWeight: 900, fontVariantNumeric: 'tabular-nums', ...animStyle(p, 'zoom', 300, 460) }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></div>
        <div style={animStyle(p, 'slide-right', 220, 420)}><Fitted full={team(p, 'away').name} short={team(p, 'away').shortName} width={330} fontPx={40} measure={p.measure} /></div>
      </div>
      {d.shootout ? <div style={{ textAlign: 'center', fontSize: 30, ...animStyle(p, 'rise', 420, 320) }}>Penalties {d.shootout.home}–{d.shootout.away}</div> : null}
      <div style={{ textAlign: 'center', marginTop: 10, fontSize: 24, opacity: 0.8, ...animStyle(p, 'rise', 460, 320) }}>{occasionLine(p.data.match)}</div>
      {p.cue.variables.showSponsor !== false ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16, ...animStyle(p, 'fade', 540, 300) }}><SponsorMark p={p} placement="detached_logo" height={64} /></div> : null}
    </FullPanel>
  );
}

function PeriodBanner(p: GraphicProps) {
  const { heading, period } = periodBanner(p);
  const d = p.display;
  const h = team(p, 'home');
  const a = team(p, 'away');
  const W = 940;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', bottom: SY + 50, width: W, fontFamily: p.data.theme.font, color: p.data.theme.text, ...animStyle(p, 'slide-up') }} data-graphic="period_banner">
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: p.data.theme.accent, color: '#0B1220', fontSize: 40, fontWeight: 900, letterSpacing: 4, padding: '8px 36px', ...angled(20), ...animStyle(p, 'zoom', 0, 460) }}>{t(p, heading)}</div>
      </div>
      <Panel p={p} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 24, padding: '18px 34px', marginTop: -6, ...animStyle(p, 'wipe', 140, 420) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'flex-end', ...animStyle(p, 'slide-left', 260, 400) }}><span style={{ fontSize: 34, fontWeight: 800 }}>{h.abbreviation}</span><Logo url={h.logoUrl} label={h.abbreviation} size={56} color={h.primaryColor} /></div>
        <div style={{ textAlign: 'center', ...animStyle(p, 'flip', 320, 460) }}>
          <div style={{ fontSize: 46, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}><span style={changeStyle(p, 'score', `${d.score.home}-${d.score.away}`)}>{d.score.home}–{d.score.away}</span></div>
          <div style={{ fontSize: 22, opacity: 0.85, letterSpacing: 2 }}>{period.toUpperCase()}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...animStyle(p, 'slide-right', 260, 400) }}><Logo url={a.logoUrl} label={a.abbreviation} size={56} color={a.primaryColor} /><span style={{ fontSize: 34, fontWeight: 800 }}>{a.abbreviation}</span></div>
      </Panel>
      {p.creative('lower_third_banner', p.cue) ? <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8, ...animStyle(p, 'fade', 480, 300) }}><span style={{ background: 'rgba(255,255,255,.95)', padding: '6px 16px' }}><SponsorMark p={p} placement="lower_third_banner" height={40} /></span></div> : null}
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
    <div style={{ position: 'absolute', ...box, background: 'rgba(255,255,255,.96)', padding: 14, display: 'grid', placeItems: 'center', ...animStyle(p, placement === 'lower_third_banner' ? 'wipe' : 'zoom') }} data-graphic="sponsor">
      <img alt={c.brandName} src={c.url} style={{ height: '100%', objectFit: 'contain', ...animStyle(p, 'fade', 150, 300) }} data-sponsor-creative={c.id} />
    </div>
  );
}

function Ticker(p: GraphicProps) {
  const text = tickerText(p);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: SY - 10, height: 56, background: p.data.theme.panel, color: p.data.theme.text, overflow: 'hidden', fontFamily: p.data.theme.font, display: 'flex', alignItems: 'center', ...animStyle(p, 'slide-up') }} data-graphic="ticker">
      <div style={{ background: p.data.theme.primary, color: p.data.theme.secondary, fontWeight: 900, padding: '0 24px', height: '100%', display: 'grid', placeItems: 'center', zIndex: 1, ...animStyle(p, 'wipe', 100, 340) }}>LATEST</div>
      <div style={{ ...animStyle(p, 'fade', 240, 400) }}>
        <div style={{ whiteSpace: 'nowrap', fontSize: 28, animation: `bs-ticker ${tickerSpeed(p)}s linear infinite`, paddingLeft: 40 }}>
          {text} &nbsp;&nbsp;•&nbsp;&nbsp; {text} &nbsp;&nbsp;•&nbsp;&nbsp;
        </div>
      </div>
    </div>
  );
}

function Slate(p: GraphicProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${p.data.theme.secondary} 0%, ${p.data.theme.panel} 100%)`, color: p.data.theme.text, fontFamily: p.data.theme.font, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, ...animStyle(p, 'fade') }} data-graphic="slate">
      <div style={animStyle(p, 'fade', 100, 400)}><ThemeBadge p={p} height={80} /></div>
      <div style={{ width: 1100 }}><TeamsHeader p={p} delayMs={200} /></div>
      <div style={{ fontSize: 52, fontWeight: 800, ...animStyle(p, 'rise', 420, 420) }}>{slateMessage(p)}</div>
      <div style={{ fontSize: 28, opacity: 0.7, ...animStyle(p, 'rise', 500, 360) }}>{occasionLine(p.data.match)}</div>
      <div style={animStyle(p, 'fade', 600, 400)}><SponsorMark p={p} placement="detached_logo" height={80} /></div>
    </div>
  );
}

/** Lower-anchored strip (kicker + panel) used by the shared match-information graphic. */
function LowerStrip(p: GraphicProps, kicker: string, color: string, body: React.ReactNode, sponsorPlacement?: string) {
  return (
    <div style={{ position: 'absolute', left: SX, bottom: SY + 40, display: 'flex', alignItems: 'stretch', fontFamily: p.data.theme.font, ...animStyle(p, 'slide-left') }} data-graphic={p.t.key}>
      <div style={{ background: color, color: p.data.theme.secondary, fontSize: 22, fontWeight: 900, letterSpacing: 3, padding: '0 22px', display: 'grid', placeItems: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', ...angled(12), ...animStyle(p, 'wipe', 0, 360) }}>{kicker}</div>
      <Panel p={p} style={{ padding: '16px 40px 16px 28px', minWidth: 700, maxWidth: 1300, ...angled(26), ...animStyle(p, 'wipe', 100, 400) }}>{body}</Panel>
      {sponsorPlacement ? <SponsorBox p={p} placement={sponsorPlacement} delayMs={420} /> : null}
    </div>
  );
}

export const broadcastChrome: Chrome = {
  frame: (p, title, children, width) => <FullPanel p={p} title={title} width={width}>{children}</FullPanel>,
  strip: LowerStrip,
  event: EventBar,
  text: (p) => p.data.theme.text,
  muted: () => 'rgba(255,255,255,.65)',
  rule: () => 'rgba(255,255,255,.12)',
};

export const broadcastTheme: ThemeComponents = {
  ...sharedGraphics(broadcastChrome),
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
