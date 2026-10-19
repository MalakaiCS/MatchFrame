import type { AppBundle } from './app';
import { registerCoreRoutes } from './routes/core';

export function registerRoutes(b: AppBundle) {
  registerCoreRoutes(b);
}
