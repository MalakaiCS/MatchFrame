'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Redo2, Trash2, Undo2 } from 'lucide-react';
import { BINDING_PATHS, DEFAULT_THEMES, LAYERS, emptyState, type Scene, type SceneElement, type OverlayPublicState } from '@bs/graphics';
import { Keyframes, Renderer, Stage, THEMES, customDefsFrom, renderCustomScene } from '@bs/graphics/react';
import { Button, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Switch, cx } from '@bs/ui';
import { get, post, put } from '@/lib/api';
import { sampleData } from '@/components/theme-preview';

type Issue = { path: string; message: string };
const SNAP = 8;

function useHistory<T>(initial: T | null) {
  const [stack, setStack] = useState<{ past: T[]; present: T | null; future: T[] }>({ past: [], present: initial, future: [] });
  const set = useCallback((next: T, record = true) => setStack((s) => (record && s.present ? { past: [...s.past.slice(-80), s.present], present: next, future: [] } : { ...s, present: next })), []);
  const undo = useCallback(() => setStack((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1]!, future: s.present ? [s.present, ...s.future] : s.future } : s)), []);
  const redo = useCallback(() => setStack((s) => (s.future.length ? { past: s.present ? [...s.past, s.present] : s.past, present: s.future[0]!, future: s.future.slice(1) } : s)), []);
  const reset = useCallback((v: T) => setStack({ past: [], present: v, future: [] }), []);
  /** record a single history entry for a gesture whose intermediate steps were applied without recording */
  const commit = useCallback((before: T) => setStack((s) => ({ past: [...s.past.slice(-80), before], present: s.present, future: [] })), []);
  return { value: stack.present, set, undo, redo, reset, commit, canUndo: stack.past.length > 0, canRedo: stack.future.length > 0 };
}

const newId = (els: SceneElement[], base: string) => {
  let i = els.length + 1;
  while (els.some((e) => e.id === `${base}${i}`)) i++;
  return `${base}${i}`;
};

function blank(type: SceneElement['type'], id: string): SceneElement {
  const common = { id, name: `${type} ${id}`, x: 200, y: 700, w: 400, h: 100, anchor: 'tl' as const, opacity: 1, z: 1, animation: { in: 'fade' as const, out: 'fade' as const, delayMs: 0 } };
  switch (type) {
    case 'text': return { ...common, type: 'text', text: 'Text', fontSize: 48, fontWeight: 700, color: '#F3F6FB', align: 'left' };
    case 'image': return { ...common, type: 'image', fit: 'contain', w: 160, h: 160 };
    case 'sponsor_slot': return { ...common, type: 'sponsor_slot', placement: 'detached_logo', w: 260, h: 90 };
    case 'group': return { ...common, type: 'group', children: [] };
    default: return { ...common, type: 'rect', fill: '#131F32', radius: 6 };
  }
}

export default function Designer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const h = useHistory<Scene>(null);
  const [name, setName] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [warnings, setWarnings] = useState<Issue[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; scale: number; mode: 'move' | 'resize'; ow: number; oh: number; before: Scene } | null>(null);

  useEffect(() => {
    get<{ name: string; draft: Scene; currentVersion: number }>(`templates/${id}`)
      .then((t) => { setName(t.name); h.reset(t.draft); setVersion(t.currentVersion); })
      .catch((e) => setLoadErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const scene = h.value;
  const el = scene?.elements.find((e) => e.id === sel) ?? null;
  const update = (patch: Partial<SceneElement>, record = true) => scene && sel && h.set({ ...scene, elements: scene.elements.map((e) => (e.id === sel ? ({ ...e, ...patch } as SceneElement) : e)) }, record);
  const setScene = (patch: Partial<Scene>) => scene && h.set({ ...scene, ...patch });

  // keyboard: undo/redo/delete/nudge (not inside inputs)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey) { h.redo(); } else { h.undo(); } }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); h.redo(); }
      if (!el) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') { e.preventDefault(); update({ x: el.x - step }); }
      if (e.key === 'ArrowRight') { e.preventDefault(); update({ x: el.x + step }); }
      if (e.key === 'ArrowUp') { e.preventDefault(); update({ y: el.y - step }); }
      if (e.key === 'ArrowDown') { e.preventDefault(); update({ y: el.y + step }); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const data = useMemo(() => {
    const d = sampleData(DEFAULT_THEMES.broadcast);
    if (scene) d.customTemplates = [{ key: 'custom:draft', scene }];
    return d;
  }, [scene]);
  const previewState: OverlayPublicState = useMemo(() => {
    const s = emptyState();
    if (scene) s.layers[scene.layer] = { cueId: 'draft', templateKey: 'custom:draft', layer: scene.layer, variables: Object.fromEntries(scene.variables.map((v) => [v.key, v.default ?? (v.type === 'text' ? v.label : v.type === 'team' ? 'home' : undefined)])), startedAt: Date.now() - 60_000, durationMs: null, source: 'operator' };
    return s;
  }, [scene]);

  if (loadErr) return <ErrorNotice error={{ message: loadErr }} />;
  if (!scene) return <Spinner />;

  const add = (type: SceneElement['type']) => {
    const nid = newId(scene.elements, type.slice(0, 4));
    h.set({ ...scene, elements: [...scene.elements, { ...blank(type, nid), z: Math.max(0, ...scene.elements.map((e) => e.z)) + 1 }] });
    setSel(nid);
  };
  const remove = () => {
    if (!sel) return;
    h.set({ ...scene, elements: scene.elements.filter((e) => e.id !== sel) });
    setSel(null);
  };
  const duplicate = () => {
    if (!el) return;
    const nid = newId(scene.elements, el.id.replace(/\d+$/, ''));
    h.set({ ...scene, elements: [...scene.elements, { ...structuredClone(el), id: nid, name: `${el.name} copy`, x: el.x + 20, y: el.y + 20 }] });
    setSel(nid);
  };
  const zMove = (dir: 1 | -1) => el && update({ z: Math.max(0, el.z + dir) });

  const onPointerDown = (e: React.PointerEvent, eid: string, mode: 'move' | 'resize') => {
    e.stopPropagation();
    const target = scene.elements.find((x) => x.id === eid)!;
    const rect = canvas.current!.getBoundingClientRect();
    drag.current = { id: eid, sx: e.clientX, sy: e.clientY, ox: target.x, oy: target.y, ow: target.w, oh: target.h, scale: rect.width / 1920, mode, before: scene };
    setSel(eid);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.scale;
    const dy = (e.clientY - d.sy) / d.scale;
    const cur = scene.elements.find((x) => x.id === d.id)!;
    if (d.mode === 'resize') {
      h.set({ ...scene, elements: scene.elements.map((x) => (x.id === d.id ? ({ ...x, w: Math.max(4, Math.round((d.ow + dx) / SNAP) * SNAP), h: Math.max(4, Math.round((d.oh + dy) / SNAP) * SNAP) } as SceneElement) : x)) }, false);
      return;
    }
    let nx = Math.round((d.ox + dx) / SNAP) * SNAP;
    let ny = Math.round((d.oy + dy) / SNAP) * SNAP;
    // snap guides: stage centre, title-safe edges and other elements' edges
    const xs = [96, 1920 - 96, 960, ...scene.elements.filter((o) => o.id !== d.id).flatMap((o) => [o.x, o.x + o.w])];
    const ys = [54, 1080 - 54, 540, ...scene.elements.filter((o) => o.id !== d.id).flatMap((o) => [o.y, o.y + o.h])];
    const g: { x?: number; y?: number } = {};
    for (const gx of xs) {
      if (Math.abs(nx - gx) < 10) { nx = gx; g.x = gx; break; }
      if (Math.abs(nx + cur.w - gx) < 10) { nx = gx - cur.w; g.x = gx; break; }
      if (Math.abs(nx + cur.w / 2 - gx) < 10) { nx = gx - cur.w / 2; g.x = gx; break; }
    }
    for (const gy of ys) {
      if (Math.abs(ny - gy) < 10) { ny = gy; g.y = gy; break; }
      if (Math.abs(ny + cur.h - gy) < 10) { ny = gy - cur.h; g.y = gy; break; }
    }
    setGuides(g);
    h.set({ ...scene, elements: scene.elements.map((x) => (x.id === d.id ? ({ ...x, x: nx, y: ny } as SceneElement) : x)) }, false);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setGuides({});
    const moved = scene.elements.find((x) => x.id === d.id)!;
    if (moved.x !== d.ox || moved.y !== d.oy || moved.w !== d.ow || moved.h !== d.oh) h.commit(d.before);
  };
  const save = async () => {
    setStatus('Saving…');
    try {
      const r = await put<{ validation: { ok: boolean; issues: Issue[]; warnings: Issue[] } }>(`templates/${id}/draft`, { scene: { ...scene, name: name || scene.name } });
      setIssues(r.validation.issues);
      setWarnings(r.validation.warnings);
      setStatus(r.validation.ok ? 'Draft saved · valid' : `Draft saved · ${r.validation.issues.length} issue(s)`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const publish = async () => {
    await save();
    try {
      const r = await post<{ version: { version: number }; warnings: Issue[] }>(`templates/${id}/publish`);
      setVersion(r.version.version);
      setWarnings(r.warnings);
      setStatus(`Published v${r.version.version}. It now appears in control-room catalogues.`);
    } catch (e) {
      const ae = e as { message: string; fields?: { field: string; message: string }[] };
      if (ae.fields) setIssues(ae.fields.map((f) => ({ path: f.field, message: f.message })));
      setStatus(ae.message);
    }
  };
  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...scene, name }, null, 2)], { type: 'application/json' }));
    a.download = `${(name || 'template').replace(/\W+/g, '-')}.json`;
    a.click();
  };
  const importJson = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      h.set(j);
      setStatus('Imported. Save to validate.');
    } catch {
      setStatus('That file is not valid JSON');
    }
  };

  const textValue = el?.type === 'text' ? el.text : null;
  const bindingValue = textValue && typeof textValue === 'object' ? textValue.binding : '';

  return (
    <>
      <Keyframes />
      <PageHeader crumbs={<><Link href="/app/themes" className="hover:text-text">Themes</Link> / Templates</>} title={name || 'Template'} subtitle={<>Constrained designer: typed bindings only, no code. {version ? <StatusPill tone="primary">published v{version}</StatusPill> : <StatusPill tone="warning">not published</StatusPill>}</>}
        actions={<>
          <Button variant="ghost" onClick={h.undo} disabled={!h.canUndo} aria-label="Undo"><Undo2 className="size-4" /></Button>
          <Button variant="ghost" onClick={h.redo} disabled={!h.canRedo} aria-label="Redo"><Redo2 className="size-4" /></Button>
          <Button onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview with data'}</Button>
          <Button onClick={exportJson}>Export JSON</Button>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-sm">Import<input type="file" accept="application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} /></label>
          <Button onClick={save}>Save draft</Button>
          <Button variant="primary" onClick={publish}>Publish</Button>
        </>} />
      {status ? <p className="mb-2 text-sm text-muted" role="status">{status}</p> : null}
      {issues.length ? <ul className="mb-2 rounded-md border border-live/50 bg-live/10 p-2 text-sm text-live">{issues.map((i, k) => <li key={k}>{i.path}: {i.message}</li>)}</ul> : null}
      {warnings.length ? <ul className="mb-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-sm text-warning">{warnings.map((i, k) => <li key={k}>{i.message}</li>)}</ul> : null}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[220px_minmax(0,1fr)_300px]">
        <aside className="rounded-[var(--radius-card)] border border-border bg-panel p-3">
          <h3 className="mb-2 text-xs font-medium text-muted">Add</h3>
          <div className="mb-3 grid grid-cols-2 gap-1">{(['text', 'rect', 'image', 'sponsor_slot'] as const).map((t) => <Button key={t} size="sm" onClick={() => add(t)}>{t.replace('_', ' ')}</Button>)}</div>
          <h3 className="mb-2 text-xs font-medium text-muted">Layers</h3>
          <ul className="space-y-0.5 text-sm">
            {[...scene.elements].sort((a, b) => b.z - a.z).map((e) => (
              <li key={e.id} className={cx('flex items-center gap-1 rounded px-1.5 py-1', sel === e.id ? 'bg-elevated' : 'hover:bg-elevated/50')}>
                <button className="flex-1 truncate text-left" onClick={() => setSel(e.id)}>{e.name}</button>
                <button aria-label={e.hidden ? 'Show' : 'Hide'} className="text-muted" onClick={() => h.set({ ...scene, elements: scene.elements.map((x) => (x.id === e.id ? ({ ...x, hidden: !x.hidden } as SceneElement) : x)) })}>{e.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
              </li>
            ))}
          </ul>
        </aside>
        <div>
          <div ref={canvas} className="relative aspect-video select-none overflow-hidden rounded-md border border-border bg-[repeating-conic-gradient(#222b3a_0%_25%,#171e2a_0%_50%)] bg-[length:20px_20px]" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerDown={() => setSel(null)}>
            <Stage>
              {preview ? (
                <Renderer state={previewState} data={data} themes={THEMES} serverNow={() => Date.now()} customDefs={customDefsFrom(data.customTemplates)} renderCustom={renderCustomScene} />
              ) : (
                <>
                  <div className="pointer-events-none absolute border border-dashed border-warning/40" style={{ left: 96, top: 54, width: 1920 - 192, height: 1080 - 108 }} />
                  {guides.x != null ? <div className="pointer-events-none absolute top-0 h-full w-px bg-cyan" style={{ left: guides.x }} /> : null}
                  {guides.y != null ? <div className="pointer-events-none absolute left-0 h-px w-full bg-cyan" style={{ top: guides.y }} /> : null}
                  {[...scene.elements].sort((a, b) => a.z - b.z).map((e) => e.hidden ? null : (
                    <div key={e.id} onPointerDown={(ev) => onPointerDown(ev, e.id, 'move')} className={cx('absolute cursor-move', sel === e.id && 'outline outline-4 outline-primary')}
                      style={{ left: e.x, top: e.y, width: e.w, height: e.h, opacity: e.opacity, background: e.type === 'rect' ? (typeof e.fill === 'string' ? e.fill : '#3EA6FF55') : e.type === 'sponsor_slot' ? 'rgba(255,206,102,.25)' : e.type === 'image' ? 'rgba(255,255,255,.08)' : undefined, borderRadius: e.type === 'rect' ? e.radius : 0, color: e.type === 'text' && typeof e.color === 'string' ? e.color : '#fff', fontSize: e.type === 'text' ? e.fontSize : 24, fontWeight: e.type === 'text' ? e.fontWeight : 600, textAlign: e.type === 'text' ? e.align : 'center', display: 'flex', alignItems: 'center', justifyContent: e.type === 'text' ? (e.align === 'center' ? 'center' : e.align === 'right' ? 'flex-end' : 'flex-start') : 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {e.type === 'text' ? (typeof e.text === 'string' ? e.text : `{${e.text.binding}}`) : e.type === 'sponsor_slot' ? `sponsor: ${e.placement}` : e.type === 'image' ? 'image' : null}
                      {sel === e.id ? <span onPointerDown={(ev) => onPointerDown(ev, e.id, 'resize')} className="absolute bottom-0 right-0 size-6 cursor-se-resize bg-primary" /> : null}
                    </div>
                  ))}
                </>
              )}
            </Stage>
          </div>
          <p className="mt-1 text-xs text-muted">Dashed box: 5% title-safe area. Drag to move (snaps to {SNAP}px grid, safe edges, centre and other elements); arrows nudge, Shift+arrows ×10, Ctrl+Z / Ctrl+Shift+Z.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-border bg-panel p-3 md:grid-cols-4">
            <Field label="Name" htmlFor="sn"><Input id="sn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Category" htmlFor="sc"><NativeSelect id="sc" value={scene.category} onChange={(e) => setScene({ category: e.target.value as Scene['category'] })}>{['Scorebug', 'Match', 'Teams', 'Events', 'Stats', 'People', 'Sponsors', 'Media'].map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
            <Field label="Layer" htmlFor="sl"><NativeSelect id="sl" value={scene.layer} onChange={(e) => setScene({ layer: e.target.value as Scene['layer'] })}>{LAYERS.map((l) => <option key={l}>{l}</option>)}</NativeSelect></Field>
            <Field label="Hold (ms, empty = until out)" htmlFor="sh"><Input id="sh" value={scene.holdMs ?? ''} onChange={(e) => setScene({ holdMs: e.target.value ? Number(e.target.value) : null })} /></Field>
          </div>
          <VariablesEditor scene={scene} onChange={(variables) => setScene({ variables })} />
        </div>
        <aside className="rounded-[var(--radius-card)] border border-border bg-panel p-3">
          {el ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between"><h3 className="font-medium">{el.type}</h3><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => zMove(1)} aria-label="Bring forward"><ArrowUp className="size-4" /></Button><Button size="sm" variant="ghost" onClick={() => zMove(-1)} aria-label="Send back"><ArrowDown className="size-4" /></Button><Button size="sm" variant="ghost" onClick={duplicate} aria-label="Duplicate"><Copy className="size-4" /></Button><Button size="sm" variant="ghost" onClick={remove} aria-label="Delete"><Trash2 className="size-4" /></Button></div></div>
              <Field label="Name" htmlFor="en"><Input id="en" value={el.name} onChange={(e) => update({ name: e.target.value })} /></Field>
              <div className="grid grid-cols-4 gap-1">{(['x', 'y', 'w', 'h'] as const).map((k) => <Field key={k} label={k} htmlFor={`e${k}`}><Input id={`e${k}`} inputMode="numeric" value={el[k]} onChange={(e) => update({ [k]: Number(e.target.value) || 0 })} /></Field>)}</div>
              <div className="grid grid-cols-2 gap-1">
                <Field label="Anchor" htmlFor="ea"><NativeSelect id="ea" value={el.anchor} onChange={(e) => update({ anchor: e.target.value as SceneElement['anchor'] })}>{['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].map((a) => <option key={a}>{a}</option>)}</NativeSelect></Field>
                <Field label="Opacity" htmlFor="eo"><Input id="eo" inputMode="decimal" value={el.opacity} onChange={(e) => update({ opacity: Math.min(1, Math.max(0, Number(e.target.value))) })} /></Field>
              </div>
              {el.type === 'text' ? (
                <>
                  <Field label="Bind to data" htmlFor="eb" hint="Or leave unbound and type static text"><NativeSelect id="eb" value={bindingValue} onChange={(e) => update({ text: e.target.value ? { binding: e.target.value, fallback: '' } : 'Text' } as Partial<SceneElement>)}><option value="">Static text</option>{Object.keys(BINDING_PATHS).filter((k) => k !== 'variables.*').map((k) => <option key={k}>{k}</option>)}{scene.variables.map((v) => <option key={v.key} value={`variables.${v.key}`}>variables.{v.key}</option>)}</NativeSelect></Field>
                  {typeof el.text === 'string' ? <Field label="Text" htmlFor="et"><Input id="et" value={el.text} onChange={(e) => update({ text: e.target.value } as Partial<SceneElement>)} /></Field> : (
                    <>
                      <Field label="Fallback" htmlFor="ef"><Input id="ef" value={el.text.fallback ?? ''} onChange={(e) => update({ text: { ...(el.text as { binding: string }), fallback: e.target.value } } as Partial<SceneElement>)} /></Field>
                      <Switch label="Uppercase" checked={!!el.text.transforms?.some((t) => t.type === 'uppercase')} onCheckedChange={(on) => update({ text: { ...(el.text as { binding: string }), transforms: on ? [{ type: 'uppercase' }] : [] } } as Partial<SceneElement>)} />
                    </>
                  )}
                  <div className="grid grid-cols-3 gap-1">
                    <Field label="Size" htmlFor="es"><Input id="es" value={el.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) || 8 } as Partial<SceneElement>)} /></Field>
                    <Field label="Min" htmlFor="em"><Input id="em" value={el.minFontSize ?? ''} onChange={(e) => update({ minFontSize: e.target.value ? Number(e.target.value) : undefined } as Partial<SceneElement>)} /></Field>
                    <Field label="Weight" htmlFor="ew"><NativeSelect id="ew" value={el.fontWeight} onChange={(e) => update({ fontWeight: Number(e.target.value) } as Partial<SceneElement>)}>{[400, 500, 600, 700, 800].map((w) => <option key={w}>{w}</option>)}</NativeSelect></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <Field label="Colour" htmlFor="ec"><input id="ec" type="color" className="h-9 w-full rounded border border-border bg-bg" value={typeof el.color === 'string' ? el.color.slice(0, 7) : '#ffffff'} onChange={(e) => update({ color: e.target.value.toUpperCase() } as Partial<SceneElement>)} /></Field>
                    <Field label="Align" htmlFor="eal"><NativeSelect id="eal" value={el.align} onChange={(e) => update({ align: e.target.value } as Partial<SceneElement>)}><option>left</option><option>center</option><option>right</option></NativeSelect></Field>
                  </div>
                </>
              ) : null}
              {el.type === 'rect' ? (
                <div className="grid grid-cols-2 gap-1">
                  <Field label="Fill" htmlFor="rf"><input id="rf" type="color" className="h-9 w-full rounded border border-border bg-bg" value={typeof el.fill === 'string' ? el.fill.slice(0, 7) : '#131f32'} onChange={(e) => update({ fill: e.target.value.toUpperCase() } as Partial<SceneElement>)} /></Field>
                  <Field label="Radius" htmlFor="rr"><Input id="rr" value={el.radius} onChange={(e) => update({ radius: Number(e.target.value) || 0 } as Partial<SceneElement>)} /></Field>
                </div>
              ) : null}
              {el.type === 'image' ? <Field label="Image source" htmlFor="is"><NativeSelect id="is" value={el.source?.binding ?? ''} onChange={(e) => update({ source: e.target.value ? { binding: e.target.value } : undefined } as Partial<SceneElement>)}><option value="">Asset (set asset id)</option>{['match.homeTeam.logo', 'match.awayTeam.logo', 'player.photo'].map((k) => <option key={k}>{k}</option>)}</NativeSelect></Field> : null}
              {el.type === 'sponsor_slot' ? <Field label="Placement" htmlFor="sp"><NativeSelect id="sp" value={el.placement} onChange={(e) => update({ placement: e.target.value } as Partial<SceneElement>)}>{['scorebug_logo', 'lower_third_banner', 'event_partner', 'detached_logo', 'full_frame_image'].map((p) => <option key={p}>{p}</option>)}</NativeSelect></Field> : null}
              <div className="grid grid-cols-3 gap-1">
                <Field label="In" htmlFor="ai"><NativeSelect id="ai" value={el.animation.in} onChange={(e) => update({ animation: { ...el.animation, in: e.target.value as never } })}>{['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'wipe'].map((a) => <option key={a}>{a}</option>)}</NativeSelect></Field>
                <Field label="Out" htmlFor="ao"><NativeSelect id="ao" value={el.animation.out} onChange={(e) => update({ animation: { ...el.animation, out: e.target.value as never } })}>{['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'wipe'].map((a) => <option key={a}>{a}</option>)}</NativeSelect></Field>
                <Field label="Delay" htmlFor="ad"><Input id="ad" value={el.animation.delayMs} onChange={(e) => update({ animation: { ...el.animation, delayMs: Number(e.target.value) || 0 } })} /></Field>
              </div>
            </div>
          ) : <p className="text-sm text-muted">Select an element to edit its properties.</p>}
        </aside>
      </div>
    </>
  );
}

function VariablesEditor({ scene, onChange }: { scene: Scene; onChange: (v: Scene['variables']) => void }) {
  const [key, setKey] = useState('');
  const [type, setType] = useState('text');
  return (
    <div className="mt-3 rounded-[var(--radius-card)] border border-border bg-panel p-3">
      <h3 className="mb-2 text-xs font-medium text-muted">Operator controls (variables)</h3>
      <ul className="mb-2 space-y-1 text-sm">{scene.variables.map((v) => <li key={v.key} className="flex items-center gap-2"><code className="text-xs">{v.key}</code><span className="text-muted">{v.type}{v.required ? ' · required' : ''}</span><button className="ml-auto text-xs text-muted hover:text-live" onClick={() => onChange(scene.variables.filter((x) => x.key !== v.key))}>Remove</button></li>)}</ul>
      <div className="flex gap-2"><Input placeholder="key (e.g. heading)" value={key} onChange={(e) => setKey(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} /><NativeSelect value={type} onChange={(e) => setType(e.target.value)} className="w-32">{['text', 'number', 'boolean', 'team', 'player', 'image', 'stat'].map((t) => <option key={t}>{t}</option>)}</NativeSelect><Button disabled={!/^[a-zA-Z]/.test(key) || scene.variables.some((v) => v.key === key)} onClick={() => { onChange([...scene.variables, { key, label: key, type: type as never, required: false, maxLength: type === 'text' ? 60 : undefined }]); setKey(''); }}>Add</Button></div>
    </div>
  );
}
