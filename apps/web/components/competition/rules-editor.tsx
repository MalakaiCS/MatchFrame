'use client';
// A competition's rules as a form: every setting of the sport's rules in three groups (match timing with a picture of
// the periods and breaks; extra time, overtime or a shoot-out when the scores are level; everything else), a preset
// to start from (built-in or one of the organisation's own), saving the result as an own preset, and giving upcoming
// matches nobody has scored yet the new rules.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { getAdapter, RULES_GROUP_LABELS, setRulesValue, type Sport } from '@bs/domain';
import { Button, Dialog, ErrorNotice, Field, NativeSelect } from '@bs/ui';
import { del, patch, post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { MatchTimeline, RulesFields } from './rules-timing';

export interface OwnPreset { id: string; value: string; sport: string; name: string; config: Record<string, unknown>; rulesDescription: string[] }

/** Saved rules with any setting added since filled in with its usual value, so the form shows every setting. */
export function withDefaults(sport: Sport, config: Record<string, unknown>): Record<string, unknown> {
  const r = getAdapter(sport).configSchema.safeParse(config);
  return structuredClone(r.success ? (r.data as Record<string, unknown>) : config);
}

/** The sport's built-in presets and the organisation's own, as [value, label] for a rules-preset picker. */
export function usePresetOptions(sport: string) {
  const own = useGet<OwnPreset[]>(['rules-presets', sport], `rules-presets?sport=${sport}`);
  const builtIn = getAdapter(sport).presets.map((p) => ({ value: p.id, label: p.label, config: p.config as Record<string, unknown> }));
  const mine = (own.data ?? []).map((p) => ({ value: p.value, label: p.name, config: p.config }));
  return { builtIn, mine, own };
}

/** `target` "finals" edits the competition's finals rules (finals matches), else its rules (the regular season). */
export function RulesEditor({ competitionId, sport, current, open, onOpenChange, target = 'rules' }: { competitionId: string; sport: Sport; current: Record<string, unknown>; open: boolean; onOpenChange: (o: boolean) => void; target?: 'rules' | 'finals' }) {
  const adapter = getAdapter(sport);
  const { builtIn, mine } = usePresetOptions(sport);
  const [cfg, setCfg] = useState<Record<string, unknown>>(() => withDefaults(sport, current));
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [applyToUpcoming, setApplyToUpcoming] = useState(true);
  const parsed = adapter.configSchema.safeParse(cfg);
  const issue = (path: string) => (parsed.success ? null : parsed.error.issues.find((i) => i.path.join('.') === path)?.message ?? null);
  const save = useAction(
    async () => {
      if (saveAsPreset) await post('rules-presets', { sport, name: String(cfg.label ?? '').trim(), config: cfg });
      return patch<{ matchesUpdated: number }>(`competitions/${competitionId}`, { [target === 'finals' ? 'finalsRulesConfig' : 'rulesConfig']: cfg, applyToUpcoming });
    },
    [['competition', competitionId], ['rules-presets', sport], ['matches', 'competition', competitionId]],
    { success: (r) => `Rules saved${saveAsPreset ? ' and kept as one of your presets' : ''}${r.matchesUpdated ? `; ${r.matchesUpdated} upcoming match${r.matchesUpdated === 1 ? '' : 'es'} updated` : ''}` },
  );
  const remove = useAction((id: string) => del(`rules-presets/${id}`), [['rules-presets', sport]], { success: 'Preset deleted' });
  const set = (path: string, value: unknown) => setCfg((c) => setRulesValue(c, path, value));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (o) setCfg(withDefaults(sport, current)); save.reset(); }}
      title={target === 'finals' ? 'Finals rules' : 'Rules'}
      description={target === 'finals' ? 'Finals matches use these rules. A match keeps the rules it started with.' : 'New fixtures use these rules. A match keeps the rules it started with.'}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!parsed.success || (saveAsPreset && !String(cfg.label ?? '').trim())} onClick={() => save.mutate(undefined, { onSuccess: () => onOpenChange(false) })}>Save rules</Button></>}
    >
      <div className="grid gap-3">
        <Field label="Start from" htmlFor="rules-from" hint="Fills in the form; nothing is saved until you press Save rules.">
          <NativeSelect id="rules-from" value="" onChange={(e) => { const p = [...mine, ...builtIn].find((x) => x.value === e.target.value); if (p) setCfg(withDefaults(sport, p.config)); }}>
            <option value="">Choose a preset…</option>
            {mine.length ? <optgroup label="Your presets">{mine.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</optgroup> : null}
            <optgroup label="Built-in">{builtIn.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</optgroup>
          </NativeSelect>
        </Field>
        <RulesFields sport={sport} config={cfg} group="name" onChange={set} issue={issue} />
        {(['timing', 'level', 'other'] as const).map((g) => (
          <section key={g} aria-labelledby={`rules-group-${g}`} className="grid gap-3 border-t border-border pt-3">
            <h3 id={`rules-group-${g}`} className="text-sm font-semibold text-text">{RULES_GROUP_LABELS[g]}</h3>
            <RulesFields sport={sport} config={cfg} group={g} onChange={set} issue={issue} />
            {g === 'timing' ? <MatchTimeline sport={sport} config={cfg} /> : null}
          </section>
        ))}
        {parsed.success ? (
          <div className="rounded-md border border-border p-3" aria-label="These rules">
            <h3 className="mb-1 text-xs font-medium text-muted">These rules</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{adapter.describeRules(parsed.data).map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={saveAsPreset} onChange={(e) => setSaveAsPreset(e.target.checked)} /> Keep as one of your presets, named as above, for other competitions</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={applyToUpcoming} onChange={(e) => setApplyToUpcoming(e.target.checked)} /> Also use for upcoming matches nobody has started scoring</label>
        <ErrorNotice error={save.error} />
        {mine.length ? (
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted">Your presets</h3>
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {mine.map((p) => (
                <li key={p.value} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span>{p.label}</span>
                  <Button size="sm" variant="ghost" aria-label={`Delete preset ${p.label}`} loading={remove.isPending} onClick={() => confirm(`Delete the preset “${p.label}”? Competitions already using its rules keep them.`) && remove.mutate(p.value.slice(4))}><Trash2 className="size-4" /></Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
