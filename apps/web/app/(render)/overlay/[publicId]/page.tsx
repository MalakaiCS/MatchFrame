'use client';
import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { OutputView } from '@/components/output/output-view';

function OverlayOutput({ publicId }: { publicId: string }) {
  const q = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    // Keep the capability out of the visible URL/history after load; survive a manual refresh via sessionStorage.
    const t = q.get('t') ?? sessionStorage.getItem(`ov:${publicId}`);
    if (t) sessionStorage.setItem(`ov:${publicId}`, t);
    setToken(t);
  }, [q, publicId]);
  return <OutputView publicId={publicId} token={token} mode={q.get('mode')} />;
}

export default function OverlayPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  return (
    <Suspense>
      <OverlayOutput publicId={publicId} />
    </Suspense>
  );
}
