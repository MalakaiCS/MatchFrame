'use client';
// One graphics output drawn full screen, as OBS shows it: the overlay page draws its own output with it, and a
// stream link's page draws whichever match is on. Production stays transparent until the snapshot arrives (no
// loading text on air). `hidden` draws it invisibly while it loads, so a stream link can swap matches without a
// blank frame; a hidden output reports no sponsor exposure. `screen="intermission"` draws the intermission instead of
// the output's own graphics: the animated background and the intermission screen, with that output's look and data
// (a stream link between matches, with the next match's output).
import { useEffect, useRef } from 'react';
import { Keyframes, Renderer, Stage, THEMES, customDefsFrom, renderCustomScene } from '@bs/graphics/react';
import type { OverlayPublicState } from '@bs/graphics';
import { useOutput } from './use-output';
import { useExposureReporter } from './exposure';

/** The intermission on its own: the animated background and the intermission screen, nothing else of the output's. */
function intermissionState(base: OverlayPublicState, at: number): OverlayPublicState {
  const cue = (layer: 'background' | 'fullframe', templateKey: string) => ({ cueId: `intermission-${layer}`, templateKey, layer, variables: {}, startedAt: at, durationMs: null, source: 'automation' as const });
  return { ...base, scorebugVisible: false, slots: {}, layers: { background: cue('background', 'builtin:backdrop'), fullframe: cue('fullframe', 'builtin:intermission') } };
}

export function OutputView({ publicId, token, mode, hidden = false, screen = 'match', onReady }: { publicId: string; token: string | null; mode?: string | null; hidden?: boolean; screen?: 'match' | 'intermission'; onReady?: () => void }) {
  const intermission = screen === 'intermission';
  const out = useOutput(publicId, token, { refreshBoards: intermission });
  const report = useExposureReporter(out.emit, out.sessionInfo, out.snap);
  const since = useRef<number | null>(null);
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
  since.current ??= out.serverNow();
  const state = intermission ? intermissionState(out.snap.state, since.current) : out.snap.state;
  return (
    <div data-output={publicId} data-match-id={out.snap.overlay.matchId} data-screen={screen} style={{ position: 'fixed', inset: 0, overflow: 'hidden', visibility: hidden ? 'hidden' : 'visible' }}>
      <Keyframes />
      <Stage format={out.snap.data.format}>
        <Renderer state={state} data={out.snap.data} themes={THEMES} serverNow={out.serverNow} customDefs={custom} renderCustom={renderCustomScene} monitor={monitor} slots={intermission ? {} : (out.snap.state.slots ?? out.snap.slots)} onVisible={hidden || intermission ? undefined : report} />
      </Stage>
      {monitor && !hidden ? (
        <div style={{ position: 'fixed', left: 8, bottom: 8, font: '12px monospace', color: '#fff', background: 'rgba(0,0,0,.6)', padding: '4px 8px', borderRadius: 4 }}>
          {mode} · rev {out.snap.state.revision} · {out.connected ? 'connected' : 'reconnecting'} · {out.snap.state.mode}{out.snap.state.inhibited ? ' · CLEARED' : ''}
        </div>
      ) : null}
    </div>
  );
}
