'use client';
// Sponsor delivery reports: confirmed on-air occurrences and seconds, by campaign/creative/match/output.
// Explicitly not audience measurement.
import Link from 'next/link';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Card, ErrorNotice, Field, Input, NativeSelect, PageHeader, Spinner, StatusPill, Tab, TabList, TabPanel, Table, Tabs } from '@bs/ui';
import { AirtimeReport } from '@/components/reports/airtime';
import { fmtDate, useGet } from '@/lib/hooks';
import { placementLabel } from '@/lib/labels';
import { useMe } from '@/lib/session';

interface Row { key: string; occurrences: number; seconds: number }
interface Report {
  definitions: Record<string, string>;
  totals: { occurrences: number; confirmedSeconds: number; skippedOrEmpty: number };
  byCampaign: Row[];
  byCreative: Row[];
  byMatch: (Row & { matchId: string; scheduledAt: string })[];
  byOutput: (Row & { overlayId: string; matchId: string; match: string; scheduledAt: string })[];
  skipped: { at: string; placement: string; reason: string | null }[];
  occurrences: { exposureId: string; firstVisibleAt: string; matchLabel: string; output: string; brand: string; campaign: string; creative: string; placement: string; evidenceType: string; confirmedSeconds: number; closeReason: string; uncertaintySeconds: number }[];
}

function SponsorReport() {
  const me = useMe();
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [comp, setComp] = useState('');
  const comps = useGet<{ id: string; name: string }[]>(['competitions'], 'competitions');
  const qs = new URLSearchParams();
  if (from) qs.set('from', new Date(from).toISOString());
  if (to) qs.set('to', new Date(`${to}T23:59:59`).toISOString());
  if (comp) qs.set('competitionId', comp);
  const r = useGet<Report>(['sponsor-report', qs.toString()], `reports/sponsors?${qs}`);
  const day = (iso: string) => fmtDate(iso, tz, { dateStyle: 'medium' });
  const group = (title: string, label: string, rows: { id: string; name: React.ReactNode; occurrences: number; seconds: number }[]) => (
    <Card className="p-3">
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <Table><thead><tr><th>{label}</th><th className="text-right">Times shown</th><th className="text-right">Seconds on air</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.id}><td>{x.name}</td><td className="text-right tabular">{x.occurrences}</td><td className="text-right tabular">{x.seconds}</td></tr>)}{!rows.length ? <tr><td colSpan={3} className="text-muted">No delivery recorded.</td></tr> : null}</tbody>
      </Table>
    </Card>
  );
  const named = (rows: Row[]) => rows.map((x) => ({ ...x, id: x.key, name: x.key }));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">How often and how long each sponsor was actually on screen, confirmed by the output that showed it. Demo matches are left out.</p>
        <Button asChild variant="secondary"><a href={`/api/v1/reports/sponsors.csv?${qs}`}><Download className="size-4" /> Export CSV</a></Button>
      </div>
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <Field label="From" htmlFor="r-from"><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" htmlFor="r-to"><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Competition" htmlFor="r-comp"><NativeSelect id="r-comp" value={comp} onChange={(e) => setComp(e.target.value)}><option value="">All</option>{comps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
      </Card>
      <ErrorNotice error={r.error} />
      {r.isLoading || !r.data ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="p-3"><div className="text-xs text-muted">Times shown</div><div className="text-2xl font-semibold tabular">{r.data.totals.occurrences}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted">Seconds on air</div><div className="text-2xl font-semibold tabular">{r.data.totals.confirmedSeconds}</div></Card>
          </div>
          <details className="rounded-[var(--radius-card)] border border-border p-3 text-xs text-muted">
            <summary className="cursor-pointer text-sm text-text">What these numbers mean</summary>
            <ul className="mt-2 space-y-1">{Object.entries(r.data.definitions).map(([k, v]) => <li key={k}><span className="font-medium text-text">{k}:</span> {v}</li>)}</ul>
            <p className="mt-2">Not audience numbers: this is proof a sponsor was on screen, not how many people saw it.</p>
            <p className="mt-2">Sponsor slots that came up with nothing to show (no campaign for that place, or a limit reached): <span className="font-medium text-text tabular">{r.data.totals.skippedOrEmpty}</span>. These are normal: automation asks for a sponsor at every chance, and most chances are passed over on purpose.</p>
          </details>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {group('By campaign', 'Campaign', named(r.data.byCampaign))}
            {group('By artwork', 'Artwork', named(r.data.byCreative))}
            {group('By match', 'Match', r.data.byMatch.map((x) => ({ ...x, id: x.matchId, name: <><Link href={`/app/matches/${x.matchId}`} className="hover:underline">{x.key}</Link><span className="block text-xs text-muted">{day(x.scheduledAt)}</span></> })))}
            {group('By output', 'Output', r.data.byOutput.map((x) => ({ ...x, id: x.overlayId, name: <>{x.key}<span className="block text-xs text-muted">{x.match} · {day(x.scheduledAt)}</span></> })))}
          </div>
          <Card className="p-3">
            <h2 className="mb-2 text-sm font-medium">Occurrences</h2>
            <Table>
              <thead><tr><th>First shown</th><th>Match and output</th><th>Sponsor artwork</th><th>Where</th><th>Confirmed by</th><th className="text-right">Seconds</th><th>Ended because</th></tr></thead>
              <tbody>{r.data.occurrences.slice(-200).reverse().map((o) => (
                <tr key={o.exposureId}><td className="text-xs">{fmtDate(o.firstVisibleAt, tz, { dateStyle: 'short', timeStyle: 'medium' })}</td><td>{o.matchLabel}<span className="block text-xs text-muted">{o.output}</span></td><td>{o.brand} · {o.creative}</td><td className="text-xs">{placementLabel(o.placement)}</td><td><StatusPill tone={o.evidenceType === 'compositor' ? 'healthy' : 'neutral'}>{o.evidenceType === 'compositor' ? 'cloud programme' : 'OBS output'}</StatusPill></td><td className="text-right">{o.confirmedSeconds}{o.uncertaintySeconds ? ` (±${o.uncertaintySeconds})` : ''}</td><td className="text-xs">{o.closeReason.replace(/_/g, ' ')}</td></tr>
              ))}</tbody>
            </Table>
          </Card>
          {r.data.skipped.length ? (
            <Card className="p-3"><h2 className="mb-2 text-sm font-medium">Skipped (no eligible sponsor)</h2><ul className="space-y-0.5 text-xs text-muted">{r.data.skipped.slice(-50).reverse().map((s, i) => <li key={i}>{fmtDate(s.at, tz, { timeStyle: 'medium' })} · {placementLabel(s.placement)}: {s.reason}</li>)}</ul></Card>
          ) : null}
        </div>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" subtitle="What was on screen: sponsors for your partners, and every graphic for your own records." />
      <Tabs defaultValue="sponsors">
        <TabList className="mb-4"><Tab value="sponsors">Sponsor delivery</Tab><Tab value="airtime">Graphics on air</Tab></TabList>
        <TabPanel value="sponsors"><SponsorReport /></TabPanel>
        <TabPanel value="airtime"><AirtimeReport /></TabPanel>
      </Tabs>
    </>
  );
}
