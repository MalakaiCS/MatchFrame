'use client';
// Match-day checklist: the five things that make a match broadcast-ready, each with its action in place (a choice
// applies as soon as it is made), and the scorer link to hand around. Folds to one line once all five are done.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Copy, QrCode, Smartphone } from 'lucide-react';
import { toDataURL } from 'qrcode';
import { Button, Card, CheckRow, Dialog, ErrorNotice, Input, NativeSelect, StatusPill } from '@bs/ui';
import { get, post, put } from '@/lib/api';
import { useAction, useCopy, useGet } from '@/lib/hooks';
import { obsStatus, type OverlayRow } from './overlays-panel';
import { LookPicker, lookName, type LookChoice, type LookProfile } from '@/components/look-picker';
import type { MatchDetail } from '@/app/(main)/app/matches/[id]/page';

interface Plan { id: string; name: string; sport: string; currentVersion: number; versions: { id: string; version: number }[] }
interface Member { id: string; name: string; role: string; status: string }

export function MatchDayChecklist({ d, canEdit, onGoTo }: { d: MatchDetail; canEdit: boolean; onGoTo: (tab: string) => void }) {
  const overlays = useGet<OverlayRow[]>(['overlays', d.id], `matches/${d.id}/overlays`, { refetchInterval: 5000 });
  const profiles = useGet<LookProfile[]>(['theme-profiles'], 'theme-profiles');
  const plans = useGet<Plan[]>(['game-plans'], 'game-plans');
  const members = useGet<Member[]>(['members'], 'members', { enabled: canEdit });
  // on a stream link (one OBS link for the day's matches here), OBS is ready once it has the link open
  const streamLink = useGet<{ link: { id: string; name: string; connected: boolean; today: boolean; onNow: boolean } | null }>(['stream-link', d.id], `matches/${d.id}/stream-link`, { refetchInterval: 15_000 });
  const sl = streamLink.data?.link?.today ? streamLink.data.link : null;
  const copy = useCopy();
  const [scorerLink, setScorerLink] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const primary = overlays.data?.[0];
  const setLookAction = useAction((v: { choice: LookChoice; name: string }) => put<{ outputs: number }>(`matches/${d.id}/look`, v.choice), [['overlays', d.id], ['theme-profiles']], { success: (_r, v) => `${v.name} applied to this match` });
  const setPlanAction = useAction((versionId: string) => put(`overlays/${primary!.id}/game-plan`, { gamePlanVersionId: versionId }), [['overlays', d.id]], { success: 'Automation set for this match' });
  const starterAction = useAction(() => post(`overlays/${primary!.id}/starter-plan`), [['overlays', d.id], ['game-plans']], { success: 'Automation on: the pre-match graphics are going to air' });
  const assign = useAction((membershipId: string) => post(`matches/${d.id}/scorers`, { membershipId }), [['match', d.id]], { success: 'Scorer assigned. The match is now on their list.' });
  const copyObs = async () => {
    if (!primary) return onGoTo('graphics');
    const u = await get<{ production: string | null }>(`overlays/${primary.id}/urls`).catch(() => null);
    if (u?.production) await copy(u.production, 'OBS link');
    else onGoTo('graphics');
  };

  const starters = (side: 'home' | 'away') => d.lineup[side].filter((p) => p.starter).length;
  const lineupsDone = starters('home') > 0 && starters('away') > 0;
  const publishedPlans = (plans.data ?? []).filter((p) => p.sport === d.sport && p.currentVersion > 0);
  const planName = (versionId: string | null) => {
    for (const p of plans.data ?? []) for (const v of p.versions) if (v.id === versionId) return `${p.name} v${v.version}`;
    return null;
  };
  // the output is on an older version of its plan than the one now published (matches keep the version they were given)
  const newer = (() => {
    for (const p of plans.data ?? []) {
      const at = p.versions.find((v) => v.id === primary?.gamePlanVersionId);
      if (at && p.versions[0] && p.versions[0].version > at.version) return p.versions[0];
    }
    return null;
  })();
  const tournamentLook = lookName(profiles.data, d.competition.themeProfileId);
  const obs = primary ? obsStatus(primary) : null;
  const rows = [
    { done: lineupsDone, key: 'lineups' },
    { done: !!primary?.theme, key: 'look' },
    { done: !!primary?.gamePlanVersionId, key: 'plan' },
    { done: d.scorers.length > 0, key: 'scorer' },
    { done: !!obs?.connected || !!sl?.connected, key: 'obs' },
  ];
  const doneCount = rows.filter((r) => r.done).length;
  const allDone = doneCount === rows.length;

  // everything done: one line, the list one click away
  if (allDone && !expanded) {
    return (
      <Card className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <h2 className="font-medium">Match day</h2>
        <StatusPill tone="healthy">Ready to go</StatusPill>
        <span className="text-sm text-muted">Line-ups, look, automation, scorer and OBS are all set.</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setScorerLink(true)}><Smartphone className="size-4" /> Send scorer link</Button>
          <Button size="sm" variant="ghost" aria-expanded={false} onClick={() => setExpanded(true)}>Show the checklist</Button>
        </div>
        <ScorerLinkDialog matchId={d.id} open={scorerLink} onClose={() => setScorerLink(false)} assigned={d.scorers.map((s) => s.name)} />
      </Card>
    );
  }

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium">Match day</h2>
        <StatusPill tone={allDone ? 'healthy' : 'primary'}>{allDone ? 'Ready to go' : `${doneCount} of ${rows.length} ready`}</StatusPill>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setScorerLink(true)}><Smartphone className="size-4" /> Send scorer link</Button>
          {allDone ? <Button size="sm" variant="ghost" aria-expanded onClick={() => setExpanded(false)}>Hide</Button> : null}
        </div>
      </div>
      <ul className="mt-2 divide-y divide-border">
        <CheckRow done={lineupsDone} label={lineupsDone ? `Line-ups entered (${starters('home')} v ${starters('away')} starters)` : 'Enter the line-ups'}
          detail={lineupsDone ? undefined : 'Team line-ups and the goal, card and substitution graphics need player names.'}
          action={<Button size="sm" variant={lineupsDone ? 'ghost' : 'secondary'} onClick={() => onGoTo('lineup')}>{lineupsDone ? 'Edit' : 'Line-ups'}</Button>} />
        <CheckRow done={!!primary?.theme} label={primary?.theme ? `Look: ${primary.theme.profile} v${primary.theme.version}` : 'Choose a graphics look'}
          detail={primary?.theme
            ? (primary.theme.id === d.competition.themeProfileId ? 'The tournament’s look. Choose another for this match only.' : 'This match’s own look.')
            : 'Colours and style for every graphic in this match: one of your looks or any of the ten built-in looks.'}
          action={canEdit && primary ? (
            <LookPicker profiles={profiles.data} current={primary.theme?.id} follow={{ name: tournamentLook }} loading={setLookAction.isPending} onApply={(choice, name) => setLookAction.mutate({ choice, name })} />
          ) : null} />
        <CheckRow done={!!primary?.gamePlanVersionId} label={primary?.gamePlanVersionId ? `Automation: ${planName(primary.gamePlanVersionId) ?? 'on'}` : 'Set up automation'}
          detail={newer ? `Version ${newer.version} of this plan is published; this match still runs the older one.` : primary?.gamePlanVersionId ? 'Graphics follow the scorer automatically.' : publishedPlans.length ? 'Line-ups, kick-off, goals and the half-time board run from the scorer’s taps.' : 'Without a plan the OBS link stays empty until you take graphics by hand. The starter flow puts the background and match header up now and follows the scorer from there.'}
          action={canEdit && primary ? (
            <>
              {!primary.gamePlanVersionId ? <Button size="sm" variant="primary" loading={starterAction.isPending} onClick={() => starterAction.mutate(undefined)}>{publishedPlans.length ? 'Use the latest plan' : 'Use the starter flow'}</Button> : null}
              {newer ? <Button size="sm" variant="primary" loading={setPlanAction.isPending} onClick={() => setPlanAction.mutate(newer.id)}>Use v{newer.version}</Button> : null}
              {publishedPlans.length ? (
                <NativeSelect aria-label="Automation plan" className="w-auto" value="" disabled={setPlanAction.isPending} onChange={(e) => e.target.value && setPlanAction.mutate(e.target.value)}>
                  <option value="">{setPlanAction.isPending ? 'Applying…' : primary.gamePlanVersionId ? 'Change plan…' : 'Choose…'}</option>
                  {publishedPlans.map((p) => <option key={p.id} value={p.versions[0]!.id} disabled={p.versions[0]!.id === primary.gamePlanVersionId}>{p.name} (v{p.versions[0]!.version})</option>)}
                </NativeSelect>
              ) : null}
            </>
          ) : null} />
        <CheckRow done={d.scorers.length > 0} label={d.scorers.length ? `Scorer: ${d.scorers.map((s) => s.name).join(', ')}` : 'Assign a scorer'}
          detail={d.scorers.length ? 'They open the scorer link on their phone and the match is on their list.' : 'The scorer records goals, cards and the clock from a phone.'}
          action={canEdit ? (
            <NativeSelect aria-label="Scorer" className="w-auto" value="" disabled={assign.isPending} onChange={(e) => e.target.value && assign.mutate(e.target.value)}>
              <option value="">{assign.isPending ? 'Assigning…' : d.scorers.length ? 'Add another…' : 'Choose…'}</option>
              {members.data?.filter((x) => x.status === 'active' && !d.scorers.some((s) => s.membershipId === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.role})</option>)}
            </NativeSelect>
          ) : null} />
        {sl ? (
          <CheckRow done={sl.connected || !!obs?.connected} label={sl.connected ? `OBS has the stream link “${sl.name}” open${sl.onNow ? ': this match is on now' : ''}` : `On the stream link “${sl.name}”`}
            detail={sl.connected ? (sl.onNow ? undefined : 'It shows this match when its turn comes.') : 'Add the stream link to OBS once for the whole day (Live → Stream links); it shows this match when its turn comes.'}
            action={<Button asChild size="sm" variant={sl.connected ? 'ghost' : 'secondary'}><Link href="/app/live#stream-links">Stream links</Link></Button>} />
        ) : (
          <CheckRow done={!!obs?.connected} label={obs?.connected ? obs.text : 'Add the OBS link to OBS'}
            detail={obs?.connected ? undefined : 'Paste the link into OBS as a Browser Source at 1920×1080. This turns green once OBS is showing it.'}
            action={<><Button size="sm" variant={obs?.connected ? 'ghost' : 'secondary'} onClick={() => void copyObs()}><Copy className="size-4" /> Copy OBS link</Button><Button size="sm" variant="ghost" onClick={() => onGoTo('graphics')}>Show me how</Button></>} />
        )}
      </ul>
      <ErrorNotice error={setLookAction.error ?? setPlanAction.error ?? starterAction.error ?? assign.error} />
      <ScorerLinkDialog matchId={d.id} open={scorerLink} onClose={() => setScorerLink(false)} assigned={d.scorers.map((s) => s.name)} />
    </Card>
  );
}

/** The scorer's link for this match, as text and as a QR code to scan from the producer's screen. */
export function ScorerLinkDialog({ matchId, open, onClose, assigned }: { matchId: string; open: boolean; onClose: () => void; assigned: string[] }) {
  const copy = useCopy();
  const [qr, setQr] = useState<string | null>(null);
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/score/${matchId}`;
  useEffect(() => {
    if (!open || !url) return;
    void toDataURL(url, { width: 240, margin: 1, color: { dark: '#0B1220', light: '#FFFFFF' } }).then(setQr).catch(() => setQr(null));
  }, [open, url]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Scorer link" description="Send this to the person scoring the match, or let them scan it. They sign in with their own account.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
        {qr ? <img src={qr} alt="QR code for the scorer link" className="mx-auto size-40 rounded-md bg-white p-1" /> : <div className="mx-auto grid size-40 place-items-center rounded-md border border-border text-muted"><QrCode className="size-8" /></div>}
        <div className="grid gap-2">
          <div className="flex gap-2"><Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Scorer link" /><Button onClick={() => void copy(url, 'Scorer link')}><Copy className="size-4" /> Copy</Button></div>
          <p className="text-xs text-muted">{assigned.length ? `Assigned: ${assigned.join(', ')}. ` : 'Assign them above so the match appears on their list. '}The scorer app works offline once it has opened on the phone.</p>
        </div>
      </div>
    </Dialog>
  );
}
