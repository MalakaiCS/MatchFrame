'use client';
// A YouTube video that loads nothing from YouTube until the visitor presses play (no cookies, no third-party
// requests on page load). The frame sends the page origin as referrer, which YouTube's player requires.
import { useState } from 'react';
import { Play } from 'lucide-react';

export function VideoEmbed({ youtubeId, title }: { youtubeId: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <figure className="overflow-hidden rounded-2xl border border-white/10 bg-panel/60">
      <div className="relative aspect-video bg-black">
        {playing ? (
          <iframe
            className="absolute inset-0 size-full"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&rel=0&modestbranding=1`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_center,rgba(43,92,255,0.35),transparent_65%)] text-white">
            <span className="grid size-16 place-items-center rounded-full bg-brand-cyan text-brand-navy shadow-[0_0_60px_rgba(0,210,255,0.5)] transition group-hover:scale-105">
              <Play className="ml-1 size-7" aria-hidden />
            </span>
            <span className="text-sm font-medium">Play video: {title}</span>
          </button>
        )}
      </div>
      <figcaption className="px-4 py-3 text-xs text-muted">Plays from YouTube when you press play. Nothing loads from YouTube before then.</figcaption>
    </figure>
  );
}
