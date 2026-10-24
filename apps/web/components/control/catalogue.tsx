'use client';
import { memo, useMemo } from 'react';
import { BUILTIN_TEMPLATES, emptyState, type Layer, type OverlayPublicState, type RenderData, type TemplateDef } from '@bs/graphics';
import { Renderer, Stage, THEMES, renderCustomScene } from '@bs/graphics/react';
import { cx } from '@bs/ui';

export const CATEGORIES = ['Scorebug', 'Match', 'Teams', 'Events', 'Stats', 'People', 'Sponsors', 'Media'] as const;

export function defaultVariables(t: TemplateDef, data: RenderData): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const x of t.variables) {
    if (x.default !== undefined) v[x.key] = x.default;
    if (x.type === 'team') v[x.key] = 'home';
    if (x.key === 'heading') v[x.key] = data.match.competition.name;
    if (x.key === 'text' && t.key === 'builtin:ticker') v[x.key] = `${data.match.teams.home.name} v ${data.match.teams.away.name}`;
  }
  return v;
}

/** Live-data thumbnail: the real renderer at thumbnail scale with sample variables. */
const Thumb = memo(function Thumb({ t, data, serverNow }: { t: TemplateDef; data: RenderData; serverNow: () => number }) {
  const state: OverlayPublicState = useMemo(() => {
    const s = emptyState();
    const startedAt = serverNow() - 60_000; // hold phase: no animation in thumbnails
    s.layers[t.layer as Layer] = { cueId: 'thumb', templateKey: t.key, layer: t.layer, variables: defaultVariables(t, data), startedAt, durationMs: null, source: 'operator' };
    s.scorebugVisible = t.layer === 'scoreboard';
    return s;
  }, [t, data, serverNow]);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded bg-[repeating-conic-gradient(#1b2433_0%_25%,#141c29_0%_50%)] bg-[length:16px_16px]" aria-hidden>
      <Stage>
        <Renderer state={state} data={data} themes={THEMES} serverNow={serverNow} renderCustom={renderCustomScene} />
      </Stage>
    </div>
  );
});

export function Catalogue({ data, onAir, selected, onSelect, search, custom, serverNow, sport }: { data: RenderData; onAir: Map<string, string>; selected: string | null; onSelect: (key: string) => void; search: string; custom: TemplateDef[]; serverNow: () => number; sport: string }) {
  const all = [...BUILTIN_TEMPLATES, ...custom].filter((t) => t.sports.includes(sport as never) && (!search || t.name.toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="grid gap-4">
      {CATEGORIES.map((cat) => {
        const items = all.filter((t) => t.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat} aria-label={cat}>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{cat}</h3>
            <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
              {items.map((t) => {
                const layer = onAir.get(t.key);
                return (
                  <button key={t.key} onClick={() => onSelect(t.key)} aria-pressed={selected === t.key} data-template={t.key}
                    className={cx('rounded-md border-2 bg-panel p-1.5 text-left transition-colors', layer ? 'border-live' : selected === t.key ? 'border-primary' : 'border-border hover:border-muted')}>
                    <Thumb t={t} data={data} serverNow={serverNow} />
                    <div className="mt-1.5 flex items-center justify-between gap-1 px-0.5">
                      <span className="truncate text-xs font-medium">{t.name}</span>
                      {layer ? <span className="rounded bg-live px-1.5 py-0.5 text-[10px] font-bold text-white">ON AIR</span> : null}
                    </div>
                    <div className="px-0.5 text-[10px] text-muted">{t.variables.filter((v) => v.required).map((v) => v.label).join(', ') || 'No required inputs'} · {t.holdMs ? `${t.holdMs / 1000}s` : 'until out'}</div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
