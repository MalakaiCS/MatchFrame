'use client';
// A competition's rules as a form: every setting of the sport's rules (half length, breaks, timeouts, extra time…),
// a preset to start from (built-in or one of the organisation's own), saving the result as an own preset, and
// giving upcoming matches nobody has scored yet the new rules.
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { getAdapter, getRulesValue, rulesFields, setRulesValue, type Sport } from '@bs/domain';
import { Button, Dialog, ErrorNotice, Field, Input, NativeSelect } from '@bs/ui';
import { del, patch, post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';

export interface OwnPreset { id: string; value: string; sport: string; name: string; config: Record<string, unknown>; rulesDescription: string[] }

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
  const fields = useMemo(() => rulesFields(sport), [sport]);
  const { builtIn, mine } = usePresetOptions(sport);
  const [cfg, setCfg] = useState<Record<string, unknown>>(() => structuredClone(current));
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
      onOpenChange={(o) => { onOpenChange(o); if (o) setCfg(structuredClone(current)); save.reset(); }}
      title={target === 'finals' ? 'Finals rules' : 'Rules'}
      description={target === 'finals' ? 'Finals matches use these rules. A match keeps the rules it started with.' : 'New fixtures use these rules. A match keeps the rules it started with.'}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!parsed.success || (saveAsPreset && !String(cfg.label ?? '').trim())} onClick={() => save.mutate(undefined, { onSuccess: () => onOpenChange(false) })}>Save rules</Button></>}
    >
      <div className="grid gap-3">
        <Field label="Start from" htmlFor="rules-from" hint="Fills in the form; nothing is saved until you press Save rules.">
          <NativeSelect id="rules-from" value="" onChange={(e) => { const p = [...mine, ...builtIn].find((x) => x.value === e.target.value); if (p) setCfg(structuredClone(p.config)); }}>
            <option value="">Choose a preset…</option>
            {mine.length ? <optgroup label="Your presets">{mine.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</optgroup> : null}
            <optgroup label="Built-in">{builtIn.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</optgroup>
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map((f) => {
            if (f.dependsOn && !getRulesValue(cfg, f.dependsOn)) return null;
            const v = getRulesValue(cfg, f.path);
            const id = `rules-${f.path.replace(/\./g, '-')}`;
            if (f.kind === 'boolean') {
              return (
                <label key={f.path} className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
                  <input id={id} type="checkbox" className="size-5" checked={!!v} onChange={(e) => set(f.path, e.target.checked)} /> {f.label}
                </label>
              );
            }
            return (
              <Field key={f.path} className={f.kind === 'text' ? 'sm:col-span-2' : undefined} label={f.label} htmlFor={id} error={issue(f.path)} hint={f.kind === 'number' && f.min != null && f.max != null ? `${f.min} to ${f.max}` : undefined}>
                {f.kind === 'select' ? (
                  <NativeSelect id={id} value={String(v ?? '')} onChange={(e) => set(f.path, e.target.value)}>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>
                ) : f.kind === 'number' ? (
                  <Input id={id} type="number" inputMode="numeric" min={f.min} max={f.max} value={Number.isFinite(v) ? String(v) : ''} onChange={(e) => set(f.path, e.target.value === '' ? Number.NaN : Number(e.target.value))} />
                ) : (
                  <Input id={id} maxLength={f.max} value={String(v ?? '')} onChange={(e) => set(f.path, e.target.value)} />
                )}
              </Field>
            );
          })}
        </div>
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
