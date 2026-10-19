'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { ErrorNotice, Spinner, StatusPill } from '@bs/ui';
import { ApiError, get } from '@/lib/api';
import { fmtDate } from '@/lib/hooks';
import { cacheList, getCachedList } from '@/lib/scorer-outbox';
import { useMe } from '@/lib/session';
import type { MatchRow } from '@/components/match-table';

export default function ScoreList() {
  const me = useMe();
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    get<MatchRow[]>('score/matches')
      .then(async (r) => { setRows(r); setCachedAt(null); await cacheList(r); })
      .catch(async (e: ApiError) => {
        const c = await getCachedList();
        if (c) { setRows(c.list as MatchRow[]); setCachedAt(c.at); } else setErr(e);
      });
  }, []);
  const tz = me.data?.activeOrganisation?.timezone ?? 'Australia/Brisbane';
  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-1 text-lg font-semibold">Your matches</h1>
      <p className="mb-4 text-sm text-muted">Only matches you are assigned to score are listed.{cachedAt ? ` Offline copy from ${new Date(cachedAt).toLocaleTimeString('en-AU')}.` : ''}</p>
      <ErrorNotice error={err} />
      {!rows && !err ? <Spinner /> : rows?.length === 0 ? <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">No matches assigned to you. Ask a producer to assign you.</p> : null}
      <ul className="grid gap-2">
        {rows?.map((m) => (
          <li key={m.id}>
            <Link href={`/score/${m.id}`} className="flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-border bg-panel p-3 active:bg-elevated">
              <div className="flex-1">
                <div className="font-medium">{m.home?.name} v {m.away?.name}</div>
                <div className="text-xs text-muted">{fmtDate(m.scheduledAt, tz)} · {m.competition.name}</div>
              </div>
              <StatusPill tone={m.status === 'live' ? 'live' : 'neutral'}>{m.status === 'live' ? `${m.score.home}–${m.score.away}` : m.status}</StatusPill>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
