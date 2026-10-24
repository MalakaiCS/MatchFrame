'use client';
// Staff console: every account on the installation, searchable by email or name.
import Link from 'next/link';
import { useState } from 'react';
import { Button, EmptyState, ErrorNotice, Input, PageHeader, Spinner, StatusPill, Table } from '@bs/ui';
import { fmtDate, useGet } from '@/lib/hooks';

interface UserRow { id: string; name: string; email: string; emailVerified: boolean; twoFactorEnabled: boolean | null; disabledAt: string | null; createdAt: string; staffRole: string | null; organisations: number; lastActiveAt: string | null }

export default function StaffUsersPage() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const list = useGet<{ items: UserRow[]; total: number; pageSize: number }>(['staff', 'users', q, page], `staff/users?${new URLSearchParams({ ...(q ? { search: q } : {}), page: String(page) })}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Accounts" subtitle="Everyone who has signed up. Open an account to see its organisations, resend its verification email, sign it out or disable it." />
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setPage(0); setQ(search.trim()); }}>
        <Input aria-label="Search accounts" className="max-w-sm" placeholder="Email or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      <ErrorNotice error={list.error} />
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? <EmptyState title="No accounts found" /> : (
        <>
          <Table>
            <thead><tr><th>Account</th><th>Email verified</th><th>Two-step</th><th>Organisations</th><th>Last active</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((u) => (
                <tr key={u.id}>
                  <td><Link className="font-medium text-primary hover:underline" href={`/staff/users/${u.id}`}>{u.name}</Link><div className="text-xs text-muted">{u.email}</div></td>
                  <td>{u.emailVerified ? 'yes' : <StatusPill tone="warning">not yet</StatusPill>}</td>
                  <td>{u.twoFactorEnabled ? 'on' : 'off'}</td>
                  <td>{u.organisations}</td>
                  <td className="text-muted">{u.lastActiveAt ? fmtDate(u.lastActiveAt, 'UTC') : '—'}</td>
                  <td className="space-x-1 text-right">
                    {u.staffRole ? <StatusPill tone="primary" icon={false}>staff · {u.staffRole}</StatusPill> : null}
                    {u.disabledAt ? <StatusPill tone="live">disabled</StatusPill> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            {list.data.total} account{list.data.total === 1 ? '' : 's'} · page {page + 1} of {pages}
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </>
      )}
    </div>
  );
}
