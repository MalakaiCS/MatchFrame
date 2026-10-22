'use client';
// Finals on the competition page: after the regular season, the top of the ladder plays knockout rounds
// (quarter-finals, semi-finals, the Grand Final…). The first round comes from the ladder, each next one from the
// winners; finals matches take the finals rules (a level score is decided) and never count for the ladder.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Plus, Trophy } from 'lucide-react';
import { firstFinalsRound, type FinalsFormat, type Sport } from '@bs/domain';
import { Button, Card, ErrorNotice, Field, Input, NativeSelect, Spinner, StatusPill, cx } from '@bs/ui';
import { patch, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { phaseTone } from '@/components/match-table';
import { RulesEditor } from './rules-editor';
import { SeasonSelect, useSeasonPick } from './season-data';

interface TeamRef { id: string; name: string; shortName: string; abbreviation: string; primaryColor: string }
interface FinalsMatch {
  id: string; round: string | null; scheduledAt: string; timezone: string; status: string;
  bracket: { format: string; week: number; slot: number; seeds: { home: number; away: number } } | null;
  home: TeamRef; away: TeamRef; score: { home: number; away: number } | null; shootout: { home: number; away: number } | null; winner: 'home' | 'away' | null; done: boolean;
}
interface Fixture { round: string; slot: number; seeds: { home: number; away: number }; home: TeamRef; away: TeamRef }
interface Finals {
  season: { id: string; name: string };
  formats: { id: FinalsFormat; label: string; teams: number; rounds: string[] }[];
  format: FinalsFormat | null;
  ladder: { position: number; team: TeamRef; points: number; played: number }[];
  regularLeft: number;
  matches: FinalsMatch[];
  next: { kind: 'start' } | { kind: 'round'; week: number; round: string; fixtures: Fixture[] } | { kind: 'waiting'; week: number; unresolved: { home: TeamRef; away: TeamRef; round: string | null }[] } | { kind: 'done'; champion: TeamRef | null };
  rules: { description: string[]; knockoutLabel: string | null; own: boolean };
}
interface Season { id: string; name: string; status: string }

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor((n % 100) / 10) === 1 ? 0 : n % 10]}`;

function Pairing({ f }: { f: Fixture }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-sm" style={{ background: f.home.primaryColor }} aria-hidden />
      <span className="min-w-0 truncate"><span className="text-xs text-muted">{ordinal(f.seeds.home)}</span> {f.home.name}</span>
      <span className="text-muted">v</span>
      <span className="min-w-0 truncate">{f.away.name} <span className="text-xs text-muted">{ordinal(f.seeds.away)}</span></span>
    </span>
  );
}

/** Kick-off for each match of the round, then create it. */
function CreateRound({ seasonId, competitionId, timezone, format, fixtures, title }: { seasonId: string; competitionId: string; timezone: string; format?: FinalsFormat; fixtures: Fixture[]; title: string }) {
  const [kickoffs, setKickoffs] = useState<string[]>(() => fixtures.map(() => ''));
  const [venues, setVenues] = useState<string[]>(() => fixtures.map(() => ''));
  const venueList = useGet<{ id: string; name: string }[]>(['venues'], 'venues');
  const create = useAction(
    () => post<{ round: string; created: unknown[] }>(`seasons/${seasonId}/finals/rounds`, { format, timezone, matches: fixtures.map((_, i) => ({ kickoffLocal: kickoffs[i]!.replace('T', ' '), venueId: venues[i] || null })) }),
    [['finals', seasonId], ['matches', 'competition', competitionId], ['fixtures', seasonId], ['matches']],
    { success: (r) => `${r.round}${r.created.length > 1 ? 's' : ''} created. Each has its OBS link on the match page.` },
  );
  const ready = kickoffs.length === fixtures.length && kickoffs.every(Boolean);
  return (
    <div className="grid gap-3">
      <ul className="grid gap-2" aria-label={title}>
        {fixtures.map((f, i) => (
          <li key={`${f.home.id}-${f.away.id}`} className="grid items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="min-w-0 text-sm"><span className="block text-xs text-muted">{f.round} {fixtures.length > 1 ? f.slot : ''}</span><Pairing f={f} /></div>
            <Field label="Kick-off" htmlFor={`fk-${i}`}><Input id={`fk-${i}`} type="datetime-local" value={kickoffs[i] ?? ''} onChange={(e) => setKickoffs((k) => k.map((x, j) => (j === i ? e.target.value : x)))} /></Field>
            <Field label="Venue" htmlFor={`fv-${i}`}>
              <NativeSelect id={`fv-${i}`} value={venues[i] ?? ''} onChange={(e) => setVenues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}>
                <option value="">None</option>
                {venueList.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </NativeSelect>
            </Field>
          </li>
        ))}
      </ul>
      <div><Button variant="primary" loading={create.isPending} disabled={!ready} onClick={() => create.mutate(undefined)}><Plus className="size-4" /> Create {title.toLowerCase()}</Button></div>
      <ErrorNotice error={create.error} />
    </div>
  );
}

export function FinalsPanel({ competition, canEdit }: { competition: { id: string; sport: string; defaultTimezone: string; seasons: Season[]; rulesConfig: Record<string, unknown>; finals?: { rulesConfig: Record<string, unknown>; own: boolean } }; canEdit: boolean }) {
  const [seasonId, setSeasonId] = useSeasonPick(competition.seasons);
  const q = useGet<Finals>(['finals', seasonId], seasonId ? `seasons/${seasonId}/finals` : null);
  const [format, setFormat] = useState<FinalsFormat>('top4');
  const [rulesOpen, setRulesOpen] = useState(false);
  const resetRules = useAction(() => patch(`competitions/${competition.id}`, { finalsRulesConfig: null, applyToUpcoming: true }), [['competition', competition.id], ['finals', seasonId]], { success: 'Finals use the competition’s rules, with a level score decided' });
  const tz = competition.defaultTimezone;
  const d = q.data;
  const preview = useMemo<Fixture[] | { error: string }>(() => {
    if (!d) return [];
    try {
      const byId = new Map(d.ladder.map((r) => [r.team.id, r.team]));
      return firstFinalsRound(format, d.ladder.map((r) => r.team.id)).map((f) => ({ round: f.round, slot: f.bracket.slot, seeds: f.bracket.seeds, home: byId.get(f.homeTeamId)!, away: byId.get(f.awayTeamId)! }));
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [d, format]);
  if (!competition.seasons.length) return <p className="text-sm text-muted">Add a season first.</p>;

  const rounds = new Map<string, FinalsMatch[]>();
  for (const m of d?.matches ?? []) {
    const k = m.round ?? 'Finals';
    rounds.set(k, [...(rounds.get(k) ?? []), m]);
  }

  return (
    <div className="grid min-w-0 gap-4">
      <SeasonSelect seasons={competition.seasons} value={seasonId} onChange={setSeasonId} />
      <ErrorNotice error={q.error} />
      {q.isLoading || !d ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid min-w-0 content-start gap-4">
            <Card className="p-4" role="region" aria-label="Next in the finals">
              {d.next.kind === 'start' ? (
                <>
                  <h2 className="font-medium">Start the finals</h2>
                  <p className="mt-1 text-sm text-muted">The first round comes from the ladder; each round after it from the winners. The better-placed team is at home.</p>
                  {d.regularLeft ? <p className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning" role="status">{d.regularLeft} regular-season match{d.regularLeft === 1 ? '' : 'es'} still to be played: the ladder can still change.</p> : null}
                  {canEdit ? (
                    <div className="mt-3 grid gap-3">
                      <Field label="Format" htmlFor="finals-format">
                        <NativeSelect id="finals-format" className="w-full min-w-0" value={format} onChange={(e) => setFormat(e.target.value as FinalsFormat)}>{d.formats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</NativeSelect>
                      </Field>
                      {'error' in preview ? <p className="text-sm text-warning" role="alert">{preview.error}</p> : <CreateRound key={format} seasonId={seasonId} competitionId={competition.id} timezone={tz} format={format} fixtures={preview} title={`${preview[0]?.round ?? 'Finals'}${preview.length > 1 ? 's' : ''}`} />}
                    </div>
                  ) : null}
                </>
              ) : d.next.kind === 'round' ? (
                <>
                  <h2 className="font-medium">Next: {d.next.round}{d.next.fixtures.length > 1 ? 's' : ''}</h2>
                  <p className="mt-1 text-sm text-muted">From the winners of the last round.</p>
                  {canEdit ? <div className="mt-3"><CreateRound key={`${d.next.week}`} seasonId={seasonId} competitionId={competition.id} timezone={tz} fixtures={d.next.fixtures} title={`${d.next.round}${d.next.fixtures.length > 1 ? 's' : ''}`} /></div> : <ul className="mt-2 grid gap-1 text-sm">{d.next.fixtures.map((f) => <li key={f.home.id}><Pairing f={f} /></li>)}</ul>}
                </>
              ) : d.next.kind === 'waiting' ? (
                <>
                  <h2 className="font-medium">Waiting for winners</h2>
                  <p className="mt-1 text-sm text-muted">The next round is ready once every match of this one has a winner. A level score goes to {d.rules.knockoutLabel?.replace(/ when level$/, '').toLowerCase() ?? 'extra time'}.</p>
                  <ul className="mt-2 grid gap-1 text-sm">{d.next.unresolved.map((u) => <li key={u.home.id}>{u.round}: {u.home.name} v {u.away.name}</li>)}</ul>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <Trophy className="size-8 text-warning" aria-hidden />
                  <div><h2 className="font-medium">Finals complete</h2><p className="text-sm">{d.next.champion ? <><strong>{d.next.champion.name}</strong> won the {d.season.name} Grand Final.</> : 'The last round is played.'}</p></div>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="mb-2 font-medium">Finals matches</h2>
              {!d.matches.length ? <p className="text-sm text-muted">None yet. A finals match can also be added by hand: New fixture, Stage “Finals”.</p> : (
                <div className="grid gap-3">
                  {[...rounds.entries()].map(([round, ms]) => (
                    <div key={round}>
                      <h3 className="mb-1 text-xs font-medium text-muted">{round}</h3>
                      <ul className="divide-y divide-border/60">
                        {ms.map((m) => (
                          <li key={m.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 py-1.5 text-sm">
                            <span className={cx('truncate text-right', m.winner === 'home' && 'font-semibold')}>{m.home.name}</span>
                            <Link href={`/app/matches/${m.id}`} className="min-w-16 rounded bg-elevated px-2 py-0.5 text-center tabular hover:bg-primary hover:text-bg">{m.score ? `${m.score.home} – ${m.score.away}${m.shootout ? ` (${m.shootout.home}–${m.shootout.away} pens)` : ''}` : fmtDate(m.scheduledAt, m.timezone || tz, { timeStyle: 'short' })}</Link>
                            <span className={cx('truncate', m.winner === 'away' && 'font-semibold')}>{m.away.name}</span>
                            <StatusPill tone={phaseTone(m.status)}>{m.done ? (m.winner ? `${m.winner === 'home' ? m.home.abbreviation : m.away.abbreviation} win` : 'level') : m.status === 'live' ? 'live' : fmtDate(m.scheduledAt, m.timezone || tz, { dateStyle: 'short' })}</StatusPill>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid content-start gap-4">
            <Card className="p-4">
              <h2 className="mb-2 font-medium">Finals rules</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{d.rules.description.map((r) => <li key={r}>{r}</li>)}</ul>
              <p className="mt-2 text-xs text-muted">{d.rules.own ? 'Own finals rules.' : `The competition's rules${d.rules.knockoutLabel ? `, with ${d.rules.knockoutLabel.toLowerCase()}` : ''}.`} Finals never count for the ladder.</p>
              {canEdit ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setRulesOpen(true)}>Edit finals rules</Button>
                  {d.rules.own ? <Button size="sm" variant="ghost" loading={resetRules.isPending} onClick={() => resetRules.mutate(undefined)}>Use the competition&apos;s rules</Button> : null}
                </div>
              ) : null}
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 font-medium">Ladder</h2>
              {d.ladder.length ? (
                <ol className="grid gap-1 text-sm">{d.ladder.map((r) => <li key={r.team.id} className="flex items-center gap-2"><span className="w-6 text-right tabular text-muted">{r.position}</span><span className="size-2.5 rounded-sm" style={{ background: r.team.primaryColor }} aria-hidden /><span className="min-w-0 flex-1 truncate">{r.team.name}</span><span className="tabular text-muted">{r.points}</span></li>)}</ol>
              ) : <p className="text-sm text-muted">No results yet.</p>}
            </Card>
          </div>
        </div>
      )}
      {canEdit && competition.finals ? <RulesEditor target="finals" competitionId={competition.id} sport={competition.sport as Sport} current={competition.finals.rulesConfig} open={rulesOpen} onOpenChange={setRulesOpen} /> : null}
    </div>
  );
}
