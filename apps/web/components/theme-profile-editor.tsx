'use client';
// Edit a look (theme profile) with the graphics it affects in view: colours named by what they do, a club or
// league logo, and a one-click copy of a team's colours.
import { SportOptions } from '@/components/sport-options';
import type { Sport } from '@bs/domain';
import { useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { DEFAULT_THEMES, LOOKS, emptyState, findTemplate, type OverlayPublicState, type ThemeConfig } from '@bs/graphics';
import { Keyframes, Renderer, Stage, THEMES } from '@bs/graphics/react';
import { Button, Dialog, ErrorNotice, Field, Input, NativeSelect, Spinner, toast } from '@bs/ui';
import { ApiError, patch, post } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useAction, useGet } from '@/lib/hooks';
import { SAMPLE_SLOTS, sampleData, sampleVariables } from '@/components/theme-preview';

type Config = Partial<ThemeConfig> & { logoAssetId?: string | null; fontAssetId?: string | null; sponsorSlots?: Record<string, boolean>; controlRoomLayoutId?: string | null };
export interface EditableProfile { id: string; name: string; competitionId: string | null; currentVersion: number; draft: { themeKey: string; config: Config } }
interface Team { id: string; name: string; sport: string; primaryColor: string; secondaryColor: string }

const COLOURS: { key: 'primary' | 'secondary' | 'accent' | 'panel' | 'text'; label: string; hint: string }[] = [
  { key: 'primary', label: 'Main colour', hint: 'Title bars, team strips, the kick-off banner' },
  { key: 'secondary', label: 'Dark colour', hint: 'Text and shapes on the main colour' },
  { key: 'accent', label: 'Highlight', hint: 'Goals, the countdown, the scorebug clock' },
  { key: 'panel', label: 'Panel background', hint: 'The boxes behind names and stats' },
  { key: 'text', label: 'Text on panels', hint: 'Names, numbers and labels' },
];
const PREVIEWS: { title: string; keys: string[]; scorebug: boolean }[] = [
  { title: 'Scorebug and goal', keys: ['builtin:goal'], scorebug: true },
  { title: 'Lineup', keys: ['builtin:lineup'], scorebug: false },
  { title: 'Half-time board', keys: ['builtin:break_score'], scorebug: false },
  { title: 'Lower third and kick-off banner', keys: ['builtin:period_banner'], scorebug: true },
];
const SAVED_KEYS = ['primary', 'secondary', 'accent', 'text', 'panel', 'motion', 'entranceMs', 'exitMs', 'safeArea', 'logoAssetId', 'fontAssetId', 'scorebug', 'clock', 'wording', 'stings', 'sponsorSlots', 'controlRoomLayoutId'] as const;
/** On-air words a look may change (translations, house style). Keys are the default wording. */
const WORDING_KEYS = ['GOAL', 'PENALTY', 'OWN GOAL', 'YELLOW CARD', 'RED CARD', 'HALF TIME', 'FULL TIME', 'KICK-OFF', 'ABOUT TO START', 'MATCH STATS', 'TABLE', 'LADDER', 'PRESENTED BY', 'TRY', 'TIMEOUT'];
const PITCH = 'linear-gradient(180deg, #24476b 0%, #1d3b2a 55%, #2f6b3c 100%)';

/** A still frame of the given graphics (started a minute ago, so no entrance animation plays). */
function stillState(keys: string[], scorebug: boolean, sport: Sport): OverlayPublicState {
  const s = emptyState();
  const at = Date.now() - 60_000;
  if (scorebug) {
    s.scorebugVisible = true;
    s.layers.scoreboard = { cueId: 'bug', templateKey: 'builtin:scorebug', layer: 'scoreboard', variables: sampleVariables('builtin:scorebug', sport), startedAt: at, durationMs: null, source: 'operator' };
  }
  for (const k of keys) {
    const t = findTemplate(k);
    if (t) s.layers[t.layer] = { cueId: k, templateKey: k, layer: t.layer, variables: sampleVariables(k, sport), startedAt: at, durationMs: null, source: 'operator' };
  }
  return s;
}

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

export function ThemeProfileEditor({ profile, onClose }: { profile: EditableProfile; onClose: () => void }) {
  const [cfg, setCfg] = useState<Config>(profile.draft.config ?? {});
  const [themeKey, setThemeKey] = useState(profile.draft.themeKey as ThemeConfig['themeKey']);
  const [sport, setSport] = useState<Sport>('football');
  const [logoPreview, setLogoPreview] = useState<string | null>(cfg.logoAssetId ? `/api/v1/assets/${cfg.logoAssetId}/preview` : null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<ApiError | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const teams = useGet<Team[]>(['teams'], 'teams');
  const base = DEFAULT_THEMES[themeKey];
  const theme: ThemeConfig = useMemo(() => ({ ...base, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined && v !== null)), themeKey, logoUrl: logoPreview }) as ThemeConfig, [base, cfg, themeKey, logoPreview]);
  const data = useMemo(() => sampleData(theme, sport), [theme, sport]);
  const states = useMemo(() => PREVIEWS.map((p) => stillState(p.keys, p.scorebug, sport)), [sport]);

  const payload = () => {
    const all = cfg as Record<string, unknown>;
    return { themeKey, config: Object.fromEntries(SAVED_KEYS.filter((k) => all[k] !== undefined).map((k) => [k, all[k]])) };
  };
  const save = useAction(() => patch(`theme-profiles/${profile.id}`, payload()), [['theme-profiles']], { success: 'Draft saved' });
  const publish = useAction(async () => {
    await patch(`theme-profiles/${profile.id}`, payload());
    return post<{ version: number }>(`theme-profiles/${profile.id}/publish`);
  }, [['theme-profiles']], { success: (r) => `Published v${r.version}. Matches using this look pick it up from their OBS link tab.` });

  const setColour = (k: (typeof COLOURS)[number]['key'], v: string) => setCfg({ ...cfg, [k]: v.toUpperCase() });
  const applyTeamColours = (id: string) => {
    const t = teams.data?.find((x) => x.id === id);
    if (!t) return;
    setCfg({ ...cfg, primary: t.primaryColor.toUpperCase(), secondary: t.secondaryColor.toUpperCase() });
    toast(`Colours taken from ${t.name}`);
  };
  const fontFile = useRef<HTMLInputElement>(null);
  const [fontName, setFontName] = useState<string | null>(cfg.fontAssetId ? 'Uploaded font' : null);
  const upload = async (f: File, kind: 'logo' | 'font' = 'logo') => {
    setUploadErr(null);
    setUploading(true);
    try {
      const mime = f.type || (kind === 'font' ? (f.name.endsWith('.woff2') ? 'font/woff2' : f.name.endsWith('.woff') ? 'font/woff' : f.name.endsWith('.otf') ? 'font/otf' : 'font/ttf') : 'application/octet-stream');
      const assetId = await uploadFile(f, kind, mime);
      const u = { assetId };
      if (kind === 'font') {
        setCfg((c) => ({ ...c, fontAssetId: u.assetId }));
        setFontName(f.name);
        toast('Font uploaded. Graphics use it once it has been checked (a few seconds).');
      } else {
        setCfg((c) => ({ ...c, logoAssetId: u.assetId }));
        setLogoPreview(URL.createObjectURL(f));
        toast('Logo uploaded. It is checked and converted in the background.');
      }
    } catch (e) {
      setUploadErr(e as ApiError);
    } finally {
      setUploading(false);
    }
  };
  const setNested = <K extends 'scorebug' | 'clock'>(key: K, patch: NonNullable<Config[K]>) => setCfg((c) => ({ ...c, [key]: { ...(c[key] as object), ...patch } }));
  const setWord = (k: string, v: string) => setCfg((c) => {
    const w = { ...(c.wording ?? {}) };
    if (v.trim()) w[k] = v;
    else delete w[k];
    return { ...c, wording: w };
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={`Edit ${profile.name}`} description="Changes here are a draft. Publishing makes a new version; matches switch to it when you choose to."
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save draft</Button><Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate(undefined, { onSuccess: onClose })}>Publish v{profile.currentVersion + 1}</Button></>}>
      <Keyframes />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <NativeSelect aria-label="Preview sport" className="w-auto" value={sport} onChange={(e) => setSport(e.target.value as Sport)}><SportOptions /></NativeSelect>
            <span className="text-xs text-muted">Sample teams and players; your own logos and names appear on real matches.</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {PREVIEWS.map((p, i) => (
              <figure key={p.title}>
                <div className="relative aspect-video overflow-hidden rounded-md border border-border">
                  <Stage background={PITCH}><Renderer state={states[i]!} data={data} themes={THEMES} serverNow={Date.now} slots={SAMPLE_SLOTS} /></Stage>
                </div>
                <figcaption className="mt-1 text-xs text-muted">{p.title}</figcaption>
              </figure>
            ))}
          </div>
        </div>
        <div className="grid content-start gap-3">
          <Field label="Style" htmlFor="tk" hint="Broadcast: dark angled panels. Minimal: light, quiet. Club: team colours and rounded pills.">
            <NativeSelect id="tk" value={themeKey} onChange={(e) => setThemeKey(e.target.value as ThemeConfig['themeKey'])}>{LOOKS.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Use a team's colours" htmlFor="tt">
            <NativeSelect id="tt" value="" onChange={(e) => applyTeamColours(e.target.value)}><option value="">Choose a team…</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
          </Field>
          {COLOURS.map((c) => {
            const v = String(cfg[c.key] ?? base[c.key]);
            return (
              <div key={c.key} className="grid grid-cols-[2.75rem_1fr] items-center gap-2">
                <input aria-label={`${c.label} colour picker`} type="color" className="h-9 w-11 cursor-pointer rounded border border-border bg-bg" value={isHex(v) ? v : '#000000'} onChange={(e) => setColour(c.key, e.target.value)} />
                <div>
                  <div className="flex items-center gap-2"><span className="text-xs font-medium">{c.label}</span><Input aria-label={`${c.label} hex`} className="h-7 w-24 font-mono text-xs" value={v} onChange={(e) => setColour(c.key, e.target.value)} invalid={!isHex(v)} /></div>
                  <div className="text-[11px] text-muted">{c.hint}</div>
                </div>
              </div>
            );
          })}
          <div>
            <div className="text-xs font-medium text-muted">Logo</div>
            <div className="mt-1 flex items-center gap-2">
              <div className="grid h-12 w-20 place-items-center overflow-hidden rounded border border-border bg-[repeating-conic-gradient(#1c2c43_0_25%,#131f32_0_50%)] bg-[length:12px_12px]">{logoPreview ? <img src={logoPreview} alt="Logo preview" className="max-h-10 max-w-full object-contain" /> : <span className="text-[10px] text-muted">none</span>}</div>
              <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              <Button size="sm" loading={uploading} onClick={() => file.current?.click()}><Upload className="size-4" /> {logoPreview ? 'Replace' : 'Upload'}</Button>
              {logoPreview ? <Button size="sm" variant="ghost" onClick={() => { setCfg({ ...cfg, logoAssetId: null }); setLogoPreview(null); }}>Remove</Button> : null}
            </div>
            <p className="mt-1 text-[11px] text-muted">PNG with a transparent background works best. It appears in the title bars of full-screen graphics and on the holding slate.</p>
            {uploading ? <Spinner label="Uploading" /> : null}
          </div>
          <Field label="Motion" htmlFor="mo"><NativeSelect id="mo" value={cfg.motion ?? base.motion} onChange={(e) => setCfg({ ...cfg, motion: e.target.value as ThemeConfig['motion'] })}><option value="full">Full (slides, zooms, pops)</option><option value="subtle">Subtle (fades and small moves)</option><option value="none">None (graphics cut in)</option></NativeSelect></Field>
          <Field label={`Entrance speed: ${cfg.entranceMs ?? base.entranceMs} ms`} htmlFor="en"><input id="en" type="range" min={150} max={600} step={10} value={cfg.entranceMs ?? base.entranceMs} onChange={(e) => setCfg({ ...cfg, entranceMs: Number(e.target.value) })} /></Field>
          <details className="rounded-md border border-border p-2">
            <summary className="cursor-pointer text-sm font-medium">Scorebug, clock and sounds</summary>
            <div className="mt-2 grid gap-3">
              <Field label="Scorebug style" htmlFor="sbv" hint="Box stacks the teams; strip is one slim row. Club keeps its pill in both.">
                <NativeSelect id="sbv" value={cfg.scorebug?.variant ?? 'box'} onChange={(e) => setNested('scorebug', { variant: e.target.value as 'box' | 'strip' })}><option value="box">Box</option><option value="strip">Strip</option></NativeSelect>
              </Field>
              <Field label="Scorebug position" htmlFor="sbp">
                <NativeSelect id="sbp" value={cfg.scorebug?.position ?? (themeKey === 'club' ? 'centre' : 'left')} onChange={(e) => setNested('scorebug', { position: e.target.value as 'left' | 'centre' | 'right' })}><option value="left">Top left</option><option value="centre">Top centre</option><option value="right">Top right</option></NativeSelect>
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={!!cfg.clock?.hideSeconds} onChange={(e) => setNested('clock', { hideSeconds: e.target.checked })} /> Hide seconds on the clock (63&apos;)</label>
              <Field label="Added time" htmlFor="ast">
                <NativeSelect id="ast" value={cfg.clock?.stoppage ?? 'plus'} onChange={(e) => setNested('clock', { stoppage: e.target.value as 'plus' | 'label' })}><option value="plus">+2:14</option><option value="label">ADDED TIME 2:14</option></NativeSelect>
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={!!cfg.stings} onChange={(e) => setCfg({ ...cfg, stings: e.target.checked })} /> Play a short sting on goals and cards (OBS captures it when audio is on)</label>
            </div>
          </details>
          <details className="rounded-md border border-border p-2">
            <summary className="cursor-pointer text-sm font-medium">Typeface</summary>
            <div className="mt-2 grid gap-2">
              <p className="text-xs text-muted">Upload the club&apos;s font (WOFF2, WOFF, TTF or OTF). Every graphic uses it; the built-in font remains the fallback.</p>
              <div className="flex items-center gap-2">
                <input ref={fontFile} type="file" hidden accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0], 'font')} />
                <Button size="sm" loading={uploading} onClick={() => fontFile.current?.click()}><Upload className="size-4" /> {fontName ? 'Replace font' : 'Upload font'}</Button>
                {fontName ? <span className="text-xs text-muted">{fontName}</span> : null}
                {cfg.fontAssetId ? <Button size="sm" variant="ghost" onClick={() => { setCfg({ ...cfg, fontAssetId: null }); setFontName(null); }}>Remove</Button> : null}
              </div>
            </div>
          </details>
          <details className="rounded-md border border-border p-2">
            <summary className="cursor-pointer text-sm font-medium">Wording</summary>
            <div className="mt-2 grid gap-1.5">
              <p className="text-xs text-muted">Change what the graphics say, for another language or your house style. Leave a field empty to keep the default.</p>
              {WORDING_KEYS.map((k) => (
                <label key={k} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-xs"><span className="text-muted">{k}</span><Input className="h-7 text-xs" value={cfg.wording?.[k] ?? ''} placeholder={k} onChange={(e) => setWord(k, e.target.value)} /></label>
              ))}
            </div>
          </details>
          <ErrorNotice error={save.error ?? publish.error ?? uploadErr} />
        </div>
      </div>
    </Dialog>
  );
}
