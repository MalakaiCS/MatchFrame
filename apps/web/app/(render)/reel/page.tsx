'use client';
// A reel of the broadcast looks for the public site: the real renderer playing a scripted sequence with fictional
// teams over a drawn pitch, one look after another behind a wipe that names it. `pnpm record:reel` records it to
// apps/web/public/media/. /reel plays it on a loop; /reel?wait=1 holds the first frame until
// window.__startReel() is called (the recorder does this, so the video starts on the first frame of the reel).
import { Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { DEFAULT_THEMES, LOOKS, emptyState, findTemplate, type OverlayPublicState, type ThemeKey } from '@bs/graphics';
import { Keyframes, Renderer, Stage, THEMES } from '@bs/graphics/react';
import { SAMPLE_SLOTS, sampleData, sampleVariables } from '@/components/theme-preview';
import { BRAND, MatchFrameMark } from '@/components/site/brand';

/** One look per scene: a team event over the scorebug, then a full-frame board. */
const SEQUENCE: { look: ThemeKey; event: string; board: string }[] = [
  { look: 'premier', event: 'builtin:goal', board: 'builtin:lineup' },
  { look: 'liga', event: 'builtin:goal', board: 'builtin:ident' },
  { look: 'major', event: 'builtin:goal', board: 'builtin:stats' },
  { look: 'southern', event: 'builtin:card', board: 'builtin:break_score' },
  { look: 'continental', event: 'builtin:goal', board: 'builtin:league_table' },
  { look: 'primetime', event: 'builtin:substitution', board: 'builtin:formation' },
  { look: 'meister', event: 'builtin:goal', board: 'builtin:head_to_head' },
];
const INTRO = 3800;
const SCENE = 6700;
const WIPE = 1500;
const OUTRO = 3400;
/** the moment inside a wipe when the picture underneath is fully covered and the look changes */
const SWITCH = Math.round(WIPE * 0.48);
const END = INTRO + SEQUENCE.length * SCENE;
const REEL_MS = END + OUTRO;

interface Shot { key: string; at: number; ms: number | null; vars?: Record<string, unknown> }
interface Scene { look: ThemeKey; from: number; to: number; shots: Shot[] }

const SCENES: Scene[] = [
  { look: 'premier', from: 0, to: INTRO + SWITCH, shots: [{ key: 'builtin:backdrop', at: 0, ms: null }, { key: 'builtin:ident', at: 450, ms: 3000 }] },
  ...SEQUENCE.map((s, i) => {
    const b = INTRO + i * SCENE;
    return { look: s.look, from: b + SWITCH, to: b + SCENE + SWITCH, shots: [{ key: 'builtin:scorebug', at: b + 1150, ms: null }, { key: s.event, at: b + 1650, ms: 2200 }, { key: s.board, at: b + 4150, ms: 2100 }] };
  }),
];
const WIPES: { look: ThemeKey | 'end'; at: number }[] = [...SEQUENCE.map((s, i) => ({ look: s.look, at: INTRO + i * SCENE })), { look: 'end', at: END }];

/** The graphics on air at reel time t (ms), as the overlay state the renderer reads. */
function stateAt(scene: Scene, t: number, base: number): OverlayPublicState {
  const s = emptyState();
  scene.shots.forEach((shot, i) => {
    const tpl = findTemplate(shot.key);
    if (!tpl || t < shot.at || (shot.ms != null && t > shot.at + shot.ms + tpl.exitMs + 100)) return;
    if (tpl.layer === 'scoreboard') s.scorebugVisible = true;
    // unique per scene and per play-through, so every entrance animates (the renderer remembers cue ids)
    s.layers[tpl.layer] = { cueId: `${base}-s${SCENES.indexOf(scene)}-${i}`, templateKey: shot.key, layer: tpl.layer, variables: { ...sampleVariables(shot.key, 'football'), ...shot.vars }, startedAt: base + shot.at, durationMs: shot.ms, source: 'operator' };
  });
  return s;
}

/** Reel time in ms, ticking about 30 times a second once started (looping unless held for the recorder). */
function useReelTime(wait: boolean) {
  const [base, setBase] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const w = window as unknown as { __startReel?: () => void; __reelMs?: number };
    w.__reelMs = REEL_MS;
    w.__startReel = () => setBase(Date.now());
    if (!wait) void document.fonts.ready.then(() => setBase(Date.now()));
  }, [wait]);
  useEffect(() => {
    if (base == null) return;
    let raf = 0;
    let last = 0;
    const tick = (f: number) => {
      if (f - last > 33) {
        last = f;
        const t = Date.now() - base;
        if (!wait && t > REEL_MS + 600) setBase(Date.now());
        else setNow(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [base, wait]);
  return { base, t: base == null ? -1 : now };
}

const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

/** The wipe between looks: a slanted panel in the incoming look's colours, carrying its name. */
function Wipe({ t }: { t: number }) {
  const w = [...WIPES].reverse().find((x) => t >= x.at);
  if (!w) return null;
  const p = (t - w.at) / WIPE;
  const key = w.look === 'end' ? null : w.look;
  const end = key == null;
  if (!end && p >= 1) return null;
  // in over the first 28%, hold, then out over the last 30%; the end card stays
  const x = p < 0.28 ? -125 + 125 * ease(p / 0.28) : end || p < 0.7 ? 0 : 125 * ease((p - 0.7) / 0.3);
  const th = key ? DEFAULT_THEMES[key] : null;
  const look = key ? LOOKS.find((l) => l.key === key)! : null;
  const bg = th ? `linear-gradient(115deg, ${th.secondary} 0%, ${th.secondary} 42%, ${th.primary} 100%)` : `radial-gradient(ellipse at 30% 30%, ${BRAND.blue} 0%, ${BRAND.navy} 65%)`;
  const text = th && th.secondary.toLowerCase().startsWith('#f') ? '#111' : '#fff';
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 200 }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '-15%', width: '130%', background: bg, transform: `translateX(${x}%) skewX(-12deg)` }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, color: text, transform: `translateX(${x * 1.15}%)`, opacity: end && p < 0.28 ? ease(p / 0.28) : 1 }}>
        {end ? (
          <>
            <MatchFrameMark size={150} />
            <div style={{ fontFamily: "'Outfit Variable', sans-serif", fontWeight: 800, fontSize: 96, letterSpacing: -1 }}>{BRAND.name}</div>
            <div style={{ fontFamily: "'Outfit Variable', sans-serif", fontWeight: 500, fontSize: 36, opacity: 0.85 }}>{BRAND.tagline}</div>
            <div style={{ fontFamily: "'Inter Variable', sans-serif", fontWeight: 500, fontSize: 24, opacity: 0.6, marginTop: 16 }}>Ten looks · 29 graphics · one scorer</div>
          </>
        ) : (
          <>
            <div style={{ fontFamily: th!.font, fontWeight: 800, fontSize: 150, lineHeight: 1, textTransform: 'uppercase', letterSpacing: 2, fontStyle: key === 'primetime' || key === 'meister' ? 'italic' : undefined }}>{look!.name}</div>
            <div style={{ fontFamily: "'Inter Variable', sans-serif", fontWeight: 500, fontSize: 30, opacity: 0.85 }}>{look!.description}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** A drawn pitch from a high camera: mown stripes, the halfway line and centre circle, darker stands at the top. */
const PITCH: CSSProperties = { position: 'absolute', inset: 0, background: 'repeating-linear-gradient(90deg, #2e7a3c 0 160px, #296f36 160px 320px)' };

function Reel() {
  const wait = useSearchParams().get('wait') === '1';
  const { base, t } = useReelTime(wait);
  const scene = SCENES.find((s) => t >= s.from && t < s.to) ?? SCENES[SCENES.length - 1]!;
  const data = useMemo(() => sampleData(DEFAULT_THEMES[scene.look], 'football'), [scene.look]);
  // a new overlay state only when a graphic starts or finishes, not on every tick
  const active = base == null ? '' : `${SCENES.indexOf(scene)}:${scene.shots.map((s) => {
    const tpl = findTemplate(s.key);
    return t >= s.at && !(s.ms != null && t > s.at + s.ms + (tpl?.exitMs ?? 0) + 100) ? 1 : 0;
  }).join('')}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state = useMemo(() => (base == null ? emptyState() : stateAt(scene, t, base)), [active, base]);
  const look = LOOKS.find((l) => l.key === scene.look)!;
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#000' }}>
      <Keyframes />
      <Stage>
        <div style={PITCH} />
        <svg aria-hidden viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <line x1="960" y1="250" x2="960" y2="1080" stroke="rgba(255,255,255,.35)" strokeWidth="4" />
          <ellipse cx="960" cy="690" rx="300" ry="150" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="4" />
          <rect x="-20" y="250" width="1960" height="860" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="4" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #0b1320 0%, rgba(11,19,32,.85) 18%, rgba(11,19,32,0) 30%, rgba(0,0,0,0) 70%, rgba(0,0,0,.35) 100%)' }} />
        <Renderer state={state} data={data} themes={THEMES} serverNow={() => Date.now()} slots={SAMPLE_SLOTS} />
        {t >= 0 ? (
          <div style={{ position: 'absolute', right: 96, top: 54, padding: '10px 22px', borderRadius: 999, background: 'rgba(0,0,0,.55)', color: '#fff', fontFamily: "'Inter Variable', sans-serif", fontSize: 22, fontWeight: 600, zIndex: 150 }}>
            {look.name} look
          </div>
        ) : null}
        <div style={{ position: 'absolute', right: 96, bottom: 24, color: 'rgba(255,255,255,.7)', fontFamily: "'Inter Variable', sans-serif", fontSize: 18, zIndex: 150 }}>MatchFrame · sample graphics, fictional teams</div>
        <Wipe t={t} />
      </Stage>
    </div>
  );
}

export default function ReelPage() {
  return (
    <Suspense fallback={null}>
      <Reel />
    </Suspense>
  );
}
