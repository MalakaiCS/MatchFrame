import type { AppBundle } from './app';
import { registerCoreRoutes } from './routes/core';
import { registerGraphicsRoutes } from './routes/graphics';

export function registerRoutes(b: AppBundle) {
  registerCoreRoutes(b);
  registerGraphicsRoutes(b);
}
