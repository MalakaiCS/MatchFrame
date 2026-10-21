'use client';
// Media files: direct-to-storage uploads, server-side validation/normalisation state, previews, archive.
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, EmptyState, ErrorNotice, Input, NativeSelect, Spinner, StatusPill } from '@bs/ui';
import type { ApiError } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useGet } from '@/lib/hooks';

interface Asset { id: string; name: string; kind: string; state: string; width: number | null; height: number | null; durationMs: number | null; bytes: number; error: string | null; tags: string[] }
const KIND_FOR = (mime: string) => (mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image');
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export function AssetLibrary() {
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const assets = useGet<Asset[]>(['assets', kind, search], `assets?${new URLSearchParams({ ...(kind ? { kind } : {}), ...(search ? { search } : {}) })}`, { refetchInterval: 4000 });
  const usage = useGet<{ storageBytes: number; storageLimitBytes: number; maxUploadBytes: number }>(['usage'], 'usage');
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const upload = async (f: File) => {
    setErr(null);
    setBusy(`Uploading ${f.name}…`);
    try {
      await uploadFile(f, KIND_FOR(f.type));
      setBusy(null);
      void assets.refetch();
    } catch (e) {
      setErr(e as ApiError);
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Kind" className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All files</option><option value="image">Images</option><option value="logo">Logos</option><option value="video">Video</option><option value="audio">Audio</option></NativeSelect>
        <Input aria-label="Search files" className="max-w-xs" placeholder="Search by name or tag" value={search} onChange={(e) => setSearch(e.target.value)} />
        {usage.data ? <span className="text-xs text-muted">{mb(usage.data.storageBytes)} of {Math.round(usage.data.storageLimitBytes / 1024 ** 3)} GB used · max upload {mb(usage.data.maxUploadBytes)}</span> : null}
        <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button variant="primary" className="ml-auto" disabled={!!busy} onClick={() => file.current?.click()}><Upload className="size-4" /> Upload</Button>
      </div>
      {busy ? <p role="status" className="text-sm text-muted">{busy}</p> : null}
      <ErrorNotice error={err ?? assets.error} />
      {assets.isLoading ? <Spinner /> : !assets.data?.length ? <EmptyState title="No media files" body="Upload PNG/JPEG/WebP images, MP4/MOV/WebM video or audio. Files are checked by content and converted to broadcast formats." /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {assets.data.map((a) => (
            <div key={a.id} className="rounded border border-border p-2 text-xs">
              <div className="grid aspect-video place-items-center overflow-hidden rounded bg-[repeating-conic-gradient(#1c2c43_0_25%,#131f32_0_50%)] bg-[length:16px_16px]">
                {a.state === 'READY' && a.kind !== 'audio' ? <img src={`/api/v1/assets/${a.id}/preview`} alt={a.name} className="max-h-full max-w-full object-contain" loading="lazy" /> : <span className="text-muted">{a.kind}</span>}
              </div>
              <div className="mt-1 truncate font-medium" title={a.name}>{a.name}</div>
              <div className="flex items-center gap-1 text-muted">
                <StatusPill tone={a.state === 'READY' ? 'healthy' : a.state === 'FAILED' ? 'offline' : 'warning'}>{a.state.toLowerCase()}</StatusPill>
                {a.width ? `${a.width}×${a.height}` : ''}{a.durationMs ? ` · ${Math.round(a.durationMs / 1000)}s` : ''}
              </div>
              {a.error ? <p className="mt-1 text-live">{a.error}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
