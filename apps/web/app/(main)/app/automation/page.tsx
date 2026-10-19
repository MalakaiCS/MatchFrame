'use client';
// Game plans: playlists with triggers, guards, priorities and timed items; publish-time validation; and an
// isolated rehearsal that replays a synthetic match through the production decision functions.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Plus, Upload } from 'lucide-react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs, Textarea, cx } from '@bs/ui';
import { ApiError, post, put } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';

interface Issue { path: string; message: string; severity: 'error' | 'warning' }
interface Item { id: string; action: string; templateKey?: string; placement?: string; offsetMs: number; durationMs?: number | null }
interface Playlist { id: string; name: string; kind: string; priority: number; promotional: boolean; triggers: { id: string; type: string; eventTypes?: string[]; phaseTags?: string[]; atMs?: number }[]; repeat: { mode: string; gapMs: number; maxIterations: number }; items: Item[] }
interface Draft { version: 1; sport: string; defaultScorebug: boolean; freshnessMs: number; playlists: Playlist[] }
interface PlanSummary { id: string; name: string; sport: string; currentVersion: number; updatedAt: string; versions: { id: string; version: number; publishedAt: string }[] }
interface PlanDetail extends PlanSummary { draft: Draft; validation: { ok: boolean; issues: Issue[] } }
interface Rehearsal { decisions: { t: number; playlistId: string; triggerId: string; outcome: string; reason: string }[]; cues: { t: number; playlistId: string; action: string; templateKey?: string; layer: string | null; durationMs: number | null; placement?: string }[]; durationMs: number }

const triggerLabel = (t: Playlist['triggers'][number]) =>
  t.type === 'event' ? `on ${t.eventTypes?.join(', ')}` : t.type === 'phase' ? `phase ${t.phaseTags?.join(', ')}` : t.type === 'match_clock' ? `at ${Math.round((t.atMs ?? 0) / 60000)}′` : t.type;

export default function AutomationPage() {
  const me = useMe();
  const full = isFull(me.data?.role);
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const plans = useGet<PlanSummary[]>(['game-plans'], 'game-plans');
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', sport: 'football', fromStarter: true });
  const create = useAction(() => post<{ id: string }>('game-plans', form), [['game-plans']]);
  useEffect(() => {
    if (!sel && plans.data?.[0]) setSel(plans.data[0].id);
  }, [plans.data, sel]);

  return (
    <>
      <PageHeader title="Automation" subtitle="Game plans decide which graphics run from scoring events, phases, clock times and sponsor rotations." actions={full ? <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> New game plan</Button> : null} />
      <ErrorNotice error={plans.error} />
      {plans.isLoading ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card className="p-2">
            <ul aria-label="Game plans">
              {plans.data?.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setSel(p.id)} className={cx('w-full rounded px-2 py-2 text-left text-sm', sel === p.id ? 'bg-elevated' : 'hover:bg-elevated/60')} aria-current={sel === p.id}>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted">{p.sport} · {p.currentVersion ? `v${p.currentVersion} published` : 'draft only'}</div>
                  </button>
                </li>
              ))}
              {!plans.data?.length ? <li className="p-2 text-sm text-muted">No game plans yet. Start from a starter plan.</li> : null}
            </ul>
          </Card>
          {sel ? <PlanEditor key={sel} id={sel} canEdit={full} tz={tz} /> : null}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen} title="New game plan" footer={<Button variant="primary" disabled={!form.name || create.isPending} onClick={async () => { const r = await create.mutateAsync(undefined as never); setSel(r.id); setOpen(false); }}>Create</Button>}>
        <div className="space-y-3">
          <Field label="Name" htmlFor="gp-name"><Input id="gp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Sport" htmlFor="gp-sport"><NativeSelect id="gp-sport" value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}><option value="football">Football</option><option value="basketball">Basketball</option></NativeSelect></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.fromStarter} onChange={(e) => setForm({ ...form, fromStarter: e.target.checked })} /> Start from the {form.sport} starter plan</label>
          <ErrorNotice error={create.error} />
        </div>
      </Dialog>
    </>
  );
}

function PlanEditor({ id, canEdit, tz }: { id: string; canEdit: boolean; tz: string }) {
  const plan = useGet<PlanDetail>(['game-plan', id], `game-plans/${id}`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [json, setJson] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (plan.data && !draft) {
      setDraft(plan.data.draft);
      setJson(JSON.stringify(plan.data.draft, null, 2));
      setIssues(plan.data.validation.issues);
    }
  }, [plan.data, draft]);
  if (!plan.data || !draft) return <Spinner />;

  const save = async (d: Draft) => {
    setErr(null);
    try {
      const r = await put<{ validation: { issues: Issue[] } }>(`game-plans/${id}/draft`, { draft: d });
      setIssues(r.validation.issues);
      setSaved('Draft saved');
      await plan.refetch();
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  const update = (fn: (d: Draft) => Draft) => {
    const d = fn(structuredClone(draft));
    setDraft(d);
    setJson(JSON.stringify(d, null, 2));
    void save(d);
  };
  const publish = async () => {
    setErr(null);
    try {
      const r = await post<{ version: number }>(`game-plans/${id}/publish`);
      setSaved(`Published v${r.version}. Assign it to an output in the control room.`);
      await plan.refetch();
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  const errors = issues.filter((i) => i.severity === 'error');

  return (
    <div className="min-w-0 space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <h2 className="text-lg font-semibold">{plan.data.name}</h2>
        <StatusPill tone="primary">{plan.data.sport}</StatusPill>
        <span className="text-xs text-muted">{plan.data.currentVersion ? `v${plan.data.currentVersion} published ${fmtDate(plan.data.versions[0]?.publishedAt, tz)}` : 'not yet published'}</span>
        <div className="ml-auto flex items-center gap-2">
          {saved ? <span role="status" className="text-xs text-muted">{saved}</span> : null}
          {canEdit ? <Button variant="primary" disabled={!!errors.length} onClick={() => void publish()}><Upload className="size-4" /> Publish</Button> : null}
        </div>
      </Card>
      <ErrorNotice error={err} />
      {issues.length ? (
        <Card className="p-3">
          <h3 className="mb-1 text-sm font-medium">{errors.length ? `${errors.length} error(s) block publishing` : 'Warnings'}</h3>
          <ul className="space-y-0.5 text-xs">{issues.map((i, k) => <li key={k} className={i.severity === 'error' ? 'text-live' : 'text-warning'}>{i.path}: {i.message}</li>)}</ul>
        </Card>
      ) : null}
      <Tabs defaultValue="playlists">
        <TabList className="mb-3"><Tab value="playlists">Playlists</Tab><Tab value="rehearse">Rehearse</Tab><Tab value="advanced">Advanced (JSON)</Tab></TabList>
        <TabPanel value="playlists" className="space-y-3">
          <Card className="flex flex-wrap items-center gap-4 p-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={draft.defaultScorebug} onChange={(e) => update((d) => ({ ...d, defaultScorebug: e.target.checked }))} /> Show scorebug during play by default</label>
            <label className="flex items-center gap-2">Live window <Input type="number" className="w-20" disabled={!canEdit} value={draft.freshnessMs / 1000} min={1} max={120} onChange={(e) => update((d) => ({ ...d, freshnessMs: Math.max(1, Math.min(120, Number(e.target.value) || 10)) * 1000 }))} /> s</label>
            <span className="text-xs text-muted">Facts recorded later than this never trigger on-air graphics.</span>
          </Card>
          {draft.playlists.map((pl, i) => (
            <Card key={pl.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Playlist name" className="w-56" disabled={!canEdit} value={pl.name} onChange={(e) => update((d) => { d.playlists[i]!.name = e.target.value; return d; })} />
                <StatusPill tone="neutral">{pl.kind}</StatusPill>
                <span className="text-xs text-muted">{pl.triggers.map(triggerLabel).join(' / ')}</span>
                <label className="ml-auto flex items-center gap-1 text-xs">Priority
                  <NativeSelect aria-label="Priority" className="w-auto" disabled={!canEdit} value={pl.priority} onChange={(e) => update((d) => { d.playlists[i]!.priority = Number(e.target.value); return d; })}>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>{p}{p === 1 ? ' (highest)' : ''}</option>)}</NativeSelect>
                </label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={!canEdit} checked={pl.repeat.mode === 'loop'} onChange={(e) => update((d) => { d.playlists[i]!.repeat = { ...pl.repeat, mode: e.target.checked ? 'loop' : 'once' }; return d; })} /> Loop</label>
                {canEdit ? <Button size="sm" variant="ghost" onClick={() => update((d) => { d.playlists.splice(i, 1); return d; })}>Remove</Button> : null}
              </div>
              <ol className="mt-2 flex flex-wrap gap-1 text-xs">
                {pl.items.map((it) => (
                  <li key={it.id} className="rounded bg-elevated px-2 py-1">+{(it.offsetMs / 1000).toFixed(1)}s {it.action}{it.templateKey ? ` ${it.templateKey.replace('builtin:', '')}` : ''}{it.placement ? ` ${it.placement}` : ''}{it.durationMs ? ` · ${it.durationMs / 1000}s` : ''}</li>
                ))}
              </ol>
            </Card>
          ))}
          <p className="text-xs text-muted">Edit triggers, guards and item timing in the Advanced tab; changes save as a draft and are validated before publishing.</p>
        </TabPanel>
        <TabPanel value="rehearse"><RehearsalView id={id} draft={draft} /></TabPanel>
        <TabPanel value="advanced" className="space-y-2">
          <Textarea aria-label="Game plan JSON" className="h-[28rem] font-mono text-xs" disabled={!canEdit} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          {canEdit ? <Button onClick={() => { try { const d = JSON.parse(json) as Draft; setDraft(d); void save(d); } catch { setIssues([{ path: '(json)', message: 'Not valid JSON', severity: 'error' }]); } }}>Save draft</Button> : null}
        </TabPanel>
      </Tabs>
    </div>
  );
}

const SPEEDS = [1, 2, 5, 10];

function RehearsalView({ id, draft }: { id: string; draft: Draft }) {
  const [r, setR] = useState<Rehearsal | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [speed, setSpeed] = useState(5);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = useRef(0);
  const run = async () => {
    setErr(null);
    try {
      setR(await post<Rehearsal>(`game-plans/${id}/rehearse`, {}));
      setT(0);
      setPlaying(true);
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  useEffect(() => {
    if (!playing || !r) return;
    last.current = performance.now();
    let raf = 0;
    const step = (now: number) => {
      setT((x) => Math.min(r.durationMs, x + (now - last.current) * speed));
      last.current = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, r, speed]);
  const onAir = useMemo(() => {
    if (!r) return [];
    const by = new Map<string, Rehearsal['cues'][number]>();
    for (const c of r.cues) if (c.t <= t && c.layer && !c.action.includes('cancelled') && ['show', 'sponsor', 'creative', 'media'].includes(c.action) && (c.durationMs == null || c.t + c.durationMs > t)) by.set(c.layer, c);
    return [...by.entries()];
  }, [r, t]);
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <StatusPill tone="warning">Rehearsal — isolated</StatusPill>
        <span className="text-xs text-muted">Synthetic {draft.sport} match. Nothing is sent to outputs, streams, sponsor reports or usage.</span>
        <div className="ml-auto flex items-center gap-2">
          <NativeSelect aria-label="Speed" className="w-auto" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</NativeSelect>
          {r ? <Button size="sm" variant="secondary" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</Button> : null}
          <Button variant="primary" className="whitespace-nowrap" onClick={() => void run()}>Rehearse draft</Button>
        </div>
      </Card>
      <ErrorNotice error={err} />
      {r ? (
        <>
          <Card className="p-3">
            <div className="mb-2 flex items-center gap-2 text-sm"><span className="font-mono">{fmt(t)}</span> / <span className="font-mono text-muted">{fmt(r.durationMs)}</span></div>
            <input type="range" aria-label="Rehearsal position" className="w-full" min={0} max={r.durationMs} value={t} onChange={(e) => setT(Number(e.target.value))} />
            <div className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
              {['fullframe', 'event', 'lower', 'sponsor', 'ticker', 'background'].map((l) => {
                const c = onAir.find(([k]) => k === l)?.[1];
                return <div key={l} className={cx('rounded border px-2 py-1', c ? 'border-primary' : 'border-border text-muted')}><span className="uppercase">{l}</span>: {c ? `${c.templateKey?.replace('builtin:', '') ?? c.placement} (${c.playlistId})` : '—'}</div>;
              })}
            </div>
          </Card>
          <Table>
            <thead><tr><th>Time</th><th>Playlist</th><th>Outcome</th><th>Why</th></tr></thead>
            <tbody>
              {r.decisions.map((d, k) => (
                <tr key={k} className={d.t <= t ? '' : 'opacity-40'}><td className="font-mono">{fmt(d.t)}</td><td>{d.playlistId}</td><td><StatusPill tone={d.outcome === 'fired' ? 'healthy' : d.outcome === 'skipped' ? 'neutral' : 'warning'}>{d.outcome}</StatusPill></td><td className="text-xs text-muted">{d.reason}</td></tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}
    </div>
  );
}
