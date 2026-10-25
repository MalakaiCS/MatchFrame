import { mediaAssets } from '@bs/db';
import { overlaysSvc, sponsorsSvc } from '@bs/services';
import type { Cue } from '@bs/graphics';
import { and, eq, inArray } from 'drizzle-orm';
import type { ApiDeps } from './app';

/** Enrich renderer snapshots with approved sponsor creatives and media referenced by on-air cues. */
export function snapshotExtras(deps: ApiDeps): Parameters<typeof overlaysSvc.rendererSnapshot>[3] {
  return async (t, data, state, scope) => {
    const org = scope.organisationId;
    data.creatives = await sponsorsSvc.renderCreatives(t, deps.config, org, [], true);
    const media = new Set<string>();
    for (const c of Object.values(state.layers) as Cue[]) {
      const img = c.variables?.image;
      if (typeof img === 'string' && /^[0-9a-f-]{36}$/.test(img) && !data.assets[img]) media.add(img);
    }
    if (media.size) {
      const ready = await t.select({ id: mediaAssets.id }).from(mediaAssets).where(and(inArray(mediaAssets.id, [...media]), eq(mediaAssets.state, 'READY')));
      for (const a of ready) data.assets[a.id] = overlaysSvc.signedAssetUrl(deps.config, org, a.id);
    }
  };
}
