'use client';
// "What this plan does", in plain words, before any of the knobs: one line per playlist under the part of the match
// it belongs to, when it runs and what goes on air ("At Players entering: Team lineup for both teams"). Clicking a
// line jumps to that playlist.
import type { GamePlan, PlanItem, Playlist } from '@bs/domain';
import { Card } from '@bs/ui';
import { PLAYLIST_KINDS, seconds } from '@/lib/labels';
import { templateName } from './step-editor';
import { triggerText, type Sport } from './trigger-editor';

/** What a step puts on (or takes off) air, in a few words; null for a pause. */
function stepName(it: PlanItem): { name: string; team: string | null } | null {
  const team = typeof it.variables?.team === 'string' ? it.variables.team : null;
  switch (it.action) {
    case 'show': return { name: templateName(it.templateKey), team };
    case 'update': return { name: `${templateName(it.templateKey)} updated`, team };
    case 'hide': return { name: `${templateName(it.templateKey)} off`, team: null };
    case 'sponsor': case 'creative': return { name: 'a sponsor', team: null };
    case 'media': return { name: 'an image or video', team: null };
    case 'scorebug_show': return { name: 'the scorebug', team: null };
    case 'scorebug_hide': return { name: 'scorebug off', team: null };
    case 'clear_layers': return { name: 'full-screen graphics off', team: null };
    default: return null;
  }
}

/** "Match header, then Team lineup for both teams": the steps in order, a home-then-away pair said once. */
export function stepsSummary(items: PlanItem[]): string {
  const steps = items.map(stepName).filter((s): s is NonNullable<typeof s> => !!s);
  const out: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const next = steps[i + 1];
    if (next && next.name === s.name && s.team && next.team && s.team !== next.team) {
      out.push(`${s.name} for both teams`);
      i++;
    } else out.push(s.team === 'home' || s.team === 'away' ? `${s.name} (${s.team})` : s.name);
  }
  const text = out.join(', then ');
  return text ? text[0]!.toUpperCase() + text.slice(1) : 'Nothing yet';
}

/** The extras worth knowing at a glance (repeats, conditions, approval), for the summary and the Fine-tune line. */
export function playlistExtras(pl: Playlist): string[] {
  return [
    pl.repeat.mode === 'loop' ? `repeats${pl.repeat.gapMs ? ` every ${seconds(pl.repeat.gapMs)}` : ''}` : null,
    pl.guards.length ? `only when ${pl.guards.length === 1 ? 'a condition is met' : `${pl.guards.length} conditions are met`}` : null,
    pl.approval === 'manual' ? 'waits for the producer' : null,
  ].filter((x): x is string => !!x);
}

const KIND_ORDER = ['pre', 'in_play', 'break', 'post'];

export function PlanSummary({ plan, sport, onOpen }: { plan: GamePlan; sport: Sport; onOpen: (playlistId: string) => void }) {
  const groups = KIND_ORDER.map((k) => ({ kind: k, lists: plan.playlists.filter((p) => p.kind === k) })).filter((g) => g.lists.length || (g.kind === 'in_play' && plan.defaultScorebug));
  return (
    <Card className="p-4">
      <h3 className="font-medium">What this plan does</h3>
      {!plan.playlists.length ? <p className="mt-1 text-sm text-muted">Nothing yet: add a playlist below, or reset to the starter flow.</p> : (
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
          {groups.map((g) => (
            <section key={g.kind} aria-label={PLAYLIST_KINDS[g.kind]}>
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{PLAYLIST_KINDS[g.kind]}</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {g.kind === 'in_play' && plan.defaultScorebug ? <li className="text-muted">The scorebug stays up during play.</li> : null}
                {g.lists.map((pl) => {
                  const extras = playlistExtras(pl);
                  return (
                    <li key={pl.id}>
                      <button type="button" onClick={() => onOpen(pl.id)} className="w-full rounded px-1 py-0.5 text-left hover:bg-elevated">
                        <span className="text-muted">{pl.triggers.map((t) => triggerText(t, sport)).join('; or ')}: </span>
                        <span>{stepsSummary(pl.items)}</span>
                        {extras.length ? <span className="text-xs text-muted"> ({extras.join(', ')})</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
