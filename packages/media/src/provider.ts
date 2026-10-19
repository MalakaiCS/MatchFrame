// Provider-neutral media interface (spec §13.6). Core models use our IDs; provider IDs live in provider_resources.

export type OutputPreset = '720p25' | '720p30' | '1080p25' | '1080p30';

export interface PresetSpec {
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  keyframeIntervalSec: number;
}

export const PRESETS: Record<OutputPreset, PresetSpec> = {
  '720p25': { width: 1280, height: 720, fps: 25, videoBitrateKbps: 3000, audioBitrateKbps: 128, keyframeIntervalSec: 2 },
  '720p30': { width: 1280, height: 720, fps: 30, videoBitrateKbps: 3000, audioBitrateKbps: 128, keyframeIntervalSec: 2 },
  '1080p25': { width: 1920, height: 1080, fps: 25, videoBitrateKbps: 4500, audioBitrateKbps: 128, keyframeIntervalSec: 2 },
  '1080p30': { width: 1920, height: 1080, fps: 30, videoBitrateKbps: 4500, audioBitrateKbps: 128, keyframeIntervalSec: 2 },
};

export interface ProvisionedInput {
  providerId: string;
  url: string; // RTMP server URL (without key)
  streamKey: string;
}

export interface InputHealth {
  state: 'inactive' | 'buffering' | 'publishing' | 'error' | 'unknown';
  error?: string | null;
  video?: { width?: number; height?: number; fps?: number; codec?: string } | null;
  audio?: { codec?: string; channels?: number } | null;
  bitrateKbps?: number | null; // only when measured by the provider
  startedAt?: number | null;
}

export interface StartOutputRequest {
  roomName: string;
  templateUrl: string; // full URL of our programme/clean template incl. bootstrap token
  preset: OutputPreset;
  hls?: { prefix: string; segmentSeconds: number } | null;
  file?: { key: string } | null;
  rtmp: string[];
}

export interface OutputStreamStatus {
  url: string; // redacted
  status: 'starting' | 'active' | 'failed' | 'finished' | 'unknown';
  error?: string | null;
}

export interface OutputStatus {
  providerId: string;
  state: 'starting' | 'active' | 'ending' | 'complete' | 'failed' | 'aborted' | 'limit_reached' | 'unknown';
  error?: string | null;
  streams: OutputStreamStatus[];
  playlist?: { key: string; durationMs?: number } | null;
  file?: { key: string; durationMs?: number; bytes?: number } | null;
  startedAt?: number | null;
  endedAt?: number | null;
  /** template URL without capabilities (contains our os= correlation id) */
  templateUrl?: string | null;
}

export interface ProviderWebhookEvent {
  id: string;
  event: string;
  createdAt: number;
  roomName?: string;
  participantIdentity?: string;
  ingressId?: string;
  egressId?: string;
  raw: Record<string, unknown>;
}

export interface MediaProvider {
  readonly name: 'livekit' | 'fake';
  readonly demo: boolean;
  provisionInput(opts: { name: string; roomName: string; participantIdentity: string }): Promise<ProvisionedInput>;
  bindInput(providerId: string, roomName: string, participantIdentity: string): Promise<void>;
  deleteInput(providerId: string): Promise<void>;
  inputHealth(providerId: string): Promise<InputHealth>;
  ensureRoom(roomName: string): Promise<void>;
  deleteRoom(roomName: string): Promise<void>;
  participantTracks(roomName: string, identity: string): Promise<{ audio: number; video: number } | null>;
  startOutput(req: StartOutputRequest): Promise<{ providerId: string }>;
  updateOutputStreams(providerId: string, add: string[], remove: string[]): Promise<void>;
  stopOutput(providerId: string): Promise<void>;
  outputStatus(providerId: string): Promise<OutputStatus>;
  listRoomOutputs(roomName: string): Promise<OutputStatus[]>;
  monitorToken(roomName: string, identity: string, ttlSeconds: number): Promise<string>;
  /** narrow token for the programme template: subscribe-only, hidden, short-lived */
  templateToken(roomName: string, identity: string, ttlSeconds: number): Promise<string>;
  verifyWebhook(rawBody: string, authHeader: string | undefined): Promise<ProviderWebhookEvent>;
}

export class MediaNotConfiguredError extends Error {
  code = 'MEDIA_NOT_CONFIGURED';
}

export function redactUrl(u: string): string {
  try {
    const url = new URL(u);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length > 1) parts[parts.length - 1] = '••••' + parts[parts.length - 1]!.slice(-4);
    url.pathname = '/' + parts.join('/');
    url.search = url.search ? '?••••' : '';
    url.password = url.password ? '••••' : '';
    return url.toString();
  } catch {
    return '••••';
  }
}
