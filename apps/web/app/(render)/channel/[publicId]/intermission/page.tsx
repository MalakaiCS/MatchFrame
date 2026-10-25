'use client';
// A stream link's intermission link: its own OBS browser source, for a scene to transition to between matches. It
// always shows the intermission screen (the next match with its countdown, then today's results, live scores and
// kick-off times) in the next match's look, moving on to the following match by itself.
import { Suspense, use } from 'react';
import { ChannelOutput } from '@/components/output/channel-output';

export default function IntermissionPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  return (
    <Suspense>
      <ChannelOutput publicId={publicId} intermission />
    </Suspense>
  );
}
