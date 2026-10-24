import { GraphicsShowcase } from '@/components/site/graphics-showcase';
import { ButtonLink, Container, Eyebrow, H2, Lead, Section } from '@/components/site/ui';
import { LooksReel } from '@/components/site/looks-reel';
import { GRAPHIC_COUNT, LOOK_COUNT, VIDEOS, countWord } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Live demo: graphics showcase',
  description: `Try MatchFrame's ${GRAPHIC_COUNT} broadcast graphics in all ${LOOK_COUNT} looks, in widescreen, vertical and venue-screen formats, drawn live in your browser with fictional teams.`,
  path: '/showcase',
});

export default function ShowcasePage() {
  return (
    <>
      <Container className="pb-12 pt-10 sm:pb-16 sm:pt-12">
        <Eyebrow>Live demo</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-brand text-[34px] font-bold leading-[1.08] tracking-[-0.02em] text-text sm:text-5xl">Every graphic, in every look</h1>
        <p className="mt-3 max-w-2xl text-muted sm:text-lg">The real MatchFrame graphics engine, running in your browser with fictional teams. Choose a sport, a look and a format, then pick a graphic to play it.</p>
        <div className="mt-8">
          <GraphicsShowcase />
        </div>
      </Container>
      <Section tone="raised" labelledBy="reel-heading">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <div>
            <H2 id="reel-heading">Watch the graphics in action</H2>
            <Lead className="mt-4">Your own colours, logo and team colours go on any of the {countWord(LOOK_COUNT)} looks, and the same graphics work in a 9:16 vertical stream and on a venue screen.</Lead>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/register">Get started</ButtonLink>
              <ButtonLink href="/docs/graphics/themes-and-branding" variant="secondary">Looks and branding</ButtonLink>
            </div>
          </div>
          <LooksReel {...VIDEOS.looks} />
        </div>
      </Section>
    </>
  );
}
