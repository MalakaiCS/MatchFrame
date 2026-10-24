import { Check } from 'lucide-react';
import { SHOTS, ShotFrame, type Shot } from '@/components/site/shots';
import { ArrowLink, AvailabilityBadge, ButtonLink, H2, H3, PageIntro, Section, SectionHeading } from '@/components/site/ui';
import { CAPABILITIES, EDITIONS, GRAPHIC_COUNT, LOOK_COUNT, type Capability } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Features',
  description: `Live scoring from a phone, ${GRAPHIC_COUNT} broadcast graphics in ${LOOK_COUNT} looks, automation and sponsor placements, plus cloud production and highlights with the media server.`,
  path: '/features',
});

/** The four things every hosted plan does, first; the media-server extras after them. */
const CORE: Capability['key'][] = ['scoring', 'graphics', 'automation', 'sponsors'];
const EXTRA: Capability['key'][] = ['streaming', 'highlights'];
const FALLBACK: Partial<Record<Capability['key'], Shot>> = { streaming: SHOTS.bug, highlights: SHOTS.goal };

const MORE = [
  ['Live page', 'Every live match and today’s fixtures on one screen: score, scorer connection, what each output shows and cues waiting for approval.'],
  ['Commentator view', 'A large-type, read-only page for the commentary position: line-ups, key events, statistics, head to head and the table.'],
  ['Public match centre', 'A link for fans with the live score, events, line-ups and statistics, plus a JSON feed for club websites. Switch it off at any time.'],
  ['Run sheet and activity', 'A shared, timed run sheet ticked off live, and one plain-language timeline of what happened on the match and who did it.'],
  ['Season data', 'League tables with your tiebreakers, results and fixtures by round, and player totals across a season.'],
  ['Stream Deck and OBS scenes', 'One web request per button to take graphics or run playlists, and a ready-made OBS scene collection download.'],
  ['Fixture import', 'Import fixtures from a CSV file (with a dry run first), an iCal calendar or a published spreadsheet.'],
  ['Demo matches', 'A self-playing match, labelled Demo everywhere and left out of tables and reports, to see everything move.'],
];

function CapabilitySection({ c, flip, tone }: { c: Capability; flip: boolean; tone: 'plain' | 'raised' }) {
  const shot = c.image ?? FALLBACK[c.key];
  const phone = c.key === 'scoring';
  return (
    <Section id={c.key} tone={tone} labelledBy={`${c.key}-heading`}>
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div className={flip ? 'lg:order-2' : ''}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Hosted:</span> <AvailabilityBadge value={c.hosted} />
            {c.hosted !== c.media ? <><span className="ml-1 text-xs text-muted">Self-hosted:</span> <AvailabilityBadge value={c.media} /></> : null}
          </div>
          <H2 id={`${c.key}-heading`} className="mt-4">{c.name}</H2>
          <p className="mt-4 max-w-xl text-base leading-[1.65] text-muted sm:text-lg">{c.benefit}</p>
          <ul className="mt-6 space-y-3">
            {c.points.map((pt) => (
              <li key={pt} className="flex max-w-xl gap-3 text-[15px] leading-relaxed text-text/90">
                <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <span>{pt}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-xl rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
            <span className="font-semibold text-text">Plans: </span>
            {c.plans}
          </p>
          <ArrowLink href={c.guide.href} className="mt-3">{c.guide.label}</ArrowLink>
        </div>
        {shot ? (
          <div className={flip ? 'lg:order-1' : ''}>
            {phone ? (
              <div className="grid place-items-center rounded-2xl border border-border bg-elevated py-8">
                <div className="w-[52%] max-w-[260px] rounded-[2rem] border border-border-strong/50 bg-[#05080d] p-2 shadow-pop">
                  <img src={shot.src} alt={shot.alt} width={shot.w} height={shot.h} loading="lazy" decoding="async" className="block h-auto w-full rounded-[1.5rem]" />
                </div>
              </div>
            ) : (
              <ShotFrame shot={shot} chrome={shot === SHOTS.control} />
            )}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

export default function FeaturesPage() {
  const by = (k: Capability['key']) => CAPABILITIES.find((c) => c.key === k)!;
  return (
    <>
      <PageIntro eyebrow="Features" title="Everything the broadcast needs, connected">
        <p className="max-w-2xl text-base leading-[1.65] text-muted sm:text-lg">
          One match record drives the scorebug, the event graphics, the automation and the sponsor reports. Score it once on a phone; everything else follows.
        </p>
        <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
          {[...CORE, ...EXTRA].map((k) => (
            <a key={k} href={`#${k}`} className="inline-flex min-h-11 items-center rounded-xl border border-border bg-panel px-4 text-sm font-medium text-text shadow-card hover:border-primary hover:text-primary">
              {by(k).name}
            </a>
          ))}
        </nav>
      </PageIntro>

      {CORE.map((k, i) => (
        <CapabilitySection key={k} c={by(k)} flip={i % 2 === 1} tone={i % 2 === 1 ? 'raised' : 'plain'} />
      ))}

      <Section tone="raised" labelledBy="availability-heading">
        <SectionHeading eyebrow="Availability" title="What runs where" id="availability-heading">
          <p>
            <span className="font-semibold text-text">{EDITIONS.hosted.name}:</span> {EDITIONS.hosted.summary}{' '}
            <span className="font-semibold text-text">{EDITIONS.media.name}:</span> {EDITIONS.media.summary}
          </p>
        </SectionHeading>
        <div className="mt-8 relative overflow-x-auto rounded-2xl border border-border bg-panel shadow-card" role="region" aria-label="Feature availability" tabIndex={0}>
          <table className="w-full min-w-[30rem] text-left text-sm">
            <caption className="sr-only">Where each feature is available</caption>
            <thead className="bg-elevated/70 text-xs uppercase tracking-[0.12em] text-muted">
              <tr>
                <th scope="col" className="px-5 py-3">Feature</th>
                <th scope="col" className="px-5 py-3">Hosted</th>
                <th scope="col" className="px-5 py-3">Self-hosted with media server</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c.key} className="border-t border-border">
                  <th scope="row" className="px-5 py-3 font-medium text-text">
                    <a href={`#${c.key}`} className="hover:text-primary hover:underline">{c.name}</a>
                  </th>
                  <td className="px-5 py-3"><AvailabilityBadge value={c.hosted} /></td>
                  <td className="px-5 py-3"><AvailabilityBadge value={c.media} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted">Cloud production is coming to the hosted service as an optional $10-per-production-hour extra. Today it needs a self-hosted deployment with the media server, where capacity depends on your server.</p>
      </Section>

      {EXTRA.map((k, i) => (
        <CapabilitySection key={k} c={by(k)} flip={i % 2 === 0} tone="plain" />
      ))}

      <Section tone="raised" labelledBy="more-heading">
        <SectionHeading eyebrow="Around the match" title="Tools for the whole team" id="more-heading" />
        <ul className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {MORE.map(([t, b]) => (
            <li key={t}>
              <H3 className="!text-base">{t}</H3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{b}</p>
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/showcase">Try the live demo</ButtonLink>
          <ButtonLink href="/pricing" variant="secondary">Compare plans</ButtonLink>
          <ButtonLink href="/how-it-works" variant="ghost">How a matchday runs</ButtonLink>
        </div>
      </Section>
    </>
  );
}
