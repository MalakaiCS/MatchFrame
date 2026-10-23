// A match's video thumbnail (YouTube and the like), in the match's look: a band across the top with the
// competition's logo, round, date and name on a slanted plate and what the video is on a tag (live stream,
// highlights, extended highlights, full match or the club's own words), and the two teams below, each on its
// colour either side of a slanted seam with its crest and name. 1280×720, drawn in the browser like the other
// stills; it shows the score only when asked (a thumbnail usually keeps the result back).
import { useMemo, useState, type CSSProperties } from 'react';
import { getAdapter } from '@bs/domain';
import { COLOUR_CLASH_THRESHOLD, colourDistance, resolveColourClash, type RenderData, type RenderTeam } from '../data';
import { canvasMeasure, fitLabel, type Measure } from '../fit';
import { inkOn, Logo, withAlpha } from './common';

export type ThumbnailKind = 'live' | 'highlights' | 'extended' | 'full_match' | 'custom';

/** The thumbnails a match gets, in the order they are offered. */
export const THUMBNAIL_KINDS: { kind: ThumbnailKind; name: string; label: string }[] = [
  { kind: 'live', name: 'Live stream', label: 'LIVE STREAM' },
  { kind: 'highlights', name: 'Highlights', label: 'HIGHLIGHTS' },
  { kind: 'extended', name: 'Extended highlights', label: 'EXTENDED HIGHLIGHTS' },
  { kind: 'full_match', name: 'Full match', label: 'FULL MATCH' },
  { kind: 'custom', name: 'Your own words', label: 'MATCH REPLAY' },
];

export const THUMBNAIL_SIZE = { width: 1280, height: 720 };
const W = THUMBNAIL_SIZE.width;
const H = THUMBNAIL_SIZE.height;
const BAND = 300;

export interface ThumbnailOptions {
  kind: ThumbnailKind;
  /** the tag's words for `custom` (and to reword any kind) */
  label?: string | null;
  /** the final (or current) score between the crests instead of "VS" */
  showScore?: boolean;
  /** the team names under the crests */
  names?: boolean;
}

function Badge({ url, height }: { url: string; height: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return <img alt="" src={url} onError={() => setBroken(true)} style={{ height, maxWidth: height * 1.5, objectFit: 'contain', flex: 'none' }} />;
}

/** The largest size from `px` down to `min` that `text` fits `width` at, or null. */
function fitSize(m: Measure, text: string, width: number, px: number, min: number): number | null {
  for (let s = px; s >= min; s -= 2) if (m(text, s) <= width) return s;
  return null;
}

export function MatchThumbnail({ data, measure, ...o }: ThumbnailOptions & { data: RenderData; measure?: Measure }) {
  const th = data.theme;
  const m = data.match;
  const font = th.font;
  const fallback = useMemo(() => canvasMeasure(font, 900), [font]);
  // measured a little wide: the heaviest weight, upper case, letter-spaced
  const meas: Measure = measure ?? ((t, px) => fallback(t, px) * 1.08);
  const { home, away } = resolveColourClash(m.teams.home, m.teams.away);
  const dark = th.secondary;
  const plate = colourDistance(th.primary, dark) < COLOUR_CLASH_THRESHOLD ? th.accent : th.primary;
  const plateInk = inkOn(plate, dark);
  const stripe = colourDistance(th.accent, dark) < COLOUR_CLASH_THRESHOLD || colourDistance(th.accent, plate) < COLOUR_CLASH_THRESHOLD ? '#FFFFFF' : th.accent;
  const say = (s: string) => th.wording?.[s] ?? s;

  // ---- the band: logo, round and date, competition
  const logo = m.competition.logoUrl || th.logoUrl || null;
  let date = '';
  try {
    date = new Intl.DateTimeFormat('en-AU', { timeZone: m.timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(m.scheduledAt));
  } catch {
    // an unknown time zone: no date
  }
  const small = [m.round, date].filter(Boolean).join('  ·  ').toUpperCase();
  const textX = logo ? 56 + 190 + 64 : 64;
  const textW = 700 - textX;
  const full = m.competition.name;
  const short = m.competition.shortName;
  // the full name on a line, else on two, else the short name, else the full name cut short
  const one = fitSize(meas, full, textW, 66, 44);
  const words = full.split(/\s+/);
  const half = words.length > 1 ? Math.ceil(words.length / 2) : 0;
  const lines = half ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [];
  const two = lines.length ? fitSize(meas, lines.reduce((a, b) => (meas(a, 10) > meas(b, 10) ? a : b)), textW, 54, 36) : null;
  const shortPx = short ? fitSize(meas, short, textW, 66, 44) : null;
  const title = one ? { lines: [full], px: one } : two ? { lines, px: two } : short && shortPx ? { lines: [short], px: shortPx } : { lines: [fitLabel({ full, maxWidth: textW, fontPx: 44, minFontPx: 44, measure: meas }).text], px: 44 };

  // ---- the tag: what the video is
  const kind = THUMBNAIL_KINDS.find((k) => k.kind === o.kind) ?? THUMBNAIL_KINDS[1]!;
  const label = say((o.label?.trim() || kind.label).toUpperCase());
  const tag: { bg: string; ink: string; dot?: boolean } =
    o.kind === 'live' ? { bg: '#E5262B', ink: '#FFFFFF', dot: true }
      : o.kind === 'extended' ? { bg: stripe, ink: inkOn(stripe, dark) }
        : o.kind === 'full_match' ? { bg: plate, ink: plateInk }
          : { bg: '#FFFFFF', ink: dark };
  const tagWords = label.split(/\s+/);
  // a long label stands on two lines: its first word small above the rest
  const stacked = label.length > 13 && tagWords.length > 1;
  const tagMain = stacked ? tagWords.slice(1).join(' ') : label;
  const tagPx = fitSize(meas, tagMain, 380, stacked ? 40 : 38, 24) ?? 24;

  // ---- the teams
  const display = getAdapter(m.sport).display(m.rulesConfig as never, m.projection, m.clocks, Date.now());
  const score = o.showScore ? `${display.score.home}–${display.score.away}` : null;
  const seam = { top: 0.535, bottom: 0.465 };
  const side = (t: RenderTeam, s: 'home' | 'away') => {
    const ink = inkOn(t.primaryColor, dark);
    const cx = s === 'home' ? W * 0.255 : W * 0.745;
    // the name, smaller if it must be, else the team's letters
    const nm = fitLabel({ full: (t.shortName || t.name).toUpperCase(), short: t.abbreviation, maxWidth: 440, fontPx: 40, minFontPx: 26, measure: meas });
    const clip = s === 'home' ? `polygon(0 0, ${seam.top * 100}% 0, ${seam.bottom * 100}% 100%, 0 100%)` : `polygon(${seam.top * 100}% 0, 100% 0, 100% 100%, ${seam.bottom * 100}% 100%)`;
    return (
      <div key={s} data-thumbnail-team={s} style={{ position: 'absolute', inset: 0, clipPath: clip, background: `linear-gradient(${s === 'home' ? 135 : 225}deg, ${withAlpha('#FFFFFF', 0)} 0%, rgba(0,0,0,.28) 100%), ${t.primaryColor}` }}>
        {/* the team's letters, large and faint, behind its crest */}
        <span aria-hidden style={{ position: 'absolute', top: 18, left: cx - 360, width: 720, textAlign: 'center', fontSize: 250, fontWeight: 900, fontStyle: 'italic', letterSpacing: -6, lineHeight: 1, color: withAlpha(ink === '#FFFFFF' ? '#FFFFFF' : '#000000', 0.07), whiteSpace: 'nowrap' }}>{t.abbreviation}</span>
        <div style={{ position: 'absolute', left: cx - 230, width: 460, top: o.names === false ? 95 : 62, display: 'grid', justifyItems: 'center', gap: 18 }}>
          <span style={{ filter: 'drop-shadow(0 10px 18px rgba(0,0,0,.35))', display: 'grid' }}>
            <Logo url={t.logoUrl} label={t.abbreviation} size={o.names === false ? 230 : 210} color={withAlpha('#000000', 0.18)} radius={th.radius >= 12 ? 36 : 12} />
          </span>
          {o.names === false ? null : <span style={{ fontSize: nm.fontPx, fontWeight: 900, letterSpacing: 1, color: ink, whiteSpace: 'nowrap', textShadow: ink === '#FFFFFF' ? '0 2px 10px rgba(0,0,0,.3)' : 'none' }}>{nm.text}</span>}
        </div>
      </div>
    );
  };
  const centre: CSSProperties = { position: 'absolute', left: W / 2, top: BAND + (H - BAND) / 2, transform: 'translate(-50%, -50%)', display: 'grid', placeItems: 'center', background: dark, color: '#FFFFFF', fontWeight: 900, boxShadow: `0 0 0 5px ${stripe}, 0 12px 30px rgba(0,0,0,.45)` };

  return (
    <div data-thumbnail={o.kind} style={{ position: 'relative', width: W, height: H, overflow: 'hidden', background: dark, fontFamily: font, color: '#FFFFFF' }}>
      {/* the teams */}
      <div style={{ position: 'absolute', left: 0, top: BAND, width: W, height: H - BAND }}>
        {side(home, 'home')}
        {side(away, 'away')}
        <div aria-hidden style={{ position: 'absolute', inset: 0, background: stripe, clipPath: `polygon(${seam.top * 100 - 0.35}% 0, ${seam.top * 100 + 0.35}% 0, ${seam.bottom * 100 + 0.35}% 100%, ${seam.bottom * 100 - 0.35}% 100%)` }} />
      </div>
      {score ? (
        <span data-thumbnail-score style={{ ...centre, padding: '10px 26px', borderRadius: Math.min(th.radius, 14), fontSize: 64, fontVariantNumeric: 'tabular-nums', letterSpacing: 1 }}>{score}</span>
      ) : (
        <span style={{ ...centre, width: 86, height: 86, borderRadius: '50%', fontSize: 32, fontStyle: 'italic', letterSpacing: 1 }}>{say('VS')}</span>
      )}

      {/* the band */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: BAND, overflow: 'hidden', background: `radial-gradient(120% 140% at 85% 0%, ${withAlpha(plate, 0.28)} 0%, transparent 55%), ${dark}`, boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
        {/* fine hatching on the dark side */}
        <div aria-hidden style={{ position: 'absolute', left: 640, top: 0, right: 0, bottom: 0, opacity: 0.5, background: `repeating-linear-gradient(-62deg, ${withAlpha('#FFFFFF', 0.06)} 0 2px, transparent 2px 22px)`, maskImage: 'linear-gradient(90deg, transparent, #000 40%, #000 70%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 40%, #000 70%, transparent)' }} />
        <div style={{ position: 'absolute', left: 0, top: 0, width: 790, height: BAND, background: `linear-gradient(160deg, ${withAlpha('#FFFFFF', 0.14)}, transparent 60%), ${plate}`, clipPath: 'polygon(0 0, 100% 0, 88% 100%, 0 100%)' }} />
        <div aria-hidden style={{ position: 'absolute', left: 770, top: 0, width: 70, height: BAND, background: stripe, clipPath: 'polygon(55% 0, 100% 0, 45% 100%, 0 100%)' }} />
        <div style={{ position: 'absolute', left: 56, top: 0, height: BAND, display: 'flex', alignItems: 'center', gap: 32, color: plateInk }}>
          {logo ? (
            <>
              <span style={{ width: 190, display: 'grid', placeItems: 'center' }}><Badge url={logo} height={168} /></span>
              <span style={{ width: 3, height: 150, background: withAlpha(plateInk === '#FFFFFF' ? '#FFFFFF' : '#000000', 0.35) }} />
            </>
          ) : null}
          <div style={{ display: 'grid', gap: 8, width: textW }}>
            {small ? <span style={{ fontSize: fitSize(meas, small, textW, 26, 18) ?? 18, fontWeight: 800, letterSpacing: 2.5, opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{small}</span> : null}
            <span data-thumbnail-competition style={{ display: 'grid', fontSize: title.px, fontWeight: 900, lineHeight: 1, letterSpacing: 0.5 }}>
              {title.lines.map((l) => <span key={l} style={{ whiteSpace: 'nowrap' }}>{l}</span>)}
            </span>
          </div>
        </div>
        <div data-thumbnail-label style={{ position: 'absolute', right: 64, top: BAND / 2, transform: 'translateY(-50%) skewX(-12deg)', background: tag.bg, color: tag.ink, borderRadius: Math.min(th.radius, 10), padding: stacked ? '10px 34px 12px' : '14px 34px', boxShadow: '0 10px 30px rgba(0,0,0,.4)' }}>
          <div style={{ transform: 'skewX(12deg)', display: 'grid', justifyItems: 'center', fontStyle: 'italic', fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap' }}>
            {stacked ? <span style={{ fontSize: Math.round(tagPx * 0.55), letterSpacing: 4, opacity: 0.9, marginBottom: 4 }}>{tagWords[0]}</span> : null}
            <span style={{ fontSize: tagPx, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
              {tag.dot ? <span style={{ width: Math.round(tagPx * 0.42), height: Math.round(tagPx * 0.42), borderRadius: '50%', background: tag.ink, boxShadow: `0 0 0 4px ${withAlpha(tag.ink, 0.3)}` }} /> : null}
              {tagMain}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
