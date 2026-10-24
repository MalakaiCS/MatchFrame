'use client';
// An image picker for a logo or a photo: a preview and one button ("Change logo") whose menu uploads a file (any
// image the browser opens; it is ready as soon as it arrives), picks one already in the library, or removes it. Used for
// competition, team, club and organisation logos, player photos and sponsor creatives.
import { useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Image as ImageIcon, Upload, X } from 'lucide-react';
import { Button, Dialog, ErrorNotice, Spinner, cx } from '@bs/ui';
import type { ApiError } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useGet } from '@/lib/hooks';

interface Asset { id: string; name: string; kind: string; state: string }

export function ImageField({ value, onChange, disabled, label = 'Logo', kind = 'logo', compact = false }: { value: string | null; onChange: (assetId: string | null) => Promise<unknown> | void; disabled?: boolean; label?: string; kind?: 'logo' | 'image'; compact?: boolean }) {
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<ApiError | Error | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const images = useGet<Asset[]>(['assets', 'images-and-logos'], 'assets?pageSize=100');
  const choices = (images.data ?? []).filter((a) => (a.kind === 'logo' || a.kind === 'image') && a.state !== 'FAILED' && a.state !== 'ARCHIVED');
  const current = choices.find((a) => a.id === value);
  const preview = localPreview ?? (value ? `/api/v1/assets/${value}/preview` : null);
  // "Competition logo" → "logo", "Player photo" → "photo" for the button
  const word = label.toLowerCase();
  const short = word.split(' ').pop() ?? word;

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
  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated';

  return (
    <div>
      {compact ? null : <div className="text-xs font-medium text-muted">{label}</div>}
      <div className={cx('flex flex-wrap items-center gap-3', !compact && 'mt-1')}>
        <div className={cx('grid place-items-center overflow-hidden rounded border border-border bg-[repeating-conic-gradient(#1c2c43_0_25%,#131f32_0_50%)] bg-[length:12px_12px]', kind === 'image' ? 'h-16 w-12' : 'h-16 w-24')}>
          {preview ? <img src={preview} alt={`${label} preview`} className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-muted">none</span>}
        </div>
        <input ref={file} type="file" hidden accept="image/*" aria-label={`Upload ${word}`} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        {disabled ? null : (
          <DM.Root modal={false}>
            <DM.Trigger asChild>
              <Button size="sm" loading={uploading}>{value ? <ImageIcon className="size-4" /> : <Upload className="size-4" />} {value ? `Change ${short}` : `Add a ${short}`} <ChevronDown className="size-3.5 text-muted" aria-hidden /></Button>
            </DM.Trigger>
            <DM.Portal>
              <DM.Content align="start" sideOffset={6} className="z-50 min-w-56 rounded-xl border border-border bg-panel p-1.5 text-sm shadow-pop">
                <DM.Item className={item} onSelect={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Upload a file…</DM.Item>
                {choices.length ? <DM.Item className={item} onSelect={() => setPicking(true)}><ImageIcon className="size-4" aria-hidden /> Choose from your images…</DM.Item> : null}
                {value ? <><DM.Separator className="my-1 h-px bg-border" /><DM.Item className={item} onSelect={() => { setLocalPreview(null); void onChange(null); }}><X className="size-4" aria-hidden /> Remove</DM.Item></> : null}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
        )}
      </div>
      {current && current.state === 'PROCESSING' ? <p className="mt-1 text-[11px] text-muted">Checking a large image; graphics show it once that is done.</p> : null}
      {uploading ? <Spinner label="Uploading" /> : null}
      <ErrorNotice error={err} />
      <Dialog open={picking} onOpenChange={setPicking} wide title={`Choose a ${short}`} description="Images and logos already uploaded to your library.">
        <ul className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4" aria-label="Your images">
          {choices.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => { setLocalPreview(null); setPicking(false); void onChange(a.id); }} aria-current={a.id === value ? 'true' : undefined} className={cx('flex w-full flex-col items-center gap-1 rounded-lg border p-2 text-xs hover:border-primary', a.id === value ? 'border-primary' : 'border-border')}>
                <span className="grid h-20 w-full place-items-center overflow-hidden rounded bg-[repeating-conic-gradient(#1c2c43_0_25%,#131f32_0_50%)] bg-[length:12px_12px]"><img src={`/api/v1/assets/${a.id}/preview`} alt="" loading="lazy" className="max-h-full max-w-full object-contain" /></span>
                <span className="w-full truncate text-center">{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

/** A logo picker (competition, team, club, organisation). */
export function LogoField(props: { value: string | null; onChange: (assetId: string | null) => Promise<unknown> | void; disabled?: boolean; label?: string }) {
  return <ImageField {...props} kind="logo" />;
}
