'use client';
import Link from 'next/link';
import { Button, Card, ErrorNotice, Field, NativeSelect, Spinner } from '@bs/ui';
import { patch, put } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { LookPicker, lookName, type LookChoice, type LookProfile } from '@/components/look-picker';

interface Props {
  competition: { id: string; sport: string; themeProfileId: string | null; gamePlanVersionId: string | null; outputDefaults: Record<string, unknown> };
  canEdit: boolean;
}

/** Competition-level defaults inherited (and pinned) by new fixtures and their overlays/outputs. */
export function CompetitionProduction({ competition: c, canEdit }: Props) {
  const profiles = useGet<LookProfile[]>(['theme-profiles'], 'theme-profiles');
  const plans = useGet<{ id: string; name: string; sport: string; versions: { id: string; version: number }[] }[]>(['game-plans'], 'game-plans');
  const save = useAction((v: Record<string, unknown>) => patch(`competitions/${c.id}`, v), [['competition', c.id]]);
  const setLook = useAction((v: { choice: LookChoice; name: string }) => put<{ outputs: number }>(`competitions/${c.id}/look`, v.choice), [['competition', c.id], ['theme-profiles'], ['overlays']], {
    success: (r, v) => `${v.name} is the tournament look${r.outputs ? `; ${r.outputs} upcoming match output${r.outputs === 1 ? '' : 's'} changed to it` : ''}`,
  });
  const current = lookName(profiles.data, c.themeProfileId);
  const od = c.outputDefaults as { preset?: string; postrollSeconds?: number };
  if (profiles.isLoading || plans.isLoading) return <Spinner />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-1 font-medium">Tournament look</h2>
        <p className="mb-3 text-sm">{current ? <>Every match uses <strong>{current}</strong> unless it has a look of its own.</> : 'No look chosen: matches use the Broadcast look unless they have one of their own.'}</p>
        {canEdit ? <div className="flex flex-wrap items-center gap-2"><LookPicker label="Tournament look" profiles={profiles.data} current={c.themeProfileId} loading={setLook.isPending} onApply={(choice, name) => setLook.mutate({ choice, name })} /></div> : null}
        <p className="mt-2 text-xs text-muted">Upcoming matches that show the tournament look change with it; a match given its own look on its match page keeps that, and a match under way keeps the look it started with. <Link className="underline" href="/app/themes">See every look</Link>.</p>
        <ErrorNotice error={setLook.error} />
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 font-medium">Default automation</h2>
        <Field label="Plan for new fixtures" htmlFor="gp">
          <NativeSelect id="gp" disabled={!canEdit} value={c.gamePlanVersionId ?? ''} onChange={(e) => save.mutate({ gamePlanVersionId: e.target.value || null })}>
            <option value="">Off (everything from the control room)</option>
            {plans.data?.filter((p) => p.sport === c.sport).flatMap((p) => p.versions.map((v) => <option key={v.id} value={v.id}>{p.name} · v{v.version}</option>))}
          </NativeSelect>
        </Field>
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 font-medium">Output defaults</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Video preset" htmlFor="op">
            <NativeSelect id="op" disabled={!canEdit} value={od.preset ?? '720p30'} onChange={(e) => save.mutate({ outputDefaults: { ...od, preset: e.target.value } })}>
              <option value="720p25">1280×720 · 25 fps</option><option value="720p30">1280×720 · 30 fps</option>
            </NativeSelect>
          </Field>
          <Field label="Post-game window (s)" htmlFor="pr">
            <NativeSelect id="pr" disabled={!canEdit} value={String(od.postrollSeconds ?? 120)} onChange={(e) => save.mutate({ outputDefaults: { ...od, postrollSeconds: Number(e.target.value) } })}>
              {[30, 60, 120, 300, 600].map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted">1080p is not offered as a competition default: CPU load, bandwidth and recording sizes at 1080p have not been measured on this installation. A match can still be switched to 1080p on its Streams tab, where it is marked as unmeasured; rehearse it before relying on it.</p>
      </Card>
      <div className="lg:col-span-2"><ErrorNotice error={save.error} />{save.isPending ? <Spinner label="Saving" /> : null}</div>
      {canEdit ? null : <Button disabled>Read only</Button>}
    </div>
  );
}
