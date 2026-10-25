'use client';
// The light/dark switch. `icon`: one button that flips between light and dark (site header, app top bar).
// `choice`: Light / Dark / System as a radio group (account menu, settings, mobile menu).
import { Monitor, Moon, Sun } from 'lucide-react';
import { cx } from '@bs/ui';
import { useTheme, type ThemeChoice } from '@/lib/theme';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setChoice } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setChoice(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={cx('inline-grid size-10 place-items-center rounded-lg text-muted transition hover:bg-elevated hover:text-text', className)}
    >
      {/* both icons are drawn and the theme picks one, so the server markup matches whatever the page loads in */}
      <Sun className="size-[18px] light:hidden" aria-hidden />
      <Moon className="hidden size-[18px] light:block" aria-hidden />
    </button>
  );
}

const CHOICES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeChoices({ className }: { className?: string }) {
  const { choice, setChoice } = useTheme();
  // a radio group: one tab stop, arrow keys move the choice
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = (CHOICES.findIndex((c) => c.value === choice) + step + CHOICES.length) % CHOICES.length;
    setChoice(CHOICES[i]!.value);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Appearance" onKeyDown={onKey} className={cx('inline-flex rounded-lg border border-border bg-bg p-0.5', className)}>
      {CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={choice === c.value}
          tabIndex={choice === c.value ? 0 : -1}
          onClick={() => setChoice(c.value)}
          className={cx('inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition', choice === c.value ? 'bg-panel text-text shadow-card ring-1 ring-primary/50' : 'text-muted hover:text-text')}
        >
          <c.icon className="size-3.5" aria-hidden />
          {c.label}
        </button>
      ))}
    </div>
  );
}
