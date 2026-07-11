import { createRng, type Rng } from './rng';
// ── v2 engine imports (CONTRACT §4 + TICKSPEC v0.3) ──
import { attackStars, boxScore, shotWeight, zonalStrength, type ZoneStrength } from './rating';
import { formationById } from './types';
import type { MatchResultV2, Shootout, Tactics, Team, XiSlotV2 } from './types';
import type { MoraleMap } from './morale';
import * as P from './params';

const BASE_XG = 1.35;
const STRENGTH_TO_XG = 0.012;
const MIN_XG = 0.15;
const MAX_XG = 4.5;

export interface MatchScore {
  goalsA: number;
  goalsB: number;
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

/** Knuth Poisson sampler. Deterministic via the provided rng. */
export function poisson(lambda: number, rng: Rng): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > limit);
  return k - 1;
}

/** Simulate one match between two team strengths. Higher strength => higher xG. */
export function simulateMatch(strengthA: number, strengthB: number, rng: Rng): MatchScore {
  const diff = strengthA - strengthB;
  const xgA = clamp(BASE_XG + diff * STRENGTH_TO_XG, MIN_XG, MAX_XG);
  const xgB = clamp(BASE_XG - diff * STRENGTH_TO_XG, MIN_XG, MAX_XG);
  return { goalsA: poisson(xgA, rng), goalsB: poisson(xgB, rng) };
}

// ============================================================================
// v2 tactics-aware engine core — CONTRACT §4 + TICKSPEC v0.3.
//
// `resolveMatchOutcome` is the SHARED core. `resolveMatch` (score-only, all ~48
// matches/round) and `simulateMatchTimeline` (timeline.ts, watched matches only)
// both call it, drawing the SAME rng sequence, so their scoreline/winner are
// byte-identical (TICKSPEC §5). Tick cosmetics use a SEPARATE derived rng in
// timeline.ts and never perturb these outcome draws.
// ============================================================================

export interface MatchSide {
  id: string;
  xi: XiSlotV2[];
  tactics: Tactics;
  morale?: MoraleMap; // transient buff for THIS match (playerId → +0..3)
}

export interface GoalEvent {
  minute: number;
  team: Team;
  playerId: string;
  assistPlayerId?: string;
}

/** Everything both entry points need; timeline.ts layers ticks/box on top. */
export interface MatchOutcome {
  homeGoals: number;
  awayGoals: number;
  goals: GoalEvent[];
  shootout?: Shootout;
  xg: { home: number; away: number };
  homeZ: ZoneStrength;
  awayZ: ZoneStrength;
}

// Attack / defense indices on the rating scale (so a 10-pt edge ⇒ +0.75 xG).
// Attack weights reuse EDGE_* (sum 1); defense weights are defensive-solidity local.
function attackIndex(z: ZoneStrength): number {
  return P.EDGE_ATTACK_WEIGHT * z.att.avg + P.EDGE_MIDFIELD_WEIGHT * z.mid.avg + P.EDGE_DEFENSE_WEIGHT * z.overall;
}
function defenseIndex(z: ZoneStrength): number {
  return 0.55 * z.def.avg + 0.2 * z.mid.avg + 0.25 * z.gk;
}

function centralMids(t: Tactics): number {
  const f = formationById(t.formationId);
  if (!f) return 3;
  return f.slots.filter((s) => s === 'CDM' || s === 'CM' || s === 'CAM').length;
}

const lineOf = (t: Tactics): 'deep' | 'mid' | 'high' => t.lineHeight ?? 'mid';

/** xG for each side from zonal edges + tactic modifiers. No rng — pure. */
export function computeXg(
  home: MatchSide,
  away: MatchSide,
  homeZ: ZoneStrength,
  awayZ: ZoneStrength,
): { home: number; away: number } {
  let xgHome = P.BASE_XG_PER_SIDE + (attackIndex(homeZ) - defenseIndex(awayZ)) * P.STRENGTH_TO_XG;
  let xgAway = P.BASE_XG_PER_SIDE + (attackIndex(awayZ) - defenseIndex(homeZ)) * P.STRENGTH_TO_XG;

  // Formation: central-midfield overload tilts chance volume (bounded).
  const overload = centralMids(home.tactics) - centralMids(away.tactics);
  xgHome += overload * P.FORMATION_MID_OVERLOAD_K;
  xgAway -= overload * P.FORMATION_MID_OVERLOAD_K;

  // Style: attacking opens the game for BOTH sides (the product hits both).
  const styleProduct = P.STYLE_XG_MULT[home.tactics.style] * P.STYLE_XG_MULT[away.tactics.style];
  xgHome *= styleProduct;
  xgAway *= styleProduct;

  // Line height: my high line concedes better counters to the opponent.
  xgAway *= P.LINE_HEIGHT_COUNTER_MULT[lineOf(home.tactics)];
  xgHome *= P.LINE_HEIGHT_COUNTER_MULT[lineOf(away.tactics)];

  // Stars: attack-zone shot quality (finishing), additive.
  xgHome += attackStars(home.xi) * P.STAR_SHOT_QUALITY;
  xgAway += attackStars(away.xi) * P.STAR_SHOT_QUALITY;

  return {
    home: clamp(xgHome, P.XG_MIN, P.XG_MAX),
    away: clamp(xgAway, P.XG_MIN, P.XG_MAX),
  };
}

/** Regulation goals via independent Poisson + the DC-inspired low-draw trim. */
function sampleScore(xg: { home: number; away: number }, rng: Rng): { home: number; away: number } {
  let home = poisson(xg.home, rng);
  let away = poisson(xg.away, rng);
  if (home === away && home <= 1 && rng.next() < P.LOW_DRAW_TRIM) {
    if (xg.home > xg.away) home += 1;
    else if (xg.away > xg.home) away += 1;
    else if (rng.next() < 0.5) home += 1;
    else away += 1;
  }
  return { home, away };
}

/** Weighted pick over an XI by shot weight; deterministic given rng. */
function weightedPick(xi: readonly XiSlotV2[], rng: Rng, morale?: MoraleMap): XiSlotV2 {
  const weights = xi.map((s) => shotWeight(s, morale));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < xi.length; i++) {
    r -= weights[i];
    if (r <= 0) return xi[i];
  }
  return xi[xi.length - 1];
}

function pickAssist(
  xi: readonly XiSlotV2[],
  scorer: XiSlotV2,
  rng: Rng,
  morale?: MoraleMap,
): XiSlotV2 | null {
  if (rng.next() < P.P_SOLO_GOAL) return null;
  const pool = xi.filter((s) => s.player.id !== scorer.player.id);
  if (pool.length === 0) return null;
  return weightedPick(pool, rng, morale);
}

/** Minute-stamp + attribute each goal (scorer/assister feed morale). */
function buildGoals(
  home: MatchSide,
  away: MatchSide,
  score: { home: number; away: number },
  rng: Rng,
): GoalEvent[] {
  const raw: { team: Team; minute: number; seq: number }[] = [];
  let seq = 0;
  for (let i = 0; i < score.home; i++) raw.push({ team: 'home', minute: 1 + rng.int(90), seq: seq++ });
  for (let i = 0; i < score.away; i++) raw.push({ team: 'away', minute: 1 + rng.int(90), seq: seq++ });
  raw.sort((a, b) => a.minute - b.minute || a.seq - b.seq); // stable tiebreak for determinism
  return raw.map((g) => {
    const side = g.team === 'home' ? home : away;
    const scorer = weightedPick(side.xi, rng, side.morale);
    const assist = pickAssist(side.xi, scorer, rng, side.morale);
    const ev: GoalEvent = { minute: g.minute, team: g.team, playerId: scorer.player.id };
    if (assist) ev.assistPlayerId = assist.player.id;
    return ev;
  });
}

function keeperRating(xi: readonly XiSlotV2[]): number {
  const gk = xi.find((s) => s.position === 'GK');
  return gk ? gk.player.rating : 75;
}

/** Penalty takers, best (attacking + rating) first; ties by slot index. */
function takerOrder(xi: readonly XiSlotV2[], morale?: MoraleMap): XiSlotV2[] {
  return xi
    .map((slot, index) => ({ slot, index, w: shotWeight(slot, morale) }))
    .sort((a, b) => b.w - a.w || a.index - b.index)
    .map((e) => e.slot);
}

/** Deterministic seeded penalty shootout — every level match resolves (no draws). */
export function runShootout(home: MatchSide, away: MatchSide, rng: Rng): Shootout {
  const takers: Record<Team, XiSlotV2[]> = {
    home: takerOrder(home.xi, home.morale),
    away: takerOrder(away.xi, away.morale),
  };
  const gk: Record<Team, number> = { home: keeperRating(home.xi), away: keeperRating(away.xi) };
  const kicks: Shootout['kicks'] = [];
  const scored: Record<Team, number> = { home: 0, away: 0 };
  const count: Record<Team, number> = { home: 0, away: 0 };

  const kick = (team: Team): void => {
    const opp: Team = team === 'home' ? 'away' : 'home';
    const takerList = takers[team];
    const taker = takerList[count[team] % takerList.length];
    count[team] += 1;
    const p = clamp(
      P.SO_CONV_BASE + (taker.player.rating - 75) * P.SO_CONV_TAKER_K - (gk[opp] - 75) * P.SO_CONV_GK_K,
      P.SO_CONV_MIN,
      P.SO_CONV_MAX,
    );
    const made = rng.next() < p;
    if (made) scored[team] += 1;
    kicks.push({ team, scored: made, playerId: taker.player.id });
  };

  const order: Team[] = rng.next() < 0.5 ? ['home', 'away'] : ['away', 'home'];
  const decided = (): boolean => {
    const hRem = P.SHOOTOUT_ROUNDS - count.home;
    const aRem = P.SHOOTOUT_ROUNDS - count.away;
    return scored.home > scored.away + aRem || scored.away > scored.home + hRem;
  };

  best5: for (let round = 0; round < P.SHOOTOUT_ROUNDS; round++) {
    for (const t of order) {
      kick(t);
      if (decided()) break best5;
    }
  }
  // Sudden death — one each until a round is split.
  let guard = 0;
  while (scored.home === scored.away && guard++ < 50) {
    for (const t of order) kick(t);
  }

  return {
    winner: scored.home > scored.away ? 'home' : 'away',
    home: scored.home,
    away: scored.away,
    kicks,
  };
}

/** THE shared core (main rng). Timeline + score paths both call this. */
export function resolveMatchOutcome(home: MatchSide, away: MatchSide, seed: number): MatchOutcome {
  const rng = createRng(seed);
  const homeZ = zonalStrength(home.xi, home.morale);
  const awayZ = zonalStrength(away.xi, away.morale);
  const xg = computeXg(home, away, homeZ, awayZ);
  const score = sampleScore(xg, rng);
  const goals = buildGoals(home, away, score, rng);
  const shootout = score.home === score.away ? runShootout(home, away, rng) : undefined;
  return { homeGoals: score.home, awayGoals: score.away, goals, shootout, xg, homeZ, awayZ };
}

/**
 * Canonical per-match seed (CONTRACT §4). Both the headless tournament (for the
 * table via `resolveMatch`) and the App's watched playback (via
 * `simulateMatchTimeline`) MUST derive a match's seed with THIS function, so the
 * watched scoreline is guaranteed identical to the table's — and a future server
 * can name a match by (tournamentSeed, round, matchIndex) coordinates alone.
 * Integer hash mix (deterministic, well-distributed).
 */
export function matchSeed(tournamentSeed: number, round: number, matchIndex: number): number {
  let h = tournamentSeed >>> 0;
  h = Math.imul(h ^ (round + 0x9e3779b9), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (matchIndex + 0x27d4eb2f), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Score-only entry point (headless BR rounds). */
export function resolveMatch(home: MatchSide, away: MatchSide, seed: number): MatchResultV2 {
  const o = resolveMatchOutcome(home, away, seed);
  return {
    homeId: home.id,
    awayId: away.id,
    homeGoals: o.homeGoals,
    awayGoals: o.awayGoals,
    goals: o.goals,
    shootout: o.shootout,
  };
}

/** Box score straight off the outcome's zonal strengths (for the timeline/UI). */
export function outcomeBoxScore(o: MatchOutcome): {
  home: ReturnType<typeof boxScore>;
  away: ReturnType<typeof boxScore>;
  xg: { home: number; away: number };
} {
  return { home: boxScore(o.homeZ), away: boxScore(o.awayZ), xg: o.xg };
}
