'use client';
// The desk's graphics, grouped by section: a list by default (names big enough to find at a glance, what a graphic
// needs only when it needs something, its length when it goes out by itself) or tiles drawn by the real renderer.
import { memo, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { BUILTIN_TEMPLATES, emptyState, type Layer, type OverlayPublicState, type RenderData, type TemplateDef } from '@bs/graphics';
import { Renderer, Stage, THEMES, renderCustomScene } from '@bs/graphics/react';
import { cx } from '@bs/ui';

export const CATEGORIES = ['Scorebug', 'Match', 'Teams', 'Events', 'Stats', 'People', 'Sponsors', 'Media'] as const;
export type CatalogueView = 'list' | 'tiles';
const VIEW_KEY = 'mf-desk-view';

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

/** List or tiles, remembered in this browser. */
export function useCatalogueView(): [CatalogueView, (v: CatalogueView) => void] {
  const [view, setView] = useState<CatalogueView>('list');
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'tiles') setView('tiles');
    } catch {
      /* private mode: list */
    }
  }, []);
  const choose = (v: CatalogueView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  return [view, choose];
}

export function CatalogueViewToggle({ view, onChange }: { view: CatalogueView; onChange: (v: CatalogueView) => void }) {
  return (
    <div className="flex shrink-0 rounded-md border border-border bg-panel" role="group" aria-label="Show graphics as">
      {([['list', List, 'List'], ['tiles', LayoutGrid, 'Tiles']] as const).map(([v, Icon, label]) => (
        <button key={v} type="button" aria-pressed={view === v} title={label} onClick={() => onChange(v)} className={cx('grid h-9 w-9 place-items-center first:rounded-l-md last:rounded-r-md', view === v ? 'bg-primary/15 text-primary' : 'text-muted hover:text-text')}>
          <Icon className="size-4" aria-hidden /><span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
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

const needs = (t: TemplateDef) => t.variables.filter((v) => v.required).map((v) => v.label).join(', ');
const OnAirBadge = () => <span className="shrink-0 rounded bg-live px-1.5 py-0.5 text-[10px] font-bold text-white">ON AIR</span>;

export function Catalogue({ data, onAir, selected, onSelect, search, custom, serverNow, sport, view = 'list' }: { data: RenderData; onAir: Map<string, string>; selected: string | null; onSelect: (key: string) => void; search: string; custom: TemplateDef[]; serverNow: () => number; sport: string; view?: CatalogueView }) {
  const all = [...BUILTIN_TEMPLATES, ...custom].filter((t) => t.sports.includes(sport as never) && (!search || t.name.toLowerCase().includes(search.toLowerCase())));
  if (!all.length) return <p className="px-1 py-4 text-sm text-muted">No graphics match “{search}”.</p>;
  return (
    <div className="grid gap-4">
      {CATEGORIES.map((cat) => {
        const items = all.filter((t) => t.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat} aria-label={cat}>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{cat}</h3>
            {view === 'list' ? (
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-panel">
                {items.map((t) => {
                  const layer = onAir.get(t.key);
                  const n = needs(t);
                  return (
                    <li key={t.key}>
                      <button type="button" onClick={() => onSelect(t.key)} aria-pressed={selected === t.key} data-template={t.key}
                        className={cx('flex w-full items-center gap-3 border-l-4 px-3 py-2.5 text-left transition-colors', layer ? 'border-l-live' : 'border-l-transparent', selected === t.key ? 'bg-primary/10' : 'hover:bg-elevated')}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium text-text">{t.name}</span>
                          {n ? <span className="block truncate text-xs text-muted">Needs {n.toLowerCase()}</span> : null}
                        </span>
                        {t.holdMs ? <span className="shrink-0 text-xs tabular text-muted" title="Goes out by itself after this long">{t.holdMs / 1000} s</span> : null}
                        {layer ? <OnAirBadge /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
                {items.map((t) => {
                  const layer = onAir.get(t.key);
                  const n = needs(t);
                  return (
                    <button key={t.key} type="button" onClick={() => onSelect(t.key)} aria-pressed={selected === t.key} data-template={t.key}
                      className={cx('rounded-md border-2 bg-panel p-1.5 text-left transition-colors', layer ? 'border-live' : selected === t.key ? 'border-primary' : 'border-border hover:border-muted')}>
                      <Thumb t={t} data={data} serverNow={serverNow} />
                      <div className="mt-1.5 flex items-start justify-between gap-1 px-0.5">
                        <span className="line-clamp-2 text-sm font-medium leading-snug">{t.name}</span>
                        {layer ? <OnAirBadge /> : null}
                      </div>
                      {n || t.holdMs ? <div className="truncate px-0.5 text-xs text-muted">{[n ? `Needs ${n.toLowerCase()}` : null, t.holdMs ? `${t.holdMs / 1000} s` : null].filter(Boolean).join(' · ')}</div> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
