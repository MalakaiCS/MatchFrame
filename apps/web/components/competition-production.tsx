'use client';
import { Button, Card, ErrorNotice, Field, NativeSelect, Spinner } from '@bs/ui';
import { patch } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';

interface Props {
  competition: { id: string; sport: string; themeProfileId: string | null; gamePlanVersionId: string | null; outputDefaults: Record<string, unknown> };
  canEdit: boolean;
}

/** Competition-level defaults inherited (and pinned) by new fixtures and their overlays/outputs. */
export function CompetitionProduction({ competition: c, canEdit }: Props) {
  const profiles = useGet<{ id: string; name: string; currentVersion: number }[]>(['theme-profiles'], 'theme-profiles');
  const plans = useGet<{ id: string; name: string; sport: string; versions: { id: string; version: number }[] }[]>(['game-plans'], 'game-plans');
  const save = useAction((v: Record<string, unknown>) => patch(`competitions/${c.id}`, v), [['competition', c.id]]);
  const od = c.outputDefaults as { preset?: string; postrollSeconds?: number };
  if (profiles.isLoading || plans.isLoading) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-3 font-medium">Default look</h2>
        <Field label="Look for new fixtures" htmlFor="tp" hint="New fixtures start with this look. A match already set up changes only when you apply the newer version on its OBS link tab.">
          <NativeSelect id="tp" disabled={!canEdit} value={c.themeProfileId ?? ''} onChange={(e) => save.mutate({ themeProfileId: e.target.value || null })}>
            <option value="">None</option>
            {profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.currentVersion})</option>)}
          </NativeSelect>
        </Field>
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
        <p className="mt-2 text-xs text-muted">1080p presets stay disabled until measured on this installation.</p>
      </Card>
      <div className="lg:col-span-2"><ErrorNotice error={save.error} />{save.isPending ? <Spinner label="Saving" /> : null}</div>
      {canEdit ? null : <Button disabled>Read only</Button>}
    </div>
  );
}
