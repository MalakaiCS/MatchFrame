// Uploading a file to the media library: register the upload, send the file through the API (the app's own origin,
// so private storage and the content security policy are not in the way), then have it checked and converted.
import { api, post } from './api';

export async function uploadFile(f: File, kind: 'image' | 'logo' | 'video' | 'audio' | 'font', mime = f.type): Promise<string> {
  const u = await post<{ assetId: string }>('assets/uploads', { name: f.name, kind, mime, bytes: f.size });
  await api(`assets/${u.assetId}/content`, { method: 'PUT', headers: { 'content-type': mime }, body: f });
  await post(`assets/${u.assetId}/complete`);
  return u.assetId;
}
