'use client';
import { MediaLibrary } from '@/components/media/media-library';

export function MatchMediaPanel({ matchId, tz }: { matchId: string; tz: string }) {
  return <MediaLibrary matchId={matchId} tz={tz} />;
}
