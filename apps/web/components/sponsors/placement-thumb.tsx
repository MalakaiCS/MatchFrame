// A thumbnail of the 16:9 frame with the sponsor placement highlighted, so "where it appears" needs no reading.
const BOXES: Record<string, { x: number; y: number; w: number; h: number }> = {
  scorebug_logo: { x: 25, y: 6, w: 10, h: 7 },
  detached_logo: { x: 74, y: 6, w: 20, h: 12 },
  lower_third_banner: { x: 6, y: 74, w: 48, h: 11 },
  event_partner: { x: 46, y: 72, w: 14, h: 12 },
  full_frame_image: { x: 2, y: 2, w: 96, h: 96 },
  full_frame_video: { x: 2, y: 2, w: 96, h: 96 },
  clip_intro: { x: 2, y: 2, w: 96, h: 96 },
  clip_outro: { x: 2, y: 2, w: 96, h: 96 },
};

export function PlacementThumb({ placement, className }: { placement: string; className?: string }) {
  const b = BOXES[placement];
  return (
    <svg viewBox="0 0 100 56" width={48} height={27} className={className} aria-hidden style={{ flex: 'none' }}>
      <rect x="0.5" y="0.5" width="99" height="55" rx="3" fill="#0B1220" stroke="#2A3650" />
      <rect x="6" y="6" width="18" height="7" rx="1" fill="#2A3650" />
      {b ? <rect x={b.x} y={b.y * 0.56} width={b.w} height={b.h * 0.56} rx="1.5" fill="#FFCE66" opacity="0.9" /> : null}
      {placement.startsWith('clip') ? <path d="M44 20 L60 28 L44 36 Z" fill="#0B1220" /> : null}
    </svg>
  );
}
