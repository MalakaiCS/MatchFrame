// LiveKit adapter, pinned to server v1.13.8 / ingress v1.5.0 / egress v1.14.1 and server-sdk 2.19.1.
// Uses the source-based StartEgress API proven in MEDIA_SPIKE.md.
import { AccessToken, EgressClient, IngressClient, IngressInput, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import {
  AudioCodec,
  EgressStatus,
  EncodedFileType,
  EncodingOptions,
  FileOutput,
  IngressState_Status,
  Output,
  SegmentedFileOutput,
  SegmentedFileProtocol,
  StartEgressRequest,
  StreamInfo_Status,
  StreamOutput,
  StreamProtocol,
  TemplateSource,
  VideoCodec,
  type EgressInfo,
} from '@livekit/protocol';
import {
  PRESETS,
  redactUrl,
  type InputHealth,
  type MediaProvider,
  type OutputStatus,
  type ProviderWebhookEvent,
  type StartOutputRequest,
} from './provider';

export interface LiveKitConfig {
  httpUrl: string; // internal http(s) URL of the LiveKit server
  apiKey: string;
  apiSecret: string;
  rtmpBaseUrl: string; // public RTMP URL shown to encoders
}

const EGRESS_STATE: Record<number, OutputStatus['state']> = {
  [EgressStatus.EGRESS_STARTING]: 'starting',
  [EgressStatus.EGRESS_ACTIVE]: 'active',
  [EgressStatus.EGRESS_ENDING]: 'ending',
  [EgressStatus.EGRESS_COMPLETE]: 'complete',
  [EgressStatus.EGRESS_FAILED]: 'failed',
  [EgressStatus.EGRESS_ABORTED]: 'aborted',
  [EgressStatus.EGRESS_LIMIT_REACHED]: 'limit_reached',
};

const STREAM_STATE: Record<number, OutputStatus['streams'][number]['status']> = {
  [StreamInfo_Status.ACTIVE]: 'active',
  [StreamInfo_Status.FINISHED]: 'finished',
  [StreamInfo_Status.FAILED]: 'failed',
};

const ns = (v: bigint | number | undefined) => (v ? Math.floor(Number(v) / 1e6) : null);

export function egressToStatus(e: EgressInfo): OutputStatus {
  const file = e.fileResults?.[0];
  const seg = e.segmentResults?.[0];
  return {
    providerId: e.egressId,
    state: EGRESS_STATE[e.status] ?? 'unknown',
    error: e.error || null,
    streams: (e.streamResults ?? []).map((s) => ({ url: redactUrl(s.url), status: STREAM_STATE[s.status] ?? 'starting', error: s.error || null })),
    playlist: seg ? { key: seg.playlistLocation || seg.playlistName, durationMs: ns(seg.duration) ?? undefined } : null,
    file: file ? { key: file.location || file.filename, durationMs: ns(file.duration) ?? undefined, bytes: Number(file.size ?? 0) } : null,
    startedAt: ns(e.startedAt),
    endedAt: ns(e.endedAt),
  };
}

export function createLiveKitProvider(cfg: LiveKitConfig): MediaProvider {
  const ingress = new IngressClient(cfg.httpUrl, cfg.apiKey, cfg.apiSecret);
  const egress = new EgressClient(cfg.httpUrl, cfg.apiKey, cfg.apiSecret);
  const rooms = new RoomServiceClient(cfg.httpUrl, cfg.apiKey, cfg.apiSecret);
  const receiver = new WebhookReceiver(cfg.apiKey, cfg.apiSecret);

  const token = async (room: string, identity: string, ttl: number, hidden: boolean) => {
    const at = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity, ttl });
    at.addGrant({ room, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, hidden });
    return at.toJwt();
  };

  return {
    name: 'livekit',
    demo: false,
    async provisionInput({ name, roomName, participantIdentity }) {
      const info = await ingress.createIngress(IngressInput.RTMP_INPUT, { name, roomName, participantIdentity, participantName: name, enableTranscoding: true });
      return { providerId: info.ingressId, url: info.url || cfg.rtmpBaseUrl, streamKey: info.streamKey };
    },
    async bindInput(providerId, roomName, participantIdentity) {
      const [cur] = await ingress.listIngress({ ingressId: providerId });
      await ingress.updateIngress(providerId, { name: cur?.name ?? participantIdentity, roomName, participantIdentity, participantName: cur?.participantName ?? participantIdentity });
    },
    async deleteInput(providerId) {
      await ingress.deleteIngress(providerId).catch((e: Error) => {
        if (!/not found/i.test(e.message)) throw e;
      });
    },
    async inputHealth(providerId): Promise<InputHealth> {
      const [info] = await ingress.listIngress({ ingressId: providerId });
      if (!info) return { state: 'unknown', error: 'Input not found at provider' };
      const st = info.state;
      const map: Record<number, InputHealth['state']> = {
        [IngressState_Status.ENDPOINT_INACTIVE]: 'inactive',
        [IngressState_Status.ENDPOINT_BUFFERING]: 'buffering',
        [IngressState_Status.ENDPOINT_PUBLISHING]: 'publishing',
        [IngressState_Status.ENDPOINT_ERROR]: 'error',
        [IngressState_Status.ENDPOINT_COMPLETE]: 'inactive',
      };
      return {
        state: st ? (map[st.status] ?? 'unknown') : 'inactive',
        error: st?.error || null,
        video: st?.video ? { width: st.video.width, height: st.video.height, fps: st.video.framerate, codec: st.video.mimeType } : null,
        audio: st?.audio ? { codec: st.audio.mimeType, channels: st.audio.channels } : null,
        bitrateKbps: st?.video?.averageBitrate ? Math.round((st.video.averageBitrate + (st.audio?.averageBitrate ?? 0)) / 1000) : null,
        startedAt: st?.startedAt ? Number(st.startedAt) / 1e6 : null,
      };
    },
    async ensureRoom(roomName) {
      await rooms.createRoom({ name: roomName, emptyTimeout: 600, departureTimeout: 120 });
    },
    async deleteRoom(roomName) {
      await rooms.deleteRoom(roomName).catch((e: Error) => {
        if (!/not found|does not exist/i.test(e.message)) throw e;
      });
    },
    async participantTracks(roomName, identity) {
      try {
        const p = await rooms.getParticipant(roomName, identity);
        return { audio: p.tracks.filter((t) => t.type === 0).length, video: p.tracks.filter((t) => t.type === 1).length };
      } catch {
        return null;
      }
    },
    async startOutput(req: StartOutputRequest) {
      const p = PRESETS[req.preset];
      const outputs: Output[] = [];
      if (req.file) outputs.push(new Output({ config: { case: 'file', value: new FileOutput({ fileType: EncodedFileType.MP4, filepath: req.file.key }) } }));
      if (req.hls)
        outputs.push(
          new Output({
            config: {
              case: 'segments',
              value: new SegmentedFileOutput({
                protocol: SegmentedFileProtocol.HLS_PROTOCOL,
                filenamePrefix: `${req.hls.prefix}seg`,
                playlistName: 'index.m3u8',
                livePlaylistName: 'live.m3u8',
                segmentDuration: req.hls.segmentSeconds,
              }),
            },
          }),
        );
      if (req.rtmp.length) outputs.push(new Output({ config: { case: 'stream', value: new StreamOutput({ protocol: StreamProtocol.RTMP, urls: req.rtmp }) } }));
      const info = await egress.startEgress(
        new StartEgressRequest({
          roomName: req.roomName,
          source: { case: 'template', value: new TemplateSource({ layout: 'programme', customBaseUrl: req.templateUrl }) },
          encoding: {
            case: 'advanced',
            value: new EncodingOptions({
              width: p.width,
              height: p.height,
              framerate: p.fps,
              videoBitrate: p.videoBitrateKbps,
              audioBitrate: p.audioBitrateKbps,
              audioFrequency: 48000,
              keyFrameInterval: p.keyframeIntervalSec,
              videoCodec: VideoCodec.H264_MAIN,
              audioCodec: AudioCodec.AAC,
            }),
          },
          outputs,
        }),
      );
      return { providerId: info.egressId };
    },
    async updateOutputStreams(providerId, add, remove) {
      await egress.updateStream(providerId, add, remove);
    },
    async stopOutput(providerId) {
      await egress.stopEgress(providerId).catch((e: Error) => {
        if (!/cannot be stopped|not found/i.test(e.message)) throw e;
      });
    },
    async outputStatus(providerId) {
      const [e] = await egress.listEgress({ egressId: providerId });
      if (!e) return { providerId, state: 'unknown', error: 'Output not found at provider', streams: [] };
      return egressToStatus(e);
    },
    async listRoomOutputs(roomName) {
      return (await egress.listEgress({ roomName })).map(egressToStatus);
    },
    monitorToken: (room, identity, ttl) => token(room, identity, ttl, true),
    templateToken: (room, identity, ttl) => token(room, identity, ttl, true),
    async verifyWebhook(rawBody, authHeader): Promise<ProviderWebhookEvent> {
      const ev = await receiver.receive(rawBody, authHeader);
      return {
        id: ev.id,
        event: ev.event,
        createdAt: Number(ev.createdAt) * 1000,
        roomName: ev.room?.name,
        participantIdentity: ev.participant?.identity,
        ingressId: ev.ingressInfo?.ingressId,
        egressId: ev.egressInfo?.egressId,
        raw: JSON.parse(rawBody),
      };
    },
  };
}
