'use client';
// White-label: what the product calls itself and looks like for this organisation, and the custom host that
// resolves to it (graphics.yourclub.org). Public pages read the same branding by host.
import { useEffect, useState } from 'react';
import { Button, Card, ErrorNotice, Field, Input, Spinner, Switch } from '@bs/ui';
import { patch } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { LogoField } from '@/components/logo-field';

interface Org { id: string; name: string; customDomain: string | null; branding: { productName?: string | null; logoAssetId?: string | null; primaryColor?: string | null; accentColor?: string | null; supportEmail?: string | null; hideVendor?: boolean } | null }

export function BrandingPanel({ owner, admin }: { owner: boolean; admin: boolean }) {
  const org = useGet<Org>(['org'], 'organisations/current');
  const [b, setB] = useState<NonNullable<Org['branding']>>({});
  const [domain, setDomain] = useState('');
  useEffect(() => {
    if (org.data) {
      setB(org.data.branding ?? {});
      setDomain(org.data.customDomain ?? '');
    }
  }, [org.data]);
  const save = useAction(() => patch('organisations/current', { branding: { productName: b.productName || null, logoAssetId: b.logoAssetId || null, primaryColor: b.primaryColor || null, accentColor: b.accentColor || null, supportEmail: b.supportEmail || null, hideVendor: !!b.hideVendor } }), [['org'], ['me']], { success: 'Branding saved. Reload to see it in the app.' });
  const saveDomain = useAction(() => patch('organisations/current', { customDomain: domain.trim() || null }), [['org']], { success: 'Custom domain saved' });
  if (org.isLoading) return <Spinner />;
  const canEdit = admin;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-1 font-medium">Your brand</h2>
        <p className="mb-3 text-xs text-muted">Shown in the app header, on sign-in and on the public match centre for this organisation.</p>
        <div className="grid gap-3">
          <Field label="Product name" htmlFor="b-name" hint="Replaces the product name in menus and emails"><Input id="b-name" disabled={!canEdit} value={b.productName ?? ''} onChange={(e) => setB({ ...b, productName: e.target.value })} placeholder="e.g. Harbour League TV" /></Field>
          <LogoField label="Organisation logo" value={b.logoAssetId ?? null} disabled={!canEdit} onChange={(v) => setB({ ...b, logoAssetId: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary colour" htmlFor="b-p"><div className="flex items-center gap-2"><input id="b-p" type="color" disabled={!canEdit} className="size-9 rounded border border-border bg-bg" value={b.primaryColor ?? '#3ea6ff'} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} /><Input aria-label="Primary colour hex" disabled={!canEdit} value={b.primaryColor ?? ''} placeholder="#3ea6ff" onChange={(e) => setB({ ...b, primaryColor: e.target.value || null })} /></div></Field>
            <Field label="Accent colour" htmlFor="b-a"><div className="flex items-center gap-2"><input id="b-a" type="color" disabled={!canEdit} className="size-9 rounded border border-border bg-bg" value={b.accentColor ?? '#45d6e8'} onChange={(e) => setB({ ...b, accentColor: e.target.value })} /><Input aria-label="Accent colour hex" disabled={!canEdit} value={b.accentColor ?? ''} placeholder="#45d6e8" onChange={(e) => setB({ ...b, accentColor: e.target.value || null })} /></div></Field>
          </div>
          <Field label="Support email" htmlFor="b-s" hint="Shown to your members when something needs a human" error={save.error?.fieldError('supportEmail')}><Input id="b-s" type="email" disabled={!canEdit} value={b.supportEmail ?? ''} onChange={(e) => setB({ ...b, supportEmail: e.target.value })} /></Field>
          <Switch label="Hide the vendor name on public pages" checked={!!b.hideVendor} disabled={!canEdit} onCheckedChange={(v) => setB({ ...b, hideVendor: v })} />
          {canEdit ? <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save branding</Button> : null}
          <ErrorNotice error={save.error && !save.error.fields ? save.error : null} />
        </div>
      </Card>
      <Card className="p-4">
        <h2 className="mb-1 font-medium">Custom domain</h2>
        <p className="mb-3 text-xs text-muted">Point a host name at this installation and it opens straight into your organisation with your branding. Owners only.</p>
        <Field label="Host name" htmlFor="b-d" error={saveDomain.error?.fieldError('customDomain')}><Input id="b-d" disabled={!owner} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="graphics.yourclub.org" /></Field>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>Create a CNAME record for the host pointing at this installation's address.</li>
          <li>Have the installation's reverse proxy or hosting platform accept the host and issue its certificate.</li>
          <li>Save the host here. Sign-in and the public match centre then carry your branding on that host.</li>
        </ol>
        {owner ? <Button className="mt-3" loading={saveDomain.isPending} onClick={() => saveDomain.mutate(undefined)}>Save domain</Button> : null}
        <ErrorNotice error={saveDomain.error && !saveDomain.error.fields ? saveDomain.error : null} />
      </Card>
    </div>
  );
}
