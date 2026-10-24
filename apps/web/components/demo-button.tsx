'use client';
// "Start a demo match": a realistic match plays itself through the real scoring commands so a new
// organisation can see graphics, automation and the scorer app working within a minute.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlayCircle } from 'lucide-react';
import { Button, Dialog, ErrorNotice, Field, NativeSelect } from '@bs/ui';
import { post } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';

export function DemoButton({ competitionId, size = 'sm', variant = 'secondary' }: { competitionId?: string; size?: 'sm' | 'md'; variant?: 'secondary' | 'ghost' | 'primary' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const comps = useGet<{ id: string; name: string; sport: string }[]>(['competitions'], 'competitions');
  const [comp, setComp] = useState(competitionId ?? '');
  const [speed, setSpeed] = useState(4);
  const start = useAction(() => post<{ matchId: string }>('demo', { competitionId: comp || comps.data?.[0]?.id, speed }), [['matches']], { success: 'Demo match started. It is labelled Demo everywhere and left out of reports.' });
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}><PlayCircle className="size-4" /> Start a demo match</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Start a demo match" description="Two of your teams play a made-up match that scores itself. Open the scorer, the desk and the OBS link to watch everything move."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={start.isPending} disabled={!(comp || comps.data?.[0]?.id)} onClick={() => start.mutate(undefined, { onSuccess: (r) => { setOpen(false); router.push(`/app/matches/${r.matchId}`); } })}>Start</Button></>}>
        <div className="grid gap-3">
          <Field label="Competition" htmlFor="demo-c" hint="Needs an active season and two teams in the sport"><NativeSelect id="demo-c" value={comp || comps.data?.[0]?.id || ''} onChange={(e) => setComp(e.target.value)}>{comps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
          <Field label="Speed" htmlFor="demo-s"><NativeSelect id="demo-s" value={String(speed)} onChange={(e) => setSpeed(Number(e.target.value))}><option value="1">Real time</option><option value="2">2× faster</option><option value="4">4× faster (about 25 minutes)</option><option value="10">10× faster (about 10 minutes)</option><option value="20">20× faster</option></NativeSelect></Field>
          <ErrorNotice error={start.error} />
        </div>
      </Dialog>
    </>
  );
}
