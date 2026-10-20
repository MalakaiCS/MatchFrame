// An OBS scene collection with a Browser Source per output, sized for its format, ready to import
// (Scene Collection → Import). vMix users get the same links from the match page.
import { and, asc, eq } from 'drizzle-orm';
import { matches, overlays } from '@bs/db';
import { assertCan } from './authz';
import { notFound } from './errors';
import { tx, type Ctx } from './context';
import { overlayUrls } from './overlays';

const size = (format: string) => (format === '9:16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });

export async function obsSceneCollection(ctx: Ctx, matchId: string) {
  return tx(ctx, async (t) => {
    const [m] = await t.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.organisationId, ctx.actor.organisationId)));
    if (!m) throw notFound('Match');
    assertCan(ctx.actor, 'overlay.operate', { matchId: m.id, competitionId: m.competitionId });
    const outs = await t.select().from(overlays).where(and(eq(overlays.matchId, matchId), eq(overlays.kind, 'graphics'), eq(overlays.status, 'active'))).orderBy(asc(overlays.createdAt));
    const sources: Record<string, unknown>[] = [];
    const items: Record<string, unknown>[] = [];
    let id = 1;
    for (const o of outs) {
      const urls = await overlayUrls(ctx, o.id).catch(() => null);
      if (!urls?.production) continue;
      const { width, height } = size(o.format);
      const name = `Broadcast Studio · ${o.name}`;
      sources.push({
        name,
        id: 'browser_source',
        versioned_id: 'browser_source',
        settings: { url: urls.production, width, height, fps_custom: false, shutdown: false, restart_when_active: false, css: '', reroute_audio: true },
        enabled: true,
        muted: false,
        volume: 1,
        mixers: 255,
        monitoring_type: 0,
        sync: 0,
        flags: 0,
        hotkeys: {},
        deinterlace_mode: 0,
        deinterlace_field_order: 0,
        private_settings: {},
      });
      items.push({ name, source_uuid: null, visible: true, locked: false, id: id++, pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, align: 5, bounds_type: 0, bounds_align: 0, bounds: { x: 0, y: 0 }, crop_top: 0, crop_bottom: 0, crop_left: 0, crop_right: 0, rot: 0, blend_method: 'default', blend_type: 'normal' });
    }
    const sceneName = 'Broadcast Studio graphics';
    sources.push({ name: sceneName, id: 'scene', versioned_id: 'scene', settings: { id_counter: id, custom_size: false, items }, enabled: true, muted: false, volume: 1, hotkeys: {}, private_settings: {} });
    return {
      name: `Broadcast Studio ${m.round ? `round ${m.round} ` : ''}${m.id.slice(0, 8)}`,
      current_scene: sceneName,
      current_program_scene: sceneName,
      scene_order: [{ name: sceneName }],
      sources,
      transitions: [],
      transition_duration: 300,
      quick_transitions: [],
      modules: {},
      readme: 'Import in OBS via Scene Collection → Import. Each Browser Source is one Broadcast Studio output; put your camera scene below this scene or add these sources to it.',
    };
  });
}
