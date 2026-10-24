'use client';
import { PageHeader } from '@bs/ui';
import { useMe } from '@/lib/session';
import { MediaLibrary } from '@/components/media/media-library';

export default function MediaPage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Media" subtitle="Recordings, automatic highlights, edited exports and share links." />
      <MediaLibrary tz={me.data?.activeOrganisation?.timezone ?? 'UTC'} />
    </>
  );
}
