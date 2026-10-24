'use client';
// Database backups for installation owners: schedule from the environment, recent runs, and a run-now button.
import { Button, Card, ErrorNotice, Spinner, StatusPill, Table } from '@bs/ui';
import { post } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';

interface Backups { enabled: boolean; everyHours: number; keep: number; runs: { id: string; status: string; location: string | null; bytes: number | null; error: string | null; startedAt: string; finishedAt: string | null }[] }
const mb = (n: number | null) => (n == null ? '' : `${(n / 1_048_576).toFixed(1)} MB`);

export function BackupsPanel({ tz }: { tz: string }) {
  const b = useGet<Backups>(['backups'], 'admin/backups', { refetchInterval: 15_000 });
  const run = useAction(() => post<{ queued: boolean }>('admin/backups/run'), [['backups']], { success: 'Backup requested. The worker runs it now; the row below updates within a minute.' });
  if (b.isLoading) return <Spinner />;
  if (b.error || !b.data) return <ErrorNotice error={b.error} onRetry={() => b.refetch()} />;
  const d = b.data;
  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Database backups</h2>
          <StatusPill tone={d.enabled ? 'healthy' : 'warning'}>{d.enabled ? `every ${d.everyHours} h, keeping ${d.keep}` : 'scheduled backups off'}</StatusPill>
          <Button size="sm" className="ml-auto" loading={run.isPending} onClick={() => run.mutate(undefined)}>Run a backup now</Button>
        </div>
        <p className="mt-2 text-xs text-muted">Backups are a compressed pg_dump of the whole database, written to the media storage bucket under backups/. Set BACKUP_ENABLED, BACKUP_EVERY_HOURS and BACKUP_KEEP in the environment to schedule them. Restore with pg_restore into an empty database, then run the migrations.</p>
        <ErrorNotice error={run.error} />
      </Card>
      <Table><thead><tr><th>Started</th><th>Status</th><th>Size</th><th>Location</th><th>Took</th></tr></thead><tbody>
        {d.runs.map((r) => (
          <tr key={r.id}>
            <td className="whitespace-nowrap text-xs tabular">{fmtDate(r.startedAt, tz, { dateStyle: 'short', timeStyle: 'medium' })}</td>
            <td><StatusPill tone={r.status === 'ok' ? 'healthy' : r.status === 'running' ? 'warning' : 'live'}>{r.status}</StatusPill>{r.error ? <span className="block text-xs text-live">{r.error}</span> : null}</td>
            <td className="tabular">{mb(r.bytes)}</td>
            <td className="break-all font-mono text-xs text-muted">{r.location ?? ''}</td>
            <td className="text-xs text-muted">{r.finishedAt ? `${Math.max(1, Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000))} s` : ''}</td>
          </tr>
        ))}
        {!d.runs.length ? <tr><td colSpan={5} className="text-center text-muted">No backups yet.</td></tr> : null}
      </tbody></Table>
    </div>
  );
}
