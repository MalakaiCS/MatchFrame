'use client';
// The desk header's one status pill (the thing that matters most right now, with both details on hover) and its
// More menu, which keeps the less used tools (export, keyboard shortcuts) out of the way.
import * as DM from '@radix-ui/react-dropdown-menu';
import { Download, Keyboard, MoreHorizontal } from 'lucide-react';
import { Kbd, StatusPill, type Tone } from '@bs/ui';

type Conn = 'connecting' | 'connected' | 'disconnected';

/** Offline beats OBS missing beats OBS behind; when all is well, OBS is showing the latest. */
export function deskStatus(conn: Conn, obsConnected: boolean, behind: boolean): { tone: Tone; text: string; detail: string } {
  const live = conn === 'connected' ? 'Live updates on' : conn === 'connecting' ? 'Reconnecting to live updates' : 'Live updates lost';
  const obs = !obsConnected ? 'OBS is not showing this output' : behind ? 'OBS has not shown the latest change yet' : 'OBS is showing the latest';
  const detail = `${live}. ${obs}.`;
  if (conn !== 'connected') return { tone: conn === 'connecting' ? 'warning' : 'offline', text: conn === 'connecting' ? 'Reconnecting' : 'Offline', detail };
  if (!obsConnected) return { tone: 'offline', text: 'OBS not connected', detail };
  if (behind) return { tone: 'warning', text: 'OBS catching up', detail };
  return { tone: 'healthy', text: 'OBS showing the latest', detail };
}

export function DeskStatus({ conn, obsConnected, behind }: { conn: Conn; obsConnected: boolean; behind: boolean }) {
  const s = deskStatus(conn, obsConnected, behind);
  return (
    <span title={s.detail} data-testid="desk-status">
      <StatusPill tone={s.tone}>{s.text}</StatusPill>
      <span className="sr-only"> ({s.detail})</span>
    </span>
  );
}

const item = 'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-elevated';

export function DeskMenu({ onExport, onShortcuts }: { onExport: () => void; onShortcuts: () => void }) {
  return (
    // not modal: the dialogs it opens get the focus, not the menu's trigger
    <DM.Root modal={false}>
      <DM.Trigger className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted hover:bg-elevated hover:text-text" aria-label="More">
        <MoreHorizontal className="size-4" aria-hidden /><span className="hidden sm:inline">More</span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 min-w-60 rounded-xl border border-border bg-panel p-1.5 text-sm shadow-pop">
          <DM.Item onSelect={onExport} className={item}><Download className="size-4" aria-hidden /> Export a graphic</DM.Item>
          <DM.Item onSelect={onShortcuts} className={item}><Keyboard className="size-4" aria-hidden /> Keyboard shortcuts <span className="ml-auto"><Kbd>?</Kbd></span></DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
