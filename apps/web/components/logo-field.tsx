'use client';
// An image picker for a logo or a photo: upload one (any image the browser opens; it is ready as soon as it
// arrives) or choose one already in the media library, with a preview and a way to remove it. Used for
// competition, team, club and organisation logos, player photos and sponsor creatives.
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, ErrorNotice, NativeSelect, Spinner, cx } from '@bs/ui';
import type { ApiError } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useGet } from '@/lib/hooks';

interface Asset { id: string; name: string; kind: string; state: string }

export function ImageField({ value, onChange, disabled, label = 'Logo', kind = 'logo', compact = false }: { value: string | null; onChange: (assetId: string | null) => Promise<unknown> | void; disabled?: boolean; label?: string; kind?: 'logo' | 'image'; compact?: boolean }) {
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<ApiError | Error | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const images = useGet<Asset[]>(['assets', 'images-and-logos'], 'assets?pageSize=100');
  const choices = (images.data ?? []).filter((a) => (a.kind === 'logo' || a.kind === 'image') && a.state !== 'FAILED' && a.state !== 'ARCHIVED');
  const current = choices.find((a) => a.id === value);
  const preview = localPreview ?? (value ? `/api/v1/assets/${value}/preview` : null);
  const word = label.toLowerCase();

  const upload = async (f: File) => {
    setErr(null);
    setUploading(true);
    try {
      const assetId = await uploadFile(f, kind);
      setLocalPreview(URL.createObjectURL(f));
      await onChange(assetId);
      void images.refetch();
    } catch (e) {
      setErr(e as ApiError | Error);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <div>
      {compact ? null : <div className="text-xs font-medium text-muted">{label}</div>}
      <div className={cx('flex flex-wrap items-center gap-2', !compact && 'mt-1')}>
        <div className={cx('grid place-items-center overflow-hidden rounded border border-border bg-[repeating-conic-gradient(#1c2c43_0_25%,#131f32_0_50%)] bg-[length:12px_12px]', kind === 'image' ? 'h-16 w-12' : 'h-16 w-24')}>
          {preview ? <img src={preview} alt={`${label} preview`} className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-muted">none</span>}
        </div>
        <input ref={file} type="file" hidden accept="image/*" aria-label={`Upload ${word}`} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        {disabled ? null : (
          <>
            <Button size="sm" loading={uploading} onClick={() => file.current?.click()}><Upload className="size-4" /> {value ? 'Replace' : 'Upload'}</Button>
            {choices.length ? (
              <NativeSelect aria-label={`Choose ${word} from your images`} className="w-auto max-w-48" value="" onChange={(e) => { if (e.target.value) { setLocalPreview(null); void onChange(e.target.value); } }}>
                <option value="">Choose from your images…</option>
                {choices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </NativeSelect>
            ) : null}
            {value ? <Button size="sm" variant="ghost" onClick={() => { setLocalPreview(null); void onChange(null); }}>Remove</Button> : null}
          </>
        )}
      </div>
      {current && current.state === 'PROCESSING' ? <p className="mt-1 text-[11px] text-muted">Checking a large image; graphics show it once that is done.</p> : null}
      {uploading ? <Spinner label="Uploading" /> : null}
      <ErrorNotice error={err} />
    </div>
  );
}

/** A logo picker (competition, team, club, organisation). */
export function LogoField(props: { value: string | null; onChange: (assetId: string | null) => Promise<unknown> | void; disabled?: boolean; label?: string }) {
  return <ImageField {...props} kind="logo" />;
}
