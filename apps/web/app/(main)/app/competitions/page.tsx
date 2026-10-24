'use client';
// Competitions: the list, and a new competition with its rules. The rules start from a preset (built-in or one of the
// organisation's own); its match timing is shown ready to change (period length, breaks, halves or quarters…) with a
// picture of the match, and extra time and the other rules are one step further down.
import { SportOptions } from '@/components/sport-options';
import { usePresetOptions, withDefaults } from '@/components/competition/rules-editor';
import { MatchTimeline, RulesFields } from '@/components/competition/rules-timing';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trophy } from 'lucide-react';
import { getAdapter, regulationTimeline, setRulesValue, type Sport } from '@bs/domain';
import { Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill } from '@bs/ui';
import { post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';

/** A name for changed rules from their timing: "2×18, 5-minute half time", "4×10". */
function timingName(sport: Sport, cfg: Record<string, unknown>) {
  const t = regulationTimeline(sport, cfg);
  if (!t) return '';
  const plays = t.steps.filter((s) => s.kind === 'play');
  const half = t.steps.find((s) => s.kind === 'break' && s.label === 'Half Time');
  return `${plays.length}×${plays[0]?.minutes ?? ''}${half ? `, ${half.minutes}-minute half time` : ''}`;
}

interface Comp { id: string; name: string; shortName: string | null; sport: string; status: string; seasonCount: number; matchCount: number; currentSeason: { name: string } | null; logoAssetId: string | null }

export default function CompetitionsPage() {
  const me = useMe();
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState('');
  const [open, setOpen] = useState(false);
  const list = useGet<Comp[]>(['competitions', search, sport], `competitions?${new URLSearchParams({ ...(search ? { search } : {}), ...(sport ? { sport } : {}) })}`);
  const [form, setForm] = useState({ name: '', shortName: '', sport: 'football', rulesPreset: '', defaultTimezone: me.data?.activeOrganisation?.timezone ?? 'Australia/Brisbane' });
  // each sport's own presets (the first is its default rules), and the organisation's for the sport
  const presetOptions = usePresetOptions(form.sport);
  const presets = presetOptions.builtIn.map((p, i) => [i === 0 ? '' : p.value, p.label] as const);
  const sportKey = form.sport as Sport;
  // the chosen preset's rules, and the form's copy of them with any changes
  const presetCfg = useMemo(() => {
    const p = form.rulesPreset ? [...presetOptions.mine, ...presetOptions.builtIn].find((x) => x.value === form.rulesPreset) : presetOptions.builtIn[0];
    return p ? withDefaults(sportKey, p.config) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the option lists are rebuilt each render; their source is the sport, the choice and the own presets
  }, [sportKey, form.rulesPreset, presetOptions.own.data]);
  const [rules, setRules] = useState<Record<string, unknown> | null>(null);
  const [labelTouched, setLabelTouched] = useState(false);
  const [keepPreset, setKeepPreset] = useState(false);
  useEffect(() => {
    setRules(presetCfg);
    setLabelTouched(false);
  }, [presetCfg]);
  const changed = !!rules && !!presetCfg && JSON.stringify(rules) !== JSON.stringify(presetCfg);
  const parsed = rules ? getAdapter(sportKey).configSchema.safeParse(rules) : null;
  const issue = (path: string) => (parsed && !parsed.success ? (parsed.error.issues.find((i) => i.path.join('.') === path)?.message ?? null) : null);
  const setRule = (path: string, value: unknown) => {
    if (path === 'label') setLabelTouched(true);
    setRules((r) => {
      if (!r) return r;
      let next = setRulesValue(r, path, value);
      // changed timing names itself ("2×18, 5-minute half time") until someone types a name
      if (path !== 'label' && !labelTouched && JSON.stringify(next) !== JSON.stringify(presetCfg)) next = setRulesValue(next, 'label', `Own rules ${timingName(sportKey, next)}`.slice(0, 80));
      return next;
    });
  };
  const create = useAction(
    async (v: typeof form) => {
      if (changed && keepPreset) await post('rules-presets', { sport: v.sport, name: String(rules?.label ?? '').trim(), config: rules });
      return post('competitions', { ...v, shortName: v.shortName || null, rulesPreset: v.rulesPreset || undefined, ...(changed ? { rulesConfig: rules } : {}) });
    },
    [['competitions'], ['rules-presets', form.sport]],
  );

  return (
    <>
      <PageHeader title="Competitions" subtitle="Leagues and cups with their seasons, rules, graphics and production defaults." actions={isFull(me.data?.role) ? <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> New competition</Button> : null} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search competitions" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search competitions" />
        <NativeSelect className="max-w-40" value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport filter"><option value="">All sports</option><SportOptions /></NativeSelect>
      </div>
      <ErrorNotice error={list.error} onRetry={() => list.refetch()} />
      {list.isLoading ? <Spinner /> : !list.data?.length ? (
        <EmptyState icon={<Trophy className="size-6 text-muted" />} title={search || sport ? 'No competitions match these filters' : 'No competitions yet'} body="Create a competition to add seasons, teams and fixtures." action={isFull(me.data?.role) ? <Button variant="primary" onClick={() => setOpen(true)}>New competition</Button> : null} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((c) => (
            <Link key={c.id} href={`/app/competitions/${c.id}`}>
              <Card className="h-full p-4 hover:border-primary">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">{c.logoAssetId ? <img src={`/api/v1/assets/${c.logoAssetId}/preview`} alt="" className="h-10 w-10 shrink-0 object-contain" loading="lazy" /> : null}<div><h2 className="font-medium">{c.name}</h2><p className="text-xs text-muted">{c.shortName ?? '—'} · {c.sport}</p></div></div>
                  <StatusPill tone={c.status === 'active' ? 'healthy' : 'neutral'}>{c.status}</StatusPill>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-muted">Season</dt><dd>{c.currentSeason?.name ?? '—'}</dd></div>
                  <div><dt className="text-muted">Seasons</dt><dd className="tabular">{c.seasonCount}</dd></div>
                  <div><dt className="text-muted">Matches</dt><dd className="tabular">{c.matchCount}</dd></div>
                </dl>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <Dialog wide open={open} onOpenChange={(o) => { setOpen(o); create.reset(); }} title="New competition" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!form.name.trim() || (!!parsed && !parsed.success)} onClick={() => create.mutate(form, { onSuccess: () => setOpen(false) })}>Create</Button></>}>
        <div className="grid gap-3">
          <Field label="Name" htmlFor="cname" error={create.error?.fieldError('name')}><Input id="cname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Short name" htmlFor="cshort"><Input id="cshort" maxLength={24} value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} /></Field>
            <Field label="Sport" htmlFor="csport"><NativeSelect id="csport" value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value, rulesPreset: '' })}><SportOptions /></NativeSelect></Field>
          </div>
          <Field label="Rules preset" htmlFor="crules" hint="Start from a preset, then change the timing below if your competition plays differently. Presets are conveniences, not an official certification."><NativeSelect id="crules" value={form.rulesPreset} onChange={(e) => setForm({ ...form, rulesPreset: e.target.value })}>{presetOptions.mine.length ? <optgroup label="Your presets">{presetOptions.mine.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</optgroup> : null}<optgroup label="Built-in">{presets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup></NativeSelect></Field>
          {rules ? (
            <section aria-labelledby="new-comp-timing" className="grid gap-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="new-comp-timing" className="text-sm font-semibold text-text">Match timing</h3>
                {changed ? <StatusPill tone="primary">changed from the preset</StatusPill> : null}
              </div>
              <RulesFields sport={sportKey} config={rules} group="timing" onChange={setRule} issue={issue} />
              <MatchTimeline sport={sportKey} config={rules} />
              <details className="group">
                <summary className="cursor-pointer text-sm font-medium text-primary">Extra time and the other rules</summary>
                <div className="mt-3 grid gap-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">When the scores are level</h4>
                  <RulesFields sport={sportKey} config={rules} group="level" onChange={setRule} issue={issue} />
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Other rules</h4>
                  <RulesFields sport={sportKey} config={rules} group="other" onChange={setRule} issue={issue} />
                </div>
              </details>
              {changed ? (
                <>
                  <RulesFields sport={sportKey} config={rules} group="name" onChange={setRule} issue={issue} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={keepPreset} onChange={(e) => setKeepPreset(e.target.checked)} /> Keep these rules as one of your presets, for other competitions</label>
                </>
              ) : null}
            </section>
          ) : null}
          <Field label="Default timezone" htmlFor="ctz" error={create.error?.fieldError('defaultTimezone')}><Input id="ctz" value={form.defaultTimezone} onChange={(e) => setForm({ ...form, defaultTimezone: e.target.value })} /></Field>
          <ErrorNotice error={create.error && !create.error.fields ? create.error : null} />
        </div>
      </Dialog>
    </>
  );
}
