/**
 * Pure match-playback projection (sim workstream, MATCH-SIM).
 *
 * The ONE rule that makes multiplayer a refactor not a rewrite (CONTRACT §5):
 * everything a client draws is a PURE function of `(timeline, elapsedMs)`. No
 * randomness, no per-frame engine calls, no incremental mutation. Hand two
 * clients the same `MatchTimeline` + start timestamp and every frame is identical.
 *
 * `PlaybackState`, `POSITION_ANCHOR` and the dot-drift model are sim-owned
 * (TICKSPEC §2 recorded them as ours); the timeline shape is CONTRACT §4.
 */
import {
  CELEBRATION_MS,
  MATCH_DURATION_MS,
  VIRTUAL_MINUTES,
  formationById,
  type MatchTimeline,
  type Team,
  type TimelineEvent,
} from '../engine/types';
import type { Position } from '../engine/data/schema';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

// ---- pitch geometry (TICKSPEC §2 POSITION_ANCHOR — home attacking frame) -----
// x: 0 own goal … 1 opp goal ; y: 0 left touchline … 1 right. Sim owns the values.
export const POSITION_ANCHOR: Readonly<Record<Position, { x: number; y: number }>> = {
  GK: { x: 0.05, y: 0.5 },
  RB: { x: 0.3, y: 0.83 }, CB: { x: 0.22, y: 0.5 }, LB: { x: 0.3, y: 0.17 },
  CDM: { x: 0.4, y: 0.5 }, CM: { x: 0.52, y: 0.5 }, CAM: { x: 0.63, y: 0.5 },
  RM: { x: 0.55, y: 0.83 }, LM: { x: 0.55, y: 0.17 },
  RW: { x: 0.78, y: 0.83 }, LW: { x: 0.78, y: 0.17 }, ST: { x: 0.82, y: 0.5 },
};

/** Compresses the anchor's longitudinal span into each team's operating band so
 *  the two teams share the pitch instead of both spanning goal-to-goal. */
const DOT_SPREAD = 0.6;

export interface DotAnchor { position: Position; x: number; y: number; isGK: boolean }

/**
 * Resolve a formation id → 11 dot anchors (home frame), spreading repeated
 * positions (2×CB, back-3, twin STs…) SYMMETRICALLY on y. Depends on
 * CONTRACT §3 `FORMATIONS[id].slots` as the source of truth (TICKSPEC C3).
 */
export function formationAnchors(formationId: string): DotAnchor[] {
  const f = formationById(formationId) ?? formationById('4-3-3')!;
  const counts = new Map<Position, number>();
  for (const p of f.slots) counts.set(p, (counts.get(p) ?? 0) + 1);
  const seen = new Map<Position, number>();
  return f.slots.map((p) => {
    const a = POSITION_ANCHOR[p];
    const k = counts.get(p)!;
    const i = (seen.set(p, (seen.get(p) ?? -1) + 1), seen.get(p)!);
    const dy = k > 1 ? (i - (k - 1) / 2) * 0.16 : 0; // 2×CB → .42/.58, back-3 → .34/.50/.66
    return { position: p, x: a.x, y: clamp(a.y + dy, 0.08, 0.92), isGK: p === 'GK' };
  });
}

export interface DotView { team: Team; x: number; y: number; isGK: boolean }

/**
 * Pseudo-moving dot: eases from its formation anchor toward the ball's zone by
 * possession, plus a per-index wobble on elapsed. PURE — no per-dot simulation.
 * Away = full 180° point reflection of the anchor (x→1−x AND y→1−y) so the two
 * teams are rotationally symmetric (TICKSPEC §2, MATCH-SIM refinement).
 */
export function dotView(
  team: Team,
  anchor: DotAnchor,
  ball: { x: number; y: number },
  possession: Team,
  elapsedMs: number,
  index: number,
): DotView {
  const bx = team === 'home' ? 0.04 + anchor.x * DOT_SPREAD : 0.96 - anchor.x * DOT_SPREAD;
  const by = team === 'home' ? anchor.y : 1 - anchor.y;
  if (anchor.isGK) {
    // keeper hugs the line, shadowing the ball's lane a little
    return { team, x: bx, y: 0.5 + (ball.y - 0.5) * 0.18, isGK: true };
  }
  const attacking = possession === team;
  const pullX = attacking ? 0.2 : 0.12;
  const pullY = attacking ? 0.16 : 0.22;
  const wobX = Math.sin(elapsedMs * 0.0021 + index * 1.7) * 0.006;
  const wobY = Math.cos(elapsedMs * 0.0019 + index) * 0.006;
  return {
    team,
    x: clamp(bx + (ball.x - bx) * pullX + wobX, 0.02, 0.98),
    y: clamp(by + (ball.y - by) * pullY + wobY, 0.05, 0.95),
    isGK: false,
  };
}

// ---- playback state (sim-owned; CONTRACT §5 PlaybackState) -------------------

export interface ShootoutView {
  /** Kicks whose RESULT has been revealed so far, in order. */
  kicks: { team: Team; scored: boolean; playerId: string }[];
  /** Penalties scored so far. */
  tally: { home: number; away: number };
  /** The taker winding up right NOW — set only during a kick's pre-result beat;
   *  null while a result flashes and once the shootout is decided. */
  pendingKicker: { team: Team; playerId: string } | null;
  winner: Team | null; // set once decided

  // --- transitional aliases (pre-6s-cadence names) so the current
  //     MatchPlaybackScreen keeps rendering until Main's screen rewrite consumes
  //     the fields above. Safe to delete once the screen migrates. ---
  /** @deprecated use `kicks` */ taken: { team: Team; scored: boolean; playerId: string }[];
  /** @deprecated use `tally.home` */ home: number;
  /** @deprecated use `tally.away` */ away: number;
  /** @deprecated use `pendingKicker?.team ?? null` */ stepping: Team | null;
  /** result of the most recently revealed kick (caption) */ lastResult: 'scored' | 'missed' | null;
}

export interface PlaybackState {
  phase: 'regulation' | 'shootout';
  /** True once elapsed ≥ the match's fixed watched duration (45s or 57s). */
  finished: boolean;
  virtualMinute: number; // 0..90
  clockLabel: string; // "23'", "HT", "FT", "PENS"
  score: { home: number; away: number };
  ball: { x: number; y: number }; // ballPosition × ballLane; centre during a goal celebration
  momentum: number; // -1..+1
  possession: Team;
  ticker: TimelineEvent[]; // up to the last 3 non-shootout events fired
  celebrating: TimelineEvent | null; // a goal within [t, t+CELEBRATION_MS]
  shootout: ShootoutView | null;
}

/** Wall-clock beat per penalty in playback — kicks reveal ONE BY ONE. */
export const SHOOTOUT_KICK_MS = 6000;
/** Fraction of a kick's beat spent winding up before the result is revealed. */
const SHOOTOUT_REVEAL_AT = 0.58;

/** Total watched wall-clock: regulation (45s) plus a 6s beat per shootout kick if it
 *  went to pens (variable length). No shootout ⇒ just the 45s regulation. */
export function matchEndMs(timeline: MatchTimeline): number {
  return MATCH_DURATION_MS + (timeline.shootout ? timeline.shootout.kicks.length * SHOOTOUT_KICK_MS : 0);
}

const eventMs = (minute: number) => (minute / VIRTUAL_MINUTES) * MATCH_DURATION_MS;
const isShootoutEvent = (t: TimelineEvent['type']) =>
  t === 'shootout_start' || t === 'penalty_scored' || t === 'penalty_missed' || t === 'shootout_end';

/**
 * THE pure projection. Given a timeline and elapsed ms, produce the exact frame.
 * Deterministic and side-effect-free ⇒ trivially unit-testable and MP-safe.
 */
export function projectMatch(timeline: MatchTimeline, elapsedMs: number): PlaybackState {
  const ticks = timeline.ticks;
  const N = timeline.durationMinutes;
  const el = Math.max(0, elapsedMs);
  const finished = el >= matchEndMs(timeline);

  // regulation frame (always computed — the pitch freezes at 90' during pens)
  const regMs = clamp(el, 0, MATCH_DURATION_MS);
  const v = (regMs / MATCH_DURATION_MS) * N;
  const i = Math.min(N, Math.floor(v));
  const j = Math.min(N, i + 1);
  const f = v - i;
  const a = ticks[i] ?? ticks[ticks.length - 1];
  const b = ticks[j] ?? a;
  const possession = (f < 0.5 ? a : b).possession;

  // score = latest goal whose stamp has passed
  let score = { home: 0, away: 0 };
  for (const e of timeline.events) {
    if (e.type === 'goal' && e.scoreAfter && eventMs(e.minute) <= regMs) score = e.scoreAfter;
  }

  // celebration window → ball resets to the centre spot
  let celebrating: TimelineEvent | null = null;
  for (const e of timeline.events) {
    if (e.type !== 'goal') continue;
    const t = eventMs(e.minute);
    if (regMs >= t && regMs < t + CELEBRATION_MS) celebrating = e;
  }

  const ball = celebrating
    ? { x: 0.5, y: 0.5 }
    : { x: clamp01(lerp(a.ballPosition, b.ballPosition, f)), y: clamp01(lerp(a.ballLane, b.ballLane, f)) };

  const ticker = timeline.events
    .filter((e) => !isShootoutEvent(e.type) && eventMs(e.minute) <= regMs)
    .slice(-3);

  const min = Math.floor(v);
  const inShootout = !!timeline.shootout && el > MATCH_DURATION_MS;

  // ---- shootout sub-view: kicks reveal ONE BY ONE, a fixed 6s beat each ----
  let shootout: ShootoutView | null = null;
  if (timeline.shootout) {
    const so = timeline.shootout;
    const all = so.kicks;
    const n = all.length;
    const soEl = Math.max(0, el - MATCH_DURATION_MS); // ms into the shootout (unbounded)
    const cur = Math.floor(soEl / SHOOTOUT_KICK_MS); // kick beat now playing (may be ≥ n at the end)
    const within = (soEl - cur * SHOOTOUT_KICK_MS) / SHOOTOUT_KICK_MS; // 0..1 through this beat
    const resultShown = within >= SHOOTOUT_REVEAL_AT; // wind-up, then reveal
    const revealed = Math.min(n, cur + (resultShown ? 1 : 0));
    const kicks = all.slice(0, revealed);
    let home = 0;
    let away = 0;
    for (const k of kicks) if (k.scored) k.team === 'home' ? home++ : away++;
    const decided = revealed >= n || finished;
    // the taker winding up: only during the pre-result beat of a not-yet-revealed kick
    const pending = !decided && !resultShown && cur < n ? all[cur] : null;
    const pendingKicker = pending ? { team: pending.team, playerId: pending.playerId } : null;
    const lastResult = kicks.length ? (kicks[kicks.length - 1].scored ? 'scored' : 'missed') : null;
    shootout = {
      kicks,
      tally: { home, away },
      pendingKicker,
      winner: decided ? so.winner : null,
      // transitional aliases
      taken: kicks,
      home,
      away,
      stepping: pendingKicker?.team ?? null,
      lastResult,
    };
  }

  let clockLabel: string;
  if (inShootout) clockLabel = 'PENS';
  else if (min >= N) clockLabel = 'FT';
  else if (min === Math.floor(N / 2) && timeline.events.some((e) => e.type === 'halftime')) clockLabel = 'HT';
  else clockLabel = `${min}'`;

  return {
    phase: inShootout ? 'shootout' : 'regulation',
    finished,
    virtualMinute: v,
    clockLabel,
    score,
    ball,
    momentum: clamp(lerp(a.momentum, b.momentum, f), -1, 1),
    possession,
    ticker,
    celebrating,
    shootout,
  };
}
