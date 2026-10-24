'use client';
// Pieces of the scorer's match screen, in MatchFrame's console style: the scoreboard (each team in its own block
// with its colour down the outside edge and the period and clock between them), a team's crest, the icon of each
// event, the event pad's tiles (one per team and event: the event, its count, the team's colour down the edge) and
// the possession bar (the split so far, and a button for each team).
import type { ComponentType, ReactNode } from 'react';
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
  Video,
  Zap,
} from 'lucide-react';
import { cx } from '@bs/ui';

export interface SheetTeam { name: string; shortName: string; abbreviation: string; primaryColor: string; logoAssetId?: string | null }
type Side = 'home' | 'away';

/** The team's logo, or its letters on its colour when it has none. */
export function TeamCrest({ team, size = 36, className }: { team: SheetTeam; size?: number; className?: string }) {
  if (team.logoAssetId) return <img src={`/api/v1/assets/${team.logoAssetId}/preview`} alt={`${team.name} logo`} width={size} height={size} className={cx('shrink-0 object-contain', className)} style={{ width: size, height: size }} />;
  return (
    <span aria-hidden className={cx('grid shrink-0 place-items-center rounded-md font-bold text-white', className)} style={{ width: size, height: size, background: team.primaryColor, fontSize: size * 0.32 }}>
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
  video_review: Video,
};

export function EventIcon({ type, className }: { type: string; className?: string }) {
  const I = ICONS[type] ?? CircleDot;
  return <I className={className} />;
}

export const CARD_COLOUR: Record<string, string> = { yellow_card: '#F5C518', second_yellow: '#F5C518', green_card: '#2EA043', red_card: '#E5484D', sin_bin: '#F5C518', send_off: '#E5484D' };

/** A card's shape in its colour, for the discipline tiles. */
export function CardGlyph({ type }: { type: string }) {
  return <span aria-hidden className="inline-block h-4 w-3 shrink-0 rounded-[2px] shadow-sm" style={{ background: CARD_COLOUR[type] ?? '#888' }} />;
}

/**
 * One team's tile for an event: the team's colour down its left edge, the event's icon and name, and the count.
 * Scoring tiles are filled with the team's colour. Its name reads "Corner, Harbour: 2" (the tests read the count from it).
 */
export function PadTile({ side, eventType, team, label, count, icon, active, disabled, onTap, testLabel, strong }: { side: Side; eventType: string; team: SheetTeam; label: string; count: string | number; icon?: ReactNode; active?: boolean; disabled?: boolean; onTap: () => void; testLabel: string; strong?: boolean }) {
  const zero = count === 0 || count === '–';
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
        'relative flex min-h-[58px] min-w-0 items-center gap-2.5 overflow-hidden rounded-xl border pl-4 pr-3 text-left transition-[background-color,transform] enabled:active:scale-[0.98] disabled:opacity-40',
        strong ? 'min-h-[68px] border-transparent text-white' : 'border-border bg-panel enabled:active:bg-elevated',
        active && 'ring-2 ring-primary',
      )}
      style={strong ? { background: `linear-gradient(135deg, ${team.primaryColor}, color-mix(in srgb, ${team.primaryColor} 70%, black))` } : undefined}
    >
      {strong ? null : <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: team.primaryColor }} />}
      {icon ? <span aria-hidden className={cx('shrink-0', strong ? 'text-white/85' : 'text-muted')}>{icon}</span> : null}
      <span className={cx('min-w-0 flex-1 font-semibold leading-tight', strong ? 'text-[15px]' : 'text-[14px]')}>{label}</span>
      <span className={cx('shrink-0 font-bold leading-none tabular', strong ? 'text-[30px]' : 'text-[24px]', !strong && zero && 'text-muted/40')}>{count}</span>
    </button>
  );
}

/** A section of the pad: its name, then a tile for each team side by side, row by row (a group, so its name never
 * clashes with the screen's regions: the pad's Score is not the scoreboard). */
export function PadSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="px-3 pt-4">
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
        {title}
        <span aria-hidden className="h-px flex-1 bg-border" />
      </h3>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

/**
 * Who has had the ball: the split so far as one bar in the teams' colours, and a button for each team underneath
 * (the team with the ball is marked). Each button's name reads "Possession, Harbour: 31%".
 */
export function PossessionBar({ teams, share, has, disabled, onTap, testLabel }: { teams: Record<Side, SheetTeam>; share: Record<Side, number> | null; has: Side | null; disabled: boolean; onTap: (side: Side) => void; testLabel: (side: Side) => string }) {
  const home = share ? share.home : 50;
  return (
    <div className="col-span-2 grid gap-2 rounded-xl border border-border bg-panel p-3">
      <div aria-hidden className="flex h-7 overflow-hidden rounded-md text-[13px] font-bold tabular text-white">
        {share ? (
          <>
            <span className="flex items-center pl-2 transition-[width]" style={{ width: `${home}%`, minWidth: '3rem', background: teams.home.primaryColor }}>{share.home}%</span>
            <span className="flex flex-1 items-center justify-end pr-2" style={{ minWidth: '3rem', background: teams.away.primaryColor }}>{share.away}%</span>
          </>
        ) : <span className="flex flex-1 items-center justify-center bg-elevated text-[12px] font-medium text-muted">No possession recorded yet</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['home', 'away'] as const).map((side) => (
          <button key={side} type="button" data-side={side} data-event="possession_change" aria-label={testLabel(side)} aria-pressed={has === side} disabled={disabled} onClick={() => onTap(side)}
            className={cx('flex min-h-11 items-center justify-center gap-2 rounded-lg border text-[14px] font-semibold enabled:active:scale-[0.98] disabled:opacity-40', has === side ? 'border-transparent text-white' : 'border-border bg-elevated')}
            style={has === side ? { background: teams[side].primaryColor } : undefined}>
            {has === side ? <span aria-hidden className="size-2 animate-pulse rounded-full bg-white" /> : null}
            {teams[side].abbreviation} ball
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * One team's block of the scoreboard: the team's colour down the outside edge, its crest and name on top, and its
 * score underneath at the edge nearest the clock, with the team's details (fouls, sin bin) beside it.
 */
export function ScoreBlock({ side, team, score, detail, provisional, children }: { side: Side; team: SheetTeam; score: number | null; detail?: ReactNode; provisional?: boolean; children?: ReactNode }) {
  const away = side === 'away';
  return (
    <div className={cx('relative grid min-w-0 content-center gap-1 py-2.5', away ? 'pl-2 pr-4 text-right' : 'pl-4 pr-2')}
      style={{ background: `linear-gradient(${away ? 270 : 90}deg, color-mix(in srgb, ${team.primaryColor} 32%, transparent), transparent 85%)` }}>
      <span aria-hidden className={cx('absolute inset-y-0 w-1.5', away ? 'right-0' : 'left-0')} style={{ background: team.primaryColor }} />
      <span className={cx('flex min-w-0 items-center gap-2', away && 'flex-row-reverse')}>
        <TeamCrest team={team} size={28} />
        <span className="min-w-0 truncate text-[15px] font-bold leading-tight">{team.shortName}</span>
      </span>
      {score != null || detail ? (
        <span className={cx('flex min-w-0 items-end gap-2', away ? 'flex-row' : 'flex-row-reverse')}>
          {score != null ? <span data-score-side={side} className={cx('shrink-0 text-[40px] font-bold leading-none tabular', provisional && 'text-warning')}>{score}</span> : null}
          <span className="min-w-0 flex-1 pb-0.5">{detail}</span>
        </span>
      ) : null}
      {children}
    </div>
  );
}
