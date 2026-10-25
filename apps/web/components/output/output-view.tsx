'use client';
// One graphics output drawn full screen, as OBS shows it: the overlay page draws its own output with it, and a
// stream link's page draws whichever match is on. Production stays transparent until the snapshot arrives (no
// loading text on air). `hidden` draws it invisibly while it loads, so a stream link can swap matches without a
// blank frame; a hidden output reports no sponsor exposure.
import { useEffect } from 'react';
import { Keyframes, Renderer, Stage, THEMES, customDefsFrom, renderCustomScene } from '@bs/graphics/react';
import { useOutput } from './use-output';
import { useExposureReporter } from './exposure';

export function OutputView({ publicId, token, mode, hidden = false, onReady }: { publicId: string; token: string | null; mode?: string | null; hidden?: boolean; onReady?: () => void }) {
  const out = useOutput(publicId, token);
  const report = useExposureReporter(out.emit, out.sessionInfo, out.snap);
  const ready = !!out.snap;
  useEffect(() => {
    if (ready) onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the first snapshot arrives
  }, [ready]);
  const monitor = mode === 'monitor' || mode === 'rehearsal';
  if (!out.snap) {
    return monitor && !hidden ? <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#a7b4c8', font: '16px sans-serif', background: '#0b1220' }}>{out.error === 'invalid' ? 'This output link has been revoked or is invalid.' : 'Connecting…'}</div> : null;
  }
  const custom = customDefsFrom(out.snap.data.customTemplates);
  return (
    <div data-output={publicId} data-match-id={out.snap.overlay.matchId} style={{ position: 'fixed', inset: 0, overflow: 'hidden', visibility: hidden ? 'hidden' : 'visible' }}>
      <Keyframes />
      <Stage format={out.snap.data.format}>
        <Renderer state={out.snap.state} data={out.snap.data} themes={THEMES} serverNow={out.serverNow} customDefs={custom} renderCustom={renderCustomScene} monitor={monitor} slots={out.snap.state.slots ?? out.snap.slots} onVisible={hidden ? undefined : report} />
      </Stage>
      {monitor && !hidden ? (
        <div style={{ position: 'fixed', left: 8, bottom: 8, font: '12px monospace', color: '#fff', background: 'rgba(0,0,0,.6)', padding: '4px 8px', borderRadius: 4 }}>
          {mode} · rev {out.snap.state.revision} · {out.connected ? 'connected' : 'reconnecting'} · {out.snap.state.mode}{out.snap.state.inhibited ? ' · CLEARED' : ''}
        </div>
      ) : null}
    </div>
  );
}
