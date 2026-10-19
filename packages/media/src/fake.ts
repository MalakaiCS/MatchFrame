// Deterministic fake adapter for automated tests and explicitly labelled demo mode ONLY.
// It never claims real media: callers must surface `demo: true` in any UI or report.
import crypto from 'node:crypto';
import { redactUrl, type InputHealth, type MediaProvider, type OutputStatus } from './provider';

export interface FakeControls {
  inputs: Map<string, { room: string; identity: string; health: InputHealth }>;
  outputs: Map<string, OutputStatus & { room: string; rtmp: string[] }>;
  rooms: Set<string>;
  tracks: Map<string, { audio: number; video: number }>;
  setPublishing(providerId: string, on: boolean): void;
  setOutputState(providerId: string, state: OutputStatus['state'], error?: string): void;
  failStream(providerId: string, url: string): void;
}

export function createFakeProvider(): MediaProvider & { controls: FakeControls } {
  const controls: FakeControls = {
    inputs: new Map(),
    outputs: new Map(),
    rooms: new Set(),
    tracks: new Map(),
    setPublishing(id, on) {
      const i = controls.inputs.get(id);
      if (!i) return;
      i.health = on ? { state: 'publishing', video: { width: 1280, height: 720, fps: 30 }, audio: { channels: 2 } } : { state: 'inactive' };
      controls.tracks.set(`${i.room}/${i.identity}`, on ? { audio: 1, video: 1 } : { audio: 0, video: 0 });
    },
    setOutputState(id, state, error) {
      const o = controls.outputs.get(id);
      if (o) Object.assign(o, { state, error: error ?? null });
    },
    failStream(id, url) {
      const o = controls.outputs.get(id);
      const s = o?.streams.find((x) => x.url === redactUrl(url));
      if (s) Object.assign(s, { status: 'failed', error: 'Connection refused (fake)' });
    },
  };
  return {
    name: 'fake',
    demo: true,
    controls,
    async provisionInput({ roomName, participantIdentity }) {
      const id = `FAKE_IN_${crypto.randomBytes(4).toString('hex')}`;
      controls.inputs.set(id, { room: roomName, identity: participantIdentity, health: { state: 'inactive' } });
      return { providerId: id, url: 'rtmp://demo.invalid/live', streamKey: crypto.randomBytes(8).toString('hex') };
    },
    async bindInput(id, room, identity) {
      const i = controls.inputs.get(id);
      if (i) Object.assign(i, { room, identity });
    },
    async deleteInput(id) {
      controls.inputs.delete(id);
    },
    async inputHealth(id) {
      return controls.inputs.get(id)?.health ?? { state: 'unknown', error: 'not found' };
    },
    async ensureRoom(r) {
      controls.rooms.add(r);
    },
    async deleteRoom(r) {
      controls.rooms.delete(r);
    },
    async participantTracks(room, identity) {
      return controls.tracks.get(`${room}/${identity}`) ?? null;
    },
    async startOutput(req) {
      const id = `FAKE_EG_${crypto.randomBytes(4).toString('hex')}`;
      controls.outputs.set(id, {
        providerId: id,
        room: req.roomName,
        rtmp: req.rtmp,
        state: 'starting',
        streams: req.rtmp.map((u) => ({ url: redactUrl(u), status: 'starting' as const })),
        playlist: req.hls ? { key: `${req.hls.prefix}index.m3u8` } : null,
        file: req.file ? { key: req.file.key } : null,
        startedAt: Date.now(),
      });
      return { providerId: id };
    },
    async updateOutputStreams(id, add, remove) {
      const o = controls.outputs.get(id);
      if (!o) return;
      o.streams = o.streams.filter((s) => !remove.map(redactUrl).includes(s.url)).concat(add.map((u) => ({ url: redactUrl(u), status: 'active' as const })));
    },
    async stopOutput(id) {
      const o = controls.outputs.get(id);
      if (o) Object.assign(o, { state: 'complete', endedAt: Date.now() });
    },
    async outputStatus(id) {
      const o = controls.outputs.get(id);
      if (!o) return { providerId: id, state: 'unknown', streams: [] };
      const { room: _r, rtmp: _u, ...rest } = o;
      return structuredClone(rest);
    },
    async listRoomOutputs(room) {
      return [...controls.outputs.values()].filter((o) => o.room === room).map(({ room: _r, rtmp: _u, ...rest }) => structuredClone(rest));
    },
    async monitorToken() {
      return 'fake-monitor-token';
    },
    async templateToken() {
      return 'fake-template-token';
    },
    async verifyWebhook(raw) {
      const j = JSON.parse(raw);
      return { id: j.id, event: j.event, createdAt: Date.now(), raw: j, roomName: j.room?.name, egressId: j.egressInfo?.egressId, ingressId: j.ingressInfo?.ingressId };
    },
  };
}
