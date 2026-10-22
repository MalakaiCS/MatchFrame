'use client';
// The replay transition in every look. A wall of slanted bands in the look's colours (with the teams: home on the
// left, away on the right), edged with a bright stripe, sweeps in from the left until it covers the whole frame, the
// word REPLAY lands in the middle (between the two crests with the teams), then the wall sweeps on to the right.
// The bands move as one, so the frame never shows through between them. It plays live on the transition layer and
// is exported frame by frame as a transparent WebM for an OBS or vMix stinger (2 s, cut at 1 s).
import type { CSSProperties, ReactNode } from 'react';
import { animStyle, partAnim, type GraphicProps } from './stage';
import { Fitted, Logo, ThemeBadge, t, team } from './common';

/** The wall's sweep (ms): in over `in`; after the hold, a short pause, then on and away over `out`. */
export const REPLAY_SWEEP = { in: 720, outDelay: 60, out: 740 } as const;
// a soft start and landing in; out starts gently and leaves at a steady pace (no last-frame jump at 25/30 fps)
const SWEEP_EASE = { in: 'cubic-bezier(.45,.05,.25,1)', out: 'cubic-bezier(.55,0,.45,1)' };

interface ReplayStyle {
  /** slant of the bands (degrees, as skewX) */
  angle: number;
  bands: number;
  /** what the word sits on */
  plate: 'none' | 'slant' | 'pill' | 'paper' | 'glass' | 'metal' | 'square' | 'deep';
  italic: boolean;
  weight: number;
  /** letter spacing, em */
  tracking: number;
  /** the line under the word */
  rule: 'hot' | 'spectrum' | 'silver' | 'quad' | 'none';
  /** pattern on the bands */
  texture: 'none' | 'stars' | 'stripes' | 'brushed' | 'facets';
  /** a light sweep across the plate as it lands */
  shine: boolean;
}

const STYLES: Record<string, ReplayStyle> = {
  broadcast: { angle: -14, bands: 5, plate: 'slant', italic: false, weight: 900, tracking: 0.06, rule: 'hot', texture: 'stripes', shine: false },
  minimal: { angle: 0, bands: 3, plate: 'deep', italic: false, weight: 600, tracking: 0.32, rule: 'hot', texture: 'none', shine: false },
  club: { angle: -8, bands: 4, plate: 'pill', italic: false, weight: 800, tracking: 0.08, rule: 'none', texture: 'none', shine: false },
  premier: { angle: -22, bands: 5, plate: 'glass', italic: false, weight: 800, tracking: 0.12, rule: 'spectrum', texture: 'facets', shine: true },
  liga: { angle: 0, bands: 4, plate: 'paper', italic: false, weight: 800, tracking: 0.1, rule: 'hot', texture: 'none', shine: false },
  major: { angle: -10, bands: 4, plate: 'glass', italic: false, weight: 700, tracking: 0.2, rule: 'none', texture: 'none', shine: false },
  southern: { angle: 0, bands: 4, plate: 'square', italic: false, weight: 900, tracking: 0.02, rule: 'quad', texture: 'stripes', shine: false },
  continental: { angle: 0, bands: 3, plate: 'none', italic: false, weight: 300, tracking: 0.45, rule: 'silver', texture: 'stars', shine: true },
  primetime: { angle: -18, bands: 5, plate: 'metal', italic: true, weight: 900, tracking: 0.04, rule: 'hot', texture: 'brushed', shine: true },
  meister: { angle: -12, bands: 4, plate: 'paper', italic: true, weight: 800, tracking: 0.06, rule: 'hot', texture: 'none', shine: false },
};

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}
/** a → b by k (0..1), as hex (no color-mix(): older OBS browser sources lack it) */
function mix(a: string, b: string, k: number): string {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, '0')).join('')}`;
}
const alpha = (hex: string, a: number) => {
  const c = rgb(hex);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex;
};
const light = (hex: string) => {
  const c = rgb(hex);
  return !!c && 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150;
};

const TEXTURES: Record<ReplayStyle['texture'], string | null> = {
  none: null,
  stripes: 'repeating-linear-gradient(90deg, rgba(255,255,255,.07) 0 2px, transparent 2px 16px)',
  stars: 'radial-gradient(circle, rgba(255,255,255,.6) 0 1.4px, transparent 2px) 0 0 / 58px 58px, radial-gradient(circle, rgba(255,255,255,.35) 0 1px, transparent 1.6px) 29px 31px / 58px 58px',
  brushed: 'repeating-linear-gradient(0deg, rgba(255,255,255,.06) 0 1px, transparent 1px 4px)',
  facets: 'linear-gradient(118deg, rgba(255,255,255,.12) 0 28%, transparent 28% 61%, rgba(0,0,0,.14) 61%)',
};

/** The bands' colours, left to right: the look's, or home's on the left and away's on the right. */
function bandColours(p: GraphicProps, s: ReplayStyle, withTeams: boolean): string[] {
  const th = p.data.theme;
  const deep = th.secondary;
  if (withTeams) {
    const h = team(p, 'home').primaryColor;
    const a = team(p, 'away').primaryColor;
    const half = Math.floor(s.bands / 2);
    const left = Array.from({ length: half }, (_, i) => mix(h, '#000000', i * 0.22));
    const right = Array.from({ length: half }, (_, i) => mix(a, '#000000', (half - 1 - i) * 0.22));
    return [...left, ...(s.bands % 2 ? [deep] : []), ...right];
  }
  const palette = [deep, th.primary, mix(deep, th.primary, 0.35), th.accent, mix(deep, '#000000', 0.25)];
  return Array.from({ length: s.bands }, (_, i) => palette[i % palette.length]!);
}

function plateStyle(p: GraphicProps, s: ReplayStyle): { box: CSSProperties; ink: string } {
  const th = p.data.theme;
  switch (s.plate) {
    case 'slant':
      return { box: { background: th.panel, clipPath: 'polygon(5% 0, 100% 0, 95% 100%, 0 100%)', padding: '34px 120px', boxShadow: '0 30px 80px rgba(0,0,0,.45)' }, ink: th.text };
    case 'pill':
      return { box: { background: th.panel, borderRadius: 999, padding: '34px 110px', boxShadow: '0 30px 80px rgba(0,0,0,.4)' }, ink: th.text };
    case 'paper':
      return { box: { background: '#FFFFFF', borderRadius: th.radius, padding: '34px 100px', boxShadow: '0 30px 80px rgba(0,0,0,.35)', ...(s.italic ? { clipPath: 'polygon(4% 0, 100% 0, 96% 100%, 0 100%)', padding: '34px 130px' } : {}) }, ink: th.text };
    case 'glass':
      // smoked glass: the look's deep colour, see-through, so the word reads over light bands too
      return { box: { background: `linear-gradient(180deg, ${alpha(th.secondary, 0.82)}, ${alpha(th.secondary, 0.62)})`, border: '2px solid rgba(255,255,255,.3)', borderRadius: th.radius, padding: '34px 100px', boxShadow: 'inset 0 0 60px rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.4)' }, ink: '#FFFFFF' };
    case 'deep':
      return { box: { background: th.secondary, borderRadius: th.radius, padding: '30px 96px' }, ink: light(th.secondary) ? '#0B1220' : '#FFFFFF' };
    case 'metal':
      return { box: { background: 'linear-gradient(180deg, #F6F8FA 0%, #CDD2DA 52%, #EEF1F4 100%)', clipPath: 'polygon(6% 0, 100% 0, 94% 100%, 0 100%)', padding: '34px 140px', boxShadow: '0 30px 80px rgba(0,0,0,.45)' }, ink: th.text };
    case 'square':
      return { box: { background: '#FFFFFF', padding: '30px 90px' }, ink: th.text };
    default:
      return { box: { padding: '20px 40px' }, ink: light(th.secondary) ? '#0B1220' : '#FFFFFF' };
  }
}

function Rule({ p, s, withTeams }: { p: GraphicProps; s: ReplayStyle; withTeams: boolean }) {
  const th = p.data.theme;
  const anim = partAnim(p, 'grow-x', 560, 280, 0, 180);
  const base: CSSProperties = { height: 8, marginTop: 22, transformOrigin: 'left', ...anim };
  if (withTeams) return <div style={{ ...base, background: `linear-gradient(90deg, ${team(p, 'home').primaryColor} 0 50%, ${team(p, 'away').primaryColor} 50% 100%)` }} />;
  switch (s.rule) {
    case 'spectrum':
      return <div style={{ ...base, background: `linear-gradient(90deg, ${th.primary}, ${th.accent})` }} />;
    case 'silver':
      return <div style={{ ...base, height: 2, background: '#C9D3E8' }} />;
    case 'quad':
      return <div style={{ ...base, background: `linear-gradient(90deg, ${th.primary} 0 25%, ${th.accent} 25% 50%, #FFB400 50% 75%, #FFFFFF 75%)` }} />;
    case 'hot':
      return <div style={{ ...base, background: th.primary }} />;
    default:
      return null;
  }
}

function TeamBlock({ p, which }: { p: GraphicProps; which: 'home' | 'away' }) {
  const tm = team(p, which);
  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 18, width: 340, ...partAnim(p, which === 'home' ? 'slide-left' : 'slide-right', 420, 340, 0, 220) }}>
      <div style={{ width: 200, height: 200, borderRadius: '50%', background: '#FFFFFF', display: 'grid', placeItems: 'center', boxShadow: `0 0 0 8px ${tm.primaryColor}, 0 24px 60px rgba(0,0,0,.45)` }}>
        <Logo url={tm.logoUrl} label={tm.abbreviation ?? tm.shortName ?? tm.name} size={140} color={tm.primaryColor} radius={70} />
      </div>
      {/* the short name, made smaller to fit, or else the abbreviation */}
      <Fitted full={(tm.shortName ?? tm.name).toUpperCase()} short={tm.abbreviation} width={340} fontPx={46} weight={800} measure={p.measure} style={{ color: '#FFFFFF', letterSpacing: '0.03em', textShadow: '0 4px 18px rgba(0,0,0,.55)', textAlign: 'center' }} />
    </div>
  );
}

export function ReplayTransition(p: GraphicProps): ReactNode {
  const th = p.data.theme;
  const s = STYLES[th.themeKey] ?? STYLES.broadcast!;
  const withTeams = p.cue.variables.teams === true;
  const word = (typeof p.cue.variables.text === 'string' && p.cue.variables.text.trim()) || t(p, 'REPLAY');
  const colours = bandColours(p, s, withTeams);
  const texture = TEXTURES[s.texture];
  const plate = plateStyle(p, s);
  const edge = mix(withTeams ? '#FFFFFF' : th.accent, '#FFFFFF', 0.25);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', fontFamily: th.font }} data-graphic="replay">
      {/* the wall: every band moves with it, edged with a bright stripe at the front (in) and the back (out) */}
      <div style={{ position: 'absolute', top: '-12%', height: '124%', left: '-26%', width: '152%', ...partAnim(p, 'sweep', 0, REPLAY_SWEEP.in, REPLAY_SWEEP.outDelay, REPLAY_SWEEP.out, SWEEP_EASE) }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', transform: `skewX(${s.angle}deg)` }}>
          <div style={{ width: 22, flex: 'none', background: edge, boxShadow: `0 0 36px ${alpha(edge, 0.75)}` }} />
          {colours.map((c, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                marginRight: -3,
                background: [texture, `linear-gradient(180deg, ${mix(c, '#FFFFFF', 0.12)} 0%, ${c} 45%, ${mix(c, '#000000', 0.2)} 100%)`].filter(Boolean).join(', '),
                boxShadow: '-18px 0 40px rgba(0,0,0,.28)',
              }}
            />
          ))}
          <div style={{ width: 22, flex: 'none', background: edge, boxShadow: `0 0 36px ${alpha(edge, 0.75)}` }} />
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 64 }}>
        {withTeams ? <TeamBlock p={p} which="home" /> : null}
        <div style={{ display: 'grid', justifyItems: 'center', ...partAnim(p, 'zoom', 360, 340, 0, 220) }}>
          {!withTeams ? <div style={{ marginBottom: 26, ...partAnim(p, 'fade', 480, 260, 0, 160) }}><ThemeBadge p={p} height={96} /></div> : null}
          <div style={{ position: 'relative', overflow: 'hidden', ...plate.box }}>
            <span style={{ display: 'block', fontSize: withTeams ? 132 : 172, lineHeight: 1, fontWeight: s.weight, fontStyle: s.italic ? 'italic' : 'normal', letterSpacing: `${s.tracking}em`, marginRight: `-${s.tracking}em`, textTransform: 'uppercase', color: plate.ink, whiteSpace: 'nowrap', textShadow: s.plate === 'none' || s.plate === 'glass' ? '0 6px 28px rgba(0,0,0,.45)' : undefined }}>
              {word}
            </span>
            {s.shine ? <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '35%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent)', opacity: 0, ...animStyle(p, 'shine', 700, 560) }} /> : null}
            <Rule p={p} s={s} withTeams={withTeams} />
          </div>
        </div>
        {withTeams ? <TeamBlock p={p} which="away" /> : null}
      </div>
    </div>
  );
}
