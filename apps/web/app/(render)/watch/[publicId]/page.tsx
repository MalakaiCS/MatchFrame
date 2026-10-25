'use client';
import { use } from 'react';
import { SharedPlayer } from '@/components/share/shared-player';

export default function WatchPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  return <SharedPlayer publicId={publicId} />;
}
