'use client';
// One picker for a look, on the competition page (the tournament's look) and the match page (the match's own):
// the organisation's own looks, then all ten built-in looks. Choosing a built-in look the first time saves it as a
// look of the organisation's (named after it), which can then be given a logo and colours under Themes.
import { useState } from 'react';
import { LOOKS } from '@bs/graphics';
import { Button, NativeSelect } from '@bs/ui';

export interface LookProfile { id: string; name: string; currentVersion: number; draft?: { themeKey?: string } }
export type LookChoice = { themeProfileId: string } | { themeKey: string } | { follow: 'competition' };

/** a look made from a built-in one with nothing changed is listed as the built-in look, not twice */
const isBuiltIn = (p: LookProfile) => LOOKS.some((l) => l.name === p.name && l.key === p.draft?.themeKey);

export function lookName(profiles: LookProfile[] | undefined, id: string | null | undefined) {
  return id ? profiles?.find((p) => p.id === id)?.name ?? null : null;
}

export function LookPicker({ profiles, current, follow, disabled, loading, onApply, label = 'Look' }: {
  profiles: LookProfile[] | undefined;
  /** the profile on now, so it is not offered again */
  current?: string | null;
  /** match page: "Same as the tournament (Liga)" */
  follow?: { name: string | null };
  disabled?: boolean;
  loading?: boolean;
  onApply: (choice: LookChoice, name: string) => void;
  label?: string;
}) {
  const [value, setValue] = useState('');
  const mine = (profiles ?? []).filter((p) => p.currentVersion > 0 && !isBuiltIn(p));
  const builtIn = (key: string) => profiles?.find((p) => isBuiltIn(p) && p.draft?.themeKey === key);
  const apply = () => {
    if (value === 'follow') onApply({ follow: 'competition' }, follow?.name ?? 'the tournament look');
    else if (value.startsWith('p:')) onApply({ themeProfileId: value.slice(2) }, mine.find((p) => p.id === value.slice(2))?.name ?? 'look');
    else if (value.startsWith('k:')) onApply({ themeKey: value.slice(2) }, LOOKS.find((l) => l.key === value.slice(2))?.name ?? 'look');
    setValue('');
  };
  return (
    <>
      <NativeSelect aria-label={label} className="w-auto" disabled={disabled} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">{current ? 'Change look…' : 'Choose…'}</option>
        {follow ? <option value="follow">Same as the tournament{follow.name ? ` (${follow.name})` : ''}</option> : null}
        {mine.length ? (
          <optgroup label="Your looks">
            {mine.map((p) => <option key={p.id} value={`p:${p.id}`} disabled={p.id === current}>{p.name}</option>)}
          </optgroup>
        ) : null}
        <optgroup label="Built-in looks">
          {LOOKS.map((l) => <option key={l.key} value={`k:${l.key}`} disabled={!!current && builtIn(l.key)?.id === current} title={l.description}>{l.name}</option>)}
        </optgroup>
      </NativeSelect>
      <Button size="sm" disabled={!value || disabled} loading={loading} onClick={apply}>Apply</Button>
    </>
  );
}
