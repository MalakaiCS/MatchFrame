'use client';
// The public match centre link and its JSON feed: created, rotated or switched off from the match page.
import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Globe } from 'lucide-react';
import { Button, Card, ErrorNotice, Input } from '@bs/ui';
import { post } from '@/lib/api';
import { useAction, useCopy } from '@/lib/hooks';

export function SharePanel({ matchId, publicToken, canEdit }: { matchId: string; publicToken: string | null; canEdit: boolean }) {
  const copy = useCopy();
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const share = useAction((action: 'create' | 'rotate' | 'disable') => post<{ token: string | null }>(`matches/${matchId}/share`, { action }), [['match', matchId]], {
    success: (r) => (r.token ? 'Match centre link ready' : 'Match centre link switched off'),
  });
  const url = publicToken && origin ? `${origin}/m/${publicToken}` : null;
  const feed = publicToken && origin ? `${origin}/api/v1/public/match/${publicToken}/feed.json` : null;
  return (
    <Card className="p-4">
      <h2 className="mb-1 flex items-center gap-2 font-medium"><Globe className="size-4 text-muted" /> Match centre for fans</h2>
      <p className="mb-3 text-xs text-muted">A public page with the live score, events, line-ups, statistics and the table, plus a JSON feed for club websites. No sign-in needed; anyone with the link can open it.</p>
      {url ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Input readOnly aria-label="Match centre link" value={url} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="primary" size="sm" onClick={() => void copy(url, 'Match centre link')}><Copy className="size-4" /> Copy</Button>
            <Button asChild variant="ghost" size="sm"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Open</a></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input readOnly aria-label="JSON feed" value={feed ?? ''} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" onClick={() => feed && void copy(feed, 'Feed link')}><Copy className="size-4" /> Copy feed</Button>
          </div>
          {canEdit ? (
            <p className="text-xs text-muted">
              Shared too widely? <button className="underline" onClick={() => confirm('Create a new match centre link? The old one stops working straight away.') && share.mutate('rotate')}>Create a new link</button> or <button className="underline" onClick={() => confirm('Switch the match centre off? The link stops working straight away.') && share.mutate('disable')}>switch it off</button>.
            </p>
          ) : null}
        </div>
      ) : canEdit ? (
        <Button size="sm" loading={share.isPending} onClick={() => share.mutate('create')}>Create the match centre link</Button>
      ) : <p className="text-sm text-muted">Not shared yet.</p>}
      <ErrorNotice error={share.error} />
    </Card>
  );
}
