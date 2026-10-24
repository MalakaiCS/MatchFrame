'use client';
// The desk: one graphics output of one match. The header keeps what matters on air (output, Auto/Manual, one
// status, the OBS link, Hold to clear) with the rest under More; the graphics list in the middle; the preview
// (your draft) large on the right with its controls under it, and what OBS is showing smaller below.
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Radio, Search, Users } from 'lucide-react';
import { findTemplate, reduceOverlay, type Cue, type Layer, type OverlayPublicState, type TemplateDef } from '@bs/graphics';
import { Keyframes, Renderer, Stage, THEMES, customDefsFrom, renderCustomScene } from '@bs/graphics/react';
import { getAdapter } from '@bs/domain';
import { Button, Dialog, ErrorNotice, Kbd, Spinner, StatusPill, Tab, TabList, TabPanel, Tabs, cx } from '@bs/ui';
import { get } from '@/lib/api';
import { useCopy, useGet } from '@/lib/hooks';
import { layerLabel } from '@/lib/labels';
import { useConnectionStatus } from '@/lib/realtime';
import { Catalogue, CatalogueViewToggle, defaultVariables, useCatalogueView } from '@/components/control/catalogue';
import { DeskMenu, DeskStatus } from '@/components/control/desk-status';
import { VariableForm } from '@/components/control/variable-form';
import { EmergencyClear } from '@/components/control/emergency';
import { useControl, type PendingCommand } from '@/components/control/use-control';
import { AutomationPanel } from '@/components/control/automation-panel';
import { ProgrammeMonitor } from '@/components/control/programme-monitor';
import { ComingNext } from '@/components/control/coming-next';
import { ApprovalsPanel } from '@/components/control/approvals';
import { ExportDialog } from '@/components/control/export-dialog';
import { usePresence } from '@/components/control/presence';
import { RunSheet } from '@/components/match/run-sheet';
import { useMe } from '@/lib/session';

const DEFAULT_KEYS = { take: 'F8', out: 'F9', scorebug: 'F2', search: '/', clear: 'Shift+Escape' };
type Keys = typeof DEFAULT_KEYS;

function useWide() {
  const [w, setW] = useState(true);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1440px)');
    const f = () => setW(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return w;
}

function keyName(e: KeyboardEvent) {
  return `${e.shiftKey && e.key !== 'Shift' ? 'Shift+' : ''}${e.key === ' ' ? 'Space' : e.key}`;
}

interface Fact { id: string; sequence: number; category: string; type: string; side: 'home' | 'away' | null; playerId: string | null; clockMs: number | null; voided: boolean; payload: Record<string, unknown> }

export default function Desk({ params }: { params: Promise<{ id: string; overlayId: string }> }) {
  const { id: matchId, overlayId } = use(params);
  const router = useRouter();
  const c = useControl(overlayId);
  const me = useMe();
  const presence = usePresence(overlayId, me.data?.user.id);
  const { hold } = presence;
  const [exporting, setExporting] = useState(false);
  const conn = useConnectionStatus();
  const wide = useWide();
  const overlays = useGet<{ id: string; name: string }[]>(['overlays', matchId], `matches/${matchId}/overlays`);
  const facts = useGet<Fact[]>(['facts', matchId], `matches/${matchId}/facts`);
  const prefs = useGet<{ prefs: { controlKeys?: Partial<Keys> } }>(['prefs'], 'me/preferences');
  const keys: Keys = useMemo(() => ({ ...DEFAULT_KEYS, ...(prefs.data?.prefs.controlKeys ?? {}) }), [prefs.data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [vars, setVars] = useState<Record<string, unknown>>({});
  const [search, setSearch] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [help, setHelp] = useState(false);
  const [view, setView] = useCatalogueView();
  const copy = useCopy();
  const searchRef = useRef<HTMLInputElement>(null);

  const data = c.data;
  const state = c.detail?.state;
  const custom: TemplateDef[] = useMemo(() => (data ? customDefsFrom(data.customTemplates) : []), [data]);
  const t = selected ? findTemplate(selected, custom) : null;
  const onAirByTemplate = useMemo(() => {
    const m = new Map<string, string>();
    for (const [layer, cue] of Object.entries(state?.layers ?? {}) as [Layer, Cue][]) if (!cue.outAt && (layer !== 'scoreboard' || state?.scorebugVisible)) m.set(cue.templateKey, layer);
    return m;
  }, [state]);
  const selectedOnAir = t ? onAirByTemplate.get(t.key) : undefined;
  // tell the other desks which layer this one is preparing (advisory lock; the command route refuses a clash)
  useEffect(() => {
    hold(t?.layer ?? null);
  }, [t?.layer, hold]);

  const select = useCallback(
    (key: string) => {
      if (!data) return;
      const tt = findTemplate(key, custom);
      if (!tt) return;
      setSelected(key);
      const live = state?.layers[tt.layer];
      setVars(live && live.templateKey === key ? { ...live.variables } : defaultVariables(tt, data));
      setErr(null);
    },
    [data, custom, state],
  );

  // Preview = local draft: what To Air/Update would produce. It never changes output.
  const previewState: OverlayPublicState | null = useMemo(() => {
    if (!state || !t) return state ?? null;
    try {
      const cmd = selectedOnAir ? { type: 'UPDATE' as const, layer: t.layer, variables: vars } : { type: 'TAKE_IN' as const, templateKey: t.key, variables: vars, force: true };
      const r = reduceOverlay({ ...state, inhibited: false }, cmd, { now: c.serverNow() - 60_000, source: 'operator', cueId: 'preview', custom });
      return r.state;
    } catch {
      return state;
    }
  }, [state, t, vars, selectedOnAir, custom, c]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setErr(null);
      try {
        await fn();
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [],
  );
  const take = useCallback(() => t && run(() => (selectedOnAir ? c.send({ type: 'UPDATE', layer: t.layer, variables: vars }, `Update ${t.name}`) : c.send({ type: 'TAKE_IN', templateKey: t.key, variables: vars }, `Take ${t.name}`))), [t, vars, selectedOnAir, c, run]);
  const out = useCallback((layer?: Layer) => {
    const l = layer ?? t?.layer;
    if (l) void run(() => c.send({ type: 'TAKE_OUT', layer: l }, `Out ${l}`));
  }, [t, c, run]);
  const toggleScorebug = useCallback(() => run(() => c.send(state?.scorebugVisible ? { type: 'HIDE_SCOREBUG' } : { type: 'SHOW_SCOREBUG' }, state?.scorebugVisible ? 'Hide scorebug' : 'Show scorebug')), [state, c, run]);
  const clear = useCallback(() => run(() => c.send({ type: 'CLEAR_OUTPUT' }, 'EMERGENCY CLEAR')), [c, run]);

  // keyboard shortcuts (disabled in text fields; independent of scorer actions)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      const k = keyName(e);
      if (k === keys.take) { e.preventDefault(); void take(); }
      else if (k === keys.out) { e.preventDefault(); out(); }
      else if (k === keys.scorebug) { e.preventDefault(); void toggleScorebug(); }
      else if (k === keys.search) { e.preventDefault(); searchRef.current?.focus(); }
      else if (k === keys.clear) { e.preventDefault(); setConfirmClear(true); }
      else if (k === '?' || k === 'Shift+?') { e.preventDefault(); setHelp(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [keys, take, out, toggleScorebug]);

  if (c.error) return <ErrorNotice error={c.error} onRetry={() => c.reload()} />;
  if (!c.detail || !data || !state) return <Spinner />;
  const d = c.detail;
  const adapter = getAdapter(data.match.sport);
  const disp = adapter.display(data.match.rulesConfig as never, data.match.projection, data.match.clocks, c.serverNow());
  const prodRenderers = d.renderers.filter((r) => r.purpose === 'production' || r.purpose === 'compositor');
  const behind = state.revision > c.displayed;
  const canOp = d.canOperate;
  const lockedBy = t ? presence.lockedBy(t.layer) : null;
  const describeVar = (k: string, v: unknown): string | null => {
    if (v == null || v === '') return null;
    if (typeof v === 'string' && data.players[v]) return data.players[v]!.displayName;
    if (k === 'team') return v === 'home' ? data.match.teams.home.shortName : data.match.teams.away.shortName;
    return `${k.replace(/_/g, ' ')}: ${String(v)}`;
  };

  const header = (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-border bg-panel px-3 py-2">
      <div className="mr-2">
        <div className="text-xs text-muted"><Link href={`/app/matches/${matchId}`} className="hover:text-text">{data.match.competition.name}</Link></div>
        <div className="font-semibold">{data.match.teams.home.shortName} v {data.match.teams.away.shortName}</div>
      </div>
      <select aria-label="Output" className="h-9 rounded-md border border-border bg-bg px-2 text-sm" value={overlayId} onChange={(e) => router.push(`/app/matches/${matchId}/control/${e.target.value}`)}>
        {overlays.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <div className="flex rounded-md border border-border" role="group" aria-label="Automation mode">
        {(['auto', 'manual'] as const).map((m) => (
          <button key={m} disabled={!canOp} onClick={() => run(() => c.send({ type: 'SET_MODE', mode: m }, `Mode ${m}`))} aria-pressed={state.mode === m} className={cx('h-9 px-3 text-sm capitalize', state.mode === m ? (m === 'auto' ? 'bg-primary text-bg' : 'bg-warning text-bg') : 'text-muted hover:text-text')}>{m}</button>
        ))}
      </div>
      <DeskStatus conn={conn} obsConnected={prodRenderers.length > 0} behind={behind} />
      {d.overlay.kind === 'programme' ? <StatusPill tone="live"><Radio className="size-3" /> Cloud programme</StatusPill> : null}
      {state.inhibited ? <StatusPill tone="live">OUTPUT CLEARED</StatusPill> : null}
      {presence.others.length ? <StatusPill tone="neutral"><Users className="size-3" /> Also here: {presence.others.map((u) => u.name).join(', ')}</StatusPill> : null}
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={async () => { const u = await get<{ production: string }>(`overlays/${overlayId}/urls`); await copy(u.production, 'OBS link'); }}><Copy className="size-4" /> Copy OBS link</Button>
        <DeskMenu onExport={() => setExporting(true)} onShortcuts={() => setHelp(true)} />
        {state.inhibited ? <Button size="sm" variant="primary" disabled={!canOp} onClick={() => run(() => c.send({ type: 'RESUME' }, 'Resume output'))}>Resume output</Button> : null}
        <EmergencyClear disabled={!canOp} onClear={clear} />
      </div>
    </div>
  );

  const scoreStrip = (
      <div className="rounded-[var(--radius-card)] border border-border bg-panel p-3 text-center">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <div><div className="text-xs text-muted">{data.match.teams.home.abbreviation}</div><div className="text-4xl font-bold tabular">{disp.score.home}</div></div>
        <div><div className="text-xs text-muted">{disp.periodShort}</div><div className="text-2xl font-semibold tabular">{disp.clockText}</div>{disp.stoppageText ? <div className="text-xs text-warning">{disp.stoppageText}</div> : null}{disp.shotClockText ? <div className="text-sm text-live">{disp.shotClockText}</div> : null}</div>
        <div><div className="text-xs text-muted">{data.match.teams.away.abbreviation}</div><div className="text-4xl font-bold tabular">{disp.score.away}</div></div>
      </div>
      <div className="mt-1 text-xs text-muted">{disp.periodLabel}{disp.fouls ? ` · fouls ${disp.fouls.home}–${disp.fouls.away}` : ''}</div>
    </div>
  );

  const events = (facts.data ?? []).filter((f) => f.category === 'event');
  const eventLog = !events.length ? (
    <div className="rounded-[var(--radius-card)] border border-border bg-panel px-3 py-2 text-xs text-muted"><span className="font-medium text-text">Event log</span> · No events yet. Goals, cards and substitutions from the scorer appear here.</div>
  ) : (
    <div className="rounded-[var(--radius-card)] border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium text-muted">Event log</h3></div>
      {events.length > 6 ? <input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="Search events" aria-label="Search events" className="mb-2 h-8 w-full rounded border border-border bg-bg px-2 text-xs" /> : null}
      <ul className="max-h-[50vh] space-y-1 overflow-y-auto text-xs">
        {events.filter((f) => !logSearch || f.type.includes(logSearch.toLowerCase())).slice().reverse().map((f) => {
          const pl = f.playerId ? data.players[f.playerId] : null;
          const tmpl = ['goal', 'own_goal', 'penalty_scored'].includes(f.type) ? 'builtin:goal' : ['yellow_card', 'second_yellow', 'red_card'].includes(f.type) ? 'builtin:card' : f.type === 'substitution' ? 'builtin:substitution' : f.type === 'score' ? 'builtin:score' : null;
          return (
            <li key={f.id} className={cx('flex items-center gap-2 rounded px-1 py-1', f.voided && 'line-through opacity-50')}>
              <span className="w-8 text-muted tabular">{f.clockMs != null ? `${Math.floor(f.clockMs / 60000)}'` : ''}</span>
              <span className="flex-1">{f.type.replace(/_/g, ' ')} {f.side ? data.match.teams[f.side].abbreviation : ''} {pl ? `· ${pl.shortName ?? pl.displayName}` : ''}</span>
              {tmpl && !f.voided && f.side ? (
                <button className="text-primary hover:underline" onClick={() => {
                  select(tmpl);
                  const v: Record<string, unknown> = { team: f.side, minute: f.clockMs != null ? String(Math.floor(f.clockMs / 60000) + 1) : undefined };
                  if (f.playerId) v.player = f.playerId;
                  if (tmpl === 'builtin:goal') v.eventType = f.type;
                  if (tmpl === 'builtin:card') v.cardType = f.type === 'yellow_card' ? 'yellow' : f.type === 'red_card' ? 'red' : 'second_yellow';
                  if (tmpl === 'builtin:substitution') { v.playerOut = f.payload.playerOutId; v.playerIn = f.payload.playerInId; }
                  if (tmpl === 'builtin:score') v.points = f.payload.points;
                  setVars((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) }));
                }}>Load</button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );

  const comingNext = (
    <div className="rounded-[var(--radius-card)] border border-border bg-panel p-3">
      <h3 className="mb-1 text-xs font-medium text-muted">What happens next</h3>
      <ComingNext data={data} gamePlanVersionId={d.overlay.gamePlanVersionId} mode={state.mode} />
    </div>
  );

  const left = (
    <div className="flex flex-col gap-3">
      {scoreStrip}
      {comingNext}
      {eventLog}
    </div>
  );

  const middle = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" /><input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search graphics (${keys.search})`} aria-label="Search graphics" className="h-9 w-full rounded-md border border-border bg-panel pl-8 pr-3 text-sm" /></div>
        <CatalogueViewToggle view={view} onChange={setView} />
      </div>
      <div className="max-h-[calc(100vh-15rem)] overflow-y-auto pr-1"><Catalogue data={data} onAir={onAirByTemplate} selected={selected} onSelect={select} search={search} custom={custom} serverNow={c.serverNow} sport={data.match.sport} view={view} /></div>
    </div>
  );

  const monitor = (label: string, st: OverlayPublicState, tone: 'preview' | 'programme', small = false) => (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 text-xs"><span className={cx('font-semibold uppercase tracking-wide', tone === 'programme' ? 'text-live' : 'text-healthy')}>{label}</span>{tone === 'programme' ? <span className="text-muted">{behind ? 'OBS is catching up' : 'what OBS is showing'}</span> : <span className="text-muted">Your draft — not on air yet</span>}</div>
      <div className={cx(data.format === '9:16' ? cx('relative mx-auto aspect-[9/16]', small ? 'max-h-[30vh]' : 'max-h-[60vh]') : 'relative aspect-video', 'overflow-hidden rounded-md bg-[repeating-conic-gradient(#222b3a_0%_25%,#171e2a_0%_50%)] bg-[length:20px_20px]', small ? 'border' : 'border-2', tone === 'programme' ? 'border-live' : 'border-healthy')}>
        <Stage format={data.format}><Renderer state={st} data={data} themes={THEMES} serverNow={c.serverNow} customDefs={custom} renderCustom={renderCustomScene} /></Stage>
      </div>
    </div>
  );

  const onAirNow = (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><h3 className="whitespace-nowrap text-xs font-medium text-muted">On air now</h3><Button size="sm" variant="ghost" className="whitespace-nowrap" disabled={!canOp} onClick={() => void toggleScorebug()}>{state.scorebugVisible ? 'Hide' : 'Show'} scorebug <Kbd>{keys.scorebug}</Kbd></Button></div>
      <ul className="space-y-1 text-sm">
        {(Object.entries(state.layers) as [Layer, Cue][]).map(([layer, cue]) => (
          <li key={layer} className="flex flex-wrap items-center gap-x-2">
            <span className="min-w-0 flex-1 truncate" title={layerLabel(layer)}>{findTemplate(cue.templateKey, custom)?.name ?? cue.templateKey}{cue.outAt ? ' (going out)' : ''}</span>
            {!cue.outAt ? <Button size="sm" variant="ghost" disabled={!canOp} onClick={() => out(layer)}>Out</Button> : null}
            <span className="w-full text-xs text-muted">{layerLabel(layer)} · {cue.source === 'automation' ? 'automatic' : 'from this desk'}{cue.durationMs ? ` · ${Math.max(0, Math.round((cue.startedAt + cue.durationMs - c.serverNow()) / 1000))}s left` : ''}</span>
          </li>
        ))}
        {!Object.keys(state.layers).length ? <li className="text-xs text-muted">Nothing on air</li> : null}
        {presence.locks.map((l) => <li key={`lock:${l.layer}`} className="text-xs text-warning">{l.name} is preparing the {layerLabel(l.layer).toLowerCase()}</li>)}
      </ul>
    </div>
  );

  const right = (
    <div className="flex flex-col gap-3">
      <ApprovalsPanel overlayId={overlayId} canOperate={canOp} custom={custom} describe={describeVar} />
      {monitor('Preview', previewState ?? state, 'preview')}
      <div className="rounded-[var(--radius-card)] border border-border bg-panel p-3">
        {t ? (
          <>
            <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">{t.name}</h3>{selectedOnAir ? <StatusPill tone="live">On air</StatusPill> : <StatusPill tone="neutral">Off air</StatusPill>}</div>
            <VariableForm t={t} data={data} values={vars} onChange={setVars} creatives={Object.values(data.creatives).map((x) => ({ id: x.id, label: x.brandName }))} />
            <div className="sticky bottom-0 -mx-3 -mb-3 mt-3 flex gap-2 border-t border-border bg-panel p-3">
              <Button variant="live" className="flex-1" disabled={!canOp || state.inhibited || !!lockedBy} onClick={() => void take()}>{selectedOnAir ? 'Update on air' : 'To air'} <Kbd>{keys.take}</Kbd></Button>
              <Button className="flex-1" disabled={!canOp || !selectedOnAir} onClick={() => out()}>Out <Kbd>{keys.out}</Kbd></Button>
            </div>
          </>
        ) : <p className="text-sm text-muted">Pick a graphic from the list to preview it and fill in its details. Nothing goes on air until you press To air.</p>}
        {err ? <p role="alert" className="mt-2 text-sm text-live">{err}</p> : null}
        {lockedBy ? <p role="status" className="mt-2 text-sm text-warning">{lockedBy.name} is preparing the {layerLabel(lockedBy.layer).toLowerCase()} right now. Wait a moment or pick a graphic on another layer.</p> : null}
        {state.inhibited ? <p className="mt-2 text-sm text-live">Emergency clear is active. Graphics and automation are held until you press Resume output.</p> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-border bg-panel p-3 sm:grid-cols-2">
        {monitor(d.overlay.kind === 'programme' ? 'On air (sent to the cloud programme)' : 'On air', state, 'programme', true)}
        {onAirNow}
      </div>
      {d.overlay.kind === 'programme' ? <ProgrammeMonitor matchId={matchId} overlayId={overlayId} /> : null}
    </div>
  );

  const bottom = (
    <Tabs defaultValue="commands">
      <TabList><Tab value="commands">Sent from this desk</Tab><Tab value="runsheet">Run sheet</Tab><Tab value="automation">Automation</Tab><Tab value="diagnostics">Diagnostics</Tab></TabList>
      <TabPanel value="commands" className="py-2"><CommandLog pending={c.pending} /></TabPanel>
      <TabPanel value="runsheet" className="py-2"><RunSheet matchId={matchId} canEdit={canOp} compact /></TabPanel>
      <TabPanel value="automation" className="py-2"><AutomationPanel overlayId={overlayId} gamePlanVersionId={d.overlay.gamePlanVersionId} sport={data.match.sport} canOperate={d.canOperate} onChanged={() => void c.reload?.()} /></TabPanel>
      <TabPanel value="diagnostics" className="py-2 text-xs text-muted">
        <ul className="space-y-1">
          <li>Connected outputs: {d.renderers.map((r) => `${r.purpose}${r.reporting ? ' (reports sponsor delivery)' : ''} at revision ${r.displayedRevision}`).join(', ') || 'none'}</li>
          <li>Latest revision sent: {state.revision}; shown by OBS: {c.displayed}.</li>
          {behind ? <li className="text-warning">OBS has not yet shown revision {state.revision}.</li> : null}
          {d.overlay.pendingThemeProfileVersionId ? <li className="text-warning">A newer version of the look is published but not applied to this output (match page → Graphics).</li> : null}
          {disp.alerts.map((a) => <li key={a} className="text-warning">{a}</li>)}
        </ul>
      </TabPanel>
    </Tabs>
  );

  return (
    <div className="flex flex-col gap-3">
      <Keyframes />
      {header}
      {wide ? (
        <div className="grid grid-cols-[280px_minmax(0,1fr)_40%] gap-3">{left}{middle}{right}</div>
      ) : (
        <>
          <div className="sticky top-14 z-20">{scoreStrip}</div>
          <Tabs defaultValue="catalogue">
            <TabList><Tab value="catalogue">Graphics</Tab><Tab value="controls">Preview & controls</Tab><Tab value="log">Next & events</Tab></TabList>
            <TabPanel value="catalogue" className="pt-3">{middle}</TabPanel>
            <TabPanel value="controls" className="pt-3">{right}</TabPanel>
            <TabPanel value="log" className="flex flex-col gap-3 pt-3">{comingNext}{eventLog}</TabPanel>
          </Tabs>
        </>
      )}
      <div className="rounded-[var(--radius-card)] border border-border bg-panel p-3">{bottom}</div>
      {confirmClear ? (
        <div role="dialog" aria-label="Confirm emergency clear" className="fixed inset-0 z-50 grid place-items-center bg-black/70">
          <div className="rounded-[var(--radius-card)] border border-live bg-panel p-6 text-center">
            <p className="mb-1 text-lg font-semibold text-live">Clear all graphics on “{d.overlay.name}”?</p>
            <p className="mb-4 text-sm text-muted">Everything including the scorebug goes out and automation stops until you resume. Video and recording continue.</p>
            <div className="flex justify-center gap-2"><Button onClick={() => setConfirmClear(false)}>Cancel</Button><EmergencyClear onClear={() => { setConfirmClear(false); void clear(); }} /></div>
          </div>
        </div>
      ) : null}
      {exporting ? (
        <ExportDialog
          sources={[{ key: 'preview', label: 'Preview (your draft)', state: previewState ?? state }, { key: 'air', label: 'What is on air now', state }]}
          data={data}
          custom={custom}
          serverNow={c.serverNow}
          onClose={() => setExporting(false)}
          fileBase={`${data.match.teams.home.abbreviation}-${data.match.teams.away.abbreviation}-${t ? t.key.replace('builtin:', '') : 'graphics'}`.toLowerCase()}
        />
      ) : null}
      <Dialog open={help} onOpenChange={setHelp} title="Keyboard shortcuts" description="Press ? any time to see this. Change the keys under Settings → preferences.">
        <table className="w-full text-sm"><tbody>
          {[['To air / Update on air', keys.take], ['Take the selected graphic out', keys.out], ['Show or hide the scorebug', keys.scorebug], ['Search graphics', keys.search], ['Emergency clear (asks first)', keys.clear], ['This help', '?']].map(([what, key]) => (
            <tr key={what} className="border-t border-border"><td className="py-2">{what}</td><td className="py-2 text-right"><Kbd>{key}</Kbd></td></tr>
          ))}
        </tbody></table>
        <p className="mt-3 text-xs text-muted">Preview is your draft; the smaller On air picture under its controls is what OBS is showing. Export and these shortcuts are under More. Automation runs from the scorer's phase buttons; switch to Manual to pause it.</p>
      </Dialog>
    </div>
  );
}

function CommandLog({ pending }: { pending: PendingCommand[] }) {
  if (!pending.length) return <p className="text-xs text-muted">No commands sent from this desk yet.</p>;
  const tone = { requested: 'warning', accepted: 'primary', displayed: 'healthy', rejected: 'live' } as const;
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
      {pending.map((p) => (
        <li key={p.commandId} className="flex items-center gap-2">
          <span className="w-16 text-muted tabular">{new Date(p.at).toLocaleTimeString('en-AU')}</span>
          <StatusPill tone={tone[p.status]}>{p.status}</StatusPill>
          <span>{p.label}{p.revision ? ` · rev ${p.revision}` : ''}</span>
          {p.error ? <span className="text-live">{p.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}
