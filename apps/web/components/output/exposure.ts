'use client';
// Sponsor delivery evidence reporting (implemented with the sponsor milestone).
import type { Cue } from '@bs/graphics';
import type { Snapshot } from './use-output';

export function useExposureReporter(_emit: (ev: string, p: unknown) => void, _session: unknown, _snap: Snapshot | null) {
  return (_visible: Cue[], _now: number) => undefined;
}
