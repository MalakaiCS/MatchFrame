// Hotkeys for Stream Deck and similar: one HTTPS call per button, authenticated with a scoped API key. Every
// action goes through the normal overlay command path (audited, fenced against automation).
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { overlays } from '@bs/db';
import { BUILTIN_TEMPLATES } from '@bs/graphics';
import { z } from 'zod';
import { invalid } from './errors';
import { tx, type Ctx } from './context';
import { overlayCommand } from './overlays';
import { triggerManualPlaylist, type AutomationDeps } from './automation';

export const hotkeyInput = z.object({
  /** take:<templateKey> | clear | clear:<layer> | scorebug:on | scorebug:off | playlist:<id> | resume */
  action: z.string().min(1).max(120),
  variables: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().int().min(500).max(3_600_000).nullable().optional(),
});

/** The buttons a Stream Deck profile can bind for one output, in plain words. */
export async function listHotkeys(ctx: Ctx, overlayId: string) {
  return tx(ctx, async (t) => {
    const [o] = await t.select().from(overlays).where(and(eq(overlays.id, overlayId), eq(overlays.organisationId, ctx.actor.organisationId)));
    if (!o) throw invalid('Unknown output', [{ field: 'overlayId', message: 'Not found' }]);
    const base = `${ctx.config.PUBLIC_API_URL}/api/v1/hotkeys/${overlayId}`;
    const rows = [
      { action: 'scorebug:on', label: 'Scorebug on' },
      { action: 'scorebug:off', label: 'Scorebug off' },
      { action: 'clear', label: 'Clear everything' },
      { action: 'clear:event', label: 'Clear event graphic' },
      { action: 'clear:fullframe', label: 'Clear full-frame board' },
      { action: 'resume', label: 'Resume automation' },
      ...BUILTIN_TEMPLATES.filter((tp) => !['builtin:scorebug', 'builtin:full_frame_media', 'builtin:sponsor'].includes(tp.key)).map((tp) => ({ action: `take:${tp.key}`, label: `Take ${tp.name}` })),
    ];
    return rows.map((r) => ({ ...r, method: 'POST', url: `${base}/${encodeURIComponent(r.action)}`, header: 'Authorization: Bearer <api key with overlay.operate>' }));
  });
}

export async function fireHotkey(ctx: Ctx, overlayId: string, input: z.input<typeof hotkeyInput>, auto: AutomationDeps) {
  const d = hotkeyInput.parse(input);
  const [kind, arg] = d.action.split(':', 2) as [string, string | undefined];
  const cmd = (command: Record<string, unknown>) => overlayCommand(ctx, overlayId, { commandId: crypto.randomUUID(), command: command as never }, { source: 'operator' });
  switch (kind) {
    case 'take': {
      const t = BUILTIN_TEMPLATES.find((x) => x.key === arg);
      if (!t) throw invalid('Unknown graphic', [{ field: 'action', message: 'Unknown template' }]);
      const variables = { ...Object.fromEntries(t.variables.filter((v) => v.default !== undefined).map((v) => [v.key, v.default])), ...(d.variables ?? {}) };
      return cmd({ type: 'TAKE_IN', templateKey: t.key, variables, durationMs: d.durationMs === undefined ? t.holdMs : d.durationMs });
    }
    case 'clear':
      return arg ? cmd({ type: 'CLEAR_LAYER', layer: arg }) : cmd({ type: 'CLEAR_OUTPUT' });
    case 'scorebug':
      return cmd({ type: arg === 'off' ? 'HIDE_SCOREBUG' : 'SHOW_SCOREBUG' });
    case 'resume':
      return cmd({ type: 'RESUME' });
    case 'playlist':
      if (!arg) throw invalid('Playlist id missing', [{ field: 'action', message: 'playlist:<id>' }]);
      return triggerManualPlaylist(ctx, auto, overlayId, arg, crypto.randomUUID());
    default:
      throw invalid(`Unknown hotkey action "${d.action}"`, [{ field: 'action', message: 'Unknown action' }]);
  }
}
