'use client';
// Clip editor: trim, aspect (16:9 / 9:16 / 1:1) with crop focus, optional intro/outro sponsor bumpers.
// The preview shows the crop window over the real clip; the export is rendered by the media worker.
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, ErrorNotice, Field, NativeSelect } from '@bs/ui';
import { post, type ApiError } from '@/lib/api';
import { useGet } from '@/lib/hooks';

export interface ClipRow { id: string; title: string; inMs: number; outMs: number; mediaUrl: string | null; state: string; stale: boolean }
const RATIO: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;

export function ClipEditor({ clip, onClose, onExported }: { clip: ClipRow; onClose: () => void; onExported: () => void }) {
  const dur = clip.outMs - clip.inMs;
  const [trim, setTrim] = useState<[number, number]>([0, dur]);
  const [aspect, setAspect] = useState('16:9');
  const [focusX, setFocusX] = useState(0.5);
  const [intro, setIntro] = useState('');
  const [outro, setOutro] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const v = useRef<HTMLVideoElement>(null);
  const sponsors = useGet<{ brands: { name: string; creativeSets: { creatives: { id: string; name: string; approvalStatus: string; assetState: string; kind: string }[] }[] }[] }>(['sponsors'], 'sponsors');
  const approved = (sponsors.data?.brands ?? []).flatMap((b) => b.creativeSets.flatMap((s) => s.creatives.filter((c) => c.approvalStatus === 'approved' && c.assetState === 'READY').map((c) => ({ ...c, brand: b.name }))));
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    const loop = () => {
      if (el.currentTime * 1000 >= trim[1] || el.currentTime * 1000 < trim[0] - 100) el.currentTime = trim[0] / 1000;
    };
    el.addEventListener('timeupdate', loop);
    return () => el.removeEventListener('timeupdate', loop);
  }, [trim]);
  const r = RATIO[aspect]!;
  const boxW = r >= 16 / 9 ? 100 : (r / (16 / 9)) * 100;
  const left = Math.max(0, Math.min(100 - boxW, focusX * 100 - boxW / 2));
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post(`clips/${clip.id}/exports`, { aspect, trimInMs: Math.round(trim[0]), trimOutMs: Math.round(trim[1]), focusX, introCreativeId: intro || null, outroCreativeId: outro || null });
      onExported();
      onClose();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog wide open onOpenChange={(o) => !o && onClose()} title={`Edit “${clip.title}”`} description={clip.stale ? 'This clip is stale: the source event was corrected. Review before publishing.' : undefined} footer={<Button variant="primary" disabled={busy || trim[1] - trim[0] < 1000} onClick={() => void submit()}>Export {aspect}</Button>}>
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded bg-black">
          {clip.mediaUrl ? <video ref={v} src={clip.mediaUrl} controls muted className="aspect-video w-full" /> : null}
          {aspect !== '16:9' ? <div aria-hidden className="pointer-events-none absolute inset-y-0 border-2 border-warning shadow-[0_0_0_9999px_rgba(0,0,0,.55)]" style={{ left: `${left}%`, width: `${boxW}%` }} /> : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`Trim in · ${fmt(trim[0])}`} htmlFor="ti"><input id="ti" type="range" className="w-full" min={0} max={dur} step={100} value={trim[0]} onChange={(e) => setTrim([Math.min(Number(e.target.value), trim[1] - 1000), trim[1]])} /></Field>
          <Field label={`Trim out · ${fmt(trim[1])}`} htmlFor="to"><input id="to" type="range" className="w-full" min={0} max={dur} step={100} value={trim[1]} onChange={(e) => setTrim([trim[0], Math.max(Number(e.target.value), trim[0] + 1000)])} /></Field>
          <Field label="Aspect" htmlFor="as"><NativeSelect id="as" value={aspect} onChange={(e) => setAspect(e.target.value)}><option value="16:9">16:9 landscape (1920×1080)</option><option value="9:16">9:16 vertical (1080×1920)</option><option value="1:1">1:1 square (1080×1080)</option></NativeSelect></Field>
          <Field label="Crop focus" htmlFor="fx" hint="Horizontal position of the crop window"><input id="fx" type="range" className="w-full" min={0} max={1} step={0.01} disabled={aspect === '16:9'} value={focusX} onChange={(e) => setFocusX(Number(e.target.value))} /></Field>
          <Field label="Intro bumper" htmlFor="in"><NativeSelect id="in" value={intro} onChange={(e) => setIntro(e.target.value)}><option value="">None</option>{approved.map((c) => <option key={c.id} value={c.id}>{c.brand} · {c.name}</option>)}</NativeSelect></Field>
          <Field label="Outro bumper" htmlFor="out"><NativeSelect id="out" value={outro} onChange={(e) => setOutro(e.target.value)}><option value="">None</option>{approved.map((c) => <option key={c.id} value={c.id}>{c.brand} · {c.name}</option>)}</NativeSelect></Field>
        </div>
        <p className="text-xs text-muted">Exports are made from the recorded programme: graphics already on air stay as broadcast; nothing is drawn twice.</p>
        <ErrorNotice error={err} />
      </div>
    </Dialog>
  );
}
