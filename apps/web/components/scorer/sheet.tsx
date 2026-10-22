'use client';
// Pieces of the scorer's match screen: a team's crest, the icon of each event, the round badge in the middle of a
// row (half in each team's colour) and the mirrored rows of the sheet (the home team's half on the left, the away
// team's on the right, each with its count).
import type { ComponentType } from 'react';
import {
  ArrowLeftRight,
  Ban,
  ChartPie,
  CircleDot,
  CircleX,
  Crosshair,
  Flag,
  FlagTriangleRight,
  Footprints,
  Goal,
  Hand,
  MoveUpRight,
  Shield,
  Target,
  Timer,
  Trophy,
  Undo2,
  Zap,
} from 'lucide-react';
import { cx } from '@bs/ui';

export interface SheetTeam { name: string; shortName: string; abbreviation: string; primaryColor: string; logoAssetId?: string | null }
type Side = 'home' | 'away';

/** The team's logo, or its initials on its colour when it has none. */
export function TeamCrest({ team, size = 44, className }: { team: SheetTeam; size?: number; className?: string }) {
  if (team.logoAssetId) return <img src={`/api/v1/assets/${team.logoAssetId}/preview`} alt={`${team.name} logo`} width={size} height={size} className={cx('shrink-0 object-contain', className)} style={{ width: size, height: size }} />;
  return (
    <span aria-hidden className={cx('scorer-display grid shrink-0 place-items-center rounded-full font-bold text-white', className)} style={{ width: size, height: size, background: team.primaryColor, fontSize: size * 0.34 }}>
      {team.abbreviation.slice(0, 3)}
    </span>
  );
}

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  goal: Goal,
  try: Trophy,
  penalty_try: Trophy,
  conversion: Target,
  penalty_goal: Target,
  field_goal: Target,
  behind: Goal,
  rushed_behind: Goal,
  shot_on_target: Crosshair,
  shot_off_target: MoveUpRight,
  shot: Crosshair,
  save: Hand,
  corner: Flag,
  penalty_corner: Flag,
  circle_entry: CircleDot,
  foul: Footprints,
  free_kick: Footprints,
  penalty_conceded: Footprints,
  penalty: Footprints,
  offside: FlagTriangleRight,
  penalty_scored: Target,
  ten_metre_scored: Target,
  penalty_missed: CircleX,
  ten_metre_missed: CircleX,
  penalty_stroke_missed: CircleX,
  conversion_missed: CircleX,
  goal_missed: CircleX,
  substitution: ArrowLeftRight,
  interchange: ArrowLeftRight,
  own_goal: Undo2,
  timeout: Timer,
  possession_change: ChartPie,
  line_break: Zap,
  six_again: Zap,
  error: Ban,
  mark: Hand,
  tackle: Shield,
  inside_50: MoveUpRight,
  clearance: MoveUpRight,
  intercept: Hand,
  rebound: CircleDot,
  turnover: ArrowLeftRight,
  centre_pass: CircleDot,
};

export function EventIcon({ type, className }: { type: string; className?: string }) {
  const I = ICONS[type] ?? CircleDot;
  return <I className={className} />;
}

export const CARD_COLOUR: Record<string, string> = { yellow_card: '#F5C518', second_yellow: '#F5C518', green_card: '#2EA043', red_card: '#E5484D', sin_bin: '#F5C518', send_off: '#E5484D' };

/** The round badge between the two halves of a row: the left half in the home colour, the right in the away. */
export function CentreBadge({ home, away, children }: { home: string; away: string; children: React.ReactNode }) {
  return (
    <span aria-hidden className="relative grid size-[52px] shrink-0 place-items-center rounded-full p-[3px]" style={{ background: `linear-gradient(90deg, ${home} 50%, ${away} 50%)` }}>
      <span className="grid size-full place-items-center rounded-full text-[var(--sc-ink)]" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${home} 18%, white) 50%, color-mix(in srgb, ${away} 18%, white) 50%)` }}>
        {children}
      </span>
    </span>
  );
}

/** One half of a row: the label at the outside edge, the count next to the badge. */
export function HalfCell({ side, label, count, team, disabled, onTap, active, eventType, testLabel, compact }: { side: Side; label: string; count: string | number; team: SheetTeam; disabled?: boolean; onTap: () => void; active?: boolean; eventType: string; testLabel: string; compact?: boolean }) {
  const zero = count === 0 || count === '–' || count === '0%';
  return (
    <button
      type="button"
      data-side={side}
      data-event={eventType}
      aria-label={testLabel}
      aria-pressed={active}
      disabled={disabled}
      onClick={onTap}
      className={cx(
        'relative flex min-h-[68px] min-w-0 flex-1 items-center gap-2 px-3 transition-colors enabled:active:bg-[var(--sc-press)] disabled:opacity-40',
        side === 'home' ? 'flex-row justify-between pl-4 text-left' : 'flex-row-reverse justify-between pr-4 text-right',
      )}
      style={active ? { background: `color-mix(in srgb, ${team.primaryColor} 16%, white)` } : undefined}
    >
      <span className={cx('scorer-display min-w-0 font-semibold leading-tight text-[var(--sc-ink)]', compact ? 'text-[13px]' : 'text-[15px]')}>{label}</span>
      <span className={cx('scorer-display shrink-0 font-bold italic leading-none tabular', compact ? 'text-[30px]' : 'text-[42px]', zero ? 'text-[var(--sc-faint)]' : 'text-[var(--sc-ink)]')}>{count}</span>
    </button>
  );
}

/** A row of the sheet: a home half, the badge, an away half. */
export function MirrorRow({ children, centre }: { children: [React.ReactNode, React.ReactNode]; centre: React.ReactNode }) {
  return (
    <div role="group" className="flex items-stretch border-b border-[var(--sc-line)]">
      {children[0]}
      <span className="flex items-center">{centre}</span>
      {children[1]}
    </div>
  );
}
