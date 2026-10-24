// Uploading a file to the media library: register the upload, send the file through the API (the app's own origin,
// so private storage and the content security policy are not in the way), then complete it. Images are first made
// ready for broadcast in the browser: any image the browser can open (PNG, JPEG, WebP, SVG, GIF, AVIF, BMP…) becomes
// a PNG (logos, keeping transparency) or a JPEG/PNG photo no larger than 2048 px, so the server takes it at once.
import { api, post } from './api';

const READY_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIDE = 2048;
const MAX_BYTES = 8 * 1024 * 1024;

export class UploadProblem extends Error {
  code = 'IMAGE_UNREADABLE';
}

async function decode(f: File): Promise<{ img: HTMLImageElement; width: number; height: number; svg: boolean }> {
  const svg = f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    // a vector logo has no real size: draw it large so it stays sharp on a 1080p graphic
    if (svg) {
      const ratio = width && height ? width / height : 1;
      width = ratio >= 1 ? 1024 : Math.round(1024 * ratio);
      height = ratio >= 1 ? Math.round(1024 / ratio) : 1024;
    }
    if (!width || !height) throw new Error('no size');
    return { img, width, height, svg };
  } catch {
    URL.revokeObjectURL(url);
    throw new UploadProblem(`${f.name} cannot be opened as an image in this browser. Save it as PNG or JPEG and try again.`);
  }
}

/** The file as a PNG, JPEG or WebP no larger than 2048 px on its longer side; unchanged when it already is one. */
export async function prepareImage(f: File, kind: 'logo' | 'image'): Promise<File> {
  const { img, width, height, svg } = await decode(f);
  try {
    if (!svg && READY_TYPES.includes(f.type) && Math.max(width, height) <= MAX_SIDE && f.size <= MAX_BYTES) return f;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) throw new UploadProblem('This browser cannot prepare images. Try another browser.');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    // logos and anything that may be transparent stay PNG; photos become JPEG
    const opaque = kind === 'image' && (f.type === 'image/jpeg' || f.type === 'image/heic' || f.type === 'image/heif');
    let type = opaque ? 'image/jpeg' : 'image/png';
    let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
    if (blob && blob.size > MAX_BYTES && type === 'image/png') {
      type = 'image/webp';
      blob = (await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.92))) ?? blob;
      if (blob.type !== 'image/webp') type = blob.type;
    }
    if (!blob) throw new UploadProblem(`${f.name} could not be converted. Save it as PNG or JPEG and try again.`);
    const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1]!;
    return new File([blob], `${f.name.replace(/\.[^.]+$/, '') || 'image'}.${ext}`, { type });
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export async function uploadFile(f: File, kind: 'image' | 'logo' | 'video' | 'audio' | 'font', mime = f.type): Promise<string> {
  const file = kind === 'image' || kind === 'logo' ? await prepareImage(f, kind) : f;
  const type = file === f ? mime : file.type;
  const u = await post<{ assetId: string }>('assets/uploads', { name: file.name, kind, mime: type, bytes: file.size });
  await api(`assets/${u.assetId}/content`, { method: 'PUT', headers: { 'content-type': type }, body: file });
  await post(`assets/${u.assetId}/complete`);
  return u.assetId;
}
