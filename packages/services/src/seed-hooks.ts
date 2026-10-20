import { and, eq } from 'drizzle-orm';
import type { AppConfig } from '@bs/config';
import { competitions, matches, overlays, withTenant } from '@bs/db';
import type { SeedHook } from './seed';
import * as themesSvc from './themes';
import * as overlaysSvc from './overlays';
import * as gamePlansSvc from './gameplans';
import * as sponsorsSvc from './sponsors';
import { registerProcessedAsset } from './assets';
import { createStorage } from './storage';
import { demoMark } from './png';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/** Per-milestone seed extensions: graphics profiles + demo overlays (M3); later hooks add plans, sponsors, inputs. */
export function seedHooks(config: AppConfig): SeedHook[] {
  const graphics: SeedHook = async ({ ctx, created }) => {
    for (const c of created) {
      const prof = await themesSvc.createProfile(ctx, { name: c.sport === 'football' ? 'League broadcast look' : 'Club look', themeKey: c.sport === 'football' ? 'broadcast' : 'club', competitionId: c.competitionId, publish: true });
      const demo = await withTenant(ctx.db, { organisationId: ctx.actor.organisationId }, (t) => t.select().from(matches).where(and(eq(matches.competitionId, c.competitionId), eq(matches.isDemo, true))));
      for (const m of demo) {
        const existing = await overlaysSvc.listOverlays(ctx, m.id);
        if (!existing.length) await overlaysSvc.createOverlay(ctx, m.id, { name: 'Main graphics' });
        for (const o of existing.filter((x) => !x.theme)) await overlaysSvc.setOverlayThemeProfile(ctx, o.id, prof.id);
      }
      await withTenant(ctx.db, { organisationId: ctx.actor.organisationId }, (t) => t.select().from(competitions).where(eq(competitions.id, c.competitionId)));
    }
  };
  /** Starter game plans (published, assigned to demo overlays) and synthetic sponsors with generated artwork. */
  const automation: SeedHook = async ({ ctx, created }) => {
    for (const sport of [...new Set(created.map((c) => c.sport))]) {
      const plan = await gamePlansSvc.createGamePlan(ctx, { name: `${sport === 'football' ? 'Football' : 'Basketball'} starter`, sport: sport as 'football' | 'basketball', fromStarter: true });
      const v = await gamePlansSvc.publishGamePlan(ctx, plan.id);
      for (const c of created.filter((x) => x.sport === sport)) {
        const ovs = await withTenant(ctx.db, { organisationId: ctx.actor.organisationId }, (t) => t.select({ id: overlays.id }).from(overlays).innerJoin(matches, eq(matches.id, overlays.matchId)).where(and(eq(matches.competitionId, c.competitionId), eq(matches.isDemo, true))));
        for (const o of ovs) await overlaysSvc.setOverlayGamePlan(ctx, o.id, v.id);
      }
    }
    let storage;
    try {
      storage = createStorage(config);
      await storage.ensureBucket();
    } catch {
      console.warn('[seed] storage not configured: skipping sponsor artwork');
      return;
    }
    const sctx = { ...ctx, storage };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-seed-'));
    const brands = [
      { name: 'Tidewater Coffee Co.', category: 'beverage', bg: '#0B3D2E', fg: '#FFCE66' },
      { name: 'Northline Electrical', category: 'trade', bg: '#F3F6FB', fg: '#3EA6FF' },
    ];
    for (const b of brands) {
      const brand = await sponsorsSvc.createBrand(sctx, { name: b.name, category: b.category });
      const files = [
        { name: `${b.name} logo`, w: 400, h: 160 },
        { name: `${b.name} banner`, w: 1200, h: 160 },
        { name: `${b.name} slate`, w: 1920, h: 1080 },
      ];
      const ids: string[] = [];
      for (const f of files) {
        const p = path.join(dir, `${ids.length}-${brand.id}.png`);
        fs.writeFileSync(p, demoMark(f.w, f.h, b.bg, b.fg));
        const asset = await withTenant(ctx.db, { organisationId: ctx.actor.organisationId, userId: ctx.actor.userId }, (t) => registerProcessedAsset(sctx, t, { kind: 'logo', name: f.name, original: { path: p, mime: 'image/png', width: f.w, height: f.h }, tags: ['sponsor', 'demo'] }));
        const cr = await sponsorsSvc.addCreative(sctx, { creativeSetId: brand.creativeSetId, assetId: asset.id, name: f.name });
        await sponsorsSvc.setCreativeApproval(sctx, cr.id, 'approved');
        ids.push(cr.id);
      }
      // a short sponsor video (synthetic colour field + tone) for full-frame placements, if FFmpeg is available
      if (b === brands[0]) {
        const vp = path.join(dir, `video-${brand.id}.mp4`);
        try {
          execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${b.bg.replace('#', '0x')}:s=1920x1080:r=30`, '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '6', '-vf', `drawbox=x=760:y=340:w=400:h=400:color=${b.fg.replace('#', '0x')}:t=fill`, '-af', 'volume=0.4', '-ac', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', vp]);
          const asset = await withTenant(ctx.db, { organisationId: ctx.actor.organisationId, userId: ctx.actor.userId }, (t) => registerProcessedAsset(sctx, t, { kind: 'video', name: `${b.name} 6s spot`, original: { path: vp, mime: 'video/mp4', width: 1920, height: 1080, durationMs: 6000 }, tags: ['sponsor', 'demo'] }));
          const cr = await sponsorsSvc.addCreative(sctx, { creativeSetId: brand.creativeSetId, assetId: asset.id, name: `${b.name} 6s spot` });
          await sponsorsSvc.setCreativeApproval(sctx, cr.id, 'approved');
        } catch (e) {
          console.warn('[seed] sponsor video skipped:', (e as Error).message.split('\n')[0]);
        }
      }
      await sponsorsSvc.saveCampaign(sctx, {
        brandId: brand.id,
        creativeSetId: brand.creativeSetId,
        name: `${b.name} season partner`,
        startsAt: new Date(Date.now() - 86400_000).toISOString(),
        endsAt: new Date(Date.now() + 180 * 86400_000).toISOString(),
        minSpacingSeconds: 30,
        allocations: ['scorebug_logo', 'detached_logo', 'lower_third_banner', 'full_frame_image', 'full_frame_video', 'event_partner'].map((placement) => ({ scopeType: 'organisation' as const, placement: placement as never })),
      });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return [graphics, automation];
}
