'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth-card';

function Verify() {
  const q = useSearchParams();
  const error = q.get('error');
  if (error)
    return (
      <AuthCard title="Link not valid" subtitle="This verification link is invalid or has expired.">
        <p className="text-sm text-muted">Log in with your email and password to request a new link.</p>
        <Link href="/login" className="mt-4 inline-block text-primary">Go to log in</Link>
      </AuthCard>
    );
  return (
    <AuthCard title="Email verified" subtitle="Your account is ready.">
      <Link href="/onboarding" className="inline-block rounded-md bg-primary px-4 py-2 font-semibold text-bg">Continue</Link>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
