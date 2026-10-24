'use client';
// Public share player. Every request (metadata and each media range) is validated server-side against the
// share token, expiry and revocation; a revoked link stops working mid-playback on the next range request.
import { useEffect, useState } from 'react';

export function SharedPlayer({ publicId, embed }: { publicId: string; embed?: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ title: string; resourceType: string; expiresAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const u = new URL(location.href);
    const t = u.searchParams.get('t') ?? sessionStorage.getItem(`share:${publicId}`);
    if (u.searchParams.has('t') && !embed) {
      sessionStorage.setItem(`share:${publicId}`, t!);
      u.searchParams.delete('t');
      history.replaceState(null, '', u.toString()); // keep the secret out of the visible URL/history
    }
    setToken(t);
    if (!t) return setError('This link is incomplete.');
    void fetch(`/api/v1/public/share/${publicId}`, { headers: { 'x-share-token': t }, cache: 'no-store', referrerPolicy: 'no-referrer' }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) setError(j.error?.message ?? 'This link is not available.');
      else setMeta(j);
    });
  }, [publicId, embed]);
  const src = token ? `/api/v1/public/share/${publicId}/media?t=${encodeURIComponent(token)}` : '';
  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', color: '#F3F6FB', font: '15px "Inter Variable", system-ui, sans-serif', display: 'grid', placeItems: 'center', padding: embed ? 0 : 16 }}>
      <div style={{ width: '100%', maxWidth: embed ? 'none' : 1100 }}>
        {error ? <p role="alert" style={{ textAlign: 'center', color: '#a7b4c8' }}>{error}</p> : meta ? (
          <>
            <video src={src} controls playsInline preload="metadata" style={{ width: '100%', aspectRatio: '16/9', background: '#000', display: 'block' }} />
            {!embed ? <h1 style={{ fontSize: 20, fontWeight: 600, margin: '12px 0 4px' }}>{meta.title}</h1> : null}
            {!embed && meta.expiresAt ? <p style={{ color: '#a7b4c8', fontSize: 13 }}>Link expires {new Date(meta.expiresAt).toLocaleString()}</p> : null}
          </>
        ) : <p style={{ textAlign: 'center', color: '#a7b4c8' }}>Loading…</p>}
      </div>
    </div>
  );
}
