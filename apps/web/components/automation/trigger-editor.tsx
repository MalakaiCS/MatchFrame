'use client';
// "Runs when…": edit a playlist trigger without touching JSON. Phases and events come from the sport rules,
// so the labels match the scorer's buttons.
import { useState } from 'react';
import { getAdapter } from '@bs/domain';
import type { Trigger } from '@bs/domain';
import { Button, Dialog, Field, Input, NativeSelect } from '@bs/ui';
import { phaseTagLabel } from '@/lib/labels';

import type { Sport } from '@bs/domain';
export type { Sport };
const cfgOf = (sport: Sport) => getAdapter(sport).defaultConfig as never;
export const phasesFor = (sport: Sport) => getAdapter(sport).phases(cfgOf(sport)).filter((p) => p.kind !== 'terminal');
export const eventsFor = (sport: Sport) => getAdapter(sport).eventTypes(cfgOf(sport)).filter((e) => e.type !== 'stat_adjust');
/** Tag-based choices that mean "any period of this kind", which no single phase id covers. */
const SPECIAL_TAGS: { tag: string; label: string }[] = [
  { tag: 'period_start', label: 'Kick-off (start of any period)' },
  { tag: 'interval', label: 'Any break' },
];
const COUNTERS = [{ id: 'points', label: 'points' }, { id: 'goals', label: 'goals' }, { id: 'cards', label: 'cards' }, { id: 'substitutions', label: 'substitutions' }];

export function triggerText(t: Trigger, sport: Sport): string {
  switch (t.type) {
    case 'phase': {
      const phases = phasesFor(sport);
      const ids = t.phaseIds.map((id) => phases.find((p) => p.id === id)?.label ?? id);
      const tags = t.phaseTags.map(phaseTagLabel);
      const all = [...ids, ...tags];
      return all.length ? `At ${all.join(' or ')}` : 'At a phase (none chosen)';
    }
    case 'event': {
      const evs = eventsFor(sport);
      const labels = t.eventTypes.map((x) => evs.find((e) => e.type === x)?.label.toLowerCase() ?? x);
      const side = t.sides && t.sides.length === 1 ? ` by the ${t.sides[0]} team` : '';
      return `When ${labels.join(', ')} is recorded${side}`;
    }
    case 'match_clock': {
      const min = Math.round(t.atMs / 60_000);
      const every = t.repeatEveryMs ? ` and every ${Math.round(t.repeatEveryMs / 60_000)} min` : '';
      const until = t.untilMs ? ` until minute ${Math.round(t.untilMs / 60_000)}` : '';
      const periods = t.periodIds.length ? ` of ${t.periodIds.map((id) => phasesFor(sport).find((p) => p.id === id)?.label ?? id).join(', ')}` : '';
      return `At minute ${min}${every}${until}${periods}`;
    }
    case 'wall_clock':
      return t.atUtc ? `At ${new Date(t.atUtc).toLocaleString('en-AU')}` : `${Math.abs(Math.round((t.relativeToKickoffMs ?? 0) / 60_000))} min ${(t.relativeToKickoffMs ?? 0) < 0 ? 'before' : 'after'} kick-off`;
    case 'milestone':
      return `Every ${t.every} ${COUNTERS.find((c) => c.id === t.counter)?.label ?? t.counter}`;
    case 'manual':
      return 'When run from the control room';
  }
}

type Draft = { kind: Trigger['type']; phaseIds: string[]; phaseTags: string[]; eventTypes: string[]; side: '' | 'home' | 'away'; atMin: number; everyMin: number | ''; untilMin: number | ''; periodIds: string[]; counter: string; every: number };

function toDraft(t: Trigger | null, sport: Sport): Draft {
  const d: Draft = { kind: t?.type ?? 'phase', phaseIds: [], phaseTags: [], eventTypes: [], side: '', atMin: 20, everyMin: '', untilMin: '', periodIds: [], counter: sport === 'basketball' ? 'points' : 'goals', every: 20 };
  if (!t) return d;
  if (t.type === 'phase') {
    // tag-based triggers from the starter plan: tick the phases those tags cover, keep the "any period" tags as specials
    const special = SPECIAL_TAGS.map((s) => s.tag);
    d.phaseTags = t.phaseTags.filter((x) => special.includes(x));
    const covered = phasesFor(sport).filter((p) => t.phaseIds.includes(p.id) || p.tags.some((x) => t.phaseTags.includes(x) && !special.includes(x))).map((p) => p.id);
    d.phaseIds = [...new Set(covered)];
  }
  if (t.type === 'event') { d.eventTypes = t.eventTypes; d.side = t.sides?.length === 1 ? t.sides[0]! : ''; }
  if (t.type === 'match_clock') { d.atMin = Math.round(t.atMs / 60_000); d.everyMin = t.repeatEveryMs ? Math.round(t.repeatEveryMs / 60_000) : ''; d.untilMin = t.untilMs ? Math.round(t.untilMs / 60_000) : ''; d.periodIds = t.periodIds; }
  if (t.type === 'milestone') { d.counter = t.counter; d.every = t.every; }
  return d;
}

function fromDraft(d: Draft, id: string): Trigger {
  switch (d.kind) {
    case 'phase': return { id, type: 'phase', phaseIds: d.phaseIds, phaseTags: d.phaseTags };
    case 'event': return { id, type: 'event', eventTypes: d.eventTypes, ...(d.side ? { sides: [d.side] } : {}) };
    case 'match_clock': return { id, type: 'match_clock', atMs: Math.max(0, d.atMin) * 60_000, periodIds: d.periodIds, ...(d.everyMin ? { repeatEveryMs: Math.max(1, Number(d.everyMin)) * 60_000 } : {}), ...(d.untilMin ? { untilMs: Number(d.untilMin) * 60_000 } : {}) };
    case 'milestone': return { id, type: 'milestone', counter: d.counter, every: Math.max(1, d.every) };
    default: return { id, type: 'manual' };
  }
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function TriggerDialog({ sport, trigger, id, onSave, onClose }: { sport: Sport; trigger: Trigger | null; id: string; onSave: (t: Trigger) => void; onClose: () => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(trigger, sport));
  const phases = phasesFor(sport);
  const events = eventsFor(sport);
  const valid = d.kind === 'phase' ? d.phaseIds.length + d.phaseTags.length > 0 : d.kind === 'event' ? d.eventTypes.length > 0 : true;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={trigger ? 'Edit when this runs' : 'When should this run?'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={() => onSave(fromDraft(d, id))}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Run this" htmlFor="tk">
          <NativeSelect id="tk" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Trigger['type'] })}>
            <option value="phase">When the scorer moves the match to a phase</option>
            <option value="event">When an event is recorded</option>
            <option value="match_clock">At a minute on the match clock</option>
            {sport === 'basketball' ? <option value="milestone">Every N points (or goals, cards)</option> : <option value="milestone">Every N goals (or cards, substitutions)</option>}
            <option value="manual">Only when I press Run in the control room</option>
          </NativeSelect>
        </Field>
        {d.kind === 'phase' ? (
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-muted">Phases (the scorer's buttons)</legend>
            <div className="grid grid-cols-1 max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
              {SPECIAL_TAGS.map((s) => <label key={s.tag} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.phaseTags.includes(s.tag)} onChange={() => setD({ ...d, phaseTags: toggle(d.phaseTags, s.tag) })} /> {s.label}</label>)}
              {phases.filter((p) => p.tags.length).map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.phaseIds.includes(p.id)} onChange={() => setD({ ...d, phaseIds: toggle(d.phaseIds, p.id) })} /> {p.label}</label>)}
            </div>
          </fieldset>
        ) : null}
        {d.kind === 'event' ? (
          <>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-muted">Events</legend>
              <div className="grid grid-cols-1 max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
                {events.map((e) => <label key={e.type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.eventTypes.includes(e.type)} onChange={() => setD({ ...d, eventTypes: toggle(d.eventTypes, e.type) })} /> {e.label}</label>)}
              </div>
            </fieldset>
            <Field label="Only for" htmlFor="ts"><NativeSelect id="ts" value={d.side} onChange={(e) => setD({ ...d, side: e.target.value as Draft['side'] })}><option value="">Either team</option><option value="home">The home team</option><option value="away">The away team</option></NativeSelect></Field>
          </>
        ) : null}
        {d.kind === 'match_clock' ? (
          <div className="grid grid-cols-3 gap-2">
            <Field label="At minute" htmlFor="tm"><Input id="tm" type="number" min={0} value={d.atMin} onChange={(e) => setD({ ...d, atMin: Number(e.target.value) || 0 })} /></Field>
            <Field label="Then every (min)" htmlFor="te" hint="Blank = once"><Input id="te" type="number" min={1} value={d.everyMin} onChange={(e) => setD({ ...d, everyMin: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
            <Field label="Until minute" htmlFor="tu" hint="Blank = end of period"><Input id="tu" type="number" min={1} value={d.untilMin} onChange={(e) => setD({ ...d, untilMin: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
            <fieldset className="col-span-3">
              <legend className="mb-1 text-xs font-medium text-muted">Only during (blank = any period)</legend>
              <div className="flex flex-wrap gap-3">{phases.filter((p) => p.kind === 'play').map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.periodIds.includes(p.id)} onChange={() => setD({ ...d, periodIds: toggle(d.periodIds, p.id) })} /> {p.label}</label>)}</div>
            </fieldset>
          </div>
        ) : null}
        {d.kind === 'milestone' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Every" htmlFor="me"><Input id="me" type="number" min={1} value={d.every} onChange={(e) => setD({ ...d, every: Number(e.target.value) || 1 })} /></Field>
            <Field label="Of" htmlFor="mc"><NativeSelect id="mc" value={d.counter} onChange={(e) => setD({ ...d, counter: e.target.value })}>{COUNTERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</NativeSelect></Field>
          </div>
        ) : null}
        {d.kind === 'manual' ? <p className="text-sm text-muted">The control room shows a "Run" button for this playlist. Nothing starts it automatically.</p> : null}
      </div>
    </Dialog>
  );
}
