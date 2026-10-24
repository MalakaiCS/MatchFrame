import Link from 'next/link';
import { ArrowRight, Check, Clapperboard, MonitorPlay, Palette, Smartphone, Trophy, Users } from 'lucide-react';
import { PRICE_PLANS } from '@bs/domain';
import { GraphicsSample } from '@/components/site/graphics-sample';
import { PhoneFrame, SHOTS, ShotFrame } from '@/components/site/shots';
import { ArrowLink, Badge, ButtonLink, Container, Eyebrow, H1, H3, Rich, Section, SectionHeading } from '@/components/site/ui';
import { FAQS } from '@/content/faq';
import { LOOK_COUNT, SPORTS, SPORT_STATUS_LABEL, SPORT_STATUS_TONE, countWord } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  description: 'Professional sports graphics, built for your matchday. Live scoring from a phone, branded broadcast graphics in OBS, automation and sponsor placements for clubs, competitions and small production teams.',
  path: '/',
});

const FIT = [
  { icon: MonitorPlay, title: 'Works with OBS', body: 'Add one link to OBS Studio as a Browser Source. The graphics arrive on a transparent background over your camera.' },
  { icon: Smartphone, title: 'Score from your phone', body: 'The scorer app runs in a phone browser and keeps working through a dropped connection.' },
  { icon: Palette, title: "Your club's colours", body: `${countWord(LOOK_COUNT, true)} broadcast looks, retinted with your logo, colours and each team's colours.` },
];

const STEPS = [
  { title: 'Prepare your match', body: 'Set up the teams, line-ups, look and sponsors. Rehearse it against a made-up match before the day.', shot: SHOTS.prepare, link: { href: '/docs/getting-started/first-match', label: 'First match guide' } },
  { title: 'Score as it happens', body: 'Record goals, cards and substitutions from a phone or tablet. The score and clock update everywhere at once.', shot: SHOTS.scorer, link: { href: '/docs/scoring/corrections', label: 'Scoring and corrections' } },
  { title: 'Put the graphics on air', body: 'Bring the output into OBS and stream as usual. Graphics follow the scorer, and you can take over at any time.', shot: SHOTS.goalDetail, link: { href: '/docs/graphics/first-output', label: 'Connect your graphics to OBS' } },
];

const GALLERY = [
  { shot: SHOTS.bugDetail, title: 'Scorebug', body: 'Score, clock and added time, always up. Close-up of the top corner.' },
  { shot: SHOTS.lineup, title: 'Line-ups', body: 'Both teams as the players walk out.' },
  { shot: SHOTS.goalDetail, title: 'Goals and cards', body: 'The moment, the player and the minute, inside the scorebug. Close-up.' },
  { shot: SHOTS.stats, title: 'Match statistics', body: 'At half time and full time, from the scorer’s record.' },
];

const TOOLS = [
  ['Keep the score current', 'One tap on the scorer’s phone updates the scorebug, the boards and the match record.'],
  ['Prepare a graphic', 'Fill in a caption or pick a player in the preview before anyone sees it.'],
  ['Send it to air', 'Press To air, or let automation do the routine graphics as the match unfolds.'],
  ['Correct an event', 'Undo straight away, or fix a scorer or minute later; graphics and statistics follow.'],
  ['Take manual control', 'Switch an output to Manual, or hold Emergency clear to take everything off at once.'],
];

const AUDIENCES = [
  { icon: Users, title: 'Clubs and volunteers', body: 'One scorer and one person at the streaming computer can run a broadcast that looks the part.', href: '/docs/getting-started/first-match', link: 'Set up your first match' },
  { icon: Trophy, title: 'Competitions', body: 'Set a look and an automation plan once; every fixture gets its own scorer link, output and control room.', href: '/features#automation', link: 'Competition-wide setup' },
  { icon: Clapperboard, title: 'Production crews', body: 'Preview before air, keyboard shortcuts, Stream Deck buttons, and a producer board for every live match.', href: '/how-it-works', link: 'How a matchday runs' },
];

/** A sample delivery report (fictional sponsors): what the real report lists, in seconds on air. */
const REPORT = [
  ['Bayside Bakery', 'Scorebug logo', '4,212', '3'],
  ['Northgate Physio', 'Goal partner', '96', '3'],
  ['Harbour Motors', 'Half-time board', '540', '3'],
];

const HOME_FAQ = ['what-is-matchframe', 'equipment', 'which-sports', 'offline', 'cost'];
const money = (n: number) => `$${n.toLocaleString('en-AU')}`;

export default function Home() {
  const faqs = HOME_FAQ.map((id) => FAQS.find((f) => f.id === id)).filter((f): f is (typeof FAQS)[number] => !!f);
  return (
    <>
      {/* 1. hero */}
      <div className="relative overflow-hidden border-b border-border">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_70%_at_75%_10%,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_70%),radial-gradient(40%_60%_at_0%_100%,color-mix(in_oklab,#2b5cff_14%,transparent),transparent_70%)]" />
        <Container className="relative grid grid-cols-1 items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-14 lg:py-20">
          <div>
            <Eyebrow>Every game. Broadcast ready.</Eyebrow>
            <H1 className="mt-4 max-w-xl">Professional sports graphics. Built for your matchday.</H1>
            <p className="mt-5 max-w-lg text-base leading-[1.65] text-muted sm:text-lg">Bring live scoring, branded graphics and sponsor placements into one connected matchday workflow. Built for clubs, competitions and small production teams.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/register" size="lg">
                Get started <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="/showcase" variant="secondary" size="lg">
                Try the live demo
              </ButtonLink>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {['Works with OBS', 'Score from your phone', "Use your club's colours"].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <Check className="size-4 text-primary" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
          <GraphicsSample />
        </Container>
      </div>

      {/* 2. practical fit */}
      <div className="border-b border-border bg-panel/60">
        <Container className="grid grid-cols-1 gap-6 py-8 sm:grid-cols-3 sm:py-10">
          {FIT.map((f) => (
            <div key={f.title} className="flex gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><f.icon className="size-5" aria-hidden /></span>
              <div>
                <p className="font-semibold text-text">{f.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            </div>
          ))}
        </Container>
      </div>

      {/* 3. three-step workflow */}
      <Section labelledBy="how-heading">
        <SectionHeading eyebrow="How it works" title="From fixture to on air in three steps" id="how-heading" action={<ArrowLink href="/how-it-works">The full workflow</ArrowLink>} />
        <ol className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-card">
              <div className={`relative grid aspect-[4/3] place-items-center overflow-hidden border-b border-border ${i === 1 ? 'bg-[radial-gradient(circle_at_50%_30%,color-mix(in_oklab,var(--color-primary)_22%,transparent),transparent_70%)] bg-elevated' : 'bg-[#0b1220]'}`}>
                {i === 1 ? (
                  <PhoneFrame shot={s.shot} className="mt-10 w-[46%]" />
                ) : (
                  <img src={s.shot.src} alt={s.shot.alt} width={s.shot.w} height={s.shot.h} loading="lazy" decoding="async" className={`h-full w-full ${i === 0 ? 'object-cover object-left-top' : 'object-cover'}`} />
                )}
              </div>
              <div className="flex flex-1 flex-col p-6">
                <span className="font-brand text-sm font-bold text-primary">Step {i + 1}</span>
                <H3 className="mt-1.5">{s.title}</H3>
                <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
                <ArrowLink href={s.link.href} className="mt-3 self-start">{s.link.label}</ArrowLink>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* 4. graphics gallery */}
      <Section tone="raised" labelledBy="gallery-heading">
        <SectionHeading eyebrow="Graphics" title="Graphics that look the part" id="gallery-heading" action={<ButtonLink href="/showcase" variant="secondary">Open the live showcase</ButtonLink>}>
          <p>Drawn by the same engine that runs in OBS, in widescreen, vertical 9:16 and venue-screen layouts. Shown here in the Derby look with fictional teams.</p>
        </SectionHeading>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          {GALLERY.map((g) => (
            <figure key={g.title}>
              <div className="overflow-hidden rounded-2xl border border-border bg-[#0b1220] shadow-card">
                <img src={g.shot.src} alt={g.shot.alt} width={g.shot.w} height={g.shot.h} loading="lazy" decoding="async" className="block h-auto w-full" />
              </div>
              <figcaption className="mt-3">
                <span className="font-semibold text-text">{g.title}.</span> <span className="text-muted">{g.body}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      {/* 5. matchday tools */}
      <Section labelledBy="tools-heading">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <SectionHeading eyebrow="Matchday tools" title="The scorer’s phone and the control room, connected" id="tools-heading">
              <p>Every tap on the phone reaches the control room and the graphics within a second. Automation handles the routine; people stay in charge.</p>
            </SectionHeading>
            <ul className="mt-8 space-y-4">
              {TOOLS.map(([t, b]) => (
                <li key={t} className="flex gap-3">
                  <Check className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
                  <span><span className="font-semibold text-text">{t}.</span> <span className="text-muted">{b}</span></span>
                </li>
              ))}
            </ul>
            <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted">
              <Badge tone="neutral">Plan</Badge> Automation is on the Club plan and above; Starter has manual controls.
            </p>
          </div>
          <div className="relative pb-10 sm:pb-0">
            <ShotFrame shot={SHOTS.control} chrome sizes="(min-width: 1024px) 60vw, 100vw" />
            <PhoneFrame shot={SHOTS.scorer} className="absolute -bottom-2 left-3 w-[24%] min-w-[96px] sm:-bottom-8 sm:-left-6" />
          </div>
        </div>
      </Section>

      {/* 6. sponsors */}
      <Section tone="raised" labelledBy="sponsors-heading">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <div className="overflow-hidden rounded-2xl border border-border bg-[#0b1220] shadow-pop">
              <img src={SHOTS.sponsor.src} alt={SHOTS.sponsor.alt} width={SHOTS.sponsor.w} height={SHOTS.sponsor.h} loading="lazy" decoding="async" className="block h-auto w-full" />
            </div>
            <div className="relative z-10 -mt-10 ml-auto w-[88%] rounded-2xl border border-border bg-panel p-5 shadow-pop sm:w-[78%]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-text">Delivery report</p>
                <Badge tone="neutral">Sample · fictional sponsors</Badge>
              </div>
              <table className="mt-3 w-full text-left text-sm">
                <caption className="sr-only">Sample sponsor delivery report: seconds on air per placement</caption>
                <thead className="text-xs text-muted"><tr><th scope="col" className="py-1.5 font-medium">Sponsor</th><th scope="col" className="py-1.5 font-medium">Placement</th><th scope="col" className="py-1.5 text-right font-medium">Seconds on air</th><th scope="col" className="hidden py-1.5 text-right font-medium sm:table-cell">Matches</th></tr></thead>
                <tbody>
                  {REPORT.map((r) => (
                    <tr key={r[0]} className="border-t border-border">
                      <th scope="row" className="py-2 font-medium text-text">{r[0]}</th>
                      <td className="py-2 text-muted">{r[1]}</td>
                      <td className="py-2 text-right tabular-nums text-text">{r[2]}</td>
                      <td className="hidden py-2 text-right tabular-nums text-muted sm:table-cell">{r[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <SectionHeading eyebrow="Sponsors" title="Give sponsors a place in the action." id="sponsors-heading">
              <p>Put your partners into scoreboards, event graphics and scheduled placements, with reports showing what appeared on air.</p>
            </SectionHeading>
            <ul className="mt-6 space-y-3 text-[15px] text-muted">
              <li className="flex gap-3"><Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /><span><span className="font-semibold text-text">Starter:</span> one static sponsor placement.</span></li>
              <li className="flex gap-3"><Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /><span><span className="font-semibold text-text">Club and above:</span> several placements with automatic rotation, and delivery reports you can export for partners.</span></li>
            </ul>
            <p className="mt-5 text-sm text-muted">Reports count confirmed seconds on air per output. They are not audience numbers or impressions.</p>
            <ArrowLink href="/features#sponsors" className="mt-2">Sponsors and reports</ArrowLink>
          </div>
        </div>
      </Section>

      {/* 7. sports and audiences */}
      <Section labelledBy="sports-heading">
        <SectionHeading eyebrow="Sports" title="Seven sports, one workflow" id="sports-heading" action={<ArrowLink href="/sports">All sports</ArrowLink>}>
          <p>Football and basketball have been played end to end. The others are in beta: built and checked, worth a rehearsal before you rely on them.</p>
        </SectionHeading>
        <ul className="mt-8 flex flex-wrap gap-2.5">
          {SPORTS.map((s) => (
            <li key={s.key}>
              <Link href={s.detail ? `/sports/${s.key}` : '/sports'} className="inline-flex min-h-11 items-center gap-2.5 rounded-xl border border-border bg-panel px-4 text-sm font-semibold text-text shadow-card transition hover:border-primary">
                {s.name} <Badge tone={SPORT_STATUS_TONE[s.status]}>{SPORT_STATUS_LABEL[s.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <div key={a.title} className="rounded-2xl border border-border p-6">
              <a.icon className="size-6 text-primary" aria-hidden />
              <H3 className="mt-4">{a.title}</H3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{a.body}</p>
              <ArrowLink href={a.href} className="mt-2">{a.link}</ArrowLink>
            </div>
          ))}
        </div>
      </Section>

      {/* 8. pricing preview */}
      <Section tone="raised" labelledBy="pricing-heading">
        <SectionHeading eyebrow="Pricing" title="Plans for every kind of broadcast" id="pricing-heading" action={<ButtonLink href="/pricing" variant="secondary">Compare plans</ButtonLink>}>
          <p>Every plan includes all supported sports, unlimited rehearsals and watermark-free graphics. Pay yearly for two months free.</p>
        </SectionHeading>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRICE_PLANS.map((p) => (
            <div key={p.key} className={`flex flex-col rounded-2xl border bg-panel p-6 shadow-card ${p.popular ? 'border-primary ring-1 ring-primary' : 'border-border'}`}>
              <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
                <h3 className="font-brand text-xl font-bold text-text">{p.name}</h3>
                {p.popular ? <Badge tone="accent">Recommended for clubs</Badge> : null}
              </div>
              <p className="mt-3 font-brand text-3xl font-bold text-text">
                {p.monthly != null ? money(p.monthly) : <><span className="text-base font-medium text-muted">From </span>{money(p.fromMonthly ?? 0)}</>}
                <span className="text-sm font-normal text-muted"> /month</span>
              </p>
              <p className="mt-2 flex-1 text-sm text-muted">{p.limits.liveMatches != null ? `${p.limits.liveMatches} live ${p.limits.liveMatches === 1 ? 'match' : 'matches'} at once · ${p.limits.staffAccounts} staff accounts` : 'Allowances agreed in your quote'}</p>
              <ButtonLink href={p.selfServe ? `/register?plan=${p.key}` : '/contact?topic=sales&plan=league'} variant={p.popular ? 'primary' : 'secondary'} className="mt-5 w-full">
                {p.selfServe ? 'Get started' : 'Talk to us'}
              </ButtonLink>
            </div>
          ))}
        </div>
      </Section>

      {/* 9. short FAQ and final action */}
      <Section labelledBy="faq-heading">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <SectionHeading eyebrow="Questions" title="Common questions" id="faq-heading" />
            <p className="mt-4 text-muted">Equipment, sports, connectivity and pricing, answered plainly.</p>
            <ArrowLink href="/faq" className="mt-3">All {FAQS.length} questions</ArrowLink>
          </div>
          <div className="divide-y divide-border rounded-2xl border border-border bg-panel shadow-card">
            {faqs.map((f) => (
              <details key={f.id} className="group px-5 sm:px-6">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-text marker:hidden">
                  {f.q}
                  <span aria-hidden className="text-xl leading-none text-primary transition group-open:rotate-45">+</span>
                </summary>
                <div className="space-y-3 pb-5 text-[15px] leading-relaxed text-muted">
                  {f.a.slice(0, 2).map((p, i) => <p key={i}><Rich text={p} /></p>)}
                </div>
              </details>
            ))}
          </div>
        </div>
      </Section>

      <div className="relative overflow-hidden border-t border-border">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_90%_at_50%_100%,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_70%)]" />
        <Container className="relative py-16 text-center sm:py-24">
          <h2 className="mx-auto max-w-2xl font-brand text-[30px] font-bold leading-tight tracking-tight text-text sm:text-5xl">Ready for your next match?</h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted sm:text-lg">Create an account, set up a fixture and rehearse it before match day. Or tell us about your competition.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/register" size="lg">Get started <ArrowRight className="size-4" aria-hidden /></ButtonLink>
            <ButtonLink href="/contact?topic=sales" variant="secondary" size="lg">Talk to us</ButtonLink>
          </div>
        </Container>
      </div>
    </>
  );
}
