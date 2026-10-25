'use client';
// A stream link's OBS page: one browser source for a day of back-to-back matches. Every few seconds it asks which
// match is on (the match under way, the one just finished until the next is close, the next…) and shows that match's
// own output. A new match's output is loaded invisibly and swapped in once it is drawn, so the change is seamless;
// production stays transparent with nothing on (no loading text on air).
import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { OutputView } from '@/components/output/output-view';

interface On {
  publicId: string;
  token: string;
  matchId: string;
}
interface Current {
  matchId: string | null;
  reason: string;
  overlay: { publicId: string; token: string } | null;
}

const POLL_MS = 5000;

function ChannelOutput({ publicId }: { publicId: string }) {
  const q = useSearchParams();
  const mode = q.get('mode');
  const [token, setToken] = useState<string | null>(null);
  const [shown, setShown] = useState<On | null>(null);
  const [next, setNext] = useState<On | null>(null);
  const [state, setState] = useState<{ reason: string; invalid: boolean }>({ reason: '', invalid: false });
  const want = useRef<On | null>(null);
  useEffect(() => {
    // like the overlay page: the capability leaves the visible URL's history, and survives a manual refresh
    const t = q.get('t') ?? sessionStorage.getItem(`sl:${publicId}`);
    if (t) sessionStorage.setItem(`sl:${publicId}`, t);
    setToken(t);
  }, [q, publicId]);

  const ask = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/v1/public/channel/${publicId}/current`, { headers: { 'x-channel-token': token }, cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (r.status === 401) return setState({ reason: '', invalid: true });
      if (!r.ok) return;
      const c = (await r.json()) as Current;
      setState({ reason: c.reason, invalid: false });
      const on = c.overlay && c.matchId ? { ...c.overlay, matchId: c.matchId } : null;
      const cur = want.current;
      if (on?.publicId === cur?.publicId && on?.token === cur?.token) return;
      want.current = on;
      if (!on) {
        setShown(null);
        setNext(null);
      } else setNext(on);
    } catch {
      /* offline for a moment: keep showing what is on */
    }
  }, [publicId, token]);

  useEffect(() => {
    void ask();
    const t = setInterval(() => void ask(), POLL_MS);
    return () => clearInterval(t);
  }, [ask]);

  const monitor = mode === 'monitor';
  return (
    <div data-stream-link={publicId} data-on-match={shown?.matchId ?? ''}>
      {/* one keyed list, so the output loaded invisibly is the same one that becomes visible (no reload, no gap) */}
      {[shown, next && (next.publicId !== shown?.publicId || next.token !== shown?.token) ? next : null].map((o) =>
        o ? (
          <OutputView
            key={`${o.publicId}:${o.token}`}
            publicId={o.publicId}
            token={o.token}
            mode={mode}
            hidden={o !== shown}
            onReady={
              o === shown
                ? undefined
                : () => {
                    // the next match's output is drawn: swap it in (unless the link has moved on again meanwhile)
                    if (want.current?.publicId !== o.publicId || want.current?.token !== o.token) return;
                    setShown(o);
                    setNext(null);
                  }
            }
          />
        ) : null,
      )}
      {monitor ? (
        <div style={{ position: 'fixed', right: 8, bottom: 8, font: '12px monospace', color: '#fff', background: 'rgba(0,0,0,.6)', padding: '4px 8px', borderRadius: 4 }}>
          {state.invalid ? 'This stream link has been replaced or removed.' : `stream link · ${shown ? `on: ${shown.matchId.slice(0, 8)}` : 'nothing on'} · ${state.reason.replace('_', ' ')}`}
        </div>
      ) : null}
    </div>
  );
}

export default function ChannelPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  return (
    <Suspense>
      <ChannelOutput publicId={publicId} />
    </Suspense>
  );
}
