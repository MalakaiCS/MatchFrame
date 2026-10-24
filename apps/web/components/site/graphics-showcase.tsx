'use client';
// Public graphics showcase: every built-in graphic for a sport, in each look and output format, drawn by the same
// renderer the OBS page uses, with fictional sample data over an illustrated stadium. Choosing a graphic plays its
// entrance in the large preview. Until the renderer has loaded a still stands in, so the page is never empty.
// Thumbnails are settled frames (motion off, a fixed moment), shown one category at a time.
import type { Sport } from '@bs/domain';
import { BUILTIN_TEMPLATES, DEFAULT_THEMES, LOOKS as ALL_LOOKS, emptyState, type Category, type OutputFormat, type OverlayPublicState, type TemplateDef, type ThemeKey } from '@bs/graphics';
import { Renderer, Stage, THEMES } from '@bs/graphics/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { SAMPLE_SLOTS, sampleData, sampleVariables } from '@/components/theme-preview';
import { SCENE } from './graphics-sample';

type Look = ThemeKey;
const LOOKS = ALL_LOOKS.map((l) => ({ key: l.key, label: l.name, note: l.description }));
const SPORTS: { key: Sport; label: string; beta?: boolean }[] = [
  { key: 'football', label: 'Football' },
  { key: 'basketball', label: 'Basketball' },
  { key: 'futsal', label: 'Futsal', beta: true },
  { key: 'netball', label: 'Netball', beta: true },
  { key: 'rugby_league', label: 'Rugby league', beta: true },
  { key: 'afl', label: 'AFL', beta: true },
  { key: 'hockey', label: 'Hockey', beta: true },
];
const FORMATS: { key: OutputFormat; label: string }[] = [
  { key: '16:9', label: 'Widescreen' },
  { key: '9:16', label: 'Vertical' },
  { key: 'venue', label: 'Venue screen' },
];
const ORDER: Category[] = ['Scorebug', 'Match', 'Teams', 'Events', 'People', 'Stats', 'Sponsors', 'Media'];
const sceneFor = (sport: Sport) => (sport === 'basketball' || sport === 'netball' ? SCENE.basketball : SCENE.football);

function frame(t: TemplateDef, sport: Sport, startedAt: number, withScorebug: boolean): OverlayPublicState {
  const s = emptyState();
  if (withScorebug && t.layer !== 'scoreboard' && t.layer !== 'background' && t.layer !== 'fullframe') {
    s.scorebugVisible = true;
    s.layers.scoreboard = { cueId: 'bug', templateKey: 'builtin:scorebug', layer: 'scoreboard', variables: sampleVariables('builtin:scorebug', sport), startedAt: startedAt - 60_000, durationMs: null, source: 'operator' };
  }
  if (t.layer === 'scoreboard') s.scorebugVisible = true;
  s.layers[t.layer] = { cueId: `c-${startedAt}`, templateKey: t.key, layer: t.layer, variables: sampleVariables(t.key, sport), startedAt, durationMs: null, source: 'operator' };
  return s;
}

const selectCls = 'min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm font-medium text-text shadow-card hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25';

export function GraphicsShowcase() {
  const [mounted, setMounted] = useState(false);
  const [look, setLook] = useState<Look>('derby');
  const [sport, setSport] = useState<Sport>('football');
  const [format, setFormat] = useState<OutputFormat>('16:9');
  const [selected, setSelected] = useState('builtin:goal');
  const [category, setCategory] = useState<Category>('Events');
  const [playAt, setPlayAt] = useState(() => Date.now());
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);

  const graphics = useMemo(() => BUILTIN_TEMPLATES.filter((t) => t.sports.includes(sport)), [sport]);
  const byCategory = useMemo(() => ORDER.map((c) => [c, graphics.filter((t) => t.category === c)] as const).filter(([, l]) => l.length), [graphics]);
  const current = graphics.find((t) => t.key === selected) ?? graphics[0]!;
  const activeCategory = byCategory.some(([c]) => c === category) ? category : byCategory[0]![0];
  const shown = byCategory.find(([c]) => c === activeCategory)![1];
  const theme = DEFAULT_THEMES[look];
  const data = useMemo(() => sampleData(theme, sport, { shootout: current.key === 'builtin:shootout', review: true, format, now: playAt }), [theme, sport, current.key, format, playAt]);
  const state = useMemo(() => frame(current, sport, playAt, true), [current, sport, playAt]);
  const choose = (key: string) => {
    setSelected(key);
    setPlayAt(Date.now());
    // on a phone the preview is above the list: bring it back into view
    if (window.matchMedia('(max-width: 1023px)').matches) preview.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const changeSport = (s: Sport) => {
    setSport(s);
    setPlayAt(Date.now());
    if (!BUILTIN_TEMPLATES.find((t) => t.key === selected)?.sports.includes(s)) setSelected('builtin:scorebug');
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
        <label className="block text-sm font-medium text-text">
          Sport
          <select value={sport} onChange={(e) => changeSport(e.target.value as Sport)} className={`mt-1.5 ${selectCls}`}>
            {SPORTS.map((s) => <option key={s.key} value={s.key}>{s.label}{s.beta ? ' (beta)' : ''}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-text">
          Look
          <select value={look} onChange={(e) => { setLook(e.target.value as Look); setPlayAt(Date.now()); }} className={`mt-1.5 ${selectCls}`}>
            {LOOKS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </label>
        <div className="sm:col-span-2 lg:col-span-1">
          <span className="block text-sm font-medium text-text" id="format-label">Format</span>
          <div role="radiogroup" aria-labelledby="format-label" className="mt-1.5 flex w-full rounded-xl border border-border bg-panel p-1 shadow-card lg:w-auto">
            {FORMATS.map((f) => (
              <button key={f.key} type="button" role="radio" aria-checked={format === f.key} onClick={() => { setFormat(f.key); setPlayAt(Date.now()); }} className={`min-h-9 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition lg:flex-none ${format === f.key ? 'bg-primary text-on-primary' : 'text-muted hover:text-text'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">{LOOKS.find((l) => l.key === look)!.note}</p>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div ref={preview} className="scroll-mt-24">
          <div className={`relative mx-auto overflow-hidden rounded-2xl border border-border bg-[#05080d] shadow-pop ${format === '9:16' ? 'aspect-[9/16] max-h-[70vh] max-w-[24rem]' : 'aspect-video'}`}>
            {mounted ? (
              <Stage background={sceneFor(sport)} format={format}>
                <Renderer state={state} data={data} themes={THEMES} serverNow={() => Date.now()} slots={SAMPLE_SLOTS} />
              </Stage>
            ) : (
              <>
                <img src="/site/graphic-goal.jpg" alt="" width={1600} height={900} className="size-full object-cover opacity-80" />
                <span className="absolute inset-0 grid place-items-center text-sm font-medium text-white" role="status"><span className="inline-flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading the live preview…</span></span>
              </>
            )}
            <span data-sample-chip className="pointer-events-none absolute bottom-2.5 right-2.5 rounded-md bg-black/65 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">Sample · fictional teams</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-text" aria-live="polite">{current.name}</p>
              <p className="text-sm text-muted">{current.category} · shows on the {current.layer === 'fullframe' ? 'full-screen' : current.layer === 'scoreboard' ? 'scorebug' : current.layer} layer</p>
            </div>
            <button type="button" onClick={() => setPlayAt(Date.now())} disabled={!mounted} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-strong/70 bg-panel px-4 text-sm font-semibold text-text hover:border-primary hover:text-primary disabled:opacity-50">
              <RotateCcw className="size-4" aria-hidden /> Play again
            </button>
          </div>
        </div>

        <div>
          <div role="tablist" aria-label="Graphic categories" className="-mx-5 flex gap-1.5 relative overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {byCategory.map(([c, list]) => (
              <button key={c} type="button" role="tab" aria-selected={c === activeCategory} aria-controls="graphic-list" onClick={() => setCategory(c)} className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${c === activeCategory ? 'border-primary bg-primary/10 text-text' : 'border-border text-muted hover:text-text'}`}>
                {c} <span className="text-xs font-medium text-muted">{list.length}</span>
              </button>
            ))}
          </div>
          <ul id="graphic-list" role="tabpanel" aria-label={`${activeCategory} graphics`} className="mt-4 grid grid-cols-2 gap-3">
            {shown.map((t) => (
              <li key={t.key}>
                <button type="button" aria-pressed={t.key === current.key} onClick={() => choose(t.key)} className={`w-full rounded-xl border p-1.5 text-left transition ${t.key === current.key ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-border-strong'}`}>
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-[#0b1220]">{mounted ? <Thumb t={t} sport={sport} look={look} /> : null}</div>
                  <span className="mt-1.5 block truncate px-0.5 text-sm font-medium text-text">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">{graphics.length} graphics for {SPORTS.find((s) => s.key === sport)!.label.toLowerCase()} in this look. Every look has the same set.</p>
        </div>
      </div>
    </div>
  );
}

/** A settled frame of one graphic: motion off, drawn at one fixed moment shared with its sample data. */
const Thumb = memo(function Thumb({ t, sport, look }: { t: TemplateDef; sport: Sport; look: Look }) {
  const at = useMemo(() => Date.now(), []);
  const data = useMemo(() => sampleData({ ...DEFAULT_THEMES[look], motion: 'none' }, sport, { shootout: t.key === 'builtin:shootout', review: true, now: at }), [t.key, sport, look, at]);
  const state = useMemo(() => frame(t, sport, at - 60_000, false), [t, sport, at]);
  return (
    <Stage background={sceneFor(sport)}>
      <Renderer state={state} data={data} themes={THEMES} serverNow={() => at} slots={SAMPLE_SLOTS} />
    </Stage>
  );
});
