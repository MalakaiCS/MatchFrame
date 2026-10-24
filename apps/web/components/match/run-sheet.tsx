'use client';
// Run sheet and notes for one match: timed lines the production team ticks off ("KO-10 ident", "HT sponsor
// read") plus free notes. Shared live between the match page and every desk on the match.
import { useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { Button, ErrorNotice, Input, StatusPill, cx } from '@bs/ui';
import { del, patch, post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';

export interface Note { id: string; kind: 'note' | 'runsheet'; atLabel: string | null; body: string; done: boolean; position: number; createdAt: string }
const QUICK_LABELS = ['KO-30', 'KO-15', 'KO-10', 'KO-5', 'KO', 'HT', 'HT+5', '2H', 'FT', 'FT+5'];

export function RunSheet({ matchId, canEdit, compact = false }: { matchId: string; canEdit: boolean; compact?: boolean }) {
  const notes = useGet<Note[]>(['notes', matchId], `matches/${matchId}/notes`, { refetchInterval: compact ? 5000 : 15_000 });
  const [draft, setDraft] = useState<{ atLabel: string; body: string; kind: 'runsheet' | 'note' }>({ atLabel: '', body: '', kind: 'runsheet' });
  const add = useAction(() => post(`matches/${matchId}/notes`, { kind: draft.kind, atLabel: draft.kind === 'runsheet' && draft.atLabel.trim() ? draft.atLabel.trim() : null, body: draft.body.trim(), position: ((notes.data?.length ?? 0) + 1) * 10 }), [['notes', matchId]]);
  const toggle = useAction((n: Note) => patch(`matches/${matchId}/notes/${n.id}`, { done: !n.done }), [['notes', matchId]]);
  const remove = useAction((id: string) => del(`matches/${matchId}/notes/${id}`), [['notes', matchId]]);
  const sheet = (notes.data ?? []).filter((n) => n.kind === 'runsheet');
  const free = (notes.data ?? []).filter((n) => n.kind === 'note');
  const submit = () => {
    if (!draft.body.trim()) return;
    add.mutate(undefined, { onSuccess: () => setDraft((d) => ({ ...d, body: '', atLabel: '' })) });
  };
  const line = (n: Note) => (
    <li key={n.id} className={cx('flex items-start gap-2 rounded px-1 py-1', n.done && 'opacity-60')}>
      {n.kind === 'runsheet' ? (
        <button type="button" role="checkbox" aria-checked={n.done} aria-label={`${n.done ? 'Reopen' : 'Done'}: ${n.body}`} disabled={!canEdit || toggle.isPending} onClick={() => toggle.mutate(n)} className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded border', n.done ? 'border-healthy bg-healthy text-bg' : 'border-border')}>
          {n.done ? <Check className="size-3.5" /> : null}
        </button>
      ) : null}
      {n.atLabel ? <StatusPill tone={n.done ? 'neutral' : 'primary'}>{n.atLabel}</StatusPill> : null}
      <span className={cx('min-w-0 flex-1 text-sm', n.done && 'line-through')}>{n.body}</span>
      {canEdit ? <button type="button" aria-label={`Remove ${n.body}`} className="text-muted hover:text-live" onClick={() => remove.mutate(n.id)}><Trash2 className="size-3.5" /></button> : null}
    </li>
  );
  return (
    <div className={compact ? 'text-sm' : ''}>
      {!compact ? <p className="mb-3 text-sm text-muted">The run sheet is what the desk follows on the day: what goes to air and when, ticked off as it happens. Everyone on the match sees the same sheet live.</p> : null}
      <ErrorNotice error={notes.error ?? add.error ?? toggle.error ?? remove.error} />
      <ul className={cx('space-y-0.5', compact && 'max-h-56 overflow-y-auto')} aria-label="Run sheet">
        {sheet.map(line)}
        {!sheet.length ? <li className="px-1 py-1 text-xs text-muted">Nothing on the run sheet yet.{canEdit ? ' Add the first line below, for example “KO-10 · opening ident”.' : ''}</li> : null}
      </ul>
      {free.length ? (
        <>
          <h4 className="mb-1 mt-3 text-xs font-medium text-muted">Notes</h4>
          <ul className="space-y-0.5" aria-label="Notes">{free.map(line)}</ul>
        </>
      ) : null}
      {canEdit ? (
        <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <label className="flex items-center gap-1 text-muted"><input type="radio" name={`kind-${matchId}`} checked={draft.kind === 'runsheet'} onChange={() => setDraft({ ...draft, kind: 'runsheet' })} /> Run sheet line</label>
            <label className="flex items-center gap-1 text-muted"><input type="radio" name={`kind-${matchId}`} checked={draft.kind === 'note'} onChange={() => setDraft({ ...draft, kind: 'note' })} /> Note</label>
            {draft.kind === 'runsheet' ? <span className="ml-auto flex flex-wrap gap-1">{QUICK_LABELS.map((l) => <button type="button" key={l} onClick={() => setDraft({ ...draft, atLabel: l })} className={cx('rounded border px-1.5 py-0.5', draft.atLabel === l ? 'border-primary text-primary' : 'border-border text-muted hover:text-text')}>{l}</button>)}</span> : null}
          </div>
          <div className="flex gap-2">
            {draft.kind === 'runsheet' ? <Input aria-label="When" placeholder="KO-10" className="w-24" maxLength={16} value={draft.atLabel} onChange={(e) => setDraft({ ...draft, atLabel: e.target.value })} /> : null}
            <Input aria-label={draft.kind === 'runsheet' ? 'What happens' : 'Note'} placeholder={draft.kind === 'runsheet' ? 'What goes to air, e.g. opening ident and line-ups' : 'Anything the team should know'} className="flex-1" maxLength={500} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <Button type="submit" size="md" variant="primary" disabled={!draft.body.trim()} loading={add.isPending}>Add</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
