import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ButtonLink, Card, Eyebrow, H2, Lead, PageIntro, Section } from '@/components/site/ui';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'How it works',
  description: 'How a MatchFrame matchday runs: preparing the match, running the broadcast from a phone and a laptop, and sharing the moments afterwards.',
  path: '/how-it-works',
});

const PREPARE = [
  ['Fixture, teams and players', 'Create the competition and season, add teams and their season rosters, and create the fixture (or import a round from a CSV file).'],
  ['Line-ups', 'Mark each player Start, Bench or Out, from a laptop or the scorer\'s phone. Use last line-up and Use team default fill a side in one tap.'],
  ['Look', 'Choose one of ten looks and put your logo, colours and team colours on it. The match keeps the version it started with.'],
  ['Automation', 'Start from your sport\'s starter plan, change what you like in plain language, and rehearse it against a made-up match.'],
  ['OBS link', 'Every match has a graphics link from the moment it is created. Add it to OBS once as a Browser Source.'],
];

const ROLES = [
  { who: 'The scorer (a phone)', does: ['Presses the phase buttons as the match goes: Pre-match, Players entering, 1st Half, Half Time and so on.', 'Records goals, cards, substitutions and statistics; undoes or corrects mistakes.', 'Keeps going offline: actions apply once when the connection returns.'] },
  { who: 'MatchFrame (automatically)', does: ['Shows the scorebug, line-ups, kick-off banners and event graphics as the scorer records the match.', 'Runs the half-time and full-time boards and rotates sponsors by your campaign rules.', 'Records what went to air for the sponsor reports.'] },
  { who: 'The operator (a laptop)', does: ['Watches the preview, prepares any extra graphic and sends it To air.', 'Switches the output to Manual, or holds Emergency clear, whenever they need to.', 'Runs OBS and the stream, or the cloud outputs with the media server.'] },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageIntro eyebrow="How it works" title="Prepare the match, run the broadcast, share the moments">
        <Lead>Most of the work happens before match day. On the day, a scorer and one person at the streaming computer are enough: automation does the routine graphics, and people stay in charge.</Lead>
      </PageIntro>

      <Section>
        <Eyebrow>Stage 1</Eyebrow>
        <H2 className="mt-3">Prepare the match</H2>
        <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PREPARE.map(([t, b], i) => (
            <li key={t}>
              <Card className="h-full">
                <span className="font-brand text-sm font-bold text-brand-cyan">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-2 font-semibold text-white">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
              </Card>
            </li>
          ))}
        </ol>
        <Link href="/docs/getting-started/first-match" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-white">
          Follow the first match guide <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </Section>

      <Section tone="panel">
        <Eyebrow>Stage 2</Eyebrow>
        <H2 className="mt-3">Run the broadcast</H2>
        <p className="mt-3 max-w-3xl text-muted">Who does what during the match. Automation only acts while the output is in Auto.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {ROLES.map((r) => (
            <Card key={r.who}>
              <h3 className="font-brand text-lg font-semibold text-white">{r.who}</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
                {r.does.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </Card>
          ))}
        </div>
        <div className="mt-10">
          <h3 className="font-brand text-xl font-semibold text-white">A football match with the starter plan</h3>
          <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.12em] text-muted"><tr><th scope="col" className="px-4 py-3">When</th><th scope="col" className="px-4 py-3">On air</th></tr></thead>
              <tbody className="text-white/90">
                {[
                  ['The match is created', 'Animated background and the match header: teams, ground and kick-off time, with a countdown to kick-off, on air until the players walk out.'],
                  ['Players entering', 'Background and header fade; 15 seconds later each line-up for 8 seconds, once.'],
                  ['About to start', 'The scorebug comes up, its clock at 0:00.'],
                  ['1st Half', 'Kick-off banner, and the clock starts.'],
                  ['Goals, cards, substitutions', 'Their graphic, with the goal partner after a goal.'],
                  ['Half Time', 'Background over everything; the stats and the header with a countdown to the second half take turns every 45 seconds.'],
                  ['Players entering (2nd half)', 'Background and header fade; the scorebug returns 7 seconds later.'],
                  ['Full Time', 'After 30 seconds, the final score on the header with "Thank you for watching".'],
                ].map(([w, o]) => (
                  <tr key={w} className="border-t border-white/5"><th scope="row" className="px-4 py-3 font-medium text-white">{w}</th><td className="px-4 py-3 text-muted">{o}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section>
        <Eyebrow>Stage 3</Eyebrow>
        <H2 className="mt-3">Share the moments</H2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-white">On any edition</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">Export any graphic from the control room as a transparent PNG, or a short WebM of its animation, for social posts. Sponsor and on-air reports export as CSV.</p>
          </Card>
          <Card>
            <h3 className="font-semibold text-white">With the media server</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">The programme is recorded, and goals and key events become clips during the match. Trim, crop to 16:9, 9:16 or 1:1, add intro and outro artwork, then download or share an expiring link.</p>
          </Card>
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/register">Get started</ButtonLink>
          <ButtonLink href="/docs/getting-started/rehearsal" variant="secondary">How to rehearse</ButtonLink>
        </div>
      </Section>
    </>
  );
}
