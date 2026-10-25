'use client';
// "Only when…": playlist conditions without JSON. A condition guard compares a match number (score gap, total
// score, a team statistic, the minute, quiet time since the last graphic) so a playlist fires only when it holds.
import { useState } from 'react';
import { getAdapter, type Guard, type Sport } from '@bs/domain';
import { Button, Dialog, Field, Input, NativeSelect } from '@bs/ui';
import { phaseTagLabel } from '@/lib/labels';

type Condition = Extract<Guard, { type: 'condition' }>;
const OPS: Record<Condition['op'], string> = { '>=': 'is at least', '<=': 'is at most', '==': 'is exactly', '>': 'is more than', '<': 'is less than' };
const METRICS: { id: Condition['metric']; label: string; hint: string }[] = [
  { id: 'score_gap', label: 'The score gap', hint: 'difference between the two scores' },
  { id: 'total_score', label: 'The total score', hint: 'both teams added together' },
  { id: 'stat', label: 'A team statistic', hint: 'shots, corners, fouls… as the scorer counts them' },
  { id: 'minute', label: 'The match minute', hint: 'from the match clock' },
  { id: 'since_last_graphic_s', label: 'Seconds since the last graphic', hint: 'keeps a sponsor loop out of busy spells' },
  { id: 'matches_today', label: 'Matches today in the same place', hint: 'this one included: on its stream link, else at its ground, else in its competition' },
];
const SIDES: { id: NonNullable<Condition['side']>; label: string }[] = [
  { id: 'either', label: 'either team' },
  { id: 'home', label: 'the home team' },
  { id: 'away', label: 'the away team' },
  { id: 'leader', label: 'the team in front' },
];
const statRows = (sport: Sport) => {
  const a = getAdapter(sport);
  return (a.capabilities(a.defaultConfig as never).statRows ?? []) as { key: string; label: string }[];
};

export function guardText(g: Guard, sport: Sport): string {
  switch (g.type) {
    case 'condition': {
      const side = g.side && g.side !== 'either' ? (g.side === 'leader' ? 'the leading team’s ' : `the ${g.side} team’s `) : '';
      const what =
        g.metric === 'stat' ? `${side}${statRows(sport).find((s) => s.key === g.stat)?.label.toLowerCase() ?? g.stat ?? 'statistic'}` : g.metric === 'score_gap' ? 'the score gap' : g.metric === 'total_score' ? 'the total score' : g.metric === 'minute' ? 'the match minute' : g.metric === 'matches_today' ? 'the number of matches today in the same place' : 'the quiet time since the last graphic (s)';
      return `${what} ${OPS[g.op]} ${g.value}`;
    }
    case 'phase': {
      const kinds: Record<string, string> = { pre: 'pre-match', play: 'play', break: 'a break', final: 'the final whistle' };
      const all = [...g.phaseKinds.map((k) => kinds[k] ?? k), ...g.phaseIds.map(phaseTagLabel)];
      return `during ${all.join(' or ') || 'any phase'}`;
    }
    case 'team':
      return `for the ${g.sides.join(' or ')} team`;
    case 'min_data':
      return `only with ${g.require.map((r) => (r === 'lineup' ? 'a line-up entered' : 'a named player')).join(' and ')}`;
    case 'freshness':
      return `events newer than ${Math.round(g.maxAgeMs / 1000)} s`;
    case 'sponsor_available':
      return `a sponsor is booked for ${g.placement.replace(/_/g, ' ')}`;
  }
}

type Draft = { type: 'condition' | 'team' | 'min_data'; metric: Condition['metric']; stat: string; side: NonNullable<Condition['side']>; op: Condition['op']; value: number; sides: ('home' | 'away')[]; require: ('lineup' | 'player')[] };

function toDraft(g: Guard | null, sport: Sport): Draft {
  const d: Draft = { type: 'condition', metric: 'score_gap', stat: statRows(sport)[0]?.key ?? '', side: 'either', op: '>=', value: 3, sides: ['home'], require: ['lineup'] };
  if (!g) return d;
  if (g.type === 'condition') return { ...d, type: 'condition', metric: g.metric, stat: g.stat ?? d.stat, side: g.side ?? 'either', op: g.op, value: g.value };
  if (g.type === 'team') return { ...d, type: 'team', sides: g.sides };
  if (g.type === 'min_data') return { ...d, type: 'min_data', require: g.require };
  return d;
}

function fromDraft(d: Draft): Guard {
  if (d.type === 'team') return { type: 'team', sides: d.sides.length ? d.sides : ['home'] };
  if (d.type === 'min_data') return { type: 'min_data', require: d.require.length ? d.require : ['lineup'] };
  const needsSide = d.metric === 'stat';
  return { type: 'condition', metric: d.metric, op: d.op, value: d.value, ...(needsSide ? { stat: d.stat, side: d.side } : {}) };
}

export function GuardDialog({ sport, guard, onSave, onClose }: { sport: Sport; guard: Guard | null; onSave: (g: Guard) => void; onClose: () => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(guard, sport));
  const stats = statRows(sport);
  const editable = !guard || ['condition', 'team', 'min_data'].includes(guard.type);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={guard ? 'Edit condition' : 'Only run when…'} description="Conditions are checked at the moment the playlist would start. When one is not met the run is skipped and the automation history says why."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!editable} onClick={() => onSave(fromDraft(d))}>Save</Button></>}>
      {!editable ? <p className="text-sm text-muted">This condition ({guardText(guard!, sport)}) is set in the Advanced tab.</p> : (
        <div className="grid gap-3">
          <Field label="Kind" htmlFor="gk">
            <NativeSelect id="gk" value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as Draft['type'] })}>
              <option value="condition">A match number is…</option>
              <option value="team">Only for one team</option>
              <option value="min_data">Only when the data is there</option>
            </NativeSelect>
          </Field>
          {d.type === 'condition' ? (
            <>
              <Field label="Number" htmlFor="gm" hint={METRICS.find((m) => m.id === d.metric)?.hint}>
                <NativeSelect id="gm" value={d.metric} onChange={(e) => setD({ ...d, metric: e.target.value as Condition['metric'] })}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</NativeSelect>
              </Field>
              {d.metric === 'stat' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Statistic" htmlFor="gs"><NativeSelect id="gs" value={d.stat} onChange={(e) => setD({ ...d, stat: e.target.value })}>{stats.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</NativeSelect></Field>
                  <Field label="Of" htmlFor="gsd"><NativeSelect id="gsd" value={d.side} onChange={(e) => setD({ ...d, side: e.target.value as Draft['side'] })}>{SIDES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</NativeSelect></Field>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Is" htmlFor="go"><NativeSelect id="go" value={d.op} onChange={(e) => setD({ ...d, op: e.target.value as Condition['op'] })}>{(Object.keys(OPS) as Condition['op'][]).map((o) => <option key={o} value={o}>{OPS[o]}</option>)}</NativeSelect></Field>
                <Field label="Value" htmlFor="gv"><Input id="gv" type="number" value={d.value} onChange={(e) => setD({ ...d, value: Number(e.target.value) || 0 })} /></Field>
              </div>
              <p className="text-xs text-muted">Reads as: {guardText(fromDraft(d), sport)}.</p>
            </>
          ) : null}
          {d.type === 'team' ? (
            <fieldset className="flex gap-4 text-sm">
              <legend className="mb-1 text-xs font-medium text-muted">Runs for events by</legend>
              {(['home', 'away'] as const).map((s) => <label key={s} className="flex items-center gap-2"><input type="checkbox" checked={d.sides.includes(s)} onChange={() => setD({ ...d, sides: d.sides.includes(s) ? d.sides.filter((x) => x !== s) : [...d.sides, s] })} /> the {s} team</label>)}
            </fieldset>
          ) : null}
          {d.type === 'min_data' ? (
            <fieldset className="flex gap-4 text-sm">
              <legend className="mb-1 text-xs font-medium text-muted">Needs</legend>
              {(['lineup', 'player'] as const).map((r) => <label key={r} className="flex items-center gap-2"><input type="checkbox" checked={d.require.includes(r)} onChange={() => setD({ ...d, require: d.require.includes(r) ? d.require.filter((x) => x !== r) : [...d.require, r] })} /> {r === 'lineup' ? 'a line-up entered' : 'a named player on the event'}</label>)}
            </fieldset>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
