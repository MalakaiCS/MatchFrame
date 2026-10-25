import { Camera, ChevronDown, Laptop, MonitorPlay, Radio, Smartphone } from 'lucide-react';
import { PhoneFrame, SHOTS, ShotFrame } from '@/components/site/shots';
import { ArrowLink, Badge, ButtonLink, Eyebrow, H2, H3, PageIntro, Section, SectionHeading } from '@/components/site/ui';
import { LOOK_COUNT } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'How it works',
  description: 'How a MatchFrame matchday runs: prepare the match, score it from a phone while the graphics go to air in OBS, then share the moments afterwards.',
  path: '/how-it-works',
});

const SETUP = [
  { icon: Camera, title: 'Your camera', body: 'Into OBS Studio on the streaming computer, as you would without MatchFrame.' },
  { icon: MonitorPlay, title: 'The graphics link', body: 'Added to OBS once as a Browser Source. Graphics arrive on a transparent background over the picture.' },
  { icon: Smartphone, title: 'A phone for the scorer', body: 'The scorer app runs in the phone’s browser; no app store, and it keeps working offline.' },
  { icon: Radio, title: 'Your stream', body: 'OBS streams to YouTube, Facebook or wherever you broadcast today.' },
];

const PREPARE = [
  ['Fixture, teams and players', 'Create the competition and season, add teams and their rosters, and create the fixture, or import a round from a CSV file.'],
  ['Line-ups', 'Mark each player Start, Bench or Out, from a laptop or the scorer’s phone. Use last line-up and Use team default fill a side in one tap.'],
  ['Look', `Choose one of ${LOOK_COUNT} looks and put your logo, colours and team colours on it.`],
  ['Automation', 'Start from your sport’s starter plan, change what you like in plain language, and rehearse it against a made-up match.'],
  ['OBS link', 'Every match has a graphics link from the moment it is created. Add it to OBS once as a Browser Source.'],
];

const ROLES = [
  { icon: Smartphone, who: 'The scorer', where: 'on a phone', does: ['Presses the phase buttons as the match goes: Players entering, 1st Half, Half Time and so on.', 'Records goals, cards, substitutions and statistics, and undoes or corrects mistakes.', 'Keeps going through a dropped connection; actions apply once it returns.'] },
  { icon: MonitorPlay, who: 'MatchFrame', where: 'automatically', does: ['Puts the scorebug, line-ups, banners and event graphics on air as the scorer records the match.', 'Runs the half-time and full-time boards and rotates sponsors by your campaign rules.', 'Records what went to air for the sponsor reports.'] },
  { icon: Laptop, who: 'The operator', where: 'on a laptop', does: ['Watches the preview, prepares any extra graphic and sends it To air.', 'Switches the output to Manual, or holds Emergency clear, whenever they need to.', 'Runs OBS and the stream.'] },
];

const FOOTBALL_FLOW = [
  ['The match is created', 'Animated background and the match header with a countdown to kick-off, until the players walk out.'],
  ['Players entering', 'Background and header fade; 15 seconds later each line-up for 8 seconds, once.'],
  ['About to start', 'The scorebug comes up, its clock at 0:00.'],
  ['1st Half', 'Kick-off banner, and the clock starts.'],
  ['Goals, cards, substitutions', 'Their graphic, with the goal partner after a goal.'],
  ['Half Time', 'The half-time banner; 10 seconds later the background, then the header (with a countdown to the second half) and the stats take turns every 30 seconds.'],
  ['Players entering (2nd half)', 'Background and header fade; the scorebug returns 7 seconds later.'],
  ['Full Time', 'After 30 seconds, the final score on the header with “Thank you for watching”.'],
];

export default function HowItWorksPage() {
  return (
    <>
      <PageIntro eyebrow="How it works" title="Prepare the match, run the broadcast, share the moments">
        <p className="max-w-2xl text-base leading-[1.65] text-muted sm:text-lg">
          Most of the work happens before match day. On the day, a scorer and one person at the streaming computer are enough: automation does the routine graphics, and people stay in charge.
        </p>
      </PageIntro>

      {/* the normal setup: OBS on your own computer */}
      <Section labelledBy="setup-heading">
        <div className="flex flex-wrap items-center gap-3">
          <Eyebrow>The usual setup</Eyebrow>
          <Badge tone="available">Available</Badge>
        </div>
        <H2 id="setup-heading" className="mt-3 max-w-2xl">MatchFrame graphics over your camera, in OBS</H2>
        <p className="mt-4 max-w-2xl text-base leading-[1.65] text-muted sm:text-lg">MatchFrame makes the graphics and keeps the match record; it does not film the game. You stream from OBS Studio exactly as you do now, with one extra source.</p>
        <ol className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SETUP.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-border bg-panel p-6 shadow-card">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><s.icon className="size-5" aria-hidden /></span>
                <span className="font-brand text-sm font-bold text-muted">{i + 1}</span>
              </div>
              <H3 className="mt-4 !text-lg">{s.title}</H3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <ArrowLink href="/docs/graphics/first-output">Connect your graphics to OBS</ArrowLink>
          <ArrowLink href="/docs/getting-started/requirements">What you need</ArrowLink>
        </div>
      </Section>

      {/* 1. prepare */}
      <Section tone="raised" labelledBy="prepare-heading">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
          <div>
            <SectionHeading eyebrow="Step 1" title="Prepare the match" id="prepare-heading" />
            <ol className="mt-8 space-y-5">
              {PREPARE.map(([t, b], i) => (
                <li key={t} className="flex gap-4">
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 font-brand text-sm font-bold text-primary">{i + 1}</span>
                  <div>
                    <H3 className="!text-base">{t}</H3>
                    <p className="mt-1 max-w-lg text-[15px] leading-relaxed text-muted">{b}</p>
                  </div>
                </li>
              ))}
            </ol>
            <ArrowLink href="/docs/getting-started/first-match" className="mt-5">Follow the first match guide</ArrowLink>
          </div>
          <ShotFrame shot={SHOTS.prepare} chrome />
        </div>
      </Section>

      {/* 2. run */}
      <Section labelledBy="run-heading">
        <SectionHeading eyebrow="Step 2" title="Run the broadcast" id="run-heading">
          <p>Who does what during the match. Automation only acts while the output is in Auto, and anyone at the desk can take over.</p>
        </SectionHeading>
        <div className="mt-10 grid grid-cols-1 items-end gap-6 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <figure>
            <PhoneFrame shot={SHOTS.scorer} className="mx-auto w-[60%] max-w-[220px] lg:w-full" />
            <figcaption className="mt-3 text-center text-sm text-muted">The scorer’s phone</figcaption>
          </figure>
          <figure>
            <ShotFrame shot={SHOTS.control} chrome sizes="(min-width: 1024px) 40vw, 100vw" />
            <figcaption className="mt-3 text-center text-sm text-muted">The desk on the operator’s laptop</figcaption>
          </figure>
          <figure>
            <div className="overflow-hidden rounded-2xl border border-border bg-[#0b1220] shadow-pop">
              <img src={SHOTS.goal.src} alt={SHOTS.goal.alt} width={SHOTS.goal.w} height={SHOTS.goal.h} loading="lazy" decoding="async" className="block h-auto w-full" />
            </div>
            <figcaption className="mt-3 text-center text-sm text-muted">On air, in OBS</figcaption>
          </figure>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.who} className="rounded-2xl border border-border bg-panel p-6 shadow-card">
              <div className="flex items-center gap-3">
                <r.icon className="size-5 text-primary" aria-hidden />
                <H3 className="!text-lg">{r.who} <span className="font-sans text-sm font-normal text-muted">{r.where}</span></H3>
              </div>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted marker:text-primary">
                {r.does.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <details className="group mt-10 rounded-2xl border border-border bg-panel shadow-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-semibold text-text marker:hidden sm:px-6">
            What goes to air in a football match, moment by moment
            <ChevronDown className="size-5 shrink-0 text-primary transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-border px-5 pb-5 sm:px-6">
            <p className="mt-4 text-sm text-muted">With the football starter plan. Every timing can be changed, and other sports have their own starter plans.</p>
            <div className="mt-4 relative overflow-x-auto rounded-xl border border-border" role="region" aria-label="Football starter plan timings" tabIndex={0}>
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="bg-elevated/70 text-xs uppercase tracking-[0.12em] text-muted">
                  <tr><th scope="col" className="px-4 py-3">When</th><th scope="col" className="px-4 py-3">On air</th></tr>
                </thead>
                <tbody>
                  {FOOTBALL_FLOW.map(([w, o]) => (
                    <tr key={w} className="border-t border-border align-top">
                      <th scope="row" className="px-4 py-3 font-medium text-text">{w}</th>
                      <td className="px-4 py-3 text-muted">{o}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ArrowLink href="/docs/automation/football-flow" className="mt-3">How the football automation runs</ArrowLink>
          </div>
        </details>
      </Section>

      {/* 3. share */}
      <Section tone="raised" labelledBy="share-heading">
        <SectionHeading eyebrow="Step 3" title="Share the moments" id="share-heading">
          <p>Two different things: still and animated graphics you can export on any setup, and video clips, which need the media server.</p>
        </SectionHeading>
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-panel p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <H3 className="!text-lg">Graphic exports</H3>
              <Badge tone="available">Available</Badge>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">Export any graphic from the desk as a transparent PNG, or a short WebM of its animation, for social posts. Sponsor and on-air reports export as CSV. These are graphics only, not footage of the match.</p>
          </div>
          <div className="rounded-2xl border border-border bg-panel p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <H3 className="!text-lg">Recording and video clips</H3>
              <Badge tone="media-server">Requires media server</Badge>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">With cloud production on a self-hosted deployment, the programme is recorded and goals become clips during the match. Trim, crop to 16:9, 9:16 or 1:1, add intro and outro artwork, then download or share an expiring link.</p>
          </div>
        </div>
      </Section>

      {/* cloud production */}
      <Section labelledBy="cloud-heading">
        <div className="rounded-2xl border border-border p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="planned">Coming soon on hosted</Badge>
            <Badge tone="media-server">Requires media server</Badge>
          </div>
          <H2 id="cloud-heading" className="mt-4 !text-2xl sm:!text-3xl">Cloud production, without OBS</H2>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted">Instead of OBS, a camera or encoder sends an RTMP feed to MatchFrame, which puts the graphics on it and streams to up to three destinations, with a clean feed alongside. Today this runs on self-hosted deployments with the media server; it is coming to the hosted service as an optional extra.</p>
          <ArrowLink href="/docs/production/choose-a-workflow" className="mt-3">Compare the workflows</ArrowLink>
        </div>
        <div className="mt-12 flex flex-wrap gap-3">
          <ButtonLink href="/register" size="lg">Get started</ButtonLink>
          <ButtonLink href="/showcase" variant="secondary" size="lg">Try the live demo</ButtonLink>
          <ButtonLink href="/docs/getting-started/rehearsal" variant="ghost" size="lg">How to rehearse</ButtonLink>
        </div>
      </Section>
    </>
  );
}
