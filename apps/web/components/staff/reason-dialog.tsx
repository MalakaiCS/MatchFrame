'use client';
// A staff action that needs a reason (suspend, disable, take down): the reason goes into the staff log and the
// organisation's own audit log.
import { useState } from 'react';
import { Button, Dialog, ErrorNotice, Field, Input } from '@bs/ui';
import type { ApiError } from '@/lib/api';

export function ReasonButton({ label, title, description, confirm, danger, optional, onConfirm, size = 'sm', children }: {
  label: string;
  title: string;
  description: React.ReactNode;
  confirm: string;
  danger?: boolean;
  /** a reason may be left out (e.g. reactivating) */
  optional?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
  size?: 'sm' | 'md';
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const ok = optional || reason.trim().length >= 3;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      setReason('');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size={size} variant={danger ? 'danger' : 'secondary'} onClick={() => setOpen(true)}>{children ?? label}</Button>
      <Dialog
        open={open}
        onOpenChange={(o) => { setOpen(o); setErr(null); }}
        title={title}
        description={description}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!ok} onClick={() => void go()}>{confirm}</Button></>}
      >
        <Field label={optional ? 'Reason (optional)' : 'Reason'} htmlFor="staff-reason" hint="Kept in the staff log and in the organisation's activity.">
          <Input id="staff-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={optional ? '' : 'Why this is being done'} />
        </Field>
        <ErrorNotice error={err} />
      </Dialog>
    </>
  );
}
