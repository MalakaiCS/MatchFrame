'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { BUILTIN_TEMPLATES, DEFAULT_THEMES, type ThemeConfig } from '@bs/graphics';
import { Keyframes } from '@bs/graphics/react';
import { ThemeThumb } from '@/components/theme-preview';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { patch, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';

interface Theme { id: string; key: string; name: string; description: string | null; versions: { id: string; version: number; config: ThemeConfig }[] }
interface Profile { id: string; name: string; competitionId: string | null; currentVersion: number; draft: { themeKey: string; config: Partial<ThemeConfig> }; versions: { id: string; version: number; publishedAt: string }[] }

export default function ThemesPage() {
  const me = useMe();
  const full = isFull(me.data?.role);
  const themes = useGet<Theme[]>(['themes'], 'themes');
  const profiles = useGet<Profile[]>(['theme-profiles'], 'theme-profiles');
  const comps = useGet<{ id: string; name: string }[]>(['competitions'], 'competitions');
  const templates = useGet<{ id: string; name: string; category: string; currentVersion: number; updatedAt: string }[]>(['templates'], 'templates');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', themeKey: 'broadcast', competitionId: '' });
  const create = useAction(() => post('theme-profiles', { ...form, competitionId: form.competitionId || null, publish: true }), [['theme-profiles']]);
  const [edit, setEdit] = useState<Profile | null>(null);
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const newTemplate = useAction(() => post<{ id: string }>('templates', { name: 'New graphic' }), [['templates']]);

  return (
    <>
      <Keyframes />
      <PageHeader title="Themes" subtitle="Original theme library, competition graphics profiles and custom templates." />
      <Tabs defaultValue="library">
        <TabList className="mb-4"><Tab value="library">Theme library</Tab><Tab value="profiles">Profiles</Tab><Tab value="templates">Custom templates</Tab></TabList>
        <TabPanel value="library">
          {themes.isLoading ? <Spinner /> : (
            <div className="grid gap-4 md:grid-cols-3">
              {themes.data?.map((t) => (
                <Link key={t.id} href={`/app/themes/${t.key}`} className="block rounded-lg transition hover:ring-2 hover:ring-primary/50">
                  <Card className="h-full p-3">
                    <ThemeThumb theme={(t.versions[0]?.config as ThemeConfig) ?? DEFAULT_THEMES.broadcast} />
                    <h2 className="mt-2 font-medium">{t.name}</h2>
                    <p className="text-sm text-muted">{t.description}</p>
                    <p className="mt-1 text-xs text-muted">v{t.versions[0]?.version} · football & basketball · {BUILTIN_TEMPLATES.length} graphics</p>
                    <p className="mt-2 text-sm text-primary">View graphics and animations →</p>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabPanel>
        <TabPanel value="profiles">
          {full ? <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> New profile</Button></div> : null}
          <ErrorNotice error={profiles.error} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {profiles.data?.map((p) => {
              const base = DEFAULT_THEMES[(p.draft.themeKey as ThemeConfig['themeKey']) ?? 'broadcast'];
              return (
                <Card key={p.id} className="p-3">
                  <ThemeThumb theme={{ ...base, ...p.draft.config }} />
                  <div className="mt-2 flex items-center justify-between"><h2 className="font-medium">{p.name}</h2><StatusPill tone="primary">v{p.currentVersion}</StatusPill></div>
                  <p className="text-xs text-muted">{p.draft.themeKey} · {comps.data?.find((c) => c.id === p.competitionId)?.name ?? 'no competition'}</p>
                  <Table className="mt-2"><tbody>{p.versions.slice(0, 3).map((v) => <tr key={v.id}><td>v{v.version}</td><td className="text-right text-xs text-muted">{fmtDate(v.publishedAt, tz)}</td></tr>)}</tbody></Table>
                  <div className="mt-2 flex gap-2">
                    <Button asChild size="sm"><Link href={`/app/themes/${p.draft.themeKey}?profile=${p.id}`}>Preview graphics</Link></Button>
                    {full ? <Button size="sm" onClick={() => setEdit(p)}>Edit draft</Button> : null}
                  </div>
                </Card>
              );
            })}
          </div>
        </TabPanel>
        <TabPanel value="templates">
          {full ? <div className="mb-3 flex justify-end"><Button variant="primary" loading={newTemplate.isPending} onClick={() => newTemplate.mutate(undefined, { onSuccess: (t) => location.assign(`/app/themes/templates/${t.id}`) })}><Plus className="size-4" /> New template</Button></div> : null}
          <Table><thead><tr><th>Template</th><th>Category</th><th>Published</th><th /></tr></thead><tbody>
            {templates.data?.map((t) => <tr key={t.id}><td>{t.name}</td><td>{t.category}</td><td>{t.currentVersion ? `v${t.currentVersion}` : <StatusPill tone="warning">draft only</StatusPill>}</td><td className="text-right"><Button asChild size="sm"><Link href={`/app/themes/templates/${t.id}`}>Open designer</Link></Button></td></tr>)}
            {!templates.data?.length ? <tr><td colSpan={4} className="text-center text-muted">No custom templates. Build one with typed data bindings; no code required.</td></tr> : null}
          </tbody></Table>
        </TabPanel>
      </Tabs>
      <Dialog open={open} onOpenChange={setOpen} title="New graphics profile" description="Publishes version 1. Overlays pin versions; later publishes need an explicit apply on live outputs."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!form.name} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => setOpen(false) })}>Create & publish</Button></>}>
        <div className="grid gap-3">
          <Field label="Name" htmlFor="pn"><Input id="pn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Theme" htmlFor="pt"><NativeSelect id="pt" value={form.themeKey} onChange={(e) => setForm({ ...form, themeKey: e.target.value })}><option value="minimal">Minimal</option><option value="broadcast">Broadcast</option><option value="club">Club</option></NativeSelect></Field>
          <Field label="Default for competition" htmlFor="pc"><NativeSelect id="pc" value={form.competitionId} onChange={(e) => setForm({ ...form, competitionId: e.target.value })}><option value="">None</option>{comps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
          <ErrorNotice error={create.error} />
        </div>
      </Dialog>
      {edit ? <ProfileEditor profile={edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function ProfileEditor({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [cfg, setCfg] = useState<Partial<ThemeConfig>>(profile.draft.config ?? {});
  const [themeKey, setThemeKey] = useState(profile.draft.themeKey);
  const save = useAction(() => patch(`theme-profiles/${profile.id}`, { themeKey, config: cfg }), [['theme-profiles']]);
  const publish = useAction(async () => {
    await patch(`theme-profiles/${profile.id}`, { themeKey, config: cfg });
    return post(`theme-profiles/${profile.id}/publish`);
  }, [['theme-profiles']]);
  const base = DEFAULT_THEMES[themeKey as ThemeConfig['themeKey']];
  const colour = (k: keyof ThemeConfig, label: string) => (
    <Field label={label} htmlFor={`c-${k}`}><input id={`c-${k}`} type="color" className="h-9 w-full rounded border border-border bg-bg" value={String(cfg[k] ?? base[k])} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value.toUpperCase() })} /></Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={`Edit ${profile.name}`} description="Draft edits never change a running broadcast. Publish creates an immutable new version."
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save draft</Button><Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate(undefined, { onSuccess: onClose })}>Publish v{profile.currentVersion + 1}</Button></>}>
      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <ThemeThumb theme={{ ...base, ...cfg }} />
        <div className="grid content-start gap-2">
          <Field label="Theme" htmlFor="tk"><NativeSelect id="tk" value={themeKey} onChange={(e) => setThemeKey(e.target.value)}><option value="minimal">Minimal</option><option value="broadcast">Broadcast</option><option value="club">Club</option></NativeSelect></Field>
          <div className="grid grid-cols-2 gap-2">{colour('primary', 'Primary')}{colour('secondary', 'Secondary')}{colour('accent', 'Accent')}{colour('panel', 'Panel')}{colour('text', 'Text')}</div>
          <Field label="Motion" htmlFor="mo"><NativeSelect id="mo" value={cfg.motion ?? base.motion} onChange={(e) => setCfg({ ...cfg, motion: e.target.value as ThemeConfig['motion'] })}><option value="none">None</option><option value="subtle">Subtle</option><option value="full">Full</option></NativeSelect></Field>
          <Field label={`Entrance ${cfg.entranceMs ?? base.entranceMs} ms`} htmlFor="en"><input id="en" type="range" min={150} max={600} step={10} value={cfg.entranceMs ?? base.entranceMs} onChange={(e) => setCfg({ ...cfg, entranceMs: Number(e.target.value) })} /></Field>
        </div>
      </div>
      <ErrorNotice error={save.error ?? publish.error} />
    </Dialog>
  );
}

