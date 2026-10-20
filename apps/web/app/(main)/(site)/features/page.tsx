import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { AvailabilityBadge, ButtonLink, Card, Eyebrow, H2, Lead, PageIntro, Section } from '@/components/site/ui';
import { CAPABILITIES, EDITIONS, type Capability } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Features',
  description: 'Live scoring, 29 broadcast graphics in four looks, automation, sponsor placements, cloud production and highlights, with what is available on each edition.',
  path: '/features',
});

const GROUPS: { title: string; blurb: string; keys: Capability['key'][] }[] = [
  { title: 'Before the match', blurb: 'Set up once: the look, the automation and the sponsors.', keys: ['graphics', 'automation', 'sponsors'] },
  { title: 'During the match', blurb: 'One scorer drives everything; the control room can take over.', keys: ['scoring', 'streaming'] },
  { title: 'After the match', blurb: 'Clips and reports from what actually happened and went to air.', keys: ['highlights'] },
];

const MORE = [
  ['Producer board', 'Every live match and today\'s fixtures on one screen: score, whether a scorer is connected, what each output is showing, and cues waiting for approval.'],
  ['Commentator view', 'A read-only, large-type page for the commentary position: line-ups with what each player has done, key events, statistics, head to head and the table.'],
  ['Public match centre', 'A link for fans with the live score, events, line-ups, statistics and the table, plus a JSON feed for club websites. Switch it off at any time.'],
  ['Run sheet and activity', 'A shared timed run sheet ticked off live, and one plain-language timeline of everything that happened on the match and who did it.'],
  ['Season data', 'League tables with your tiebreakers, results and fixtures by round, player totals across a season, and season rollover that keeps the history.'],
  ['Stream Deck and OBS scenes', 'One web request per button to take graphics or run playlists, and a ready-made OBS scene collection download.'],
  ['Fixture import', 'Import fixtures from a CSV file (with a dry run first), an iCal calendar or a published spreadsheet.'],
  ['Demo matches', 'A self-playing match, labelled Demo everywhere and left out of tables and reports, to see everything move.'],
];

export default function FeaturesPage() {
  const by = (k: Capability['key']) => CAPABILITIES.find((c) => c.key === k)!;
  return (
    <>
      <PageIntro eyebrow="Features" title="Everything the broadcast needs, connected">
        <Lead>One match record drives the scorebug, the event graphics, the automation and the sponsor reports. Each area below says what it does, where it is available and how we checked it.</Lead>
      </PageIntro>

      <Section>
        <H2>Where each feature is available</H2>
        <p className="mt-3 max-w-3xl text-sm text-muted">The <strong className="text-white">{EDITIONS.hosted.name}</strong>: {EDITIONS.hosted.summary} <strong className="text-white">{EDITIONS.media.name}</strong>: {EDITIONS.media.summary}</p>
        <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.12em] text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">Feature</th>
                <th scope="col" className="px-4 py-3">{EDITIONS.hosted.short}</th>
                <th scope="col" className="px-4 py-3">{EDITIONS.media.short}</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c.key} className="border-t border-white/5">
                  <th scope="row" className="px-4 py-3 font-medium text-white"><a href={`#${c.key}`} className="hover:text-brand-cyan">{c.name}</a></th>
                  <td className="px-4 py-3"><AvailabilityBadge value={c.hosted} /></td>
                  <td className="px-4 py-3"><AvailabilityBadge value={c.media} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {GROUPS.map((g) => (
        <Section key={g.title} tone="panel">
          <Eyebrow>{g.title}</Eyebrow>
          <p className="mt-2 text-muted">{g.blurb}</p>
          <div className="mt-8 space-y-10">
            {g.keys.map((k) => {
              const c = by(k);
              return (
                <article key={c.key} id={c.key} className="scroll-mt-24 grid gap-6 md:grid-cols-[1fr_1.3fr]">
                  <div>
                    <H2>{c.name}</H2>
                    <p className="mt-3 text-muted">{c.benefit}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="text-xs text-muted">Hosted:</span> <AvailabilityBadge value={c.hosted} />
                      <span className="ml-2 text-xs text-muted">Media server:</span> <AvailabilityBadge value={c.media} />
                    </div>
                    <p className="mt-3 text-sm text-muted"><strong className="text-white/90">Plans:</strong> {c.plans}</p>
                    <Link href={c.guide.href} className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-white">
                      {c.guide.label} <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  </div>
                  <Card>
                    <ul className="space-y-3">
                      {c.points.map((pt) => (
                        <li key={pt} className="flex gap-3 text-sm leading-relaxed text-white/90">
                          <Check className="mt-0.5 size-4 shrink-0 text-brand-cyan" aria-hidden />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 border-t border-white/5 pt-3 text-xs text-muted"><strong className="text-white/80">How we checked:</strong> {c.evidence}</p>
                  </Card>
                </article>
              );
            })}
          </div>
        </Section>
      ))}

      <Section>
        <Eyebrow>And around the match</Eyebrow>
        <H2 className="mt-3">Tools for the whole team</H2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MORE.map(([t, b]) => (
            <Card key={t}>
              <h3 className="font-semibold text-white">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
            </Card>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/showcase">See the graphics</ButtonLink>
          <ButtonLink href="/how-it-works" variant="secondary">How a matchday runs</ButtonLink>
        </div>
      </Section>
    </>
  );
}
