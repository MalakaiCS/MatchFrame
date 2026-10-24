import { StatusPill } from '@bs/ui';

export function orgStatusPill(status: string) {
  return status === 'suspended' ? <StatusPill tone="live">suspended</StatusPill> : status === 'deleted' ? <StatusPill tone="offline">deleted</StatusPill> : <StatusPill tone="healthy">active</StatusPill>;
}
