'use client';
// "Then show…": one step of a playlist, chosen from the graphics catalogue with its details, timing and length.
import { useMemo, useState } from 'react';
import type { PlanItem, Playlist } from '@bs/domain';
import { BUILTIN_TEMPLATES, type TemplateDef, type VariableDef } from '@bs/graphics';
import { Button, Dialog, Field, Input, NativeSelect, Switch } from '@bs/ui';
import { useGet } from '@/lib/hooks';
import { ACTIONS, PLACEMENTS, placementLabel, seconds } from '@/lib/labels';
import type { Sport } from './trigger-editor';

type Vars = NonNullable<PlanItem['variables']>;
type Var = Vars[string];
type FromKey = Extract<Var, { from: string }>['from'];
const from = (k: FromKey): Var => ({ from: k });
const isFrom = (v: unknown): v is { from: FromKey } => !!v && typeof v === 'object' && 'from' in v;

const STEP_KINDS: { id: PlanItem['action']; label: string }[] = [
  { id: 'show', label: 'Show a graphic' },
  { id: 'sponsor', label: 'Show a sponsor' },
  { id: 'media', label: 'Show an image or video' },
  { id: 'scorebug_show', label: 'Show the scorebug' },
  { id: 'scorebug_hide', label: 'Hide the scorebug' },
  { id: 'clear_layers', label: 'Clear full-screen graphics' },
  { id: 'wait', label: 'Wait' },
];
const CATEGORY_ORDER = ['Scorebug', 'Match', 'Teams', 'Events', 'People', 'Stats', 'Sponsors', 'Media'];
const DEFAULT_SECONDS: Partial<Record<PlanItem['action'], number>> = { sponsor: 6, media: 10, wait: 2 };
/** Which event detail fills which variable when the playlist runs from an event. */
const EVENT_SOURCE: Record<string, FromKey> = { team: 'event.side', player: 'event.playerId', minute: 'event.minute', eventType: 'event.type', cardType: 'event.cardType', playerOut: 'event.playerOutId', playerIn: 'event.playerInId', points: 'event.points' };

export const templatesFor = (sport: Sport) => BUILTIN_TEMPLATES.filter((t) => t.sports.includes(sport));
export const templateName = (key?: string) => BUILTIN_TEMPLATES.find((t) => t.key === key)?.name ?? key?.replace('builtin:', '').replace(/_/g, ' ') ?? '';

export function stepText(it: PlanItem): string {
  const what =
    it.action === 'show' || it.action === 'update' ? `${ACTIONS[it.action]} ${templateName(it.templateKey)}`
    : it.action === 'sponsor' || it.action === 'creative' ? `Show a sponsor (${placementLabel(it.placement ?? 'detached_logo')})`
    : (ACTIONS[it.action] ?? it.action);
  const timing = it.action === 'scorebug_show' || it.action === 'scorebug_hide' || it.action === 'clear_layers' ? '' : ` · ${seconds(it.durationMs ?? null)}`;
  return `${what} · at ${(it.offsetMs / 1000).toFixed(1)} s${timing}`;
}

/** Start the new step after the last one ends, with a short gap so exits finish before the next entrance. */
export function nextOffset(pl: Playlist, gapMs = 800) {
  const ends = pl.items.map((i) => i.offsetMs + (i.durationMs ?? 0));
  return ends.length ? Math.max(...ends) + gapMs : 0;
}

export function StepDialog({ sport, playlist, item, onSave, onClose }: { sport: Sport; playlist: Playlist; item: PlanItem | null; onSave: (it: PlanItem) => void; onClose: () => void }) {
  const fromEvent = playlist.triggers.some((t) => t.type === 'event');
  const templates = useMemo(() => templatesFor(sport), [sport]);
  const [action, setAction] = useState<PlanItem['action']>(item?.action ?? 'show');
  const [templateKey, setTemplateKey] = useState(item?.templateKey ?? (fromEvent ? 'builtin:lower_third' : 'builtin:ident'));
  const [vars, setVars] = useState<Vars>(item?.variables ?? {});
  const [placement, setPlacement] = useState(item?.placement ?? 'detached_logo');
  const [assetId, setAssetId] = useState(item?.assetId ?? '');
  const [audio, setAudio] = useState<NonNullable<PlanItem['audio']>>(item?.audio ?? 'muted');
  const [afterPrevious, setAfterPrevious] = useState(!item);
  const [atSeconds, setAtSeconds] = useState(item ? item.offsetMs / 1000 : nextOffset(playlist) / 1000);
  const t = templates.find((x) => x.key === templateKey) ?? null;
  const [untilOut, setUntilOut] = useState(item ? item.durationMs == null : false);
  const [forSeconds, setForSeconds] = useState(item?.durationMs != null ? item.durationMs / 1000 : (t?.holdMs ?? (DEFAULT_SECONDS[action] ?? 8) * 1000) / 1000);
  const assets = useGet<{ id: string; name: string; kind: string; state: string }[]>(['assets', 'all'], 'assets', { enabled: action === 'media' || t?.variables.some((v) => v.type === 'image') });
  const timed = !['scorebug_show', 'scorebug_hide', 'clear_layers'].includes(action);

  const pickTemplate = (key: string) => {
    setTemplateKey(key);
    const def = templates.find((x) => x.key === key);
    if (!def) return;
    const v: Vars = {};
    for (const x of def.variables) {
      if (fromEvent && EVENT_SOURCE[x.key]) v[x.key] = from(EVENT_SOURCE[x.key]!);
      else if (x.default !== undefined) v[x.key] = x.default as Var;
      else if (x.type === 'team') v[x.key] = 'home';
    }
    setVars(v);
    if (def.holdMs) setForSeconds(def.holdMs / 1000);
    setUntilOut(def.holdMs == null && playlist.repeat.mode !== 'loop');
  };

  const save = () => {
    const offsetMs = Math.round((afterPrevious ? nextOffset(playlist) / 1000 : atSeconds) * 1000);
    const durationMs = timed ? (untilOut ? null : Math.max(500, Math.round(forSeconds * 1000))) : undefined;
    const base: PlanItem = { id: item?.id ?? '', action, offsetMs, ...(durationMs !== undefined ? { durationMs } : {}) };
    if (action === 'show') onSave({ ...base, templateKey, variables: vars });
    else if (action === 'sponsor') onSave({ ...base, placement });
    else if (action === 'media') onSave({ ...base, assetId, audio });
    else if (action === 'clear_layers') onSave({ ...base, layers: ['fullframe', 'background', 'lower'] });
    else onSave(base);
  };
  const valid = action === 'show' ? !!t : action === 'media' ? !!assetId : true;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={item ? 'Edit step' : 'Add a step'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={save}>{item ? 'Save' : 'Add step'}</Button></>}>
      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <div className="grid content-start gap-3">
          <Field label="What" htmlFor="sk">
            <NativeSelect id="sk" value={action} onChange={(e) => { const a = e.target.value as PlanItem['action']; setAction(a); if (DEFAULT_SECONDS[a]) setForSeconds(DEFAULT_SECONDS[a]!); if (a !== 'show') setUntilOut(false); }}>
              {STEP_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </NativeSelect>
          </Field>
          {action === 'show' ? (
            <>
              <Field label="Graphic" htmlFor="st">
                <NativeSelect id="st" value={templateKey} onChange={(e) => pickTemplate(e.target.value)}>
                  {CATEGORY_ORDER.map((cat) => {
                    const list = templates.filter((x) => x.category === cat);
                    return list.length ? <optgroup key={cat} label={cat}>{list.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</optgroup> : null;
                  })}
                </NativeSelect>
              </Field>
              {t ? <VariablesForm t={t} vars={vars} onChange={setVars} fromEvent={fromEvent} assets={assets.data ?? []} /> : null}
            </>
          ) : null}
          {action === 'sponsor' ? (
            <Field label="Where" htmlFor="sp" hint={PLACEMENTS[placement]?.where}>
              <NativeSelect id="sp" value={placement} onChange={(e) => setPlacement(e.target.value)}>{['detached_logo', 'lower_third_banner', 'full_frame_image', 'full_frame_video', 'event_partner', 'scorebug_logo'].map((p) => <option key={p} value={p}>{placementLabel(p)}</option>)}</NativeSelect>
            </Field>
          ) : null}
          {action === 'media' ? (
            <>
              <Field label="File" htmlFor="sm" hint="From Assets; images and videos that have finished processing">
                <NativeSelect id="sm" value={assetId} onChange={(e) => setAssetId(e.target.value)}><option value="">Choose…</option>{(assets.data ?? []).filter((a) => a.state === 'READY' && ['image', 'video', 'logo'].includes(a.kind)).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}</NativeSelect>
              </Field>
              <Field label="Sound (video only)" htmlFor="sa"><NativeSelect id="sa" value={audio} onChange={(e) => setAudio(e.target.value as typeof audio)}><option value="muted">Silent</option><option value="duck">Lower the programme sound</option><option value="replace">Replace the programme sound</option></NativeSelect></Field>
            </>
          ) : null}
          {action === 'clear_layers' ? <p className="text-sm text-muted">Takes off any full-screen graphic, background slate and lower third, for example at kick-off. The scorebug stays.</p> : null}
          {action === 'scorebug_show' || action === 'scorebug_hide' ? <p className="text-sm text-muted">{action === 'scorebug_show' ? 'Brings the scorebug in (it also comes in by itself at kick-off when "Show scorebug during play" is on).' : 'Takes the scorebug out, for example during the half-time board.'}</p> : null}
        </div>
        <div className="grid content-start gap-3 rounded-md border border-border p-3">
          <div className="text-xs font-medium text-muted">Timing</div>
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="when" checked={afterPrevious} onChange={() => setAfterPrevious(true)} /> <span>After the previous step<span className="block text-xs text-muted">starts at {(nextOffset(playlist) / 1000).toFixed(1)} s</span></span></label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="when" checked={!afterPrevious} onChange={() => setAfterPrevious(false)} /> At <Input type="number" min={0} step={0.5} className="w-20" value={atSeconds} disabled={afterPrevious} onChange={(e) => setAtSeconds(Number(e.target.value) || 0)} /> s</label>
          {timed ? (
            <>
              <div className="mt-2 text-xs font-medium text-muted">On screen for</div>
              <div className="flex items-center gap-2 text-sm"><Input type="number" min={0.5} step={0.5} className="w-20" value={forSeconds} disabled={untilOut} onChange={(e) => setForSeconds(Number(e.target.value) || 1)} /> s</div>
              {action === 'show' || action === 'sponsor' || action === 'media' ? <Switch label="Stays until taken out" checked={untilOut} onCheckedChange={setUntilOut} disabled={playlist.repeat.mode === 'loop'} /> : null}
              {playlist.repeat.mode === 'loop' ? <p className="text-xs text-muted">Looping playlists need a length on every step.</p> : null}
            </>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function VariablesForm({ t, vars, onChange, fromEvent, assets }: { t: TemplateDef; vars: Vars; onChange: (v: Vars) => void; fromEvent: boolean; assets: { id: string; name: string; kind: string; state: string }[] }) {
  const set = (k: string, v: Var | undefined) => {
    const n = { ...vars };
    if (v === undefined) delete n[k];
    else n[k] = v;
    onChange(n);
  };
  const field = (v: VariableDef) => {
    const id = `sv-${v.key}`;
    const cur = vars[v.key];
    const src = EVENT_SOURCE[v.key];
    const eventOpt = fromEvent && src ? <option value="__event">From the event</option> : null;
    const asEvent = isFrom(cur);
    const onPick = (raw: string, parse: (s: string) => Var | undefined) => set(v.key, raw === '__event' ? from(src!) : parse(raw));
    switch (v.type) {
      case 'team':
        return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={asEvent ? '__event' : String(cur ?? 'home')} onChange={(e) => onPick(e.target.value, (s) => s)}>{eventOpt}<option value="home">Home team</option><option value="away">Away team</option></NativeSelect></Field>;
      case 'player':
        return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={asEvent ? '__event' : ''} onChange={(e) => onPick(e.target.value, () => undefined)}>{eventOpt}<option value="">Not shown (team name instead)</option></NativeSelect></Field>;
      case 'select':
        return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={asEvent ? '__event' : String(cur ?? v.default ?? '')} onChange={(e) => onPick(e.target.value, (s) => s)}>{eventOpt}{(v.options ?? []).map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</NativeSelect></Field>;
      case 'boolean':
        return <Switch key={v.key} label={v.label} checked={cur !== false} onCheckedChange={(b) => set(v.key, b)} />;
      case 'number':
        return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={asEvent ? '__event' : 'fixed'} onChange={(e) => (e.target.value === '__event' ? set(v.key, from(src!)) : set(v.key, 1))}>{eventOpt}<option value="fixed">Set a number</option></NativeSelect>{!asEvent ? <Input className="mt-1" inputMode="numeric" value={typeof cur === 'number' ? cur : ''} onChange={(e) => set(v.key, e.target.value === '' ? undefined : Number(e.target.value))} /> : null}</Field>;
      case 'stat':
        return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={String(cur ?? '')} onChange={(e) => set(v.key, e.target.value || undefined)}><option value="">None</option>{['goals', 'points', 'fouls', 'yellow'].map((s) => <option key={s}>{s}</option>)}</NativeSelect></Field>;
      case 'creative':
        return <p key={v.key} className="text-xs text-muted">Sponsor: the eligible campaign is chosen automatically.</p>;
      case 'image':
        return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={String(cur ?? '')} onChange={(e) => set(v.key, e.target.value || undefined)}><option value="">None</option>{assets.filter((a) => a.state === 'READY' && ['image', 'logo', 'video'].includes(a.kind)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></Field>;
      default: {
        if (v.key === 'minute' && fromEvent) return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={asEvent ? '__event' : 'fixed'} onChange={(e) => (e.target.value === '__event' ? set(v.key, from('event.minute')) : set(v.key, ''))}><option value="__event">From the event</option><option value="fixed">Type it</option></NativeSelect>{!asEvent ? <Input className="mt-1" value={String(cur ?? '')} onChange={(e) => set(v.key, e.target.value)} /> : null}</Field>;
        const s = asEvent ? '' : String(cur ?? '');
        return <Field key={v.key} label={`${v.label}${v.maxLength ? ` (${s.length}/${v.maxLength})` : ''}`} htmlFor={id}><Input id={id} value={s} maxLength={v.maxLength} onChange={(e) => set(v.key, e.target.value)} /></Field>;
      }
    }
  };
  if (!t.variables.length) return <p className="text-xs text-muted">This graphic needs no details.</p>;
  return <div className="grid gap-2 sm:grid-cols-2">{t.variables.map(field)}</div>;
}
