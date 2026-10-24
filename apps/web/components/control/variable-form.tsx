'use client';
import type { RenderData, TemplateDef } from '@bs/graphics';
import { Field, Input, NativeSelect, Switch } from '@bs/ui';

export function VariableForm({ t, data, values, onChange, creatives }: { t: TemplateDef; data: RenderData; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; creatives: { id: string; label: string }[] }) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  const teamSide = (values.team as 'home' | 'away') ?? 'home';
  const players = data.match.lineup[teamSide] ?? [];
  if (!t.variables.length) return <p className="text-xs text-muted">This graphic has no inputs.</p>;
  return (
    <div className="grid gap-2">
      {t.variables.map((v) => {
        const id = `var-${v.key}`;
        const val = values[v.key];
        switch (v.type) {
          case 'team':
            return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={String(val ?? 'home')} onChange={(e) => set(v.key, e.target.value)}><option value="home">{data.match.teams.home.name}</option><option value="away">{data.match.teams.away.name}</option></NativeSelect></Field>;
          case 'player':
            return <Field key={v.key} label={v.label} htmlFor={id} hint={!players.length ? 'No lineup for this team' : undefined}><NativeSelect id={id} value={String(val ?? '')} onChange={(e) => set(v.key, e.target.value || undefined)}><option value="">{v.required ? 'Choose…' : 'None (team name shown)'}</option>{players.map((p) => <option key={p.playerId} value={p.playerId}>{p.number ?? ''} {p.displayName}</option>)}</NativeSelect></Field>;
          case 'select':
            return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={String(val ?? v.default ?? '')} onChange={(e) => set(v.key, e.target.value)}>{(v.options ?? []).map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</NativeSelect></Field>;
          case 'boolean':
            return <Switch key={v.key} label={v.label} checked={val !== false} onCheckedChange={(b) => set(v.key, b)} />;
          case 'number':
            return <Field key={v.key} label={v.label} htmlFor={id}><Input id={id} inputMode="numeric" value={val == null ? '' : String(val)} onChange={(e) => set(v.key, e.target.value === '' ? undefined : Number(e.target.value))} /></Field>;
          case 'stat':
            return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={String(val ?? '')} onChange={(e) => set(v.key, e.target.value || undefined)}><option value="">None</option>{['goals', 'points', 'fouls', 'yellow'].map((s) => <option key={s}>{s}</option>)}</NativeSelect></Field>;
          case 'creative':
            return <Field key={v.key} label={v.label} htmlFor={id} hint="Approved creatives only"><NativeSelect id={id} value={String(val ?? '')} onChange={(e) => set(v.key, e.target.value || undefined)}><option value="">Eligible sponsor (automatic)</option>{creatives.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</NativeSelect></Field>;
          case 'image':
            return <Field key={v.key} label={v.label} htmlFor={id}><NativeSelect id={id} value={String(val ?? '')} onChange={(e) => set(v.key, e.target.value || undefined)}><option value="">None</option>{Object.keys(data.assets).map((a) => <option key={a} value={a}>{a.slice(0, 8)}</option>)}</NativeSelect></Field>;
          default: {
            const s = String(val ?? '');
            const over = v.maxLength && s.length > v.maxLength;
            return <Field key={v.key} label={`${v.label}${v.maxLength ? ` (${s.length}/${v.maxLength})` : ''}`} htmlFor={id} error={over ? `Max ${v.maxLength} characters` : null}><Input id={id} value={s} invalid={!!over} onChange={(e) => set(v.key, e.target.value)} /></Field>;
          }
        }
      })}
    </div>
  );
}
