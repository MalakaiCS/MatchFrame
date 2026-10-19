'use client';
import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Keyframes, Renderer, Stage, THEMES, customDefsFrom, renderCustomScene } from '@bs/graphics/react';
import { useOutput } from '@/components/output/use-output';
import { useExposureReporter } from '@/components/output/exposure';

function OverlayOutput({ publicId }: { publicId: string }) {
  const q = useSearchParams();
  const mode = q.get('mode');
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    // Keep the capability out of the visible URL/history after load; survive a manual refresh via sessionStorage.
    const t = q.get('t') ?? sessionStorage.getItem(`ov:${publicId}`);
    if (t) sessionStorage.setItem(`ov:${publicId}`, t);
    setToken(t);
  }, [q, publicId]);
  const out = useOutput(publicId, token);
  const report = useExposureReporter(out.emit, out.sessionInfo, out.snap);
  const monitor = mode === 'monitor' || mode === 'rehearsal';
  if (!out.snap) {
    // Production output stays transparent: no loading text or error chrome on air.
    return monitor ? <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#a7b4c8', font: '16px sans-serif', background: '#0b1220' }}>{out.error === 'invalid' ? 'This output link has been revoked or is invalid.' : 'Connecting…'}</div> : null;
  }
  const custom = customDefsFrom(out.snap.data.customTemplates);
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <Keyframes />
      <Stage>
        <Renderer state={out.snap.state} data={out.snap.data} themes={THEMES} serverNow={out.serverNow} customDefs={custom} renderCustom={renderCustomScene} monitor={monitor} slots={out.snap.slots} onVisible={report} />
      </Stage>
      {monitor ? (
        <div style={{ position: 'fixed', left: 8, bottom: 8, font: '12px monospace', color: '#fff', background: 'rgba(0,0,0,.6)', padding: '4px 8px', borderRadius: 4 }}>
          {mode} · rev {out.snap.state.revision} · {out.connected ? 'connected' : 'reconnecting'} · {out.snap.state.mode}{out.snap.state.inhibited ? ' · CLEARED' : ''}
        </div>
      ) : null}
    </div>
  );
}

export default function OverlayPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  return (
    <Suspense>
      <OverlayOutput publicId={publicId} />
    </Suspense>
  );
}
