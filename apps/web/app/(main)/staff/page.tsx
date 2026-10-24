'use client';
// Staff console: every organisation on the installation, searchable by name or an owner's email.
import Link from 'next/link';
import { useState } from 'react';
import { Button, EmptyState, ErrorNotice, Input, NativeSelect, PageHeader, Spinner, Table } from '@bs/ui';
import { orgStatusPill } from '@/components/staff/pills';
import { fmtDate, useGet } from '@/lib/hooks';

interface OrgRow { id: string; name: string; slug: string; status: string; plan: string | null; staffPlan: string | null; planEndsAt: string | null; members: number; owners: string | null; createdAt: string }

export default function StaffOrganisationsPage() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const params = new URLSearchParams({ ...(q ? { search: q } : {}), ...(status ? { status } : {}), page: String(page) });
  const list = useGet<{ items: OrgRow[]; total: number; pageSize: number }>(['staff', 'organisations', q, status, page], `staff/organisations?${params}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Organisations" subtitle="Every organisation on this installation. Open one to see its members, usage, public content and activity." />
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setPage(0); setQ(search.trim()); }}>
        <Input aria-label="Search organisations" className="max-w-sm" placeholder="Name, address or an owner's email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Status" className="w-auto" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deleted">Deleted</option>
        </NativeSelect>
        <Button type="submit">Search</Button>
      </form>
      <ErrorNotice error={list.error} />
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? (
        <EmptyState title="No organisations found" body={q ? 'Try part of the name or the owner’s email address.' : undefined} />
      ) : (
        <>
          <Table>
            <thead><tr><th>Organisation</th><th>Owners</th><th>Members</th><th>Plan</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {list.data.items.map((o) => (
                <tr key={o.id}>
                  <td><Link className="font-medium text-primary hover:underline" href={`/staff/organisations/${o.id}`}>{o.name}</Link><div className="text-xs text-muted">{o.slug}</div></td>
                  <td className="max-w-64 truncate text-muted">{o.owners ?? '—'}</td>
                  <td>{o.members}</td>
                  <td>
                    {o.plan ?? 'free'}
                    {o.staffPlan ? <span className="block text-xs text-muted">{o.planEndsAt ? `staff plan until ${new Date(o.planEndsAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'staff plan, permanent'}</span> : null}
                  </td>
                  <td>{orgStatusPill(o.status)}</td>
                  <td className="text-muted">{fmtDate(o.createdAt, 'UTC', { dateStyle: 'medium' })}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            {list.data.total} organisation{list.data.total === 1 ? '' : 's'} · page {page + 1} of {pages}
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </>
      )}
    </div>
  );
}
