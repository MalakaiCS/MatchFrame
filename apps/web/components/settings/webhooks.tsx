'use client';
// Outbound webhooks: where match events are posted (club website, Slack relay, scoreboard app), which events,
// and how deliveries have been going. The signing secret is shown once when the endpoint is created.
import { useState } from 'react';
import { Button, Card, Dialog, ErrorNotice, Field, Input, Spinner, StatusPill, Switch, Table, type Tone } from '@bs/ui';
import { del, patch, post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';

interface Endpoint { id: string; url: string; events: string[]; enabled: boolean; createdAt: string; last: { state: string; status: number | null; error: string | null; at: string; event: string } | null; counts: { delivered: number; failed: number; pending: number } }
interface Delivery { id: string; eventType: string; state: string; attempts: number; lastStatus: number | null; lastError: string | null; nextAttemptAt: string | null; createdAt: string }
const EVENT_LABELS: Record<string, string> = {
  'match.started': 'Match started',
  'match.score': 'Score changed',
  'match.event': 'Goal, card or change recorded',
  'match.phase': 'Period changed (half time, full time…)',
  'match.final': 'Final result',
  'match.lineup': 'Line-up published',
  'match.rescheduled': 'Fixture rescheduled',
  'webhook.test': 'Test ping',
};
const stateTone = (s: string): Tone => (s === 'delivered' ? 'healthy' : s === 'pending' ? 'warning' : s === 'dead' || s === 'failed' ? 'live' : 'neutral');

export function WebhooksPanel({ tz, canEdit }: { tz: string; canEdit: boolean }) {
  const list = useGet<Endpoint[]>(['webhooks'], 'webhook-endpoints', { refetchInterval: 15_000 });
  const events = useGet<string[]>(['webhook-events'], 'webhook-events');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ url: string; events: string[] }>({ url: '', events: ['match.score', 'match.event', 'match.phase', 'match.final'] });
  const [secret, setSecret] = useState<string | null>(null);
  const [showing, setShowing] = useState<string | null>(null);
  const deliveries = useGet<Delivery[]>(['webhook-deliveries', showing], showing ? `webhook-endpoints/${showing}/deliveries` : null);
  const create = useAction(() => post<{ id: string; secret: string }>('webhook-endpoints', { url: form.url.trim(), events: form.events, enabled: true }), [['webhooks']]);
  const toggle = useAction((e: Endpoint) => patch(`webhook-endpoints/${e.id}`, { enabled: !e.enabled }), [['webhooks']]);
  const remove = useAction((id: string) => del(`webhook-endpoints/${id}`), [['webhooks']], { success: 'Webhook removed' });
  const test = useAction((id: string) => post(`webhook-endpoints/${id}/test`), [['webhooks']], { success: 'Test event queued. The result appears in the deliveries within a few seconds.' });
  const flip = (ev: string) => setForm((f) => ({ ...f, events: f.events.includes(ev) ? f.events.filter((x) => x !== ev) : [...f.events, ev] }));

  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h2 className="font-medium">Webhooks</h2>
            <p className="text-xs text-muted">Match events are posted as JSON to your address within seconds. Each request carries a signature header so you can check it came from here; failed deliveries are retried with increasing delays.</p>
          </div>
          {canEdit ? <Button variant="primary" className="ml-auto" onClick={() => { setOpen(true); setSecret(null); create.reset(); }}>Add webhook</Button> : null}
        </div>
      </Card>
      <ErrorNotice error={list.error ?? toggle.error ?? remove.error ?? test.error} />
      {list.isLoading ? <Spinner /> : list.data?.length ? (
        <Table><thead><tr><th>Address</th><th>Events</th><th>Last delivery</th><th>Delivered / failed</th><th>On</th><th /></tr></thead><tbody>
          {list.data.map((e) => (
            <tr key={e.id}>
              <td className="max-w-xs break-all font-mono text-xs">{e.url}</td>
              <td className="text-xs text-muted">{e.events.map((x) => EVENT_LABELS[x] ?? x).join(', ')}</td>
              <td className="text-xs">{e.last ? <><StatusPill tone={stateTone(e.last.state)}>{e.last.state}</StatusPill> <span className="text-muted">{e.last.status ? `HTTP ${e.last.status} · ` : ''}{fmtDate(e.last.at, tz, { timeStyle: 'short', dateStyle: 'short' })}</span>{e.last.error ? <span className="block text-live">{e.last.error}</span> : null}</> : <span className="text-muted">nothing sent yet</span>}</td>
              <td className="tabular">{e.counts.delivered} / <span className={e.counts.failed ? 'text-live' : ''}>{e.counts.failed}</span>{e.counts.pending ? <span className="text-xs text-muted"> · {e.counts.pending} pending</span> : null}</td>
              <td><Switch label="" checked={e.enabled} disabled={!canEdit} onCheckedChange={() => toggle.mutate(e)} /></td>
              <td className="text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setShowing(showing === e.id ? null : e.id)}>{showing === e.id ? 'Hide' : 'Deliveries'}</Button>{canEdit ? <><Button size="sm" variant="ghost" loading={test.isPending} onClick={() => test.mutate(e.id)}>Send test</Button><Button size="sm" variant="danger" onClick={() => confirm('Remove this webhook? Nothing more is sent to it.') && remove.mutate(e.id)}>Remove</Button></> : null}</div></td>
            </tr>
          ))}
        </tbody></Table>
      ) : <Card className="p-4 text-sm text-muted">No webhooks yet. Add one to push live scores to a website, a chat tool or a scoreboard.</Card>}
      {showing ? (
        <Card className="p-3">
          <h3 className="mb-2 text-sm font-medium">Recent deliveries</h3>
          {deliveries.isLoading ? <Spinner /> : deliveries.data?.length ? (
            <Table><thead><tr><th>When</th><th>Event</th><th>State</th><th>Attempts</th><th>Response</th><th>Next try</th></tr></thead><tbody>
              {deliveries.data.map((d) => <tr key={d.id}><td className="whitespace-nowrap text-xs tabular">{fmtDate(d.createdAt, tz, { dateStyle: 'short', timeStyle: 'medium' })}</td><td className="text-xs">{EVENT_LABELS[d.eventType] ?? d.eventType}</td><td><StatusPill tone={stateTone(d.state)}>{d.state}</StatusPill></td><td className="tabular">{d.attempts}</td><td className="text-xs">{d.lastStatus ? `HTTP ${d.lastStatus}` : ''}{d.lastError ? <span className="block text-live">{d.lastError}</span> : null}</td><td className="text-xs text-muted">{d.nextAttemptAt && d.state === 'pending' ? fmtDate(d.nextAttemptAt, tz, { timeStyle: 'medium' }) : '—'}</td></tr>)}
            </tbody></Table>
          ) : <p className="text-xs text-muted">No deliveries yet.</p>}
        </Card>
      ) : null}
      <Card className="p-4 text-xs text-muted">
        <h3 className="mb-1 text-sm font-medium text-text">Checking a signature</h3>
        <p>Every request has <code>X-Webhook-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code> where v1 is HMAC-SHA256 of <code>&lt;t&gt;.&lt;raw body&gt;</code> with your endpoint's secret, and <code>X-Webhook-Event</code> names the event. Reject requests older than five minutes. The body never includes personal details beyond player display names.</p>
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title={secret ? 'Webhook added' : 'Add a webhook'} description={secret ? 'Copy the signing secret now. It is not shown again.' : 'An https address that accepts POST requests with a JSON body.'}
        footer={secret ? <Button variant="primary" onClick={() => setOpen(false)}>Done</Button> : <><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!form.url.trim() || !form.events.length} onClick={() => create.mutate(undefined, { onSuccess: (r) => setSecret(r.secret) })}>Add webhook</Button></>}>
        {secret ? <Card className="p-3 text-sm"><p className="mb-1 text-warning">Signing secret</p><code className="break-all text-xs">{secret}</code></Card> : (
          <div className="grid gap-3">
            <Field label="Address" htmlFor="wh-url" error={create.error?.fieldError('url')}><Input id="wh-url" type="url" placeholder="https://example.org/hooks/scores" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-muted">Send these events</legend>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{(events.data ?? Object.keys(EVENT_LABELS)).map((ev) => <label key={ev} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.events.includes(ev)} onChange={() => flip(ev)} /> {EVENT_LABELS[ev] ?? ev}</label>)}</div>
            </fieldset>
            <ErrorNotice error={create.error && !create.error.fields ? create.error : null} />
          </div>
        )}
      </Dialog>
    </div>
  );
}
