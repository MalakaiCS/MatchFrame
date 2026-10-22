'use client';
// Sponsors: brands, creatives (approval), campaigns with allocations, caps and spacing.
import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Button, Card, Dialog, EmptyState, ErrorNotice, Field, InfoTip, Input, NativeSelect, PageHeader, Spinner, StatusPill, Table } from '@bs/ui';
import { PLACEMENTS, PRIORITIES, placementLabel } from '@/lib/labels';
import { PlacementThumb } from '@/components/sponsors/placement-thumb';
import { post, put } from '@/lib/api';
import { fmtDate, useAction, useGet } from '@/lib/hooks';
import { useMe } from '@/lib/session';
import { ImageField } from '@/components/logo-field';

interface Creative { id: string; name: string; kind: string; width: number | null; height: number | null; approvalStatus: string; assetState: string; url: string | null; expiresAt: string | null }
interface Brand { id: string; name: string; category: string | null; creativeSets: { id: string; name: string; creatives: Creative[] }[] }
interface Campaign { id: string; brandId: string; creativeSetId: string; name: string; startsAt: string; endsAt: string; priority: number; weight: number; totalCap: number | null; perMatchCap: number | null; minSpacingSeconds: number; status: string; allocations: { scopeType: string; scopeId: string | null; placement: string }[] }
const MANAGE = new Set(['owner', 'admin', 'producer']);

export default function SponsorsPage() {
  const me = useMe();
  const canManage = MANAGE.has(me.data?.role ?? '');
  const tz = me.data?.activeOrganisation?.timezone ?? 'UTC';
  const data = useGet<{ brands: Brand[]; campaigns: Campaign[] }>(['sponsors'], 'sponsors');
  const assets = useGet<{ id: string; name: string; kind: string; width: number | null; height: number | null; state: string }[]>(['assets'], 'assets');
  const comps = useGet<{ id: string; name: string }[]>(['competitions'], 'competitions');
  const [brandOpen, setBrandOpen] = useState(false);
  const [brand, setBrand] = useState({ name: '', category: '' });
  const addBrand = useAction(() => post('brands', { name: brand.name, category: brand.category || null }), [['sponsors']], { success: 'Brand added' });
  const [crOpen, setCrOpen] = useState<string | null>(null);
  const [cr, setCr] = useState({ assetId: '', name: '' });
  const addCreative = useAction(() => post('creatives', { creativeSetId: crOpen, ...cr }), [['sponsors']], { success: 'Creative added. Approve it before it can go to air.' });
  const approve = useAction(({ id, status }: { id: string; status: string }) => post(`creatives/${id}/approval`, { status }), [['sponsors']], { success: 'Approval updated' });
  const [camp, setCamp] = useState<Partial<Campaign> | null>(null);
  const saveCamp = useAction((c: Partial<Campaign>) => (c.id ? put(`campaigns/${c.id}`, c) : post('campaigns', c)), [['sponsors']], { success: 'Campaign saved' });
  const startCampaign = (b: Brand) => {
    const now = new Date();
    setCamp({ brandId: b.id, creativeSetId: b.creativeSets[0]?.id, name: `${b.name} partner`, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 90 * 86400_000).toISOString(), priority: 3, weight: 1, minSpacingSeconds: 60, totalCap: null, perMatchCap: null, allocations: [{ scopeType: 'organisation', scopeId: null, placement: 'scorebug_logo' }] });
  };

  return (
    <>
      <PageHeader title="Sponsors" subtitle="Sponsor logos and slates rotate into the graphics in the places you choose, with limits and spacing you set. Only approved artwork goes to air." actions={canManage ? <Button variant="primary" onClick={() => setBrandOpen(true)}><Plus className="size-4" /> New brand</Button> : null} />
      <ErrorNotice error={data.error} />
      {data.isLoading ? <Spinner /> : !data.data?.brands.length ? <EmptyState title="No sponsors yet" body="Add a brand, upload creatives in Assets, approve them and create a campaign." /> : (
        <div className="space-y-4">
          {data.data.brands.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="mb-2 flex items-center gap-2"><h2 className="text-lg font-semibold">{b.name}</h2>{b.category ? <StatusPill tone="neutral">{b.category}</StatusPill> : null}
                {canManage ? <div className="ml-auto flex gap-2"><Button size="sm" onClick={() => setCrOpen(b.creativeSets[0]?.id ?? null)}>Add creative</Button><Button size="sm" variant="secondary" onClick={() => startCampaign(b)}>New campaign</Button></div> : null}
              </div>
              <div className="flex flex-wrap gap-3">
                {b.creativeSets.flatMap((s) => s.creatives).map((c) => (
                  <div key={c.id} className="w-44 rounded border border-border p-2 text-xs">
                    <div className="grid h-20 place-items-center rounded bg-[repeating-conic-gradient(#1c2c43_0_25%,#131f32_0_50%)] bg-[length:16px_16px]">
                      {c.url && c.kind !== 'video' ? <img src={c.url} alt={c.name} className="max-h-16 max-w-full object-contain" /> : <span className="text-muted">{c.kind}</span>}
                    </div>
                    <div className="mt-1 truncate font-medium" title={c.name}>{c.name}</div>
                    <div className="text-muted">{c.width}×{c.height} · {c.kind}</div>
                    <div className="mt-1 flex items-center gap-1">
                      <StatusPill tone={c.approvalStatus === 'approved' ? 'healthy' : c.approvalStatus === 'rejected' ? 'offline' : 'warning'}>{c.approvalStatus}</StatusPill>
                      {canManage && c.approvalStatus !== 'approved' ? <Button size="sm" variant="ghost" aria-label={`Approve ${c.name}`} onClick={() => approve.mutate({ id: c.id, status: 'approved' })}><Check className="size-3" /></Button> : null}
                      {canManage && c.approvalStatus !== 'rejected' ? <Button size="sm" variant="ghost" aria-label={`Reject ${c.name}`} onClick={() => approve.mutate({ id: c.id, status: 'rejected' })}><X className="size-3" /></Button> : null}
                    </div>
                  </div>
                ))}
              </div>
              <Table className="mt-3">
                <thead><tr><th>Campaign</th><th>Runs</th><th>Priority</th><th>Limits</th><th>Where it appears</th><th /></tr></thead>
                <tbody>
                  {data.data!.campaigns.filter((c) => c.brandId === b.id).map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td className="text-xs">{fmtDate(c.startsAt, tz, { dateStyle: 'medium' })} – {fmtDate(c.endsAt, tz, { dateStyle: 'medium' })}{new Date(c.endsAt) < new Date() ? <StatusPill tone="offline" className="ml-1">ended</StatusPill> : null}</td>
                      <td className="text-xs">{PRIORITIES[c.priority] ?? c.priority}{c.weight > 1 ? ` · ${c.weight}× share` : ''}</td>
                      <td className="text-xs">{c.totalCap ? `${c.totalCap} in total` : 'No total limit'} · {c.perMatchCap ? `${c.perMatchCap} per match` : 'any number per match'} · at least {c.minSpacingSeconds}s apart</td>
                      <td className="text-xs"><ul className="grid gap-1">{c.allocations.map((a, i) => <li key={i} className="flex items-center gap-2"><PlacementThumb placement={a.placement} /><span>{placementLabel(a.placement)} · {a.scopeType === 'organisation' ? 'all matches' : (comps.data?.find((x) => x.id === a.scopeId)?.name ?? 'one competition')}</span></li>)}</ul></td>
                      <td>{canManage ? <Button size="sm" variant="ghost" onClick={() => setCamp(c)}>Edit</Button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={brandOpen} onOpenChange={setBrandOpen} title="New brand" footer={<Button variant="primary" disabled={!brand.name} onClick={async () => { await addBrand.mutateAsync(undefined as never); setBrandOpen(false); }}>Create</Button>}>
        <Field label="Name" htmlFor="b-name"><Input id="b-name" value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} /></Field>
        <Field label="Category (keeps rival brands apart, e.g. beverage)" htmlFor="b-cat"><Input id="b-cat" value={brand.category} onChange={(e) => setBrand({ ...brand, category: e.target.value })} /></Field>
        <ErrorNotice error={addBrand.error} />
      </Dialog>

      <Dialog open={!!crOpen} onOpenChange={(o) => !o && setCrOpen(null)} title="Add creative" description="Upload an image, or choose an image or video from the asset library. Creatives need approval before they can air." footer={<Button variant="primary" disabled={!cr.assetId || !cr.name} onClick={async () => { await addCreative.mutateAsync(undefined as never); setCrOpen(null); }}>Add</Button>}>
        <div className="mb-3"><ImageField label="Creative" kind="image" value={cr.assetId || null} onChange={(v) => { setCr({ assetId: v ?? '', name: cr.name || (v ? 'Sponsor creative' : '') }); void assets.refetch(); }} /></div>
        <Field label="Or choose a file" htmlFor="c-asset" hint="Videos are uploaded under Assets → Images, video & audio"><NativeSelect id="c-asset" value={cr.assetId} onChange={(e) => setCr({ assetId: e.target.value, name: cr.name || (assets.data?.find((a) => a.id === e.target.value)?.name ?? '') })}><option value="">Choose…</option>{assets.data?.filter((a) => ['image', 'logo', 'video'].includes(a.kind) && (a.state === 'READY' || a.id === cr.assetId)).map((a) => <option key={a.id} value={a.id}>{a.name}{a.width ? ` · ${a.width}×${a.height}` : ''}</option>)}</NativeSelect></Field>
        <Field label="Name" htmlFor="c-name"><Input id="c-name" value={cr.name} onChange={(e) => setCr({ ...cr, name: e.target.value })} /></Field>
        <ErrorNotice error={addCreative.error} />
      </Dialog>

      <Dialog wide open={!!camp} onOpenChange={(o) => !o && setCamp(null)} title={camp?.id ? 'Edit campaign' : 'New campaign'} footer={<Button variant="primary" onClick={async () => { await saveCamp.mutateAsync(camp!); setCamp(null); }}>Save</Button>}>
        {camp ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="cp-name"><Input id="cp-name" value={camp.name} onChange={(e) => setCamp({ ...camp, name: e.target.value })} /></Field>
            <Field label="Priority" htmlFor="cp-pri"><NativeSelect id="cp-pri" value={camp.priority} onChange={(e) => setCamp({ ...camp, priority: Number(e.target.value) })}>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>{p} · {PRIORITIES[p]}</option>)}</NativeSelect></Field>
            <Field label="Starts" htmlFor="cp-s"><Input id="cp-s" type="date" value={camp.startsAt?.slice(0, 10)} onChange={(e) => setCamp({ ...camp, startsAt: new Date(e.target.value).toISOString() })} /></Field>
            <Field label="Ends" htmlFor="cp-e"><Input id="cp-e" type="date" value={camp.endsAt?.slice(0, 10)} onChange={(e) => setCamp({ ...camp, endsAt: new Date(`${e.target.value}T23:59:59`).toISOString() })} /></Field>
            <Field label="Share of rotation" htmlFor="cp-w" hint="2 shows twice as often as a sponsor on 1"><Input id="cp-w" type="number" min={1} value={camp.weight} onChange={(e) => setCamp({ ...camp, weight: Number(e.target.value) || 1 })} /></Field>
            <Field label="At least this many seconds apart" htmlFor="cp-sp"><Input id="cp-sp" type="number" min={0} value={camp.minSpacingSeconds} onChange={(e) => setCamp({ ...camp, minSpacingSeconds: Number(e.target.value) || 0 })} /></Field>
            <Field label="Most times in total (blank = no limit)" htmlFor="cp-tc"><Input id="cp-tc" type="number" min={1} value={camp.totalCap ?? ''} onChange={(e) => setCamp({ ...camp, totalCap: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Most times per match (blank = no limit)" htmlFor="cp-mc"><Input id="cp-mc" type="number" min={1} value={camp.perMatchCap ?? ''} onChange={(e) => setCamp({ ...camp, perMatchCap: e.target.value ? Number(e.target.value) : null })} /></Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 flex items-center gap-2 text-sm font-medium">Where it appears <InfoTip text="Each row is one place in the graphics where this sponsor can show, and which matches it applies to." /></legend>
              {camp.allocations?.map((a, i) => (
                <div key={i} className="mb-1 flex items-center gap-2">
                  <PlacementThumb placement={a.placement} />
                  <NativeSelect aria-label="Placement" title={PLACEMENTS[a.placement]?.where} value={a.placement} onChange={(e) => setCamp({ ...camp, allocations: camp.allocations!.map((x, k) => (k === i ? { ...x, placement: e.target.value } : x)) })}>{Object.keys(PLACEMENTS).map((p) => <option key={p} value={p}>{placementLabel(p)}</option>)}</NativeSelect>
                  <NativeSelect aria-label="Scope" value={a.scopeType === 'competition' ? `competition:${a.scopeId}` : 'organisation'} onChange={(e) => { const [st, sid] = e.target.value.split(':'); setCamp({ ...camp, allocations: camp.allocations!.map((x, k) => (k === i ? { ...x, scopeType: st!, scopeId: sid ?? null } : x)) }); }}>
                    <option value="organisation">All matches</option>
                    {comps.data?.map((c) => <option key={c.id} value={`competition:${c.id}`}>{c.name}</option>)}
                  </NativeSelect>
                  <Button size="sm" variant="ghost" onClick={() => setCamp({ ...camp, allocations: camp.allocations!.filter((_, k) => k !== i) })}>Remove</Button>
                </div>
              ))}
              <Button size="sm" onClick={() => setCamp({ ...camp, allocations: [...(camp.allocations ?? []), { scopeType: 'organisation', scopeId: null, placement: 'lower_third_banner' }] })}>Add a place</Button>
            </fieldset>
            <div className="sm:col-span-2"><ErrorNotice error={saveCamp.error} /></div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
