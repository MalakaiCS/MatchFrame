import type { Metadata } from 'next';
import { StaffShell } from '@/components/staff/staff-shell';

export const metadata: Metadata = { title: 'Staff console' };

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell>{children}</StaffShell>;
}
