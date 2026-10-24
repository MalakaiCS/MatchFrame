'use client';
import { useEffect, useRef, useState } from 'react';
import { OctagonX } from 'lucide-react';
import { cx } from '@bs/ui';

/** Deliberate gesture: press and hold for 1.2 s (pointer or keyboard). Works in Auto and Manual. */
export function EmergencyClear({ onClear, disabled }: { onClear: () => void; disabled?: boolean }) {
  const [p, setP] = useState(0);
  const start = useRef<number | null>(null);
  const raf = useRef(0);
  const HOLD = 1200;
  const begin = () => {
    if (disabled) return;
    start.current = performance.now();
    const tick = () => {
      if (start.current == null) return;
      const v = Math.min(1, (performance.now() - start.current) / HOLD);
      setP(v);
      if (v >= 1) {
        start.current = null;
        setP(0);
        onClear();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const end = () => {
    start.current = null;
    cancelAnimationFrame(raf.current);
    setP(0);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerLeave={end}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && begin()}
      onKeyUp={end}
      aria-label="Emergency clear: press and hold to take all graphics out and stop automation"
      data-testid="emergency-clear"
      className={cx('relative h-9 overflow-hidden rounded-md border border-live bg-live/15 px-3 text-sm font-semibold text-live select-none disabled:opacity-50')}
    >
      <span className="absolute inset-y-0 left-0 bg-live/40" style={{ width: `${p * 100}%` }} aria-hidden />
      <span className="relative inline-flex items-center gap-1.5"><OctagonX className="size-4" /> Hold to clear</span>
    </button>
  );
}
