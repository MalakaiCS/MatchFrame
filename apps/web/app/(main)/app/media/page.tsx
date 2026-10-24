'use client';
import { PageHeader } from '@bs/ui';
import { streamingOn, useMe } from '@/lib/session';
import { MediaLibrary } from '@/components/media/media-library';

export default function MediaPage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Videos" subtitle={streamingOn(me.data) ? 'Recordings, automatic clips, highlights and other exports, and their share links.' : 'Highlights packages and other exports, and their share links. Make highlights on a match’s Media tab.'} />
      <MediaLibrary tz={me.data?.activeOrganisation?.timezone ?? 'UTC'} streaming={streamingOn(me.data)} />
    </>
  );
}
