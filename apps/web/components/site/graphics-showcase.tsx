'use client';
// Public graphics showcase: every built-in graphic for a sport, in each look and output format, drawn by the
// same renderer the OBS page uses, with fictional sample data. Choosing a card plays it in the large preview.
import type { Sport } from '@bs/domain';
import { BUILTIN_TEMPLATES, DEFAULT_THEMES, LOOKS as ALL_LOOKS, emptyState, type Category, type OutputFormat, type OverlayPublicState, type TemplateDef, type ThemeKey } from '@bs/graphics';
import { Renderer, Stage, THEMES } from '@bs/graphics/react';
import { memo, useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { SAMPLE_SLOTS, sampleData, sampleVariables } from '@/components/theme-preview';

type Look = ThemeKey;
const LOOKS = ALL_LOOKS.map((l) => ({ key: l.key, label: l.name, note: l.description }));
const SPORTS: { key: Sport; label: string }[] = [
  { key: 'football', label: 'Football' },
  { key: 'basketball', label: 'Basketball' },
  { key: 'netball', label: 'Netball (beta)' },
  { key: 'rugby_league', label: 'Rugby league (beta)' },
  { key: 'afl', label: 'AFL (beta)' },
  { key: 'hockey', label: 'Hockey (beta)' },
];
const FORMATS: { key: OutputFormat; label: string }[] = [
  { key: '16:9', label: 'Widescreen 16:9' },
  { key: '9:16', label: 'Vertical 9:16' },
  { key: 'venue', label: 'Venue screen' },
];
const ORDER: Category[] = ['Scorebug', 'Match', 'Teams', 'Events', 'People', 'Stats', 'Sponsors', 'Media'];
const PITCH = 'linear-gradient(180deg, #24476b 0%, #1d3b2a 55%, #2f6b3c 100%)';

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

export function GraphicsShowcase() {
  const [mounted, setMounted] = useState(false);
  const [look, setLook] = useState<Look>('broadcast');
  const [sport, setSport] = useState<Sport>('football');
  const [format, setFormat] = useState<OutputFormat>('16:9');
  const [selected, setSelected] = useState('builtin:goal');
  const [playAt, setPlayAt] = useState(() => Date.now());
  useEffect(() => setMounted(true), []);

  const graphics = useMemo(() => BUILTIN_TEMPLATES.filter((t) => t.sports.includes(sport)), [sport]);
  const byCategory = useMemo(() => ORDER.map((c) => [c, graphics.filter((t) => t.category === c)] as const).filter(([, l]) => l.length), [graphics]);
  const current = graphics.find((t) => t.key === selected) ?? graphics[0]!;
  const theme = DEFAULT_THEMES[look];
  const data = useMemo(() => sampleData(theme, sport, { shootout: current.key === 'builtin:shootout', format }), [theme, sport, current.key, format]);
  const state = useMemo(() => frame(current, sport, playAt, true), [current, sport, playAt]);
  const choose = (key: string) => {
    setSelected(key);
    setPlayAt(Date.now());
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Sport
          <select value={sport} onChange={(e) => setSport(e.target.value as Sport)} className="min-h-10 rounded-lg border border-white/10 bg-panel px-3 text-sm text-white">
            {SPORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Look
          <select value={look} onChange={(e) => setLook(e.target.value as Look)} className="min-h-10 rounded-lg border border-white/10 bg-panel px-3 text-sm text-white">
            {LOOKS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)} className="min-h-10 rounded-lg border border-white/10 bg-panel px-3 text-sm text-white">
            {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <p className="self-end pb-2 text-sm text-muted">{LOOKS.find((l) => l.key === look)!.note}</p>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className={`relative mx-auto overflow-hidden rounded-xl border border-white/10 bg-black ${format === '9:16' ? 'aspect-[9/16] max-w-sm' : 'aspect-video'}`}>
            {mounted ? (
              <Stage background={PITCH} format={format}>
                <Renderer state={state} data={data} themes={THEMES} serverNow={() => Date.now()} slots={SAMPLE_SLOTS} />
              </Stage>
            ) : null}
            <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/90">Sample · fictional teams</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-white">{current.name}</p>
              <p className="text-xs text-muted">{current.category} · shows on the {current.layer === 'fullframe' ? 'full-screen' : current.layer === 'scoreboard' ? 'scorebug' : current.layer} layer</p>
            </div>
            <button type="button" onClick={() => setPlayAt(Date.now())} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-4 text-sm text-white hover:border-brand-cyan hover:text-brand-cyan">
              <Play className="size-4" aria-hidden /> Play again
            </button>
          </div>
        </div>
        <div className="max-h-[38rem] space-y-5 overflow-y-auto pr-1">
          {byCategory.map(([cat, list]) => (
            <section key={cat} aria-label={cat}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted">{cat}</h3>
              <ul className="grid grid-cols-2 gap-2">
                {list.map((t) => (
                  <li key={t.key}>
                    <button type="button" aria-pressed={t.key === current.key} onClick={() => choose(t.key)} className={`w-full rounded-lg border p-1.5 text-left transition ${t.key === current.key ? 'border-brand-cyan bg-brand-cyan/10' : 'border-white/10 hover:border-white/30'}`}>
                      <div className="relative aspect-video overflow-hidden rounded">{mounted ? <Thumb t={t} sport={sport} look={look} /> : null}</div>
                      <span className="mt-1 block truncate text-xs text-white/90">{t.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A settled frame of one graphic (motion off, so it redraws a few times a second rather than every frame). */
const Thumb = memo(function Thumb({ t, sport, look }: { t: TemplateDef; sport: Sport; look: Look }) {
  const data = useMemo(() => sampleData({ ...DEFAULT_THEMES[look], motion: 'none' }, sport, { shootout: t.key === 'builtin:shootout' }), [t.key, sport, look]);
  const state = useMemo(() => frame(t, sport, 0, false), [t, sport]);
  return (
    <Stage background={PITCH}>
      <Renderer state={state} data={data} themes={THEMES} serverNow={() => 60_000} slots={SAMPLE_SLOTS} />
    </Stage>
  );
});
