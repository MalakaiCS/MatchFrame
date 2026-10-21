'use client';
// A logo picker: upload a new image (checked and converted in the background) or choose one already in the media
// library, with a preview and a way to remove it. Used for a competition's logo.
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, ErrorNotice, NativeSelect, Spinner } from '@bs/ui';
import type { ApiError } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useGet } from '@/lib/hooks';

interface Asset { id: string; name: string; kind: string; state: string }

export function LogoField({ value, onChange, disabled, label = 'Logo' }: { value: string | null; onChange: (assetId: string | null) => Promise<unknown> | void; disabled?: boolean; label?: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const images = useGet<Asset[]>(['assets', 'images-and-logos'], 'assets?pageSize=100');
  const choices = (images.data ?? []).filter((a) => (a.kind === 'logo' || a.kind === 'image') && a.state !== 'FAILED');
  const current = choices.find((a) => a.id === value);
  const preview = localPreview ?? (value ? `/api/v1/assets/${value}/preview` : null);

  const upload = async (f: File) => {
    setErr(null);
    setUploading(true);
    try {
      const assetId = await uploadFile(f, 'logo');
      setLocalPreview(URL.createObjectURL(f));
      await onChange(assetId);
      void images.refetch();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <div className="grid h-16 w-24 place-items-center overflow-hidden rounded border border-border bg-[repeating-conic-gradient(#1c2c43_0_25%,#131f32_0_50%)] bg-[length:12px_12px]">
          {preview ? <img src={preview} alt={`${label} preview`} className="max-h-14 max-w-full object-contain" /> : <span className="text-[10px] text-muted">none</span>}
        </div>
        <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label={`Upload ${label.toLowerCase()}`} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        {disabled ? null : (
          <>
            <Button size="sm" loading={uploading} onClick={() => file.current?.click()}><Upload className="size-4" /> {value ? 'Replace' : 'Upload'}</Button>
            {choices.length ? (
              <NativeSelect aria-label={`Choose ${label.toLowerCase()} from your images`} className="w-auto" value="" onChange={(e) => { if (e.target.value) { setLocalPreview(null); void onChange(e.target.value); } }}>
                <option value="">Choose from your images…</option>
                {choices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </NativeSelect>
            ) : null}
            {value ? <Button size="sm" variant="ghost" onClick={() => { setLocalPreview(null); void onChange(null); }}>Remove</Button> : null}
          </>
        )}
      </div>
      {current && current.state !== 'READY' ? <p className="mt-1 text-[11px] text-muted">Checking and converting the image; graphics show it once that is done (a few seconds).</p> : null}
      {uploading ? <Spinner label="Uploading" /> : null}
      <ErrorNotice error={err} />
    </div>
  );
}
