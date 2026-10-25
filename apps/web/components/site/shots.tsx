// Product views on the public site: screenshots of the real app and stills of the real renderer, all with
// fictional sample data, at fixed proportions so nothing shifts as they load. Captured by `pnpm capture:site`
// (tests/e2e/capture-site-media.mjs, see docs/public-site.md); never with real customer data, links or keys.
import type { ReactNode } from 'react';

export interface Shot {
  src: string;
  alt: string;
  w: number;
  h: number;
}

export const SHOTS = {
  prepare: { src: '/site/product-prepare.jpg', alt: 'A match in MatchFrame: the matchday checklist with teams, line-ups, look and the OBS link ready', w: 1600, h: 1000 },
  scorer: { src: '/site/product-scorer.jpg', alt: "The MatchFrame scorer on a phone: both teams' scores, the clock and the event buttons for a fictional football match", w: 780, h: 1560 },
  control: { src: '/site/product-control.jpg', alt: 'The MatchFrame desk: the preview and on-air monitors, the graphics catalogue and the automation panel', w: 1600, h: 1000 },
  bug: { src: '/site/graphic-scorebug.jpg', alt: 'A MatchFrame scorebug with the score, clock and a sample sponsor for a fictional football match', w: 1600, h: 900 },
  lineup: { src: '/site/graphic-lineup.jpg', alt: 'A MatchFrame line-up board listing the starting players of a fictional team', w: 1600, h: 900 },
  goal: { src: '/site/graphic-goal.jpg', alt: 'A MatchFrame goal graphic naming the scorer and the minute, inside the scorebug', w: 1600, h: 900 },
  stats: { src: '/site/graphic-stats.jpg', alt: 'A MatchFrame match statistics board comparing two fictional teams', w: 1600, h: 900 },
  sponsor: { src: '/site/graphic-sponsor.jpg', alt: 'A MatchFrame caption with a sample sponsor banner during a fictional match', w: 1600, h: 900 },
  basketball: { src: '/site/graphic-basketball.jpg', alt: 'A MatchFrame basketball scorebug with the period, team fouls, timeouts and shot clock', w: 1600, h: 900 },
  futsal: { src: '/site/graphic-futsal.jpg', alt: 'A MatchFrame futsal scorebug with the count-down clock, accumulated fouls and timeouts', w: 1600, h: 900 },
  /** close-ups: the top-left of the 16:9 frame, enlarged (labelled as close-ups wherever they appear) */
  bugDetail: { src: '/site/detail-scorebug.jpg', alt: 'Close-up of a MatchFrame scorebug: both teams, the score, the clock and a sample sponsor', w: 1300, h: 731 },
  goalDetail: { src: '/site/detail-goal.jpg', alt: 'Close-up of a MatchFrame goal graphic running across the scorebug for the scoring team', w: 1300, h: 731 },
} satisfies Record<string, Shot>;

/** A screenshot or still in a frame. `chrome` adds a slim browser bar above app screenshots. */
export function ShotFrame({ shot, className = '', chrome = false, priority = false, caption, sizes = '(min-width: 1024px) 50vw, 100vw' }: { shot: Shot; className?: string; chrome?: boolean; priority?: boolean; caption?: ReactNode; sizes?: string }) {
  return (
    <figure className={`overflow-hidden rounded-2xl border border-border bg-panel shadow-pop ${className}`}>
      {chrome ? (
        <div aria-hidden className="flex h-7 items-center gap-1.5 border-b border-border bg-elevated px-3">
          <span className="size-2.5 rounded-full bg-border-strong/60" />
          <span className="size-2.5 rounded-full bg-border-strong/60" />
          <span className="size-2.5 rounded-full bg-border-strong/60" />
        </div>
      ) : null}
      <img src={shot.src} alt={shot.alt} width={shot.w} height={shot.h} sizes={sizes} loading={priority ? 'eager' : 'lazy'} decoding="async" className="block h-auto w-full bg-[#0b1220]" />
      {caption ? <figcaption className="border-t border-border px-4 py-2.5 text-xs text-muted">{caption}</figcaption> : null}
    </figure>
  );
}

/** A phone outline around a scorer screenshot. */
export function PhoneFrame({ shot, className = '' }: { shot: Shot; className?: string }) {
  return (
    <div className={`rounded-[2rem] border border-border-strong/50 bg-[#05080d] p-2 shadow-pop ${className}`}>
      <img src={shot.src} alt={shot.alt} width={shot.w} height={shot.h} loading="lazy" decoding="async" className="block h-auto w-full rounded-[1.5rem]" />
    </div>
  );
}
