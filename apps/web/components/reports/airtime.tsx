'use client';
// Graphics on-air report: how often and how long each graphic was on screen, by template, match, sponsor
// creative and source (automation or the desk). Confirmed by the output that showed it.
import Link from 'next/link';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Card, ErrorNotice, Field, Input, NativeSelect, Spinner, Table } from '@bs/ui';
import { fmtDate, useGet } from '@/lib/hooks';
import { useMe } from '@/lib/session';

interface Row { key: string; count: number; seconds: number }
interface Report { totals: { graphics: number; seconds: number }; byTemplate: Row[]; byMatch: (Row & { matchId: string; scheduledAt: string | null })[]; bySponsorCreative: Row[]; bySource: Row[] }
const mins = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`);

export function AirtimeReport() {
  const tz = useMe().data?.activeOrganisation?.timezone ?? 'UTC';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [comp, setComp] = useState('');
  const comps = useGet<{ id: string; name: string }[]>(['competitions'], 'competitions');
  const qs = new URLSearchParams();
  if (from) qs.set('from', new Date(from).toISOString());
  if (to) qs.set('to', new Date(`${to}T23:59:59`).toISOString());
  if (comp) qs.set('competitionId', comp);
  const r = useGet<Report>(['airtime', qs.toString()], `reports/airtime?${qs}`);
  const group = (title: string, label: string, rows: (Row & { id?: string; name?: React.ReactNode })[]) => (
    <Card className="p-3">
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <Table><thead><tr><th>{label}</th><th className="text-right">Times shown</th><th className="text-right">Time on air</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.id ?? x.key}><td>{x.name ?? x.key.replace('builtin:', '').replace(/_/g, ' ')}</td><td className="text-right tabular">{x.count}</td><td className="text-right tabular">{mins(x.seconds)}</td></tr>)}{!rows.length ? <tr><td colSpan={3} className="text-muted">Nothing recorded.</td></tr> : null}</tbody>
      </Table>
    </Card>
  );
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted">Every graphic an output showed, how often and for how long. Confirmed by the output itself, not by what was sent.</p>
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <Field label="From" htmlFor="a-from"><Input id="a-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" htmlFor="a-to"><Input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Competition" htmlFor="a-comp"><NativeSelect id="a-comp" value={comp} onChange={(e) => setComp(e.target.value)}><option value="">All</option>{comps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
        <Button asChild variant="secondary" className="ml-auto"><a href={`/api/v1/reports/airtime.csv?${qs}`}><Download className="size-4" /> Export CSV</a></Button>
      </Card>
      <ErrorNotice error={r.error} />
      {r.isLoading || !r.data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="p-3"><div className="text-xs text-muted">Graphics shown</div><div className="text-2xl font-semibold">{r.data.totals.graphics}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted">Total time on air</div><div className="text-2xl font-semibold">{mins(r.data.totals.seconds)}</div></Card>
          </div>
          <p className="text-xs text-muted">Each row is a graphic that an output actually displayed, timed from when it appeared to when it went out. Demo matches are left out. For sponsor obligations use the Sponsor delivery tab; this report covers every graphic.</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {group('By graphic', 'Graphic', r.data.byTemplate)}
            {group('By match', 'Match', r.data.byMatch.map((x) => ({ ...x, id: x.matchId, name: <><Link href={`/app/matches/${x.matchId}`} className="hover:underline">{x.key}</Link>{x.scheduledAt ? <span className="block text-xs text-muted">{fmtDate(x.scheduledAt, tz, { dateStyle: 'medium' })}</span> : null}</> })))}
            {group('By sponsor artwork', 'Artwork', r.data.bySponsorCreative.map((x) => ({ ...x, name: x.key })))}
            {group('By source', 'Sent by', r.data.bySource.map((x) => ({ ...x, key: x.key === 'automation' ? 'automation' : 'the desk' })))}
          </div>
        </>
      )}
    </div>
  );
}
