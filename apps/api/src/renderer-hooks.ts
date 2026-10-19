import { overlaysSvc, sponsorsSvc } from '@bs/services';
import type { AppBundle } from './app';
import type { RendererHooks } from './realtime';

/** Overlay renderer capability hooks: authenticate scoped tokens, track sessions and displayed revisions. */
export function rendererHooks(b: AppBundle): RendererHooks {
  const { db, config } = b.deps;
  return {
    authenticate: (token) => overlaysSvc.resolveRendererToken(db, config, token),
    async onConnect(socket, scope, instanceId) {
      const r = await overlaysSvc.rendererConnected(db, socket.data.scope, instanceId);
      socket.data.rendererSessionId = r.id;
      socket.emit('session', { rendererSessionId: r.id, reportingAuthority: r.isReportingAuthority, purpose: scope.purpose });
    },
    async onDisplayed(socket, payload) {
      const rev = Number((payload as { revision?: number })?.revision);
      if (socket.data.rendererSessionId) await overlaysSvc.rendererDisplayed(db, socket.data.scope, socket.data.rendererSessionId, rev);
    },
    async onExposure(socket, payload) {
      if (socket.data.rendererSessionId) await sponsorsSvc.recordExposure(db, socket.data.scope, socket.data.rendererSessionId, payload);
    },
    async onDisconnect(socket) {
      if (socket.data.rendererSessionId) await overlaysSvc.rendererDisconnected(db, socket.data.scope, socket.data.rendererSessionId);
    },
  };
}
