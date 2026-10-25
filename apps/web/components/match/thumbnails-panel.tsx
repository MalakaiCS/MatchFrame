'use client';
// Match → Thumbnails: the match's video thumbnails in its look, one for each kind of video (the live stream,
// highlights, extended highlights, the full match, or the club's own words), to download as a PNG at YouTube's
// size or full HD. Drawn in the browser from the match's OBS output data, so a new crest or look shows at once.
import { useLayoutEffect, useRef, useState } from 'react';
import { Download, Images } from 'lucide-react';
import type { RenderData } from '@bs/graphics';
import { MatchThumbnail, THUMBNAIL_KINDS, THUMBNAIL_SIZE, type ThumbnailKind, type ThumbnailOptions } from '@bs/graphics/react';
import { Button, Card, ErrorNotice, Field, Input, NativeSelect, Spinner, Switch } from '@bs/ui';
import { useGet } from '@/lib/hooks';
import { saveBlob, thumbnailName, THUMBNAIL_SIZES, useThumbnailMaker } from '@/components/thumbnail-maker';

/** A thumbnail scaled to the width it is given. */
function Preview({ data, o }: { data: RenderData; o: ThumbnailOptions }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / THUMBNAIL_SIZE.width || 0.3);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: '16 / 9' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <MatchThumbnail data={data} {...o} />
      </div>
    </div>
  );
}

/** The thumbnails from the match's render data (the same data its OBS output draws from). */
export function useMatchRenderData(matchId: string) {
  const overlays = useGet<{ id: string; name: string }[]>(['overlays', matchId], `matches/${matchId}/overlays`);
  const overlayId = overlays.data?.[0]?.id ?? null;
  const rd = useGet<{ data: RenderData }>(['render-data', overlayId], overlayId ? `overlays/${overlayId}/render-data` : null);
  return { data: rd.data?.data ?? null, loading: overlays.isLoading || rd.isLoading, error: overlays.error ?? rd.error ?? null, noOutput: overlays.isSuccess && !overlayId };
}

export function ThumbnailsPanel({ matchId }: { matchId: string }) {
  const rd = useMatchRenderData(matchId);
  const maker = useThumbnailMaker();
  const [showScore, setShowScore] = useState(false);
  const [names, setNames] = useState(true);
  const [words, setWords] = useState('MATCH REPLAY');
  const [size, setSize] = useState<(typeof THUMBNAIL_SIZES)[number]['key']>('1280');
  const [busy, setBusy] = useState<ThumbnailKind | 'all' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (rd.loading) return <Spinner />;
  if (rd.error) return <ErrorNotice error={rd.error} />;
  if (rd.noOutput || !rd.data) return <Card className="p-4 text-sm text-muted">The thumbnails are drawn in the look of this match&apos;s OBS output. Add an output on the OBS link tab first.</Card>;
  const data = rd.data;
  const opts = (kind: ThumbnailKind): ThumbnailOptions => ({ kind, showScore, names, label: kind === 'custom' ? words : null });
  const dims = THUMBNAIL_SIZES.find((s) => s.key === size)!;
  const save = async (kinds: ThumbnailKind[], which: ThumbnailKind | 'all') => {
    setBusy(which);
    setErr(null);
    try {
      for (const k of kinds) saveBlob(await maker.make(data, opts(k), dims), thumbnailName(data, k === 'custom' ? words || 'thumbnail' : THUMBNAIL_KINDS.find((x) => x.kind === k)!.name));
    } catch (e) {
      setErr((e as Error).message || 'The thumbnail could not be drawn in this browser.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4">
      {maker.node}
      <Card className="grid gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Thumbnails</h2>
            <p className="text-sm text-muted">For the video of this match on YouTube, Facebook or your website: the competition, the round and both crests in this match&apos;s look. They follow the crests, colours and look you set.</p>
          </div>
          <Button variant="secondary" onClick={() => void save(THUMBNAIL_KINDS.map((k) => k.kind), 'all')} disabled={!!busy}><Images className="h-4 w-4" />{busy === 'all' ? 'Saving…' : 'Download all'}</Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Thumbnail size" htmlFor="th-size"><NativeSelect id="th-size" value={size} onChange={(e) => setSize(e.target.value as typeof size)}>{THUMBNAIL_SIZES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</NativeSelect></Field>
          <Field label="Your own words" htmlFor="th-words" hint="On the last thumbnail, e.g. MATCH REPLAY or GRAND FINAL"><Input id="th-words" maxLength={28} value={words} onChange={(e) => setWords(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Switch label="Show the score" checked={showScore} onCheckedChange={setShowScore} />
          <Switch label="Team names under the crests" checked={names} onCheckedChange={setNames} />
        </div>
        {err ? <p role="alert" className="text-sm text-live">{err}</p> : null}
      </Card>
      <ul aria-label="Thumbnails" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {THUMBNAIL_KINDS.map((k) => (
          <li key={k.kind} data-thumbnail-card={k.kind}>
            <Card className="grid gap-3 p-3">
              <Preview data={data} o={opts(k.kind)} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{k.kind === 'custom' ? `Your own words: ${words || '–'}` : k.name}</span>
                <Button size="sm" variant="secondary" aria-label={`Download the ${k.kind === 'custom' ? 'own words' : k.name.toLowerCase()} thumbnail`} onClick={() => void save([k.kind], k.kind)} disabled={!!busy}><Download className="h-4 w-4" />{busy === k.kind ? 'Saving…' : 'PNG'}</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
