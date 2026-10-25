'use client';
import { use } from 'react';
import { SharedPlayer } from '@/components/share/shared-player';

export default function EmbedPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  return <SharedPlayer publicId={publicId} embed />;
}
