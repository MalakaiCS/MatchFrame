'use client';
import { SportOptions } from '@/components/sport-options';
import { usePresetOptions } from '@/components/competition/rules-editor';
import Link from 'next/link';
import { useState } from 'react';
import { Plus, Trophy } from 'lucide-react';
import { Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill } from '@bs/ui';
import { post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';

interface Comp { id: string; name: string; shortName: string | null; sport: string; status: string; seasonCount: number; matchCount: number; currentSeason: { name: string } | null }

export default function CompetitionsPage() {
  const me = useMe();
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState('');
  const [open, setOpen] = useState(false);
  const list = useGet<Comp[]>(['competitions', search, sport], `competitions?${new URLSearchParams({ ...(search ? { search } : {}), ...(sport ? { sport } : {}) })}`);
  const [form, setForm] = useState({ name: '', shortName: '', sport: 'football', rulesPreset: '', defaultTimezone: me.data?.activeOrganisation?.timezone ?? 'Australia/Brisbane' });
  const create = useAction((v: typeof form) => post('competitions', { ...v, shortName: v.shortName || null, rulesPreset: v.rulesPreset || undefined }), [['competitions']]);
  // each sport's own presets (the first is its default rules), and the organisation's for the sport
  const presetOptions = usePresetOptions(form.sport);
  const presets = presetOptions.builtIn.map((p, i) => [i === 0 ? '' : p.value, p.label] as const);

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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((c) => (
            <Link key={c.id} href={`/app/competitions/${c.id}`}>
              <Card className="h-full p-4 hover:border-primary">
                <div className="flex items-start justify-between gap-2">
                  <div><h2 className="font-medium">{c.name}</h2><p className="text-xs text-muted">{c.shortName ?? '—'} · {c.sport}</p></div>
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
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); create.reset(); }} title="New competition" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!form.name.trim()} onClick={() => create.mutate(form, { onSuccess: () => setOpen(false) })}>Create</Button></>}>
        <div className="grid gap-3">
          <Field label="Name" htmlFor="cname" error={create.error?.fieldError('name')}><Input id="cname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Short name" htmlFor="cshort"><Input id="cshort" maxLength={24} value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} /></Field>
            <Field label="Sport" htmlFor="csport"><NativeSelect id="csport" value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value, rulesPreset: '' })}><SportOptions /></NativeSelect></Field>
          </div>
          <Field label="Rules preset" htmlFor="crules" hint="Presets are conveniences; change any setting, or keep your own preset, with Edit rules on the competition page. Not an official certification."><NativeSelect id="crules" value={form.rulesPreset} onChange={(e) => setForm({ ...form, rulesPreset: e.target.value })}>{presetOptions.mine.length ? <optgroup label="Your presets">{presetOptions.mine.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</optgroup> : null}<optgroup label="Built-in">{presets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup></NativeSelect></Field>
          <Field label="Default timezone" htmlFor="ctz" error={create.error?.fieldError('defaultTimezone')}><Input id="ctz" value={form.defaultTimezone} onChange={(e) => setForm({ ...form, defaultTimezone: e.target.value })} /></Field>
          <ErrorNotice error={create.error && !create.error.fields ? create.error : null} />
        </div>
      </Dialog>
    </>
  );
}
