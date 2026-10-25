'use client';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from '@bs/ui';
import { ApiError, get } from './api';

export function useGet<T>(key: QueryKey, path: string | null, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useQuery<T, ApiError>({ queryKey: key, queryFn: () => get<T>(path!), enabled: !!path && opts.enabled !== false, refetchInterval: opts.refetchInterval });
}

/** Mutation with recoverable error state, cache invalidation and an optional success toast. */
export function useAction<TIn, TOut>(fn: (v: TIn) => Promise<TOut>, invalidate: QueryKey[] = [], opts: { success?: string | ((r: TOut, v: TIn) => string) } = {}) {
  const qc = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const m = useMutation<TOut, ApiError, TIn>({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      setDone(new Date().toISOString());
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(r, v) : opts.success);
    },
  });
  return { ...m, done, reset: () => { m.reset(); setDone(null); } };
}

/** Copies text to the clipboard and confirms it with a toast. */
export function useCopy() {
  return useCallback(async (text: string, what = 'Link') => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
      return true;
    } catch {
      toast(`Could not copy the ${what.toLowerCase()}. Select it and copy it by hand.`, 'error');
      return false;
    }
  }, []);
}

export function fmtDate(d: string | Date | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-AU', { timeZone: tz, ...opts }).format(new Date(d));
}
