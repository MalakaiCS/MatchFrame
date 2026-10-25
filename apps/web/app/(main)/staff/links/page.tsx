'use client';
// Staff console (Moderator and above): someone reports a public link; find whose it is and take it down.
import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, ErrorNotice, Field, Input, PageHeader, StatusPill } from '@bs/ui';
import { post } from '@/lib/api';
import { fmtDate, useAction } from '@/lib/hooks';
import { ReasonButton } from '@/components/staff/reason-dialog';

type Hit =
  | { kind: 'match_page'; organisation: { id: string; name: string; status: string }; match: { id: string; title: string; scheduledAt: string } }
  | { kind: 'share_link'; organisation: { id: string; name: string; status: string }; shareLink: { id: string; resourceType: string; expiresAt: string | null; revoked: boolean } };

export default function StaffLinksPage() {
  const [url, setUrl] = useState('');
  const [hit, setHit] = useState<Hit | null>(null);
  const [done, setDone] = useState(false);
  const lookup = useAction((u: string) => post<Hit>('staff/public-links/lookup', { url: u }));
  const down = useAction((x: { path: string; reason: string }) => post(`staff/organisations/${hit!.organisation.id}/${x.path}`, { reason: x.reason }), [['staff', 'organisation', hit?.organisation.id ?? '']], { success: 'Taken down' });
  const find = () => {
    setDone(false);
    setHit(null);
    lookup.mutate(url.trim(), { onSuccess: (h) => setHit(h) });
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Public links" subtitle="Paste a reported link: a public match page (…/m/…) or a media share (…/watch/… or …/embed/…). You see whose it is and can take it down." />
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); find(); }}>
        <Field label="Reported link" htmlFor="staff-link" className="min-w-0 flex-1">
          <Input id="staff-link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/m/…" />
        </Field>
        <Button type="submit" variant="primary" loading={lookup.isPending} disabled={url.trim().length < 3}>Look up</Button>
      </form>
      <ErrorNotice error={lookup.error ?? down.error} />
      {hit ? (
        <Card className="mt-4 p-4" aria-label="Link found">
          <div className="mb-2 text-sm text-muted">Belongs to <Link className="text-primary hover:underline" href={`/staff/organisations/${hit.organisation.id}`}>{hit.organisation.name}</Link>{hit.organisation.status !== 'active' ? ` (${hit.organisation.status})` : ''}</div>
          {hit.kind === 'match_page' ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><div className="font-medium">Public match page: {hit.match.title}</div><div className="text-sm text-muted">{fmtDate(hit.match.scheduledAt, 'UTC')}</div></div>
              {done ? <StatusPill tone="healthy">taken down</StatusPill> : <ReasonButton label="Take down" danger title={`Take down ${hit.match.title}`} description="The match's public page and its data feed stop working. The organisation can share the match again with a new link." confirm="Take down" onConfirm={async (reason) => { await down.mutateAsync({ path: `match-pages/${hit.match.id}/take-down`, reason }); setDone(true); }} />}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><div className="font-medium">Media share link ({hit.shareLink.resourceType})</div><div className="text-sm text-muted">{hit.shareLink.revoked ? 'already revoked' : hit.shareLink.expiresAt ? `expires ${fmtDate(hit.shareLink.expiresAt, 'UTC')}` : 'does not expire'}</div></div>
              {done || hit.shareLink.revoked ? <StatusPill tone="healthy">revoked</StatusPill> : <ReasonButton label="Revoke" danger title="Revoke this share link" description="Anyone with the link can no longer watch or embed it." confirm="Revoke" onConfirm={async (reason) => { await down.mutateAsync({ path: `share-links/${hit.shareLink.id}/revoke`, reason }); setDone(true); }} />}
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
