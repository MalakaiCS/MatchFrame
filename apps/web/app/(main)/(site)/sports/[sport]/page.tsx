import { notFound } from 'next/navigation';
import { Check } from 'lucide-react';
import { SHOTS, type Shot } from '@/components/site/shots';
import { ArrowLink, Badge, ButtonLink, Container, Eyebrow, H2, H3, Section } from '@/components/site/ui';
import { SPORTS, SPORT_STATUS_LABEL, SPORT_STATUS_NOTE, SPORT_STATUS_TONE } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

interface Detail {
  intro: string;
  still: Shot;
  periods: string[];
  graphics: string[];
  automation: string[];
  rehearse: string[];
  guide: string;
}

const DETAIL: Record<string, Detail> = {
  football: {
    intro: 'Football in MatchFrame covers the full match: the walk-out, both halves, added time, extra time and penalty shoot-outs, with goals, assists, cards and substitutions recorded once on a phone.',
    still: SHOTS.lineup,
    periods: ['Pre-match and players entering', 'First and second half, with added time', 'Half time and full time', 'Extra time and a penalty shoot-out when a winner is needed'],
    graphics: ['Scorebug with the clock, added time and the shoot-out tally', 'Animated background and match header before the match, at half time and at full time', 'Team line-ups and formations', 'Goal graphics naming the scorer, cards and substitutions', 'Kick-off and period banners, match statistics, break and final scores', 'Shoot-out tracker, league table, fixtures and top scorers'],
    automation: ['From the moment the match is created: the animated background and match header, with a countdown to kick-off, until the players walk out', 'Players entering: each line-up for 8 seconds, once, 15 seconds after the walk-out', 'About to start: the scorebug, its clock at 0:00', 'Each half: the kick-off banner, and the clock starts', 'Half time: the half-time banner, then the header with a countdown to the second half and the stats, 30 seconds each', 'Full time: after 30 seconds, the final score on the header with "Thank you for watching"'],
    rehearse: ['Press Players entering and check both line-ups show (a side with no line-up is skipped)', 'Record and undo a goal', 'Go to Half Time and back out for the second half', 'If your competition has them, try extra time and a shoot-out from More options'],
    guide: '/docs/sports/football',
  },
  basketball: {
    intro: 'Basketball in MatchFrame records one, two and three-point scores (the score changes at once; name the scorer afterwards), fouls by type, timeouts, possession, rebounds and assists, through quarters and overtime with a separate shot clock.',
    still: SHOTS.basketball,
    periods: ['Four quarters with breaks between them', 'Overtime periods when the scores are level', 'A separate shot clock alongside the game clock'],
    graphics: ['Scorebug with the period, team fouls and bonus, timeouts remaining and the shot clock', 'Score updates naming the scorer, and timeout graphics', 'Team line-ups and match statistics', 'Period banners, break and final scores', 'League table, fixtures and top scorers by points'],
    automation: ['Before the game: the match header and both line-ups', 'Each period: the scorebug through play', 'Timeouts: a sponsor placement and the statistics board', 'Period breaks: the break score and statistics; full time: the final score', 'A lower third every 20 points as a milestone', 'Every playlist can be changed in plain language and rehearsed before publishing'],
    rehearse: ['Record a three and a two, and name the scorers afterwards', 'Record a foul of each type you use and a timeout', 'Run the shot clock and a period end, then overtime if your competition uses it'],
    guide: '/docs/sports/basketball',
  },
  futsal: {
    intro: 'Futsal in MatchFrame follows the Futsal Laws of the Game as Football Australia uses them: two 20-minute halves on a stopped clock, accumulated fouls per half, one timeout per team in each half, the two-minute send-off and rolling substitutions. Running-clock and junior formats are presets.',
    still: SHOTS.futsal,
    periods: ['Two 20-minute halves on a stopped, count-down clock (running-clock and junior formats as presets)', 'Half time and full time', 'Extra time and kicks from the penalty mark when a winner is needed'],
    graphics: ['Scorebug with the count-down clock, accumulated fouls (marked at five, when the next foul is a 10 m kick) and timeouts', 'Animated background and match header before the match, at half time and at full time', 'Team line-ups on a court, five a side', 'Goal graphics for goals, penalties and 10 m kicks, cards and the timeout graphic', 'Kick-off banners, match statistics, break and final scores', 'Kicks from the penalty mark tracker, league table, fixtures and top scorers'],
    automation: ['The same match flow as football: the animated background and match header from the moment the match is created, the line-ups at the walk-out, the scorebug at About to start', 'Each half: the kick-off banner, and the clock starts', 'Goals, cards and timeouts put their graphic on air; rolling substitutions put nothing on air', 'Half time: the header with a countdown to the second half and the stats, 30 seconds each', 'Full time: after 30 seconds, the final score on the header with "Thank you for watching"'],
    rehearse: ['Stop and start the clock as the ball goes out of play', 'Record five fouls for one team and check the scorebug marks them, then a sixth', 'Call a timeout and check the clock stops and the timeout graphic goes to air', 'Record a red card and watch the two-minute countdown on the scorer phone'],
    guide: '/docs/sports/futsal',
  },
};

export function generateStaticParams() {
  return Object.keys(DETAIL).map((sport) => ({ sport }));
}

export async function generateMetadata({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  const s = SPORTS.find((x) => x.key === sport);
  if (!s || !DETAIL[sport]) return {};
  return siteMetadata({ title: s.name, description: `${s.name} in MatchFrame: what the scorer records, the graphics, the automation and how to rehearse it.`, path: `/sports/${sport}` });
}

function Ticks({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-2.5">
      {items.map((g) => (
        <li key={g} className="flex gap-3 text-[15px] leading-relaxed text-text/90">
          <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <span>{g}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function SportPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  const s = SPORTS.find((x) => x.key === sport);
  const d = DETAIL[sport];
  if (!s || !d) notFound();
  return (
    <>
      <div className="border-b border-border">
        <Container className="grid grid-cols-1 items-center gap-10 py-10 sm:py-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
          <div>
            <Eyebrow>Sports</Eyebrow>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="font-brand text-[34px] font-bold leading-[1.08] tracking-[-0.02em] text-text sm:text-5xl">{s.name}</h1>
              <Badge tone={SPORT_STATUS_TONE[s.status]}>{SPORT_STATUS_LABEL[s.status]}</Badge>
            </div>
            <p className="mt-4 max-w-xl text-base leading-[1.65] text-muted sm:text-lg">{d.intro}</p>
            <p className="mt-4 max-w-xl rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
              <span className="font-semibold text-text">{SPORT_STATUS_LABEL[s.status]}: </span>
              {SPORT_STATUS_NOTE[s.status]}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/register">Get started</ButtonLink>
              <ButtonLink href="/showcase" variant="secondary">Try the live demo</ButtonLink>
            </div>
          </div>
          <figure>
            <div className="overflow-hidden rounded-2xl border border-border bg-[#0b1220] shadow-pop">
              <img src={d.still.src} alt={d.still.alt} width={d.still.w} height={d.still.h} decoding="async" className="block h-auto w-full" />
            </div>
            <figcaption className="mt-2 text-xs text-muted">Sample output with fictional teams.</figcaption>
          </figure>
        </Container>
      </div>

      <Section labelledBy="scoring-heading">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <div>
            <H2 id="scoring-heading" className="!text-2xl sm:!text-3xl">What the scorer records</H2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">{s.scoring}</p>
            <H3 className="mt-8">Periods and phases</H3>
            <Ticks items={d.periods} />
            <H3 className="mt-8">On the scorebug</H3>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{s.scorebug}</p>
          </div>
          <div>
            <H2 className="!text-2xl sm:!text-3xl">Graphics</H2>
            <Ticks items={d.graphics} />
            <ArrowLink href="/showcase" className="mt-3">See them in the live demo</ArrowLink>
          </div>
        </div>
      </Section>

      <Section tone="raised" labelledBy="automation-heading">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <div>
            <H2 id="automation-heading" className="!text-2xl sm:!text-3xl">Automation</H2>
            <p className="mt-3 text-sm text-muted">The starter plan for {s.name.toLowerCase()}, on the Club plan and above. Every step can be changed.</p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted marker:text-primary">{d.automation.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
          <div>
            <H2 className="!text-2xl sm:!text-3xl">Before your first match</H2>
            <p className="mt-3 text-sm text-muted">What you need: a camera into OBS on a computer, the MatchFrame graphics link as a Browser Source, and a phone for the scorer. Then rehearse these:</p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-muted marker:font-semibold marker:text-primary">{d.rehearse.map((r) => <li key={r}>{r}</li>)}</ol>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/docs/getting-started/first-match">Set up your first match</ButtonLink>
          <ButtonLink href={d.guide} variant="secondary">{s.name} guide</ButtonLink>
          <ButtonLink href="/sports" variant="ghost">All sports</ButtonLink>
        </div>
      </Section>
    </>
  );
}
