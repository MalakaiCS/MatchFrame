'use client';
// MatchFrame's own graphics on video: a recording of the /reel page (the real renderer, fictional teams). It plays
// muted on a loop while it is on screen, unless the visitor prefers reduced motion or has paused it; the controls
// are always there. Nothing is fetched beyond the poster and metadata until it plays.
import { useEffect, useRef } from 'react';

export function LooksReel({ src, poster, title, caption }: { src: string; poster: string; title: string; caption: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let auto = false; // pauses made here, as opposed to by the visitor
    let held = false;
    const onPause = () => {
      if (!auto) held = true;
      auto = false;
    };
    v.addEventListener('pause', onPause);
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        if (!held) void v.play().catch(() => {});
      } else if (!v.paused) {
        auto = true;
        v.pause();
      }
    }, { threshold: 0.4 });
    io.observe(v);
    return () => {
      io.disconnect();
      v.removeEventListener('pause', onPause);
    };
  }, []);
  return (
    <figure className="overflow-hidden rounded-2xl border border-white/10 bg-panel/60">
      <video ref={ref} className="block aspect-video w-full bg-black" src={src} poster={poster} muted loop playsInline controls preload="metadata" aria-label={title} />
      <figcaption className="px-4 py-3 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}
