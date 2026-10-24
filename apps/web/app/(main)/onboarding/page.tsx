'use client';
import { SportOptions } from '@/components/sport-options';
import type { Sport } from '@bs/domain';
import { LOOKS } from '@bs/graphics';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Button, ErrorNotice, Field, Input, NativeSelect, Spinner, cx } from '@bs/ui';
import { AuthCard } from '@/components/auth-card';
import { ApiError, api, get, patch, post } from '@/lib/api';
import { useMe } from '@/lib/session';

const STEPS = ['Organisation', 'Competition', 'Teams', 'Theme', 'First match'] as const;
const TZS = ['Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Adelaide', 'Australia/Perth', 'Pacific/Auckland', 'Europe/London', 'America/New_York', 'UTC'];
const THEMES = LOOKS.map((l) => ({ key: l.key, name: l.name, desc: l.description }));

interface Progress {
  step?: number;
  competitionId?: string;
  seasonId?: string;
  teamIds?: string[];
  themeProfileId?: string;
  matchId?: string;
  sport?: Sport;
  done?: boolean;
}

function Onboarding() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const isNew = useSearchParams().get('new') === '1';
  const hasOrg = !!me.data?.activeOrganisation && !isNew;
  const org = useQuery({ queryKey: ['org'], queryFn: () => get<{ name: string; timezone: string; onboarding: Progress }>('organisations/current'), enabled: hasOrg });
  const [p, setP] = useState<Progress>({});
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const step = hasOrg ? (p.step ?? 1) : 0;

  useEffect(() => {
    if (org.data?.onboarding) setP(org.data.onboarding);
  }, [org.data]);
  useEffect(() => {
    if (!me.isLoading && !me.data) router.replace('/login?next=/onboarding');
  }, [me.isLoading, me.data, router]);

  const save = async (next: Progress) => {
    setP(next);
    await patch('organisations/current', { onboarding: next });
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------ step forms
  const [orgForm, setOrgForm] = useState({ name: '', timezone: 'Australia/Brisbane' });
  // an account made with an email code (or a provider without a name) is asked for the person's name first
  const [personName, setPersonName] = useState('');
  const needsName = !!me.data && !me.data.user.name?.trim();
  const [comp, setComp] = useState({ name: '', shortName: '', sport: 'football' as Sport, season: String(new Date().getFullYear()) });
  const [teams, setTeams] = useState([
    { name: '', shortName: '', abbreviation: '', primaryColor: '#1F6FEB' },
    { name: '', shortName: '', abbreviation: '', primaryColor: '#E5484D' },
  ]);
  const [theme, setTheme] = useState('broadcast');
  const [kickoff, setKickoff] = useState('');

  if (me.isLoading || (hasOrg && org.isLoading)) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;

  const tz = org.data?.timezone ?? orgForm.timezone;
  const body = (() => {
    switch (step) {
      case 0:
        return (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(async () => { if (needsName) await api('/api/auth/update-user', { method: 'POST', json: { name: personName.trim() } }); await post('organisations', orgForm); await qc.invalidateQueries({ queryKey: ['me'] }); await qc.invalidateQueries({ queryKey: ['org'] }); await save({ step: 1 }); router.replace('/onboarding'); }); }}>
            {needsName ? <Field label="Your name" htmlFor="pn" hint="Shown to your team, for example on the scorer and in the activity log."><Input id="pn" autoComplete="name" value={personName} onChange={(e) => setPersonName(e.target.value)} /></Field> : null}
            <Field label="Organisation name" htmlFor="on"><Input id="on" value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} placeholder="e.g. Coastal Sports Media" /></Field>
            <Field label="Timezone" htmlFor="otz" hint="Dates are stored in UTC and shown in this zone."><NativeSelect id="otz" value={orgForm.timezone} onChange={(e) => setOrgForm({ ...orgForm, timezone: e.target.value })}>{TZS.map((z) => <option key={z}>{z}</option>)}</NativeSelect></Field>
            <Button variant="primary" type="submit" loading={busy} disabled={orgForm.name.trim().length < 2 || (needsName && !personName.trim())}>Create organisation</Button>
          </form>
        );
      case 1:
        return (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(async () => {
            const c = await post<{ id: string }>('competitions', { name: comp.name, shortName: comp.shortName || null, sport: comp.sport, defaultTimezone: tz });
            const s = await post<{ id: string }>(`competitions/${c.id}/seasons`, { name: comp.season });
            await save({ ...p, step: 2, competitionId: c.id, seasonId: s.id, sport: comp.sport });
          }); }}>
            <Field label="Competition name" htmlFor="cn"><Input id="cn" value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value })} placeholder="e.g. Coastal Premier League" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Short name" htmlFor="cs"><Input id="cs" value={comp.shortName} maxLength={24} onChange={(e) => setComp({ ...comp, shortName: e.target.value })} /></Field>
              <Field label="Season" htmlFor="cy"><Input id="cy" value={comp.season} onChange={(e) => setComp({ ...comp, season: e.target.value })} /></Field>
            </div>
            <Field label="Sport" htmlFor="sp"><NativeSelect id="sp" value={comp.sport} onChange={(e) => setComp({ ...comp, sport: e.target.value as 'football' })}><SportOptions /></NativeSelect></Field>
            <Button variant="primary" type="submit" loading={busy} disabled={!comp.name.trim() || !comp.season.trim()}>Continue</Button>
          </form>
        );
      case 2:
        return (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(async () => {
            const ids: string[] = [];
            for (const t of teams) ids.push((await post<{ id: string }>('teams', { ...t, shortName: t.shortName || t.name.slice(0, 24), abbreviation: (t.abbreviation || t.name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase(), sport: p.sport ?? 'football' })).id);
            await save({ ...p, step: 3, teamIds: ids });
          }); }}>
            {teams.map((t, i) => (
              <fieldset key={i} className="grid grid-cols-[1fr_5rem_3rem] gap-2 rounded-md border border-border p-3">
                <legend className="px-1 text-xs text-muted">Team {i + 1}</legend>
                <Input aria-label={`Team ${i + 1} name`} placeholder="Full name" value={t.name} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Input aria-label={`Team ${i + 1} abbreviation`} placeholder="ABC" maxLength={5} value={t.abbreviation} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, abbreviation: e.target.value.toUpperCase() } : x)))} />
                <input aria-label={`Team ${i + 1} colour`} type="color" className="h-9 w-full rounded border border-border bg-bg" value={t.primaryColor} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, primaryColor: e.target.value.toUpperCase() } : x)))} />
              </fieldset>
            ))}
            <Button type="button" variant="ghost" onClick={() => setTeams([...teams, { name: '', shortName: '', abbreviation: '', primaryColor: '#55D99D' }])}>Add another team</Button>
            <Button variant="primary" type="submit" loading={busy} disabled={teams.filter((t) => t.name.trim()).length < 2 || teams.some((t) => !t.name.trim())}>Save teams</Button>
          </form>
        );
      case 3:
        return (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              {THEMES.map((t) => (
                <button key={t.key} type="button" onClick={() => setTheme(t.key)} aria-pressed={theme === t.key} className={cx('flex items-center justify-between rounded-md border p-3 text-left', theme === t.key ? 'border-primary bg-primary/10' : 'border-border hover:border-muted')}>
                  <span><span className="font-medium">{t.name}</span><span className="block text-xs text-muted">{t.desc}</span></span>
                  {theme === t.key ? <Check className="size-4 text-primary" aria-label="Selected" /> : null}
                </button>
              ))}
            </div>
            <Button variant="primary" loading={busy} onClick={() => run(async () => {
              const prof = await post<{ id: string }>('theme-profiles', { name: `${comp.name || 'Competition'} graphics`, themeKey: theme, competitionId: p.competitionId, publish: true });
              await save({ ...p, step: 4, themeProfileId: prof.id });
            })}>Publish graphics profile</Button>
          </div>
        );
      case 4:
        return (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(async () => {
            const m = await post<{ id: string }>('matches', { competitionId: p.competitionId, seasonId: p.seasonId, homeTeamId: p.teamIds![0], awayTeamId: p.teamIds![1], kickoffLocal: kickoff.replace('T', ' '), timezone: tz });
            await save({ ...p, step: 5, matchId: m.id, done: true });
            router.replace(`/app/matches/${m.id}`);
          }); }}>
            <p className="text-sm text-muted">Your first fixture uses the first two teams. You can add more fixtures or import a CSV later.</p>
            <Field label={`Kick-off (${tz})`} htmlFor="ko"><Input id="ko" type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} /></Field>
            <Button variant="primary" type="submit" loading={busy} disabled={!kickoff}>Create match</Button>
          </form>
        );
      default:
        return <Button variant="primary" onClick={() => router.replace('/app')}>Go to dashboard</Button>;
    }
  })();

  return (
    <AuthCard wide title={step < 5 ? `Set up: ${STEPS[step]}` : 'All set'} subtitle={<span>Step {Math.min(step + 1, 5)} of 5 · progress is saved</span>}
      footer={hasOrg ? <button className="text-muted underline" onClick={() => router.push('/app')}>Skip for now</button> : null}>
      <ol className="mb-5 flex gap-1" aria-label="Progress">
        {STEPS.map((s, i) => <li key={s} title={s} className={cx('h-1.5 flex-1 rounded', i < step ? 'bg-primary' : i === step ? 'bg-primary/50' : 'bg-elevated')} />)}
      </ol>
      {body}
      <div className="mt-3"><ErrorNotice error={err} /></div>
    </AuthCard>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
