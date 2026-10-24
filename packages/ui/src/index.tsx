'use client';
// Shared accessible primitives on Radix + Tailwind tokens. Status never relies on colour alone.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import * as DialogP from '@radix-ui/react-dialog';
import * as TabsP from '@radix-ui/react-tabs';
import * as SwitchP from '@radix-ui/react-switch';
import * as TooltipP from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, CircleDot, Loader2, Radio, WifiOff, X } from 'lucide-react';

export const cx = clsx;

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live';
const btn: Record<BtnVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-strong font-semibold shadow-sm',
  secondary: 'bg-panel text-text border border-border hover:border-border-strong hover:bg-elevated font-medium',
  ghost: 'text-muted hover:text-text hover:bg-elevated font-medium',
  danger: 'bg-live/10 text-live border border-live/50 hover:bg-live/20 font-semibold',
  live: 'bg-live text-white hover:brightness-110 font-semibold shadow-sm',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg' | 'touch';
  loading?: boolean;
  asChild?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, asChild, className, children, disabled, ...rest },
  ref,
) {
  const sz = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-11 px-5 text-[15px]', touch: 'min-h-14 px-4 text-lg' }[size];
  const cls = cx('inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary', btn[variant], sz, className);
  if (asChild) {
    // Slot needs exactly one child element (e.g. a Link); no spinner sibling.
    return (
      <Slot ref={ref} className={cls} {...rest}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      ref={ref}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

/** Text fields and selects: a clear edge, a stronger one on hover, the accent and a soft ring on focus. */
const FIELD = 'w-full rounded-lg bg-bg border text-sm text-text placeholder:text-muted/70 transition-colors hover:border-border-strong focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-60';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(FIELD, 'h-10 px-3', invalid ? 'border-live' : 'border-border', className)}
      {...rest}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(FIELD, 'border-border px-3 py-2', className)} {...rest} />;
});

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function NativeSelect({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(FIELD, 'h-10 border-border px-2.5', className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, error, hint, children, htmlFor, className }: { label: string; error?: string | null; hint?: string; children: React.ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-live" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-[var(--radius-card)] bg-panel border border-border shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; crumbs?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs ? <div className="mb-1.5 text-xs text-muted">{crumbs}</div> : null}
        <h1 className="font-brand text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export type Tone = 'neutral' | 'live' | 'warning' | 'healthy' | 'primary' | 'offline';
const tone: Record<Tone, string> = {
  neutral: 'bg-elevated text-muted border-border',
  live: 'bg-live/15 text-live border-live/50',
  warning: 'bg-warning/10 text-warning border-warning/50',
  healthy: 'bg-healthy/10 text-healthy border-healthy/50',
  primary: 'bg-primary/10 text-primary border-primary/50',
  offline: 'bg-bg text-muted border-border border-dashed',
};
const toneIcon: Record<Tone, React.ComponentType<{ className?: string }>> = {
  neutral: CircleDot,
  live: Radio,
  warning: AlertTriangle,
  healthy: CheckCircle2,
  primary: CircleDot,
  offline: WifiOff,
};

/** Status pill: icon + text + colour (colour alone is never the only signal). */
export function StatusPill({ tone: t = 'neutral', children, className, icon = true }: { tone?: Tone; children: React.ReactNode; className?: string; icon?: boolean }) {
  const I = toneIcon[t];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', tone[t], className)}>
      {icon ? <I className="size-3" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </span>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border-strong/60 p-10 text-center">
      {icon}
      <p className="font-medium">{title}</p>
      {body ? <p className="max-w-md text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: { message?: string; code?: string; requestId?: string } | null | undefined; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-live/50 bg-live/10 px-3 py-2 text-sm text-live">
      <AlertTriangle className="size-4" aria-hidden />
      <span>{error.message ?? 'The request failed.'}</span>
      {error.requestId ? <span className="text-xs text-muted">Ref {error.requestId}</span> : null}
      {onRetry ? (
        <button className="ml-auto underline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Dialog({ open, onOpenChange, title, description, children, footer, wide, size }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; wide?: boolean; size?: 'md' | 'lg' | 'xl' }) {
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <DialogP.Content className={cx('fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-border bg-panel p-5 shadow-pop sm:p-6', size === 'xl' ? 'max-w-6xl' : wide || size === 'lg' ? 'max-w-3xl' : 'max-w-lg')}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <DialogP.Title className="text-lg font-semibold">{title}</DialogP.Title>
              {description ? <DialogP.Description className="mt-1 text-sm text-muted">{description}</DialogP.Description> : <DialogP.Description className="sr-only">{title}</DialogP.Description>}
            </div>
            <DialogP.Close className="rounded-lg p-1.5 text-muted hover:bg-elevated hover:text-text" aria-label="Close">
              <X className="size-4" />
            </DialogP.Close>
          </div>
          {children}
          {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

export const Tabs = TabsP.Root;
export function TabList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <TabsP.List className={cx('flex gap-1 relative overflow-x-auto border-b border-border', className)}>{children}</TabsP.List>;
}
export function Tab({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsP.Trigger value={value} className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted data-[state=active]:border-primary data-[state=active]:text-text hover:text-text">
      {children}
    </TabsP.Trigger>
  );
}
export const TabPanel = TabsP.Content;

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <SwitchP.Root checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="relative h-6 w-10 shrink-0 rounded-full border border-border-strong bg-elevated transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-50">
        <SwitchP.Thumb className="block size-[18px] translate-x-0.5 rounded-full bg-muted shadow transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-on-primary" />
      </SwitchP.Root>
      {label}
    </label>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('relative overflow-x-auto rounded-[var(--radius-card)] border border-border', className)}>
      <table className="w-full text-sm [&_th]:bg-elevated/70 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2">{children}</table>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

// ------------------------------------------------------------------ feedback

export interface ToastItem { id: number; message: string; kind: 'success' | 'error' | 'info' }
type ToastListener = (t: ToastItem) => void;
const toastListeners = new Set<ToastListener>();
let toastSeq = 0;

/** Short confirmation ("Lineup saved") shown by <Toaster/>. Safe to call anywhere; a no-op without a Toaster. */
export function toast(message: string, kind: ToastItem['kind'] = 'success') {
  const t = { id: ++toastSeq, message, kind };
  toastListeners.forEach((l) => l(t));
}

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  React.useEffect(() => {
    const l: ToastListener = (t) => {
      setItems((xs) => [...xs, t].slice(-4));
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6500 : 3200);
    };
    toastListeners.add(l);
    return () => void toastListeners.delete(l);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2" role="status" aria-live="polite">
      {items.map((t) => {
        const I = t.kind === 'error' ? AlertTriangle : t.kind === 'info' ? CircleDot : CheckCircle2;
        return (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-xl border bg-panel px-3.5 py-2.5 text-sm shadow-pop', t.kind === 'error' ? 'border-live/60 text-live' : t.kind === 'info' ? 'border-border text-text' : 'border-healthy/60 text-text')}>
            <I className={cx('mt-0.5 size-4 shrink-0', t.kind === 'success' && 'text-healthy')} aria-hidden />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A small "?" that explains a term on hover or focus. Needs the app's TooltipProvider. */
export function InfoTip({ text, label = 'What does this mean?' }: { text: React.ReactNode; label?: string }) {
  return (
    <TooltipP.Root>
      <TooltipP.Trigger asChild>
        <button type="button" aria-label={label} className="inline-grid size-5 shrink-0 place-items-center rounded-full border border-border text-[11px] font-semibold text-muted hover:border-primary hover:text-text">?</button>
      </TooltipP.Trigger>
      <TooltipP.Portal>
        <TooltipP.Content sideOffset={6} className="z-[70] max-w-xs rounded-lg border border-border bg-panel px-3 py-2 text-xs leading-relaxed text-text shadow-pop">
          {text}
          <TooltipP.Arrow className="fill-border" />
        </TooltipP.Content>
      </TooltipP.Portal>
    </TooltipP.Root>
  );
}

/** One line of a checklist: a tick or a to-do, a label, and the action that completes it. */
export function CheckRow({ done, label, detail, action }: { done: boolean; label: React.ReactNode; detail?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <span className={cx('grid size-6 shrink-0 place-items-center rounded-full border', done ? 'border-healthy bg-healthy/15 text-healthy' : 'border-border text-muted')} aria-hidden>
        {done ? <CheckCircle2 className="size-4" /> : <CircleDot className="size-3" />}
      </span>
      <span className="sr-only">{done ? 'Done:' : 'To do:'}</span>
      <div className="min-w-0 flex-1">
        <div className={cx('text-sm', done ? 'text-text' : 'font-medium')}>{label}</div>
        {detail ? <div className="text-xs text-muted">{detail}</div> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </li>
  );
}
