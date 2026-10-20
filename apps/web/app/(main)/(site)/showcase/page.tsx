import { GraphicsShowcase } from '@/components/site/graphics-showcase';
import { ButtonLink, H2, Lead, PageIntro, Section } from '@/components/site/ui';
import { VideoEmbed } from '@/components/site/video-embed';
import { VIDEOS } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Graphics showcase',
  description: 'Every MatchFrame broadcast graphic in the Broadcast, Premier, Club and Minimal looks, in widescreen, vertical and venue-screen formats, drawn live with sample teams.',
  path: '/showcase',
});

export default function ShowcasePage() {
  return (
    <>
      <PageIntro eyebrow="Graphics showcase" title="Every graphic, in every look">
        <Lead>These are the real MatchFrame graphics, drawn live in your browser by the same engine that runs in OBS, with fictional teams and players. Choose a sport, a look and a format, then pick a graphic to play its entrance.</Lead>
      </PageIntro>
      <Section>
        <GraphicsShowcase />
      </Section>
      <Section tone="panel">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <H2>Watch the graphics in action</H2>
            <Lead className="mt-4">Your own colours, logo and team colours go on any of the ten looks, and the same graphics work in a 9:16 vertical stream and on a venue screen.</Lead>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/register">Get started</ButtonLink>
              <ButtonLink href="/docs/graphics/themes-and-branding" variant="secondary">Looks and branding</ButtonLink>
            </div>
          </div>
          <VideoEmbed youtubeId={VIDEOS.graphics.youtubeId} title={VIDEOS.graphics.title} />
        </div>
      </Section>
    </>
  );
}
