import type { AppBundle } from './app';
import { registerCoreRoutes } from './routes/core';
import { registerGraphicsRoutes } from './routes/graphics';
import { registerAutomationRoutes } from './routes/automation';
import { registerStreamRoutes } from './routes/streams';
import { registerMediaRoutes } from './routes/media';

export function registerRoutes(b: AppBundle) {
  registerCoreRoutes(b);
  registerGraphicsRoutes(b);
  registerAutomationRoutes(b);
  registerStreamRoutes(b);
  registerMediaRoutes(b);
}
