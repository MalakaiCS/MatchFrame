// A whole match video up to the server in parts (a match is gigabytes): each part on its own request, retried when
// the connection drops, and an upload that stopped carries on from the parts still missing when the same file is
// chosen again.
import { api, ApiError } from './api';

export interface MatchVideo {
  id: string;
  matchId: string;
  name: string;
  mime: string;
  bytes: number;
  state: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  error: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  sync: Record<string, number>;
  partSize: number;
  parts: number;
  missingParts: number[];
  previewUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload `file` for the match, or carry on with `resume` (an upload of the same file that stopped). `onProgress`
 * gets the bytes received so far.
 */
export async function uploadMatchVideo(matchId: string, file: File, o: { resume?: MatchVideo | null; onProgress?: (sent: number, total: number) => void; signal?: AbortSignal } = {}): Promise<MatchVideo> {
  const v = o.resume && o.resume.state === 'UPLOADING' && o.resume.bytes === file.size ? o.resume : await api<MatchVideo>(`matches/${matchId}/videos`, { method: 'POST', json: { name: file.name, mime: file.type, bytes: file.size } });
  const size = (n: number) => Math.min(v.bytes, n * v.partSize) - (n - 1) * v.partSize;
  let sent = v.bytes - v.missingParts.reduce((s, n) => s + size(n), 0);
  o.onProgress?.(sent, v.bytes);
  for (const n of v.missingParts) {
    const blob = file.slice((n - 1) * v.partSize, (n - 1) * v.partSize + size(n));
    for (let attempt = 1; ; attempt++) {
      if (o.signal?.aborted) throw new DOMException('Upload stopped', 'AbortError');
      try {
        await api(`match-videos/${v.id}/parts/${n}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: blob, signal: o.signal });
        break;
      } catch (e) {
        // the connection dropped or the server was busy: try the part again a few times, waiting longer each time
        const retry = e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429);
        if (!retry || attempt >= 4) throw e;
        await sleep(1000 * 2 ** attempt);
      }
    }
    sent += size(n);
    o.onProgress?.(sent, v.bytes);
  }
  return api<MatchVideo>(`match-videos/${v.id}/complete`, { method: 'POST', json: {} });
}

/** A file to the server with upload progress (fetch cannot report it). */
export function putWithProgress(url: string, body: Blob, onProgress?: (sent: number, total: number) => void, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.withCredentials = true;
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => onProgress?.(e.loaded, e.total);
    x.onload = () => {
      let b: { error?: { code: string; message: string } } | null = null;
      try {
        b = JSON.parse(x.responseText);
      } catch {
        b = null;
      }
      if (x.status >= 200 && x.status < 300) resolve(b);
      else reject(new ApiError(x.status, b?.error?.code ?? `HTTP_${x.status}`, b?.error?.message ?? `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and retry.'));
    signal?.addEventListener('abort', () => {
      x.abort();
      reject(new DOMException('Upload stopped', 'AbortError'));
    });
    x.send(body);
  });
}
