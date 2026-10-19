import type { AppConfig } from '@bs/config';
import type { SeedHook } from './seed';

/** Per-milestone seed extensions (themes, game plans, sponsors, inputs) register here. */
export function seedHooks(_config: AppConfig): SeedHook[] {
  return [];
}
