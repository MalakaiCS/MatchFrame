'use client';
import Link from 'next/link';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { LineupEditor } from '@/components/lineup-editor';
import { useGet } from '@/lib/hooks';
import { scorerAccess } from '@/lib/scorer-access';
import { isFull, useMe } from '@/lib/session';

/** Line-ups from the scorer's phone: who starts and who is on the bench, filled from the roster or a saved line-up. */
export default function ScorerLineupPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const me = useMe();
  const router = useRouter();
  const m = useGet<{ id: string; competition: { id: string; name: string } }>(['match', matchId], `matches/${matchId}`);
  const access = scorerAccess(me.data, m.data);
  return (
    <div className="mx-auto max-w-3xl p-3">
      <Link href={`/score/${matchId}`} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Back to scoring
      </Link>
      <h1 className="mb-1 text-lg font-semibold">Line-ups</h1>
      <p className="mb-3 text-sm text-muted">Tap Start or Bench for each player. Goals, cards and substitutions can then name the player, and the line-up graphics are ready before the start.</p>
      <LineupEditor matchId={matchId} canEdit={access === 'score'} canSaveDefault={isFull(me.data?.role)} compact onSaved={() => router.push(`/score/${matchId}`)} />
    </div>
  );
}
