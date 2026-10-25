'use client';
// A stream link's OBS page (see components/output/channel-output.tsx).
import { Suspense, use } from 'react';
import { ChannelOutput } from '@/components/output/channel-output';

export default function ChannelPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  return (
    <Suspense>
      <ChannelOutput publicId={publicId} />
    </Suspense>
  );
}
