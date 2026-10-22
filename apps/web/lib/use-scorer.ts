'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyEvent, clockDisplayMs, getAdapter, type ClockState, type LineupSnapshot, type MatchProjection } from '@bs/domain';
import { ApiError, api, get, post, uuid } from './api';
import { serverNow, useConnectionStatus, useRealtime } from './realtime';
import { cacheMatch, deleteIntent, deviceId as getDeviceId, getCachedMatch, getIntents, putIntent, type Intent } from './scorer-outbox';
import { scorerAccess, type ScorerAccess } from './scorer-access';
import type { Me } from './session';

export interface ScorerMatch {
  id: string;
  sport: string;
  status: string;
  rulesConfig: Record<string, unknown>;
  teams: { home: { id: string; name: string; shortName: string; abbreviation: string; primaryColor: string }; away: { id: string; name: string; shortName: string; abbreviation: string; primaryColor: string } };
  lineup: LineupSnapshot;
  lineupLocked: boolean;
  scheduledAt: string;
  competition: { id: string; name: string };
}
export interface ServerState {
  stateVersion: number;
  sequence: number;
  phase: string;
  projection: MatchProjection;
  clocks: Record<string, ClockState>;
}
export interface Lease {
  holderUserId: string | null;
  holderName: string | null;
  holderDeviceId: string | null;
  leaseVersion: number;
  expiresAt: string | null;
  takenOverFrom: string | null;
}

const SINGLE_TAB_KEY = 'bs-scorer-tab';

async function tabDeviceId() {
  const base = await getDeviceId();
  let tab = sessionStorage.getItem(SINGLE_TAB_KEY);
  if (!tab) {
    tab = crypto.randomUUID().slice(0, 8);
    sessionStorage.setItem(SINGLE_TAB_KEY, tab);
  }
  return `${base}:${tab}`;
}

export function useScorer(matchId: string, me: Me | null | undefined, opts: { lowData?: boolean } = {}) {
  const userId = me?.user.id;
  const conn = useConnectionStatus();
  const [match, setMatch] = useState<ScorerMatch | null>(null);
  const [state, setState] = useState<ServerState | null>(null);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [lease, setLease] = useState<Lease | null>(null);
  const [leaseProblem, setLeaseProblem] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [netOk, setNetOk] = useState(true);
  const [accepted, setAccepted] = useState<Record<string, string>>({});
  const device = useRef<string>('');
  const stateRef = useRef<ServerState | null>(null);
  const leaseRef = useRef<Lease | null>(null);
  const flushing = useRef(false);
  /** true only when the current state came from the server in this session (never from the offline cache) */
  const freshState = useRef(false);
  const matchRef = useRef<ScorerMatch | null>(null);
  const meRef = useRef(me);
  stateRef.current = state;
  leaseRef.current = lease;
  meRef.current = me;
  /** what this person may do here: full scoring (needs the lease), statistics only, or follow along */
  const access: ScorerAccess = scorerAccess(me, match);
  const accessNow = () => scorerAccess(meRef.current, matchRef.current);

  // reachability decides whether actions can be sent; live updates come over the socket or, failing that, by polling
  const online = netOk && (typeof navigator === 'undefined' || navigator.onLine);
  const transport: 'live' | 'polling' | 'offline' = !online ? 'offline' : conn === 'connected' ? 'live' : 'polling';
  const holding = !!lease && lease.holderUserId === userId && lease.holderDeviceId === device.current && !!lease.expiresAt && new Date(lease.expiresAt).getTime() > Date.now();

  const reloadIntents = useCallback(async () => setIntents(await getIntents(matchId)), [matchId]);

  const applyServerState = useCallback((s: ServerState) => {
    // never let an older snapshot overwrite newer state
    if (stateRef.current && s.stateVersion < stateRef.current.stateVersion) return;
    stateRef.current = s;
    setState(s);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([get<ScorerMatch & { lease: Lease }>(`matches/${matchId}`), get<ServerState>(`matches/${matchId}/state`)]);
      setMatch(d);
      matchRef.current = d;
      applyServerState({ stateVersion: s.stateVersion, sequence: s.sequence, phase: s.phase, projection: s.projection, clocks: s.clocks });
      setLease((cur) => cur ?? d.lease);
      setFromCache(false);
      freshState.current = true;
      setNetOk(true);
      await cacheMatch({ matchId, detail: d, state: s, cachedAt: Date.now() });
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 0) {
        setNetOk(false);
        freshState.current = false;
        const c = await getCachedMatch(matchId);
        if (c) {
          setMatch(c.detail as ScorerMatch);
          matchRef.current = c.detail as ScorerMatch;
          applyServerState(c.state as ServerState);
          setFromCache(true);
        } else setLoadError(ae);
      } else setLoadError(ae);
    }
  }, [matchId, applyServerState]);

  const acquire = useCallback(async () => {
    try {
      const l = await post<Lease>(`matches/${matchId}/scorer-lease`, { action: 'acquire', deviceId: device.current });
      setLease(l);
      setLeaseProblem(null);
      return l;
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 0) setNetOk(false);
      else {
        setLeaseProblem(ae.code === 'LEASE_HELD_BY_OTHER' ? `${(ae.extra.lease as Lease | undefined)?.holderName ?? 'Another scorer'} currently controls this match` : ae.message);
        if (ae.extra.lease) setLease(ae.extra.lease as Lease);
      }
      return null;
    }
  }, [matchId]);

  // ------------------------------------------------ outbox flush (serial, one in flight)
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (;;) {
        const list = await getIntents(matchId);
        const next = list.find((i) => i.status === 'queued' && !i.offline);
        if (!next) break;
        let l = leaseRef.current;
        const mine = l && l.holderUserId === userId && l.holderDeviceId === device.current && l.expiresAt && new Date(l.expiresAt).getTime() > Date.now();
        if (!mine) {
          if (accessNow() === 'score') {
            l = await acquire();
            if (!l) break;
          } else l = null; // statistics-only scorers send without a lease; the server checks the event group
        }
        const st = stateRef.current;
        if (!st) break;
        await putIntent({ ...next, status: 'sending', attempts: next.attempts + 1 });
        try {
          const r = await api<{ state: ServerState; event: { eventId: string } }>(`/api/v1/matches/${matchId}/commands`, {
            method: 'POST',
            json: { commandId: next.commandId, expectedStateVersion: st.stateVersion, scorerLeaseVersion: l?.leaseVersion, deviceId: device.current, type: next.type, payload: next.payload, offline: next.offline ? { queuedAt: next.createdAt, reviewed: true } : undefined },
          });
          applyServerState(r.state);
          setAccepted((a) => ({ ...a, [next.commandId]: r.event.eventId }));
          await deleteIntent(next.commandId);
          setNetOk(true);
          // the match's rules changed (knockout on or off): fetch them again
          if (next.type === 'SET_KNOCKOUT') void loadAll();
        } catch (e) {
          const ae = e as ApiError;
          if (ae.status === 0) {
            setNetOk(false);
            // connection dropped mid-send: keep it queued; it is reconciled like any offline intent
            await putIntent({ ...next, status: 'queued', offline: true, attempts: next.attempts + 1 });
            break;
          }
          if (ae.code === 'STATE_VERSION_CONFLICT') {
            const s = await get<ServerState>(`matches/${matchId}/state`).catch(() => null);
            if (s) applyServerState(s);
            // Facts made against the live view are independent and may be rebased automatically once;
            // offline intents and clock/phase/score changes need the scorer's explicit review.
            const autoRebase = !next.offline && next.type === 'ADD_FACT' && next.attempts < 2;
            await putIntent({ ...next, status: autoRebase ? 'queued' : 'needs_review', error: autoRebase ? null : { code: ae.code, message: 'The match changed while this was pending. Review before applying.' }, attempts: next.attempts + 1 });
            if (!autoRebase) break;
            continue;
          }
          if (ae.code.startsWith('LEASE_')) {
            setLease((ae.extra.lease as Lease | undefined) ?? null);
            await putIntent({ ...next, status: 'queued' });
            const again = ae.code === 'LEASE_HELD_BY_OTHER' ? null : await acquire();
            if (!again) {
              setLeaseProblem(ae.code === 'LEASE_HELD_BY_OTHER' ? 'Scoring control was taken over. Your pending actions were kept and not applied.' : ae.message);
              break;
            }
            continue;
          }
          await putIntent({ ...next, status: 'rejected', error: { code: ae.code, message: ae.message } });
        }
      }
    } finally {
      flushing.current = false;
      await reloadIntents();
    }
  }, [matchId, userId, acquire, applyServerState, reloadIntents, loadAll]);

  /**
   * Offline chain reconciliation: if nobody changed the match while we were offline (server version equals the
   * version the first offline intent was based on), the chain applies in order. Otherwise every offline intent
   * needs the scorer's review — a stale local view is never pushed over newer server state.
   */
  const reconcileOffline = useCallback(async () => {
    // only authoritative server state may decide that nothing changed while we were offline
    if (!freshState.current) return;
    const pending = (await getIntents(matchId)).filter((i) => i.offline && i.status === 'queued');
    if (!pending.length) return;
    const current = stateRef.current?.stateVersion;
    const untouched = current !== undefined && pending[0]!.basedOnVersion === current;
    for (const i of pending) {
      if (untouched) await putIntent({ ...i, offline: false });
      else await putIntent({ ...i, status: 'needs_review', error: { code: 'OFFLINE', message: 'Recorded while offline and the match has changed since. Review before applying.' } });
    }
    await reloadIntents();
  }, [matchId, reloadIntents]);

  // ------------------------------------------------ lifecycle
  useEffect(() => {
    let alive = true;
    void (async () => {
      device.current = await tabDeviceId();
      await reloadIntents();
      await loadAll();
      await reconcileOffline();
      if (alive && navigator.onLine && accessNow() === 'score') await acquire();
      if (alive) void flush();
    })();
    return () => {
      alive = false;
    };
  }, [loadAll, acquire, flush, reloadIntents, reconcileOffline]);

  // renew lease while held
  useEffect(() => {
    if (!holding) return;
    const t = setInterval(async () => {
      try {
        const l = await post<Lease>(`matches/${matchId}/scorer-lease`, { action: 'renew', deviceId: device.current, leaseVersion: leaseRef.current?.leaseVersion });
        setLease(l);
      } catch (e) {
        const ae = e as ApiError;
        if (ae.status === 0) setNetOk(false);
        else {
          setLease((ae.extra.lease as Lease | undefined) ?? null);
          setLeaseProblem(ae.code === 'LEASE_LOST' ? 'Scoring control moved to another device or a producer.' : ae.message);
        }
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [holding, matchId]);

  // reconnect: authoritative state first, then reconcile authority and pending intents
  useEffect(() => {
    if (conn !== 'connected') return;
    void (async () => {
      await loadAll();
      await reconcileOffline();
      void flush();
    })();
  }, [conn, loadAll, flush, reconcileOffline]);

  // periodic retry for network failures and a safety refresh
  useEffect(() => {
    // every recovery path re-checks the offline chain against fresh server state before sending anything
    const recover = () => void loadAll().then(() => reconcileOffline()).then(() => flush());
    const t = setInterval(() => {
      if (!netOk) recover();
    }, 4000);
    const on = recover;
    // an established WebSocket can outlive a network drop: trust the browser's offline signal immediately
    const off = () => setNetOk(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [netOk, loadAll, flush, reconcileOffline]);

  // no socket (low-data mode, a blocked WebSocket, or while reconnecting): poll the state instead
  useEffect(() => {
    if (conn === 'connected' || !netOk) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    let n = 0;
    const every = opts.lowData ? 10_000 : 4_000;
    const t = setInterval(async () => {
      n++;
      try {
        if (n % 8 === 0) await loadAll();
        else {
          const st = await get<ServerState>(`matches/${matchId}/state`);
          applyServerState({ stateVersion: st.stateVersion, sequence: st.sequence, phase: st.phase, projection: st.projection, clocks: st.clocks });
          setNetOk(true);
        }
        void flush();
      } catch (e) {
        if ((e as ApiError).status === 0) setNetOk(false);
      }
    }, every);
    return () => clearInterval(t);
  }, [conn, netOk, opts.lowData, matchId, loadAll, applyServerState, flush]);

  useRealtime('match', matchId, (e) => {
    const p = e.payload as Record<string, unknown>;
    if (e.topic === 'match.state.updated') {
      applyServerState({ stateVersion: p.stateVersion as number, sequence: p.sequence as number, phase: p.phase as string, projection: p.projection as MatchProjection, clocks: p.clocks as Record<string, ClockState> });
      if (p.rulesChanged) void loadAll();
    }
    if (e.topic === 'scorer.lease.changed') {
      const l = p.lease as Lease;
      setLease(l);
      if (l?.holderDeviceId && l.holderDeviceId !== device.current) setLeaseProblem(`${l.holderName ?? 'Someone else'} took over scoring. Your pending actions were kept and not applied.`);
    }
  });

  // ------------------------------------------------ actions
  const enqueue = useCallback(
    async (type: Intent['type'], payload: Record<string, unknown>, label: string) => {
      const intent: Intent = {
        commandId: uuid(),
        matchId,
        type,
        payload,
        createdAt: Date.now(),
        offline: !(netOk && navigator.onLine),
        basedOnVersion: stateRef.current?.stateVersion ?? 0,
        status: 'queued',
        error: null,
        attempts: 0,
        label,
      };
      await putIntent(intent); // durable before it is shown
      await reloadIntents();
      void flush();
      return intent.commandId;
    },
    [matchId, netOk, flush, reloadIntents],
  );

  const review = useCallback(
    async (commandId: string, decision: 'apply' | 'discard') => {
      const i = (await getIntents(matchId)).find((x) => x.commandId === commandId);
      if (!i) return;
      if (decision === 'discard') await deleteIntent(commandId);
      else await putIntent({ ...i, status: 'queued', offline: false, error: null, attempts: 0 }); // same commandId: reviewed rebase
      await reloadIntents();
      void flush();
    },
    [matchId, flush, reloadIntents],
  );

  const takeControl = useCallback(async () => {
    const l = await acquire();
    if (l) void flush();
  }, [acquire, flush]);

  const release = useCallback(async () => {
    if (!leaseRef.current) return;
    await post(`matches/${matchId}/scorer-lease`, { action: 'release', deviceId: device.current, leaseVersion: leaseRef.current.leaseVersion }).catch(() => undefined);
    setLease(null);
  }, [matchId]);

  // ------------------------------------------------ provisional view (server state + pending fact intents)
  const provisional = useMemo(() => {
    if (!state || !match) return null;
    const pending = intents.filter((i) => i.status !== 'rejected');
    if (!pending.length) return { projection: state.projection, provisional: false };
    const adapter = getAdapter(match.sport);
    let p = state.projection;
    let seq = state.sequence;
    for (const i of pending) {
      try {
        if (i.type === 'ADD_FACT') p = applyEvent(adapter, match.rulesConfig as never, p, { sequence: ++seq, category: 'event', type: String(i.payload.type), side: i.payload.side as never, playerId: (i.payload.playerId as string) ?? null, payload: (i.payload.payload as Record<string, unknown>) ?? {}, periodId: p.phase, clockMs: state.clocks.main ? clockDisplayMs(state.clocks.main, Number(i.payload.occurredAt) || Date.now()) : null });
        if (i.type === 'SET_PHASE') p = adapter.applyPhase(match.rulesConfig as never, p, String(i.payload.to));
      } catch {
        /* display only */
      }
    }
    return { projection: p, provisional: true };
  }, [state, match, intents]);

  return {
    match,
    state,
    provisional,
    intents,
    accepted,
    lease,
    holding,
    leaseProblem,
    online,
    transport,
    access,
    fromCache,
    loadError,
    deviceId: device.current,
    enqueue,
    review,
    takeControl,
    release,
    refresh: loadAll,
    serverNow,
  };
}
