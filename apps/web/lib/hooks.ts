'use client';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, get } from './api';

export function useGet<T>(key: QueryKey, path: string | null, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useQuery<T, ApiError>({ queryKey: key, queryFn: () => get<T>(path!), enabled: !!path && opts.enabled !== false, refetchInterval: opts.refetchInterval });
}

/** Mutation with recoverable error state and cache invalidation. */
export function useAction<TIn, TOut>(fn: (v: TIn) => Promise<TOut>, invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const m = useMutation<TOut, ApiError, TIn>({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      setDone(new Date().toISOString());
    },
  });
  return { ...m, done, reset: () => { m.reset(); setDone(null); } };
}

export function fmtDate(d: string | Date | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-AU', { timeZone: tz, ...opts }).format(new Date(d));
}
