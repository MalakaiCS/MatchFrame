'use client';
// The pieces of a rules form, shared by the rules editor and the new-competition form: one group of a sport's rules
// settings (match timing, what happens when the scores are level, everything else), and a picture of the match's
// timing, each period and break to scale with its length, so "2×18 with a 5-minute half time" is visible at once.
import { getRulesValue, regulationTimeline, rulesFields, rulesFieldVisible, type RulesGroup, type Sport } from '@bs/domain';
import { Field, Input, NativeSelect, cx } from '@bs/ui';

export function RulesFields({ sport, config, group, onChange, issue }: { sport: Sport; config: Record<string, unknown>; group: RulesGroup; onChange: (path: string, value: unknown) => void; issue: (path: string) => string | null }) {
  const fields = rulesFields(sport).filter((f) => f.group === group && rulesFieldVisible(f, config));
  if (!fields.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const v = getRulesValue(config, f.path) ?? f.defaultValue;
        const id = `rules-${f.path.replace(/\./g, '-')}`;
        if (f.kind === 'boolean') {
          return (
            <label key={f.path} className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
              <input id={id} type="checkbox" className="size-5" checked={!!v} onChange={(e) => onChange(f.path, e.target.checked)} /> {f.label}
            </label>
          );
        }
        return (
          <Field key={f.path} className={f.kind === 'text' ? 'sm:col-span-2' : undefined} label={f.label} htmlFor={id} error={issue(f.path)} hint={f.kind === 'number' && f.min != null && f.max != null ? `${f.min} to ${f.max}` : undefined}>
            {f.kind === 'select' ? (
              <NativeSelect id={id} value={String(v ?? '')} onChange={(e) => onChange(f.path, e.target.value)}>
                {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </NativeSelect>
            ) : f.kind === 'number' ? (
              <Input id={id} type="number" inputMode="numeric" min={f.min} max={f.max} value={Number.isFinite(v) ? String(v) : ''} onChange={(e) => onChange(f.path, e.target.value === '' ? Number.NaN : Number(e.target.value))} />
            ) : (
              <Input id={id} maxLength={f.max} value={String(v ?? '')} onChange={(e) => onChange(f.path, e.target.value)} />
            )}
          </Field>
        );
      })}
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The match's periods and breaks in order, each as wide as its length, with the totals underneath. */
export function MatchTimeline({ sport, config, className }: { sport: Sport; config: Record<string, unknown>; className?: string }) {
  const t = regulationTimeline(sport, config);
  if (!t || !t.totalMinutes) return null;
  return (
    <figure aria-label="Match timing" className={cx('rounded-lg border border-border bg-elevated/40 p-3', className)}>
      <div aria-hidden className="flex h-9 w-full gap-0.5 overflow-hidden rounded-md">
        {t.steps.map((s, i) => (
          <div
            key={i}
            style={{ flexGrow: Math.max(s.minutes, 0.8), flexBasis: 0 }}
            className={cx('grid min-w-0 place-items-center text-xs font-semibold tabular-nums', s.kind === 'play' ? 'bg-primary text-on-primary' : 'bg-[repeating-linear-gradient(135deg,var(--color-elevated)_0_5px,var(--color-border)_5px_10px)] text-muted')}
          >
            {s.minutes >= 3 || s.kind === 'play' ? `${s.minutes}′` : ''}
          </div>
        ))}
      </div>
      <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        {t.steps.map((s, i) => (
          <li key={i} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cx('size-2 rounded-sm', s.kind === 'play' ? 'bg-primary' : 'bg-border-strong')} />
            {s.label}: {s.kind === 'break' && !s.minutes ? 'no break' : plural(s.minutes, 'minute')}
          </li>
        ))}
      </ol>
      <figcaption className="mt-2 text-sm text-text">
        <strong className="font-semibold">{plural(t.playMinutes, 'minute')} of play</strong>
        <span className="text-muted">, about {plural(t.totalMinutes, 'minute')} with the breaks (before any stoppage time, extra time or overtime)</span>
      </figcaption>
    </figure>
  );
}
