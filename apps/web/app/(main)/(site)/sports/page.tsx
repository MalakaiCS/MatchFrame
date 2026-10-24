import Link from 'next/link';
import { SHOTS, type Shot } from '@/components/site/shots';
import { ArrowLink, Badge, ButtonLink, H2, H3, PageIntro, Section, SectionHeading } from '@/components/site/ui';
import { SPORTS, SPORT_STATUS_LABEL, SPORT_STATUS_NOTE, SPORT_STATUS_TONE } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Sports',
  description: 'Football and basketball are available in MatchFrame; futsal, netball, rugby league, AFL and hockey are in beta. One scorer app, one set of graphics.',
  path: '/sports',
});

const STILL: Record<string, Shot> = { football: SHOTS.lineup, basketball: SHOTS.basketball };

export default function SportsPage() {
  const main = SPORTS.filter((s) => s.status === 'tested');
  const beta = SPORTS.filter((s) => s.status === 'beta');
  return (
    <>
      <PageIntro eyebrow="Sports" title="Seven sports, one scorer and one set of graphics">
        <p className="max-w-2xl text-base leading-[1.65] text-muted sm:text-lg">
          Every sport shares the same scorer app, graphics and automation. What differs is the rule set (periods, clocks and scoring), the event buttons and the wording on air.
        </p>
      </PageIntro>

      <Section labelledBy="available-heading">
        <div className="flex flex-wrap items-center gap-3">
          <H2 id="available-heading">Available</H2>
          <Badge tone="available">{SPORT_STATUS_LABEL.tested}</Badge>
        </div>
        <p className="mt-3 max-w-2xl text-muted">{SPORT_STATUS_NOTE.tested}</p>
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {main.map((s) => {
            const still = STILL[s.key];
            return (
              <article key={s.key} aria-labelledby={`sport-${s.key}`} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-card">
                {still ? <img src={still.src} alt={still.alt} width={still.w} height={still.h} loading="lazy" decoding="async" className="block h-auto w-full border-b border-border bg-[#0b1220]" /> : null}
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <H3 className="!text-2xl"><span id={`sport-${s.key}`}>{s.name}</span></H3>
                    <Badge tone={SPORT_STATUS_TONE[s.status]}>{SPORT_STATUS_LABEL[s.status]}</Badge>
                  </div>
                  <p className="mt-3 text-[15px] leading-relaxed text-muted"><span className="font-semibold text-text">The scorer records: </span>{s.scoring}</p>
                  <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted"><span className="font-semibold text-text">On the scorebug: </span>{s.scorebug}</p>
                  {s.detail ? <ArrowLink href={`/sports/${s.key}`} className="mt-4 self-start">{s.name} in detail</ArrowLink> : null}
                </div>
              </article>
            );
          })}
        </div>
      </Section>

      <Section tone="raised" labelledBy="beta-heading">
        <div className="flex flex-wrap items-center gap-3">
          <H2 id="beta-heading">In beta</H2>
          <Badge tone="beta">{SPORT_STATUS_LABEL.beta}</Badge>
        </div>
        <p className="mt-3 max-w-2xl text-muted">{SPORT_STATUS_NOTE.beta}</p>
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {beta.map((s) => (
            <li key={s.key} className="flex flex-col rounded-2xl border border-border bg-panel p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <H3 className="!text-lg">{s.name}</H3>
                <Badge tone={SPORT_STATUS_TONE[s.status]}>{SPORT_STATUS_LABEL[s.status]}</Badge>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted"><span className="font-semibold text-text">Records: </span>{s.scoring}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted"><span className="font-semibold text-text">Scorebug: </span>{s.scorebug}</p>
              {s.detail ? <ArrowLink href={`/sports/${s.key}`} className="mt-3 self-start">{s.name} in detail</ArrowLink> : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="next-heading">
        <SectionHeading eyebrow="Next" title="Bring your sport on air" id="next-heading">
          <p>
            Clubs: set up one fixture and rehearse it before match day. Competitions: set a look and an automation plan once, and every fixture gets its own scorer link and graphics output.{' '}
            Not sure your sport or competition format fits? <Link href="/contact?topic=setup" className="font-medium text-primary hover:underline">Ask us</Link>.
          </p>
        </SectionHeading>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/register" size="lg">Get started</ButtonLink>
          <ButtonLink href="/showcase" variant="secondary" size="lg">See every sport in the live demo</ButtonLink>
        </div>
      </Section>
    </>
  );
}
