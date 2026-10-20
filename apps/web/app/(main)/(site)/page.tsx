import Link from 'next/link';
import { ArrowRight, Clapperboard, MonitorPlay, Radio, Share2, Smartphone, Trophy, Users, Workflow } from 'lucide-react';
import { GraphicsSample } from '@/components/site/graphics-sample';
import { AvailabilityBadge, Badge, ButtonLink, Card, Container, Eyebrow, H1, H2, Lead, Rich, Section } from '@/components/site/ui';
import { VideoEmbed } from '@/components/site/video-embed';
import { PRICE_PLANS } from '@bs/domain';
import { CAPABILITIES, SPORTS, SPORT_STATUS_LABEL, VIDEOS } from '@/content/site';
import { FAQS } from '@/content/faq';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  description: 'Give every game a broadcast worth watching. MatchFrame brings live scoring, broadcast graphics, automation and sponsor placements into one matchday workflow.',
  path: '/',
});

const STAGES = [
  {
    icon: Trophy,
    title: 'Prepare the match',
    body: 'Set up the fixture, the teams and players, your look and colours, and any sponsor campaigns. Rehearse the automation against a made-up match.',
    who: 'You do this once, ahead of time.',
    href: '/docs/getting-started/first-match',
    link: 'First match guide',
  },
  {
    icon: Smartphone,
    title: 'Run the broadcast',
    body: 'The scorer taps the events on a phone. The scorebug, line-ups, goal graphics and half-time boards follow on their own, and the control room can take over at any moment.',
    who: 'A scorer, plus someone at the streaming computer.',
    href: '/docs/automation/football-flow',
    link: 'What runs on its own',
  },
  {
    icon: Share2,
    title: 'Share the moments',
    body: 'Export graphics as images for social posts. With cloud production, goal clips land in the media library while the match is still on, ready to trim and crop.',
    who: 'After the whistle, or during it.',
    href: '/features#highlights',
    link: 'Recording and highlights',
  },
];

const AUDIENCES = [
  { icon: Users, title: 'Clubs and volunteers', body: 'One scorer and one person at the streaming computer can run a broadcast that looks the part, with automation doing the routine graphics.' },
  { icon: Trophy, title: 'Competitions', body: 'Set a look and an automation plan once for a competition. Every fixture gets its own scorer link, graphics output and control room, and the producer board shows them together.' },
  { icon: Clapperboard, title: 'Production crews', body: 'Prepare graphics in a preview before they go to air, use keyboard shortcuts and Stream Deck buttons, and see who else is on the desk.' },
];

export default function Home() {
  const homeFaqs = FAQS.filter((f) => f.home);
  return (
    <>
      {/* hero */}
      <div className="relative overflow-hidden border-b border-white/5">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(0,210,255,0.16),transparent_55%),radial-gradient(ellipse_at_90%_20%,rgba(43,92,255,0.22),transparent_55%)]" />
        <Container className="relative grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <Eyebrow>Every game. Broadcast ready.</Eyebrow>
            <H1 className="mt-4">Give every game a broadcast worth watching.</H1>
            <Lead className="mt-5">Bring live scoring, on-screen graphics and sponsor placements into one matchday workflow. Prepare the game, run the broadcast from a phone and a laptop, and share the moments afterwards.</Lead>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/register">
                Get started <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="/how-it-works" variant="secondary">
                See how it works
              </ButtonLink>
            </div>
            <p className="mt-5 text-sm text-muted">The sample here is the real MatchFrame graphics engine, running in your browser with fictional teams. Press a button to send a graphic.</p>
          </div>
          <GraphicsSample />
        </Container>
      </div>

      {/* fit strip */}
      <div className="border-b border-white/5 bg-white/[0.02]">
        <Container className="grid gap-6 py-8 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Sports</p>
            <p className="mt-1.5 text-sm text-white">Football and basketball, tested end to end. Netball, rugby league, AFL and hockey in beta. <Link href="/sports" className="text-brand-cyan hover:underline">All sports</Link></p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Your setup</p>
            <p className="mt-1.5 text-sm text-white">Graphics over your camera in OBS, or cloud production from a camera feed with the media server. <Link href="/docs/production/choose-a-workflow" className="text-brand-cyan hover:underline">Compare</Link></p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Built for</p>
            <p className="mt-1.5 text-sm text-white">Community and semi-professional clubs, competitions and small production crews.</p>
          </div>
        </Container>
      </div>

      {/* workflow */}
      <Section>
        <Eyebrow>How it works</Eyebrow>
        <H2 className="mt-3">One matchday, three stages</H2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {STAGES.map((s, i) => (
            <Card key={s.title} className="flex flex-col">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-brand-blue/20 text-brand-cyan"><s.icon className="size-5" aria-hidden /></span>
                <span className="text-xs font-semibold text-muted">Stage {i + 1}</span>
              </div>
              <h3 className="mt-4 font-brand text-xl font-semibold text-white">{s.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{s.body}</p>
              <p className="mt-4 text-xs text-white/70">{s.who}</p>
              <Link href={s.href} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-white">
                {s.link} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Card>
          ))}
        </div>
      </Section>

      {/* capabilities */}
      <Section tone="panel">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>What it does</Eyebrow>
            <H2 className="mt-3">Everything the broadcast needs, connected</H2>
          </div>
          <ButtonLink href="/features" variant="ghost">
            All features <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <Card key={c.key} className="flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-brand text-lg font-semibold text-white">{c.name}</h3>
                <AvailabilityBadge value={c.hosted === 'no' ? c.media : c.hosted} />
              </div>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{c.benefit}</p>
              <p className="mt-3 text-xs text-white/60">{c.evidence}</p>
              <Link href={`/features#${c.key}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-white">
                More about {c.name.toLowerCase()} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Card>
          ))}
        </div>
      </Section>

      {/* video and showcase */}
      <Section>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>See it moving</Eyebrow>
            <H2 className="mt-3">Every graphic, in every look</H2>
            <Lead className="mt-4">Twenty-nine graphics in ten looks, in the styles of top-flight English, Spanish and German football, US network sport, North American streaming, an Australian league and European club nights, in widescreen, vertical and venue-screen layouts. The showcase draws each one live with the same engine that runs in OBS.</Lead>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/showcase">Open the showcase</ButtonLink>
            </div>
          </div>
          <VideoEmbed youtubeId={VIDEOS.graphics.youtubeId} title={VIDEOS.graphics.title} />
        </div>
      </Section>

      {/* setup */}
      <Section tone="panel">
        <Eyebrow>Setup</Eyebrow>
        <H2 className="mt-3">Works with the camera and computer you have</H2>
        <Lead className="mt-4">MatchFrame makes the graphics and keeps the match record; it does not film the game. Choose how the pictures and graphics come together.</Lead>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Card>
            <div className="flex items-center gap-3"><MonitorPlay className="size-5 text-brand-cyan" aria-hidden /><h3 className="font-brand text-lg font-semibold text-white">OBS on your computer</h3><Badge tone="available">Hosted edition</Badge></div>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li>Your camera into OBS Studio on a computer.</li>
              <li>The MatchFrame graphics link added as a transparent Browser Source.</li>
              <li>A phone for the scorer.</li>
              <li>OBS streams to YouTube, Facebook or another platform.</li>
            </ul>
            <Link href="/docs/graphics/first-output" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-white">Connect your graphics to OBS <ArrowRight className="size-3.5" aria-hidden /></Link>
          </Card>
          <Card>
            <div className="flex items-center gap-3"><Radio className="size-5 text-brand-cyan" aria-hidden /><h3 className="font-brand text-lg font-semibold text-white">Cloud production</h3><Badge tone="media-server">Needs the media server</Badge></div>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li>Your camera or encoder sends an RTMP feed to MatchFrame.</li>
              <li>Graphics are composited in the cloud, with a clean feed alongside.</li>
              <li>Up to three destinations per output, recorded, with automatic highlights.</li>
              <li>Runs on a self-hosted deployment with the media server.</li>
            </ul>
            <Link href="/docs/production/choose-a-workflow" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-white">Compare the workflows <ArrowRight className="size-3.5" aria-hidden /></Link>
          </Card>
        </div>
      </Section>

      {/* who it helps */}
      <Section>
        <Eyebrow>Who it helps</Eyebrow>
        <H2 className="mt-3">From the volunteer with a camera to the competition office</H2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <Card key={a.title}>
              <a.icon className="size-6 text-brand-cyan" aria-hidden />
              <h3 className="mt-3 font-brand text-lg font-semibold text-white">{a.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{a.body}</p>
            </Card>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          {SPORTS.map((s) => (
            <Link key={s.key} href={s.status === 'tested' ? `/sports/${s.key}` : '/sports'} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm text-white hover:border-brand-cyan">
              {s.name} <span className={`text-xs ${s.status === 'tested' ? 'text-healthy' : 'text-warning'}`}>{SPORT_STATUS_LABEL[s.status]}</span>
            </Link>
          ))}
        </div>
      </Section>

      {/* pricing preview */}
      <Section tone="panel">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Pricing</Eyebrow>
            <H2 className="mt-3">Plans from $29 a month</H2>
            <Lead className="mt-3">Every plan includes all supported sports, unlimited rehearsals and watermark-free graphics. Pay yearly and get two months free.</Lead>
          </div>
          <ButtonLink href="/pricing" variant="ghost">
            Compare plans <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRICE_PLANS.map((p) => (
            <Card key={p.key} className={p.popular ? 'border-brand-cyan' : ''}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-brand text-lg font-semibold text-white">{p.name}</h3>
                {p.popular ? <Badge tone="media-server">Most popular</Badge> : null}
              </div>
              <p className="mt-2 font-brand text-2xl font-bold text-white">{p.monthly != null ? `$${p.monthly}` : `From $${p.fromMonthly}`}<span className="text-sm font-normal text-muted">/month</span></p>
              <p className="mt-2 text-sm text-muted">{p.limits.liveMatches != null ? `${p.limits.liveMatches} simultaneous live ${p.limits.liveMatches === 1 ? 'match' : 'matches'}, ${p.limits.staffAccounts} staff accounts` : 'Allowances agreed in your quote'}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* questions */}
      <Section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Questions</Eyebrow>
            <H2 className="mt-3">Common questions</H2>
          </div>
          <ButtonLink href="/faq" variant="ghost">
            All questions <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {homeFaqs.map((f) => (
            <Card key={f.id}>
              <h3 className="font-semibold text-white">
                <Link href={`/faq#${f.id}`} className="hover:text-brand-cyan">{f.q}</Link>
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted"><Rich text={f.a[0]!} /></p>
            </Card>
          ))}
        </div>
      </Section>

      {/* final CTA */}
      <div className="border-t border-white/5 bg-[radial-gradient(ellipse_at_bottom,rgba(43,92,255,0.25),transparent_60%)]">
        <Container className="py-16 text-center sm:py-24">
          <Workflow className="mx-auto size-8 text-brand-cyan" aria-hidden />
          <H2 className="mt-4">Ready for your next match?</H2>
          <Lead className="mx-auto mt-4">Create an account, set up a fixture and rehearse it before match day.</Lead>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/register">Get started</ButtonLink>
            <ButtonLink href="/docs/getting-started/first-match" variant="secondary">Read the setup guide</ButtonLink>
          </div>
        </Container>
      </div>
    </>
  );
}
