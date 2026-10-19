import { and, eq } from 'drizzle-orm';
import type { AppConfig } from '@bs/config';
import { competitions, matches, withTenant } from '@bs/db';
import type { SeedHook } from './seed';
import * as themesSvc from './themes';
import * as overlaysSvc from './overlays';

/** Per-milestone seed extensions: graphics profiles + demo overlays (M3); later hooks add plans, sponsors, inputs. */
export function seedHooks(_config: AppConfig): SeedHook[] {
  const graphics: SeedHook = async ({ ctx, created }) => {
    for (const c of created) {
      const prof = await themesSvc.createProfile(ctx, { name: c.sport === 'football' ? 'League broadcast look' : 'Club look', themeKey: c.sport === 'football' ? 'broadcast' : 'club', competitionId: c.competitionId, publish: true });
      void prof;
      const demo = await withTenant(ctx.db, { organisationId: ctx.actor.organisationId }, (t) => t.select().from(matches).where(and(eq(matches.competitionId, c.competitionId), eq(matches.isDemo, true))));
      for (const m of demo) await overlaysSvc.createOverlay(ctx, m.id, { name: 'Main graphics' });
      await withTenant(ctx.db, { organisationId: ctx.actor.organisationId }, (t) => t.select().from(competitions).where(eq(competitions.id, c.competitionId)));
    }
  };
  return [graphics];
}
