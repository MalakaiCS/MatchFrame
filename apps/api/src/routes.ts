import type { AppBundle } from './app';
import { registerCoreRoutes } from './routes/core';
import { registerGraphicsRoutes } from './routes/graphics';
import { registerAutomationRoutes } from './routes/automation';
import { registerStreamRoutes } from './routes/streams';
import { registerMediaRoutes } from './routes/media';
import { registerPlatformRoutes } from './routes/platform';
import { registerStaffRoutes } from './routes/staff';

export function registerRoutes(b: AppBundle) {
  registerCoreRoutes(b);
  registerGraphicsRoutes(b);
  registerAutomationRoutes(b);
  if (b.deps.config.STREAMING_ENABLED) registerStreamRoutes(b);
  registerMediaRoutes(b);
  registerPlatformRoutes(b);
  registerStaffRoutes(b);
}
