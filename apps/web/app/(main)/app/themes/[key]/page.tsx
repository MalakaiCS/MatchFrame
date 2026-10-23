'use client';
import { SportOptions } from '@/components/sport-options';
import type { Sport } from '@bs/domain';
import Link from 'next/link';
import { Suspense, use, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Film, LogOut, Play, Repeat } from 'lucide-react';
import { BUILTIN_TEMPLATES, DEFAULT_THEMES, OUTPUT_FORMATS, emptyState, type Category, type OutputFormat, type OverlayPublicState, type TemplateDef, type ThemeConfig } from '@bs/graphics';
import { CHECKERBOARD, Keyframes, Renderer, Stage, THEMES } from '@bs/graphics/react';
import { Button, Card, ErrorNotice, NativeSelect, PageHeader, Spinner, StatusPill, Switch } from '@bs/ui';
import { SAMPLE_SLOTS, sampleData, sampleVariables } from '@/components/theme-preview';
import { ReplayExportDialog } from '@/components/replay-export';
import { useGet } from '@/lib/hooks';

type Backdrop = 'pitch' | 'transparent' | 'dark';

interface Theme { id: string; key: string; name: string; description: string | null; versions: { id: string; version: number; config: ThemeConfig }[] }
interface Profile { id: string; name: string; draft: { themeKey: string; config: Partial<ThemeConfig> } }

const CATEGORY_ORDER: Category[] = ['Scorebug', 'Match', 'Teams', 'Events', 'People', 'Stats', 'Sponsors', 'Media'];
const BACKDROPS: Record<Backdrop, string> = {
  pitch: 'linear-gradient(180deg, #24476b 0%, #1d3b2a 55%, #2f6b3c 100%)',
  transparent: CHECKERBOARD,
  dark: '#05080d',
};
/** Hold time used while looping, so a cycle stays short even for graphics that normally stay up until taken out. */
const LOOP_HOLD_MS = 2500;

function cueState(t: TemplateDef, sport: Sport, startedAt: number, durationMs: number | null, outAt: number | null, withScorebug: boolean): OverlayPublicState {
  const s = emptyState();
  if (withScorebug && t.layer !== 'scoreboard') {
    s.scorebugVisible = true;
    s.layers.scoreboard = { cueId: 'bug', templateKey: 'builtin:scorebug', layer: 'scoreboard', variables: sampleVariables('builtin:scorebug', sport), startedAt: startedAt - 60_000, durationMs: null, source: 'operator' };
  }
  if (t.layer === 'scoreboard') s.scorebugVisible = true;
  s.layers[t.layer] = { cueId: `c-${startedAt}`, templateKey: t.key, layer: t.layer, variables: sampleVariables(t.key, sport), startedAt, durationMs, source: 'operator', outAt };
  return s;
}

const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'look';

export default function ThemeDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  return (
    <Suspense fallback={<Spinner />}>
      <ThemeDetail themeKey={key} />
    </Suspense>
  );
}

function ThemeDetail({ themeKey }: { themeKey: string }) {
  const profileId = useSearchParams().get('profile');
  const themes = useGet<Theme[]>(['themes'], 'themes');
  const profiles = useGet<Profile[]>(['theme-profiles'], 'theme-profiles', { enabled: !!profileId });
  const meta = themes.data?.find((t) => t.key === themeKey);
  const profile = profileId ? profiles.data?.find((p) => p.id === profileId) : undefined;
  const base = (meta?.versions[0]?.config as ThemeConfig | undefined) ?? DEFAULT_THEMES[themeKey as ThemeConfig['themeKey']];
  const theme = useMemo<ThemeConfig | undefined>(() => (base ? { ...base, ...profile?.draft.config, themeKey: base.themeKey } : undefined), [base, profile]);

  const [sport, setSport] = useState<Sport>('football');
  const [backdrop, setBackdrop] = useState<Backdrop>('pitch');
  const [format, setFormat] = useState<OutputFormat>('16:9');
  const [withScorebug, setWithScorebug] = useState(true);
  const [loop, setLoop] = useState(true);
  const [replayOpen, setReplayOpen] = useState(false);
  const graphics = useMemo(() => BUILTIN_TEMPLATES.filter((t) => t.sports.includes(sport)), [sport]);
  const [selectedKey, setSelectedKey] = useState('builtin:scorebug');
  const previewRef = useRef<HTMLDivElement>(null);
  const select = (k: string) => {
    setSelectedKey(k);
    replay();
    // the preview sits above the list: bring it back into view when picking a graphic further down
    const r = previewRef.current?.getBoundingClientRect();
    if (r && r.top < 0) previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const selected = graphics.find((t) => t.key === selectedKey) ?? graphics[0]!;

  // Timeline of the large preview: Take In at `startedAt`; Take Out sets `outAt`; loop restarts after the exit.
  const [run, setRun] = useState(() => ({ startedAt: Date.now(), outAt: null as number | null }));
  const replay = () => setRun({ startedAt: Date.now(), outAt: null });
  const takeOut = () => setRun((r) => (r.outAt ? r : { ...r, outAt: Date.now() }));
  useEffect(replay, [selected.key, sport, loop]);
  // without the loop a graphic stays for its own hold time; a transition stays at full cover until Take out
  const durationMs = loop ? selected.entranceMs + LOOP_HOLD_MS : selected.layer === 'transition' ? null : selected.holdMs;
  useEffect(() => {
    if (!loop) return;
    const end = run.outAt ?? run.startedAt + selected.entranceMs + LOOP_HOLD_MS;
    const id = setTimeout(replay, Math.max(0, end + selected.exitMs + 700 - Date.now()));
    return () => clearTimeout(id);
  }, [loop, run, selected]);

  const data = useMemo(() => (theme ? sampleData(theme, sport, { shootout: selectedKey === 'builtin:shootout', review: selectedKey === 'builtin:review', timers: selectedKey === 'builtin:scorebug', format }) : null), [theme, sport, selectedKey, format]);
  const state = useMemo(() => cueState(selected, sport, run.startedAt, durationMs, run.outAt, withScorebug), [selected, sport, run, durationMs, withScorebug]);

  if (themes.isLoading) return <Spinner />;
  if (!theme || !data) {
    return (
      <>
        <PageHeader title="Theme not found" crumbs={<Link href="/app/themes" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="size-3" /> Themes</Link>} />
        <ErrorNotice error={themes.error ?? { message: `No theme called "${themeKey}".` }} />
      </>
    );
  }

  const byCategory = CATEGORY_ORDER.map((c) => [c, graphics.filter((t) => t.category === c)] as const).filter(([, list]) => list.length);
  const hold = selected.holdMs == null ? 'until taken out' : `${(selected.holdMs / 1000).toFixed(0)} s`;

  return (
    <>
      <Keyframes />
      <PageHeader
        title={profile ? `${profile.name} (${meta?.name ?? themeKey})` : (meta?.name ?? themeKey)}
        subtitle={meta?.description ?? undefined}
        crumbs={<Link href="/app/themes" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="size-3" /> Themes</Link>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Sport" value={sport} onChange={(e) => setSport(e.target.value as Sport)}><SportOptions /></NativeSelect>
            <NativeSelect aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}>{OUTPUT_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</NativeSelect>
            <NativeSelect aria-label="Background" value={backdrop} onChange={(e) => setBackdrop(e.target.value as Backdrop)}><option value="pitch">Background: pitch</option><option value="transparent">Background: transparent</option><option value="dark">Background: dark</option></NativeSelect>
            <Button onClick={() => setReplayOpen(true)}><Film className="size-4" /> Replay transition (WebM)</Button>
          </div>
        }
      />
      <ReplayExportDialog open={replayOpen} onOpenChange={setReplayOpen} data={data} fileBase={`replay-${slugOf(profile?.name ?? meta?.name ?? themeKey)}`} lookName={profile ? `${profile.name} (${meta?.name ?? themeKey})` : (meta?.name ?? themeKey)} />

      <div ref={previewRef} className="grid scroll-mt-4 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className={format === '9:16' ? 'relative mx-auto aspect-[9/16] max-h-[72vh] overflow-hidden rounded-md border border-border' : 'relative aspect-video overflow-hidden rounded-md border border-border'} data-testid="theme-preview-stage">
            <Stage background={BACKDROPS[backdrop]} format={format}>
              <Renderer state={state} data={data} themes={THEMES} serverNow={Date.now} slots={SAMPLE_SLOTS} />
            </Stage>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={replay}><Play className="size-4" /> Replay</Button>
            <Button onClick={takeOut} disabled={!!run.outAt}><LogOut className="size-4" /> Take out</Button>
            <Switch checked={loop} onCheckedChange={setLoop} label="Loop" />
            {selected.layer !== 'scoreboard' ? <Switch checked={withScorebug} onCheckedChange={setWithScorebug} label="Show with scorebug" /> : null}
          </div>
        </div>

        <Card className="p-4">
          <h2 className="text-lg font-medium">{selected.name}</h2>
          <p className="text-sm text-muted">{selected.category} · {selected.sports.join(' & ')}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted">Motion</dt><dd>{theme.motion === 'none' ? 'off (appears without animation)' : theme.motion}</dd>
            <dt className="text-muted">Entrance</dt><dd>{selected.entranceMs} ms</dd>
            <dt className="text-muted">On screen</dt><dd>{hold}</dd>
            <dt className="text-muted">Exit</dt><dd>{selected.exitMs} ms</dd>
            <dt className="text-muted">Layer</dt><dd>{selected.layer}</dd>
            {selected.requiredData.length ? <><dt className="text-muted">Uses</dt><dd>{selected.requiredData.join(', ')}</dd></> : null}
            {selected.sponsorSlots.length ? <><dt className="text-muted">Sponsor slot</dt><dd>{selected.sponsorSlots.join(', ').replaceAll('_', ' ')}</dd></> : null}
          </dl>
          {selected.variables.length ? (
            <>
              <h3 className="mt-4 text-sm font-medium">Operator fills in</h3>
              <ul className="mt-1 flex flex-wrap gap-1">{selected.variables.map((v) => <li key={v.key}><StatusPill icon={false}>{v.label}{v.required ? ' *' : ''}</StatusPill></li>)}</ul>
            </>
          ) : null}
          <p className="mt-4 text-xs text-muted">Sample teams, players and sponsor are fictional. Loop shortens the on-screen time to {LOOP_HOLD_MS / 1000} s; turn it off to see the real timing.</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6">
        {byCategory.map(([cat, list]) => (
          <section key={cat}>
            <h2 className="mb-2 text-sm font-medium text-muted">{cat}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {list.map((t) => (
                <GraphicThumb key={t.key} t={t} sport={sport} theme={theme} backdrop={BACKDROPS[backdrop]} active={t.key === selected.key} onSelect={() => select(t.key)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/** Static (holding) frame of one graphic; clicking plays it in the large preview. */
function GraphicThumb({ t, sport, theme, backdrop, active, onSelect }: { t: TemplateDef; sport: Sport; theme: ThemeConfig; backdrop: string; active: boolean; onSelect: () => void }) {
  const data = useMemo(() => sampleData(theme, sport, { shootout: t.key === 'builtin:shootout', review: true }), [theme, sport, t.key]);
  const state = useMemo(() => cueState(t, sport, Date.now() - 60_000, null, null, false), [t, sport]);
  return (
    <button type="button" onClick={onSelect} aria-pressed={active} className={`group rounded-md border p-2 text-left transition ${active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/60'}`}>
      <div className="relative aspect-video overflow-hidden rounded">
        <Stage background={backdrop}><Renderer state={state} data={data} themes={THEMES} serverNow={Date.now} slots={SAMPLE_SLOTS} /></Stage>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t.name}</span>
        <Repeat className={`size-3.5 ${active ? 'text-primary' : 'text-muted opacity-0 group-hover:opacity-100'}`} aria-hidden />
      </div>
    </button>
  );
}
