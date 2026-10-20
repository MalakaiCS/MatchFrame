'use client';
// Automation plans: playlists that run graphics from the scorer's phases and events. Edited in plain language
// (when it runs, which steps, how long); the JSON view stays for power users. Rehearsal plays the plan through
// the real renderer against a synthetic match.
import { SportOptions } from '@/components/sport-options';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pause, Pencil, Play, Plus, Trash2, Upload } from 'lucide-react';
import { STARTER_PLANS, gamePlanSchema, type GamePlan, type Guard, type PlanItem, type Playlist, type Trigger } from '@bs/domain';
import { Button, Card, Dialog, ErrorNotice, Field, InfoTip, Input, NativeSelect, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs, Textarea, cx, toast } from '@bs/ui';
import { ApiError, post, put } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { isFull, useMe } from '@/lib/session';
import { PLAYLIST_KINDS, PRIORITIES } from '@/lib/labels';
import { TriggerDialog, triggerText, type Sport } from '@/components/automation/trigger-editor';
import { StepDialog, stepText } from '@/components/automation/step-editor';
import { GuardDialog, guardText } from '@/components/automation/guard-editor';
import { RehearsalPreview, type RehearsalCue } from '@/components/automation/rehearsal-preview';

interface Issue { path: string; message: string; severity: 'error' | 'warning' }
interface PlanSummary { id: string; name: string; sport: Sport; currentVersion: number; updatedAt: string; versions: { id: string; version: number; publishedAt: string }[] }
interface PlanDetail extends PlanSummary { draft: unknown; validation: { ok: boolean; issues: Issue[] } }
interface Rehearsal { decisions: { t: number; playlistId: string; triggerId: string; outcome: string; reason: string }[]; cues: RehearsalCue[]; durationMs: number }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'item';
const uniqueId = (base: string, taken: string[]) => {
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
  return id;
};
/** The draft as a full GamePlan (defaults filled in); an invalid draft is shown as-is so it can still be repaired. */
const asPlan = (draft: unknown): GamePlan => {
  const r = gamePlanSchema.safeParse(draft);
  return r.success ? r.data : (draft as GamePlan);
};

export default function AutomationPage() {
  const me = useMe();
  const full = isFull(me.data?.role);
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const plans = useGet<PlanSummary[]>(['game-plans'], 'game-plans');
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', sport: 'football', fromStarter: true });
  const create = useAction(() => post<{ id: string }>('game-plans', form), [['game-plans']], { success: 'Plan created' });
  useEffect(() => {
    if (!sel && plans.data?.[0]) setSel(plans.data[0].id);
  }, [plans.data, sel]);

  return (
    <>
      <PageHeader title="Automation" subtitle="Plans decide which graphics run from the scorer's phases and events: lineups before kick-off, the goal strap on a goal, the half-time board, and so on." actions={full ? <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> New plan</Button> : null} />
      <ErrorNotice error={plans.error} />
      {plans.isLoading ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card className="p-2">
            <ul aria-label="Automation plans">
              {plans.data?.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setSel(p.id)} className={cx('w-full rounded px-2 py-2 text-left text-sm', sel === p.id ? 'bg-elevated' : 'hover:bg-elevated/60')} aria-current={sel === p.id}>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted">{p.sport} · {p.currentVersion ? `v${p.currentVersion} published` : 'draft only'}</div>
                  </button>
                </li>
              ))}
              {!plans.data?.length ? <li className="p-2 text-sm text-muted">No plans yet. Create one from the starter plan: it already follows a normal match.</li> : null}
            </ul>
          </Card>
          {sel ? <PlanEditor key={sel} id={sel} canEdit={full} tz={tz} /> : null}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen} title="New automation plan" footer={<Button variant="primary" disabled={!form.name || create.isPending} onClick={async () => { const r = await create.mutateAsync(undefined as never); setSel(r.id); setOpen(false); }}>Create</Button>}>
        <div className="space-y-3">
          <Field label="Name" htmlFor="gp-name"><Input id="gp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Saturday league" /></Field>
          <Field label="Sport" htmlFor="gp-sport"><NativeSelect id="gp-sport" value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}><SportOptions /></NativeSelect></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.fromStarter} onChange={(e) => setForm({ ...form, fromStarter: e.target.checked })} /> Start from the {form.sport} starter plan (pre-match, lineups, kick-off, goals, cards, half time, full time)</label>
          <ErrorNotice error={create.error} />
        </div>
      </Dialog>
    </>
  );
}

function issueText(i: Issue, plan: GamePlan): string {
  const m = /playlists\[(\d+)\](?:\.items\[(\d+)\])?(?:\.triggers\.(\w+))?/.exec(i.path);
  if (!m) return `${i.path === '(json)' ? 'JSON' : i.path}: ${i.message}`;
  const pl = plan.playlists[Number(m[1])];
  const where = pl ? `“${pl.name}”${m[2] ? ` → step ${Number(m[2]) + 1}` : m[3] ? ' → when it runs' : ''}` : i.path;
  return `${where}: ${i.message}`;
}

function PlanEditor({ id, canEdit, tz }: { id: string; canEdit: boolean; tz: string }) {
  const plan = useGet<PlanDetail>(['game-plan', id], `game-plans/${id}`);
  const [draft, setDraft] = useState<GamePlan | null>(null);
  const [json, setJson] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editTrigger, setEditTrigger] = useState<{ pi: number; ti: number | null } | null>(null);
  const [editStep, setEditStep] = useState<{ pi: number; ii: number | null } | null>(null);
  const [editGuard, setEditGuard] = useState<{ pi: number; gi: number | null } | null>(null);
  const [newPlaylist, setNewPlaylist] = useState<{ name: string; kind: Playlist['kind'] } | null>(null);
  useEffect(() => {
    if (plan.data && !draft) {
      const d = asPlan(plan.data.draft);
      setDraft(d);
      setJson(JSON.stringify(d, null, 2));
      setIssues(plan.data.validation.issues);
    }
  }, [plan.data, draft]);
  if (!plan.data || !draft) return <Spinner />;
  const sport = plan.data.sport;

  const save = async (d: GamePlan) => {
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
  const update = (fn: (d: GamePlan) => GamePlan | void) => {
    const copy = structuredClone(draft);
    const d = fn(copy) ?? copy;
    setDraft(d);
    setJson(JSON.stringify(d, null, 2));
    void save(d);
  };
  const publish = async () => {
    setErr(null);
    try {
      const r = await post<{ version: number }>(`game-plans/${id}/publish`);
      setSaved(`Published v${r.version}`);
      toast(`Published v${r.version}. Choose it on a match (Match day → Automation) or as the competition default.`);
      await plan.refetch();
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  const errors = issues.filter((i) => i.severity === 'error');
  const move = (pi: number, ii: number, dir: -1 | 1) => update((d) => {
    const items = d.playlists[pi]!.items;
    const j = ii + dir;
    if (j < 0 || j >= items.length) return;
    [items[ii], items[j]] = [items[j]!, items[ii]!];
  });

  return (
    <div className="min-w-0 space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <h2 className="text-lg font-semibold">{plan.data.name}</h2>
        <StatusPill tone="primary">{sport}</StatusPill>
        <span className="text-xs text-muted">{plan.data.currentVersion ? `v${plan.data.currentVersion} published ${fmtDate(plan.data.versions[0]?.publishedAt, tz)}` : 'not yet published'}</span>
        <div className="ml-auto flex items-center gap-2">
          {saved ? <span role="status" className="text-xs text-muted">{saved}</span> : null}
          {canEdit && STARTER_PLANS[sport] ? <Button variant="ghost" onClick={() => { if (confirm('Replace this draft with the latest starter flow? Your playlists in the draft are replaced; published versions are not touched until you publish.')) update(() => structuredClone(STARTER_PLANS[sport]!)); }}>Use the latest starter flow</Button> : null}
          {canEdit ? <Button variant="primary" disabled={!!errors.length} onClick={() => void publish()}><Upload className="size-4" /> Publish</Button> : null}
        </div>
      </Card>
      <ErrorNotice error={err} />
      {issues.length ? (
        <Card className="p-3">
          <h3 className="mb-1 text-sm font-medium">{errors.length ? `${errors.length} thing${errors.length > 1 ? 's' : ''} to fix before publishing` : 'Worth a look'}</h3>
          <ul className="space-y-0.5 text-xs">{issues.map((i, k) => <li key={k} className={i.severity === 'error' ? 'text-live' : 'text-warning'}>{issueText(i, draft)}</li>)}</ul>
        </Card>
      ) : null}
      <Tabs defaultValue="playlists">
        <TabList className="mb-3"><Tab value="playlists">Playlists</Tab><Tab value="rehearse">Rehearse</Tab><Tab value="advanced">Advanced (JSON)</Tab></TabList>
        <TabPanel value="playlists" className="space-y-3">
          <Card className="flex flex-wrap items-center gap-4 p-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={draft.defaultScorebug} onChange={(e) => update((d) => { d.defaultScorebug = e.target.checked; })} /> Show the scorebug during play by default</label>
            <label className="flex items-center gap-2">Ignore events older than <Input type="number" className="w-20" disabled={!canEdit} value={draft.freshnessMs / 1000} min={1} max={120} onChange={(e) => update((d) => { d.freshnessMs = Math.max(1, Math.min(120, Number(e.target.value) || 10)) * 1000; })} /> s <InfoTip text="A goal typed in late (for example after a connection drop) updates the score but never replays its celebration graphic." /></label>
          </Card>
          {draft.playlists.map((pl, pi) => (
            <Card key={pl.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Playlist name" className="w-60" disabled={!canEdit} value={pl.name} onChange={(e) => update((d) => { d.playlists[pi]!.name = e.target.value; })} />
                <NativeSelect aria-label="Part of the match" className="w-auto" disabled={!canEdit} value={pl.kind} onChange={(e) => update((d) => { d.playlists[pi]!.kind = e.target.value as Playlist['kind']; })}>{Object.entries(PLAYLIST_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
                <label className="ml-auto flex items-center gap-1 text-xs">Priority
                  <NativeSelect aria-label="Priority" className="w-auto" disabled={!canEdit} value={pl.priority} onChange={(e) => update((d) => { d.playlists[pi]!.priority = Number(e.target.value); })}>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>{p} · {PRIORITIES[p]}</option>)}</NativeSelect>
                </label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={!canEdit} checked={pl.repeat.mode === 'loop'} onChange={(e) => update((d) => { d.playlists[pi]!.repeat = { ...pl.repeat, mode: e.target.checked ? 'loop' : 'once' }; })} /> Repeat</label>
                {pl.repeat.mode === 'loop' ? <label className="flex items-center gap-1 text-xs">gap <Input type="number" className="w-16" min={0} disabled={!canEdit} value={pl.repeat.gapMs / 1000} onChange={(e) => update((d) => { d.playlists[pi]!.repeat.gapMs = Math.max(0, Number(e.target.value) || 0) * 1000; })} /> s</label> : null}
                {canEdit ? <Button size="sm" variant="ghost" aria-label={`Remove playlist ${pl.name}`} onClick={() => confirm(`Remove “${pl.name}”?`) && update((d) => { d.playlists.splice(pi, 1); })}><Trash2 className="size-4" /></Button> : null}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[18rem_1fr]">
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted">Runs</h4>
                  <ul className="space-y-1 text-sm">
                    {pl.triggers.map((t, ti) => (
                      <li key={t.id} className="flex items-center gap-1 rounded bg-elevated px-2 py-1">
                        <span className="flex-1">{triggerText(t, sport)}</span>
                        {canEdit ? <><button className="text-muted hover:text-text" aria-label="Edit trigger" onClick={() => setEditTrigger({ pi, ti })}><Pencil className="size-3.5" /></button>{pl.triggers.length > 1 ? <button className="text-muted hover:text-live" aria-label="Remove trigger" onClick={() => update((d) => { d.playlists[pi]!.triggers.splice(ti, 1); })}><Trash2 className="size-3.5" /></button> : null}</> : null}
                      </li>
                    ))}
                  </ul>
                  {canEdit ? <Button size="sm" variant="ghost" className="mt-1" onClick={() => setEditTrigger({ pi, ti: null })}><Plus className="size-3.5" /> Also run when…</Button> : null}
                </div>
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted">Steps</h4>
                  <ol className="space-y-1 text-sm">
                    {pl.items.map((it, ii) => (
                      <li key={it.id} className="flex items-center gap-1 rounded bg-elevated px-2 py-1">
                        <span className="w-5 text-xs text-muted">{ii + 1}.</span>
                        <span className="flex-1">{stepText(it)}</span>
                        {canEdit ? <>
                          <button className="text-muted hover:text-text disabled:opacity-30" aria-label="Move up" disabled={ii === 0} onClick={() => move(pi, ii, -1)}><ArrowUp className="size-3.5" /></button>
                          <button className="text-muted hover:text-text disabled:opacity-30" aria-label="Move down" disabled={ii === pl.items.length - 1} onClick={() => move(pi, ii, 1)}><ArrowDown className="size-3.5" /></button>
                          <button className="text-muted hover:text-text" aria-label="Edit step" onClick={() => setEditStep({ pi, ii })}><Pencil className="size-3.5" /></button>
                          <button className="text-muted hover:text-live" aria-label="Remove step" onClick={() => update((d) => { d.playlists[pi]!.items.splice(ii, 1); })}><Trash2 className="size-3.5" /></button>
                        </> : null}
                      </li>
                    ))}
                    {!pl.items.length ? <li className="text-xs text-muted">No steps yet.</li> : null}
                  </ol>
                  {canEdit ? <Button size="sm" variant="ghost" className="mt-1" onClick={() => setEditStep({ pi, ii: null })}><Plus className="size-3.5" /> Add step</Button> : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-muted">Only when</span>
                {pl.guards.map((g, gi) => (
                  <span key={gi} className="flex items-center gap-1 rounded bg-elevated px-2 py-1">
                    {guardText(g, sport)}
                    {canEdit ? <><button className="text-muted hover:text-text" aria-label="Edit condition" onClick={() => setEditGuard({ pi, gi })}><Pencil className="size-3" /></button><button className="text-muted hover:text-live" aria-label="Remove condition" onClick={() => update((d) => { d.playlists[pi]!.guards.splice(gi, 1); })}><Trash2 className="size-3" /></button></> : null}
                  </span>
                ))}
                {!pl.guards.length ? <span className="text-muted">always (no conditions)</span> : null}
                {canEdit ? <Button size="sm" variant="ghost" onClick={() => setEditGuard({ pi, gi: null })}><Plus className="size-3.5" /> Add condition</Button> : null}
                {pl.triggers.every((t) => t.type === 'phase') ? (
                  <label className="flex items-center gap-1">
                    <input type="checkbox" disabled={!canEdit} checked={!!pl.continueOnPhaseStep} onChange={(e) => update((d) => { d.playlists[pi]!.continueOnPhaseStep = e.target.checked; })} /> Keep going when the scorer presses the next step
                    <InfoTip text="Normally a phase playlist stops when the scorer moves on (for example from Players entering to About to start). With this on it finishes its steps, and still stops at kick-off, at a break or at full time." />
                  </label>
                ) : null}
                <label className="ml-auto flex items-center gap-1">
                  <input type="checkbox" disabled={!canEdit} checked={pl.approval === 'manual'} onChange={(e) => update((d) => { d.playlists[pi]!.approval = e.target.checked ? 'manual' : 'auto'; })} /> Ask the producer before sending
                  <InfoTip text="Graphics from this playlist wait in the control room until someone presses Send now. Goals and other urgent graphics usually stay automatic." />
                </label>
              </div>
            </Card>
          ))}
          {canEdit ? <Button onClick={() => setNewPlaylist({ name: '', kind: 'in_play' })}><Plus className="size-4" /> Add playlist</Button> : null}
          <p className="text-xs text-muted">Playlists on the same layer take turns by priority: a goal (priority 1) interrupts a sponsor loop (priority 3). Changes save as a draft; matches use the published version you choose for them.</p>
        </TabPanel>
        <TabPanel value="rehearse"><RehearsalView id={id} sport={sport} names={Object.fromEntries(draft.playlists.map((p) => [p.id, p.name]))} /></TabPanel>
        <TabPanel value="advanced" className="space-y-2">
          <Textarea aria-label="Plan JSON" className="h-[28rem] font-mono text-xs" disabled={!canEdit} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          {canEdit ? <Button onClick={() => { try { const d = asPlan(JSON.parse(json)); setDraft(d); void save(d); } catch { setIssues([{ path: '(json)', message: 'Not valid JSON', severity: 'error' }]); } }}>Save draft</Button> : null}
        </TabPanel>
      </Tabs>

      {editTrigger ? (
        <TriggerDialog sport={sport} trigger={editTrigger.ti == null ? null : draft.playlists[editTrigger.pi]!.triggers[editTrigger.ti]!}
          id={editTrigger.ti == null ? uniqueId('t_' + slug(draft.playlists[editTrigger.pi]!.name), draft.playlists.flatMap((p) => p.triggers.map((t) => t.id))) : draft.playlists[editTrigger.pi]!.triggers[editTrigger.ti]!.id}
          onClose={() => setEditTrigger(null)}
          onSave={(t: Trigger) => { update((d) => { const list = d.playlists[editTrigger.pi]!.triggers; if (editTrigger.ti == null) list.push(t); else list[editTrigger.ti] = t; }); setEditTrigger(null); }} />
      ) : null}
      {editGuard ? (
        <GuardDialog sport={sport} guard={editGuard.gi == null ? null : draft.playlists[editGuard.pi]!.guards[editGuard.gi]!}
          onClose={() => setEditGuard(null)}
          onSave={(g: Guard) => { update((d) => { const list = d.playlists[editGuard.pi]!.guards; if (editGuard.gi == null) list.push(g); else list[editGuard.gi] = g; }); setEditGuard(null); }} />
      ) : null}
      {editStep ? (
        <StepDialog sport={sport} playlist={draft.playlists[editStep.pi]!} item={editStep.ii == null ? null : draft.playlists[editStep.pi]!.items[editStep.ii]!}
          onClose={() => setEditStep(null)}
          onSave={(it: PlanItem) => {
            update((d) => {
              const pl = d.playlists[editStep.pi]!;
              if (editStep.ii == null) pl.items.push({ ...it, id: uniqueId(slug(it.templateKey ? it.templateKey.replace('builtin:', '') : it.action), pl.items.map((x) => x.id)) });
              else pl.items[editStep.ii] = { ...it, id: pl.items[editStep.ii]!.id };
            });
            setEditStep(null);
          }} />
      ) : null}
      {newPlaylist ? (
        <Dialog open onOpenChange={(o) => !o && setNewPlaylist(null)} title="New playlist" description="Give it a name and say which part of the match it belongs to; then add when it runs and its steps."
          footer={<><Button variant="ghost" onClick={() => setNewPlaylist(null)}>Cancel</Button><Button variant="primary" disabled={!newPlaylist.name.trim()} onClick={() => {
            update((d) => { d.playlists.push({ id: uniqueId(slug(newPlaylist.name), d.playlists.map((p) => p.id)), name: newPlaylist.name.trim(), kind: newPlaylist.kind, priority: 2, promotional: false, cooldownMs: 0, guards: [], repeat: { mode: 'once', gapMs: 0, maxIterations: 1 }, triggers: [{ id: uniqueId('t_' + slug(newPlaylist.name), d.playlists.flatMap((p) => p.triggers.map((t) => t.id))), type: 'manual' }], items: [] }); });
            setNewPlaylist(null);
          }}>Create</Button></>}>
          <div className="grid gap-3">
            <Field label="Name" htmlFor="np-name"><Input id="np-name" value={newPlaylist.name} onChange={(e) => setNewPlaylist({ ...newPlaylist, name: e.target.value })} placeholder="e.g. Man of the match" /></Field>
            <Field label="Part of the match" htmlFor="np-kind" hint="It stops by itself when the match leaves this part."><NativeSelect id="np-kind" value={newPlaylist.kind} onChange={(e) => setNewPlaylist({ ...newPlaylist, kind: e.target.value as Playlist['kind'] })}>{Object.entries(PLAYLIST_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

const SPEEDS = [1, 2, 5, 10];

function RehearsalView({ id, sport, names }: { id: string; sport: Sport; names: Record<string, string> }) {
  const [r, setR] = useState<Rehearsal | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [speed, setSpeed] = useState(5);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [theme, setTheme] = useState<'broadcast' | 'minimal' | 'club' | 'premier'>('broadcast');
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
      setT((x) => {
        const nx = Math.min(r.durationMs, x + (now - last.current) * speed);
        if (nx >= r.durationMs) setPlaying(false);
        return nx;
      });
      last.current = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, r, speed]);
  const playlistName = (pid: string) => (pid === '_default_scorebug' ? 'Default scorebug' : (names[pid] ?? pid));
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const current = r ? r.decisions.filter((d) => d.t <= t).slice(-1)[0] : null;
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <StatusPill tone="warning">Rehearsal</StatusPill>
        <span className="text-xs text-muted">Plays the draft against a made-up {sport} match (pre-match, kick-off, a goal, a card, half time, second half, full time). Nothing goes to any output.</span>
        <div className="ml-auto flex items-center gap-2">
          <NativeSelect aria-label="Look" className="w-auto" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}><option value="broadcast">Broadcast look</option><option value="minimal">Minimal look</option><option value="club">Club look</option><option value="premier">Premier look</option></NativeSelect>
          <NativeSelect aria-label="Speed" className="w-auto" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</NativeSelect>
          {r ? <Button size="sm" variant="secondary" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</Button> : null}
          <Button variant="primary" className="whitespace-nowrap" onClick={() => void run()}>{r ? 'Rehearse again' : 'Rehearse the draft'}</Button>
        </div>
      </Card>
      <ErrorNotice error={err} />
      {r ? (
        <>
          <RehearsalPreview cues={r.cues} t={t} sport={sport} themeKey={theme} />
          <Card className="p-3">
            <div className="mb-2 flex items-center gap-3 text-sm"><span className="font-mono">{fmt(t)}</span> / <span className="font-mono text-muted">{fmt(r.durationMs)}</span>{current ? <span className="text-xs text-muted">Last: {playlistName(current.playlistId)} · {current.outcome}</span> : null}</div>
            <input type="range" aria-label="Rehearsal position" className="w-full" min={0} max={r.durationMs} value={t} onChange={(e) => setT(Number(e.target.value))} />
          </Card>
          <Table>
            <thead><tr><th>Time</th><th>Playlist</th><th>What happened</th><th>Why</th></tr></thead>
            <tbody>
              {r.decisions.map((d, k) => (
                <tr key={k} className={d.t <= t ? '' : 'opacity-40'}><td className="font-mono">{fmt(d.t)}</td><td>{playlistName(d.playlistId)}</td><td><StatusPill tone={d.outcome === 'fired' ? 'healthy' : d.outcome === 'skipped' ? 'neutral' : 'warning'}>{d.outcome === 'fired' ? 'ran' : d.outcome}</StatusPill></td><td className="text-xs text-muted">{d.reason}</td></tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}
    </div>
  );
}
