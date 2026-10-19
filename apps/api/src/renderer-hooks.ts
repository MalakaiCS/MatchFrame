import type { AppBundle } from './app';
import type { RendererHooks } from './realtime';

/** Overlay renderer capability hooks (implemented with the overlay service in Milestone 3). */
export function rendererHooks(_b: AppBundle): RendererHooks {
  return { authenticate: async () => null };
}
