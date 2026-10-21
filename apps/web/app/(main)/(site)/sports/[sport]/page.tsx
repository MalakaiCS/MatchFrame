import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Check } from 'lucide-react';
import { Badge, ButtonLink, Card, H2, Lead, PageIntro, Section } from '@/components/site/ui';
import { SPORTS, SPORT_STATUS_LABEL } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

const DETAIL: Record<string, { intro: string; graphics: string[]; automation: string[]; rehearse: string[]; guide: string }> = {
  football: {
    intro: 'Football in MatchFrame covers the full match: the walk-out, both halves, added time, extra time and penalty shoot-outs, with goals, assists, cards and substitutions recorded once on a phone.',
    graphics: ['Scorebug with the clock, added time and the shoot-out tally', 'Animated background and match header before the match, at half time and at full time', 'Team line-ups and formations', 'Goal graphics naming the scorer, cards and substitutions', 'Kick-off and period banners, match statistics, break and final scores', 'Shoot-out tracker, league table, fixtures and top scorers'],
    automation: ['From the moment the match is created: the animated background and match header, with a countdown to kick-off, until the players walk out', 'Players entering: each line-up for 8 seconds, once, 15 seconds after the walk-out', 'About to start: the scorebug, its clock at 0:00', 'Each half: the kick-off banner, and the clock starts', 'Half time: after 10 seconds, the header with a countdown to the second half and the stats, 30 seconds each', 'Full time: after 30 seconds, the final score on the header with "Thank you for watching"'],
    rehearse: ['Press Players entering and check both line-ups show (a side with no line-up is skipped)', 'Record and undo a goal', 'Go to Half Time and back out for the second half', 'If your competition has them, try extra time and a shoot-out from More options'],
    guide: '/docs/sports/football',
  },
  basketball: {
    intro: 'Basketball in MatchFrame records one, two and three-point scores (the score changes at once; name the scorer afterwards), fouls by type, timeouts, possession, rebounds and assists, through quarters and overtime with a separate shot clock.',
    graphics: ['Scorebug with the period, team fouls and bonus, timeouts remaining and the shot clock', 'Score updates naming the scorer, and timeout graphics', 'Team line-ups and match statistics', 'Period banners, break and final scores', 'League table, fixtures and top scorers by points'],
    automation: ['Before the game: the match header and both line-ups', 'Each period: the scorebug through play', 'Timeouts: a sponsor placement and the statistics board', 'Period breaks: the break score and statistics; full time: the final score', 'A lower third every 20 points as a milestone', 'Every playlist can be changed in plain language and rehearsed before publishing'],
    rehearse: ['Record a three and a two, and name the scorers afterwards', 'Record a foul of each type you use and a timeout', 'Run the shot clock and a period end, then overtime if your competition uses it'],
    guide: '/docs/sports/basketball',
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

export default async function SportPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  const s = SPORTS.find((x) => x.key === sport);
  const d = DETAIL[sport];
  if (!s || !d) notFound();
  return (
    <>
      <PageIntro eyebrow="Sports" title={s.name}>
        <div className="flex flex-wrap items-center gap-3"><Badge tone={s.status}>{SPORT_STATUS_LABEL[s.status]}</Badge></div>
        <Lead className="mt-4">{d.intro}</Lead>
      </PageIntro>
      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <H2 className="!text-xl">What the scorer records</H2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{s.scoring}</p>
            <H2 className="mt-6 !text-xl">On the scorebug</H2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{s.scorebug}</p>
          </Card>
          <Card>
            <H2 className="!text-xl">Graphics</H2>
            <ul className="mt-3 space-y-2">
              {d.graphics.map((g) => <li key={g} className="flex gap-2 text-sm text-white/90"><Check className="mt-0.5 size-4 shrink-0 text-brand-cyan" aria-hidden />{g}</li>)}
            </ul>
            <Link href="/showcase" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-white">See them in the showcase <ArrowRight className="size-3.5" aria-hidden /></Link>
          </Card>
        </div>
      </Section>
      <Section tone="panel">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <H2>Automation</H2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">{d.automation.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
          <div>
            <H2>Rehearse these first</H2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">{d.rehearse.map((r) => <li key={r}>{r}</li>)}</ol>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/docs/getting-started/first-match">Set up your first match</ButtonLink>
          <ButtonLink href={d.guide} variant="secondary">{s.name} guide</ButtonLink>
        </div>
      </Section>
    </>
  );
}
