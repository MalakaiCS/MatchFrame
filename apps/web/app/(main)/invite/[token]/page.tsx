'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorNotice } from '@bs/ui';
import { AuthCard } from '@/components/auth-card';
import { ApiError, post } from '@/lib/api';
import { useMe } from '@/lib/session';

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.isLoading) return <AuthCard title="Invitation">{null}</AuthCard>;
  if (!me.data)
    return (
      <AuthCard title="You have been invited" subtitle="Log in or create an account with the email address the invitation was sent to.">
        <div className="flex gap-2">
          <Link className="rounded-md bg-primary px-4 py-2 font-semibold text-bg" href={`/login?next=/invite/${token}`}>Log in</Link>
          <Link className="rounded-md border border-border px-4 py-2" href="/register">Create account</Link>
        </div>
      </AuthCard>
    );
  async function accept() {
    setBusy(true);
    try {
      const r = await post<{ role: string }>('invitations/accept', { token });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(r.role === 'scorer' ? '/score' : '/app');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Accept invitation" subtitle={`Signed in as ${me.data.user.email}`}>
      <ErrorNotice error={err} />
      <Button variant="primary" className="mt-3 w-full" onClick={accept} loading={busy}>Join organisation</Button>
    </AuthCard>
  );
}
