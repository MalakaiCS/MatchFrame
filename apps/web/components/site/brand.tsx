// MatchFrame brand: the frame-and-play mark (two facing brackets around a play triangle) and the wordmark.
// The mark is drawn as vectors from the approved logo; colours are the logo's cyan and blue on deep navy.
export const BRAND = {
  name: 'MatchFrame',
  tagline: 'Every game. Broadcast ready.',
  cyan: '#00D2FF',
  blue: '#2B5CFF',
  navy: '#0A1020',
} as const;

const LEFT = '286,330 586,495 586,524 387,430 387,763 586,871 586,932 286,779';
const RIGHT = '969,330 668,495 668,525 863,442 863,713 668,817 668,932 969,774';
const PLAY = '494,592 664,677 494,762';

export function MatchFrameMark({ size = 32, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="250 282 755 698" width={size} height={size * (698 / 755)} className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {title ? <title>{title}</title> : null}
      <polygon points={LEFT} fill={BRAND.cyan} stroke={BRAND.cyan} strokeWidth={36} strokeLinejoin="round" />
      <polygon points={PLAY} fill={BRAND.cyan} stroke={BRAND.cyan} strokeWidth={34} strokeLinejoin="round" />
      <polygon points={RIGHT} fill={BRAND.blue} stroke={BRAND.blue} strokeWidth={36} strokeLinejoin="round" />
    </svg>
  );
}

/** Mark plus the MatchFrame wordmark; `size` is the mark height in pixels. */
export function MatchFrameLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <MatchFrameMark size={size * (755 / 698)} />
      <span className="font-brand font-extrabold tracking-[-0.02em] text-text" style={{ fontSize: size * 0.82, lineHeight: 1 }}>
        MatchFrame
      </span>
    </span>
  );
}

/** The mark as a standalone SVG document (favicon and share image). */
export function markSvg(background = true) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${background ? '180 210 900 900' : '250 282 755 698'}">${background ? `<rect x="180" y="210" width="900" height="900" rx="180" fill="${BRAND.navy}"/>` : ''}<g transform="${background ? 'translate(0,25)' : ''}"><polygon points="${LEFT}" fill="${BRAND.cyan}" stroke="${BRAND.cyan}" stroke-width="36" stroke-linejoin="round"/><polygon points="${PLAY}" fill="${BRAND.cyan}" stroke="${BRAND.cyan}" stroke-width="34" stroke-linejoin="round"/><polygon points="${RIGHT}" fill="${BRAND.blue}" stroke="${BRAND.blue}" stroke-width="36" stroke-linejoin="round"/></g></svg>`;
}
