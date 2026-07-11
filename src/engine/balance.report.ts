import { runTournament, type MatchResult, type TournamentLog } from './tournament';
import { resolveMatch, type MatchSide } from './match';
import { overallStrength } from './rating';
import { moraleForManager, type MoraleMap } from './morale';
import { FORMATIONS, type MatchResultV2 } from './types';
import { createRng, type Rng } from './rng';
import type { PlayerV2, Position } from './data/schema';

/** Real-football-inspired targets, revised by Lucca (DECISIONS.md, 2026-07-11
 *  morning): spicier-than-real goal rate, and draws are eliminated by
 *  shootouts rather than tolerated. See PLAN-qa.md Job 1 for the sourcing;
 *  these numbers supersede that document's original 2.6-2.9g/22-29%d bands. */
export const TARGETS = {
  goalsPerMatch: 3.4,
  /** Drawn-after-90 rate BEFORE the shootout resolves it. Engine v2 only —
   *  v1 has no shootout, so v1's plain draw rate is reported for context,
   *  not graded against this band. */
  preShootoutDrawRate: 0.15,
  /** Once shootouts land, no match should end level in the final table. */
  postShootoutDrawRate: 0,
} as const;

export interface GoalsStats {
  sampleSize: number;
  mean: number;
  median: number;
  p95: number;
  max: number;
  scorelessRate: number;
  fivePlusRate: number;
}

export function collectMatches(logs: readonly TournamentLog[]): MatchResult[] {
  const matches: MatchResult[] = [];
  for (const log of logs) {
    for (const round of log.rounds) matches.push(...round.matches);
  }
  return matches;
}

export function goalsStats(matches: readonly MatchResult[]): GoalsStats {
  const totals = matches.map((m) => m.homeGoals + m.awayGoals).sort((a, b) => a - b);
  const n = totals.length;
  const mean = totals.reduce((s, x) => s + x, 0) / n;
  const median = totals[Math.floor(n / 2)];
  const p95 = totals[Math.min(n - 1, Math.floor(n * 0.95))];
  const max = totals[n - 1];
  const scoreless = matches.filter((m) => m.homeGoals === 0 && m.awayGoals === 0).length;
  const fivePlus = totals.filter((t) => t >= 5).length;
  return {
    sampleSize: n,
    mean,
    median,
    p95,
    max,
    scorelessRate: scoreless / n,
    fivePlusRate: fivePlus / n,
  };
}

/** Plain draw rate (homeGoals === awayGoals). Against v1 this IS the final
 *  outcome; against v2 this is the PRE-shootout rate (see TARGETS). */
export function drawRate(matches: readonly MatchResult[]): number {
  return matches.filter((m) => m.homeGoals === m.awayGoals).length / matches.length;
}

/** Per team-match-instance clean sheet rate (a 3-0 counts one clean sheet, not zero). */
export function cleanSheetRate(matches: readonly MatchResult[]): number {
  let cleanSheets = 0;
  for (const m of matches) {
    if (m.awayGoals === 0) cleanSheets++;
    if (m.homeGoals === 0) cleanSheets++;
  }
  return cleanSheets / (matches.length * 2);
}

export interface UpsetBucket {
  label: string;
  minGap: number;
  maxGap: number;
  decisiveMatches: number;
  weakerWinRate: number;
}

const UPSET_BUCKET_BOUNDS = [
  { label: '0-10', minGap: 0, maxGap: 10 },
  { label: '10-25', minGap: 10, maxGap: 25 },
  { label: '25+', minGap: 25, maxGap: Infinity },
] as const;

/**
 * Weaker-side win rate by strength-gap bucket, using each round's `table`
 * strength (computed once per round, before that round's matches — the
 * value both of that round's matches for a manager were actually played
 * at). Draws are excluded (they don't resolve an upset either way) — under
 * v1 that's a real exclusion; under v2 there should be none left to exclude.
 *
 * NOTE: bucket boundaries (0/10/25) are v1 `teamStrength` scale placeholders
 * (totals ~850-1030). Engine v2's zonal-edge scale is a different unit —
 * these buckets need redefining once v2's real numbers exist (flagged in
 * PLAN-qa.md's review of PLAN-engine.md).
 */
export function upsetRateByGap(logs: readonly TournamentLog[]): UpsetBucket[] {
  const buckets = UPSET_BUCKET_BOUNDS.map((b) => ({ ...b, decisiveMatches: 0, weakerWins: 0 }));
  for (const log of logs) {
    for (const round of log.rounds) {
      const strengthById = new Map(round.table.map((r) => [r.managerId, r.strength]));
      for (const m of round.matches) {
        if (m.homeGoals === m.awayGoals) continue;
        const sHome = strengthById.get(m.homeId)!;
        const sAway = strengthById.get(m.awayId)!;
        const gap = Math.abs(sHome - sAway);
        const bucket = buckets.find((b) => gap >= b.minGap && gap < b.maxGap);
        if (!bucket) continue;
        bucket.decisiveMatches++;
        const weakerWasHome = sHome < sAway;
        const weakerWon = weakerWasHome ? m.homeGoals > m.awayGoals : m.awayGoals > m.homeGoals;
        if (weakerWon) bucket.weakerWins++;
      }
    }
  }
  return buckets.map((b) => ({
    label: b.label,
    minGap: b.minGap,
    maxGap: b.maxGap,
    decisiveMatches: b.decisiveMatches,
    weakerWinRate: b.decisiveMatches > 0 ? b.weakerWins / b.decisiveMatches : NaN,
  }));
}

export interface LootSnowballResult {
  sampleTournaments: number;
  /** Avg. strength gained (round 1 -> last round played) by the top third
   *  of managers, ranked by their ROUND-1 (pre-steal) strength. */
  topThirdAvgGain: number;
  /** Same, for the bottom third by round-1 strength. */
  bottomThirdAvgGain: number;
  /** topThirdAvgGain / bottomThirdAvgGain. >1 = rich-get-richer, <1 =
   *  mean-reverting (weaker teams have more low-value slots to upgrade so
   *  gain more from the same steal pool), ~1 = neutral. */
  ratio: number;
  /** Largest observed (max survivor strength - min survivor strength) in
   *  any single round, across the whole sample — a boundedness check: this
   *  should stay well short of "one team is playing a different sport." */
  maxSpreadObserved: number;
}

/**
 * v1 PROXY for the morale/snowball metric DECISIONS.md asks for. v1 has no
 * morale mechanic (goal-scorer buffs don't exist yet — that's engine v2,
 * DECISIONS.md "Morale (new)") but v1's post-round STEAL already compounds
 * manager strength round over round, which is a real, currently-measurable
 * analog of "does surviving longer make you stronger, and is that bounded."
 * Once engine v2 lands per-player morale, extend this (or add a sibling
 * `moraleSnowball`) to fold morale-driven effective-rating deltas in too —
 * the shape (top-third vs bottom-third avg gain, ratio, max spread) should
 * carry over unchanged.
 */
export function lootSnowball(logs: readonly TournamentLog[]): LootSnowballResult {
  const topGains: number[] = [];
  const bottomGains: number[] = [];
  let maxSpread = 0;

  for (const log of logs) {
    if (log.rounds.length === 0) continue;
    const round1 = log.rounds[0];
    const initialStrength = new Map(round1.table.map((r) => [r.managerId, r.strength]));
    const ranked = [...round1.table].sort((a, b) => b.strength - a.strength);
    const third = Math.max(1, Math.floor(ranked.length / 3));
    const topIds = ranked.slice(0, third).map((r) => r.managerId);
    const bottomIds = ranked.slice(-third).map((r) => r.managerId);

    const lastStrength = new Map<string, number>();
    for (const round of log.rounds) {
      for (const row of round.table) lastStrength.set(row.managerId, row.strength);
      const strengths = round.table.map((r) => r.strength);
      maxSpread = Math.max(maxSpread, Math.max(...strengths) - Math.min(...strengths));
    }

    for (const id of topIds) topGains.push(lastStrength.get(id)! - initialStrength.get(id)!);
    for (const id of bottomIds) bottomGains.push(lastStrength.get(id)! - initialStrength.get(id)!);
  }

  const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const topThirdAvgGain = avg(topGains);
  const bottomThirdAvgGain = avg(bottomGains);
  return {
    sampleTournaments: logs.length,
    topThirdAvgGain,
    bottomThirdAvgGain,
    ratio: bottomThirdAvgGain !== 0 ? topThirdAvgGain / bottomThirdAvgGain : NaN,
    maxSpreadObserved: maxSpread,
  };
}

/**
 * PENDING engine v2 (DECISIONS.md: "Bot tactics: VARIED" — formations +
 * styles are seeded-random per bot). v1 bots are all fixed 4-3-3 with no
 * style, so there is no matchup space to report yet. Wire this up (a
 * formation x style win-rate matrix, see PLAN-qa.md Job 1 metric 5) once
 * `Manager` carries `tactics` and bots draft varied ones.
 */
export function tacticsMatchupSpread(_logs: readonly TournamentLog[]): null {
  return null;
}

export interface BalanceReport {
  sampleTournaments: number;
  sampleMatches: number;
  goals: GoalsStats;
  drawRate: number;
  cleanSheetRate: number;
  upsets: UpsetBucket[];
  lootSnowball: LootSnowballResult;
  tacticsMatchupSpread: ReturnType<typeof tacticsMatchupSpread>;
}

export function buildBalanceReport(seeds: readonly number[]): BalanceReport {
  const logs = seeds.map((seed) => runTournament(seed).log);
  const matches = collectMatches(logs);
  return {
    sampleTournaments: logs.length,
    sampleMatches: matches.length,
    goals: goalsStats(matches),
    drawRate: drawRate(matches),
    cleanSheetRate: cleanSheetRate(matches),
    upsets: upsetRateByGap(logs),
    lootSnowball: lootSnowball(logs),
    tacticsMatchupSpread: tacticsMatchupSpread(logs),
  };
}

// ============================================================================
// v2 (engine v2) balance harness — DECISIONS.md targets, wired directly to
// the v2 primitives (resolveMatch / MatchResultV2 / overallStrength / POINTS
// / moraleForManager) per game-engine's handoff. No v2 BR tournament exists
// yet (tournament.ts is still v1-only — sequencing is types -> data -> engine
// -> draft -> sim, and draft v2 hasn't landed bot XIs), so this is a
// self-contained synthetic-matchup + mini round-robin harness directly over
// the engine, mirroring the sampling approach `engine.v2.test.ts` already
// validates (3.50 g/m, 14.3% draws, 59.5% stronger-wins over 4000 matchups).
// RE-POINT this at the real v2 tournament once it lands.
//
// `goalsStats`/`drawRate`/`cleanSheetRate` above are REUSED as-is: MatchResultV2
// is a structural superset of MatchResult (same homeId/awayId/homeGoals/
// awayGoals, plus goals[]/shootout), so they type-check and behave correctly
// against v2 results without duplication.
// ============================================================================

const V2_NATIONS = ['BRA', 'ARG', 'FRA', 'ENG', 'ESP', 'GER', 'POR', 'NED'];
const V2_STYLES = ['defensive', 'balanced', 'attacking'] as const;

function randomPlayer(id: string, position: Position, rng: Rng): PlayerV2 {
  const rating = Math.max(60, Math.min(97, Math.round(70 + rng.next() * 20)));
  return {
    id,
    name: `${position}-${id}`,
    nation: V2_NATIONS[rng.int(V2_NATIONS.length)],
    year: 2026,
    position,
    rating,
  };
}

/** A random v2 side: random formation, random style, random-but-plausible XI. */
function randomSide(id: string, rng: Rng): MatchSide {
  const formation = FORMATIONS[rng.int(FORMATIONS.length)];
  const xi = formation.slots.map((pos, i) => ({
    position: pos,
    player: randomPlayer(`${id}-${i}`, pos, rng),
  }));
  return { id, xi, tactics: { formationId: formation.id, style: V2_STYLES[rng.int(V2_STYLES.length)] } };
}

/**
 * Should be exactly 0: every level regulation match carries a shootout with
 * a definite winner (DECISIONS.md — "no drawn matches exist"), so nothing
 * should ever reach the table undecided. A non-zero rate here means the
 * shootout-only-after-drawn-regulation invariant broke somewhere upstream.
 */
export function postShootoutDrawRate(results: readonly MatchResultV2[]): number {
  const undecided = results.filter((r) => r.homeGoals === r.awayGoals && !r.shootout).length;
  return undecided / results.length;
}

const UPSET_BUCKET_BOUNDS_V2 = [
  { label: '0-5', minGap: 0, maxGap: 5 },
  { label: '5-15', minGap: 5, maxGap: 15 },
  { label: '15+', minGap: 15, maxGap: Infinity },
] as const;

export interface MatchupSample {
  homeStrength: number;
  awayStrength: number;
  result: MatchResultV2;
}

/**
 * Weaker-side win rate by strength-gap bucket, v2 scale. Buckets are
 * rescaled from v1's (which were tuned to v1 teamStrength totals ~850-1030)
 * to v2's `overallStrength` (a per-player rating average, ~60-97): DECISIONS'
 * own tuning anchor is "+10 zonal strength ~= +0.75 xG", so a 10-point gap is
 * already a meaningfully large edge on this scale — 0-5/5-15/15+ brackets
 * "small", "the tuned-example size", and "large" gaps around that anchor.
 */
export function upsetRateByGapV2(samples: readonly MatchupSample[]): UpsetBucket[] {
  const buckets = UPSET_BUCKET_BOUNDS_V2.map((b) => ({ ...b, decisiveMatches: 0, weakerWins: 0 }));
  for (const { homeStrength, awayStrength, result } of samples) {
    if (result.homeGoals === result.awayGoals) continue; // pre-shootout regulation level; excluded like v1
    const gap = Math.abs(homeStrength - awayStrength);
    const bucket = buckets.find((b) => gap >= b.minGap && gap < b.maxGap);
    if (!bucket) continue;
    bucket.decisiveMatches++;
    const weakerWasHome = homeStrength < awayStrength;
    const weakerWon = weakerWasHome ? result.homeGoals > result.awayGoals : result.awayGoals > result.homeGoals;
    if (weakerWon) bucket.weakerWins++;
  }
  return buckets.map((b) => ({
    label: b.label,
    minGap: b.minGap,
    maxGap: b.maxGap,
    decisiveMatches: b.decisiveMatches,
    weakerWinRate: b.decisiveMatches > 0 ? b.weakerWins / b.decisiveMatches : NaN,
  }));
}

export interface MoraleSnowballResult {
  managers: number;
  rounds: number;
  /** Avg. overallStrength (rating scale, morale included) gained from round 1
   *  (no morale yet) to the final simulated round by the top third of
   *  managers, ranked by round-1 BASE strength (pre-morale). */
  topThirdAvgGain: number;
  /** Same, for the bottom third by round-1 base strength. */
  bottomThirdAvgGain: number;
  /** topThirdAvgGain / bottomThirdAvgGain. >1 = rich-get-richer via morale. */
  ratio: number;
  /** Largest single-manager morale-driven strength delta observed in any one
   *  round — the boundedness check. MORALE_CAP=3 per scoring/assisting
   *  player means this should stay small relative to the ~60-97 XI scale,
   *  proving the cap actually contains the snowball rather than just
   *  asserting it does. */
  maxMoraleDeltaObserved: number;
}

/**
 * Real morale-based rich-get-richer measurement (replaces v1's loot-based
 * PROXY now that the actual mechanic exists). A fixed roster of managers
 * plays several rounds of one random match each; each round's goals feed
 * `moraleForManager` into the NEXT round via `MatchSide.morale`, exactly the
 * wiring game-engine specified. This is a QA-only mini round-robin, not the
 * real BR (no elimination/steals) — swap for the real v2 tournament once it
 * exists; the shape (top/bottom-third gain, ratio, max delta) should carry
 * over unchanged.
 */
export function moraleSnowball(seed: number, managerCount = 16, rounds = 6): MoraleSnowballResult {
  if (managerCount % 2 !== 0) throw new Error('managerCount must be even for round-robin pairing');
  const rng = createRng(seed);
  const managers = Array.from({ length: managerCount }, (_, i) => randomSide(`m${i}`, rng));
  const baseStrength = new Map(managers.map((m) => [m.id, overallStrength(m.xi)]));

  const ranked = [...managers].sort((a, b) => baseStrength.get(b.id)! - baseStrength.get(a.id)!);
  const third = Math.max(1, Math.floor(ranked.length / 3));
  const topIds = new Set(ranked.slice(0, third).map((m) => m.id));
  const bottomIds = new Set(ranked.slice(-third).map((m) => m.id));

  let morale = new Map<string, MoraleMap>(managers.map((m) => [m.id, {}]));
  const firstEffective = new Map(managers.map((m) => [m.id, overallStrength(m.xi, morale.get(m.id))]));
  let maxMoraleDelta = 0;

  for (let round = 0; round < rounds; round++) {
    const order = rng.shuffle(managers);
    const roundResults: MatchResultV2[] = [];
    for (let i = 0; i + 1 < order.length; i += 2) {
      const home: MatchSide = { ...order[i], morale: morale.get(order[i].id) };
      const away: MatchSide = { ...order[i + 1], morale: morale.get(order[i + 1].id) };
      roundResults.push(resolveMatch(home, away, seed * 1000 + round * 100 + i));
    }
    const nextMorale = new Map<string, MoraleMap>();
    for (const m of managers) {
      const mm = moraleForManager(roundResults, m.id);
      nextMorale.set(m.id, mm);
      const before = overallStrength(m.xi, morale.get(m.id));
      const after = overallStrength(m.xi, mm);
      maxMoraleDelta = Math.max(maxMoraleDelta, Math.abs(after - before));
    }
    morale = nextMorale;
  }

  const lastEffective = new Map(managers.map((m) => [m.id, overallStrength(m.xi, morale.get(m.id))]));
  const avg = (ids: Set<string>): number => {
    const gains = [...ids].map((id) => lastEffective.get(id)! - firstEffective.get(id)!);
    return gains.reduce((s, x) => s + x, 0) / gains.length;
  };
  const topThirdAvgGain = avg(topIds);
  const bottomThirdAvgGain = avg(bottomIds);
  return {
    managers: managerCount,
    rounds,
    topThirdAvgGain,
    bottomThirdAvgGain,
    ratio: bottomThirdAvgGain !== 0 ? topThirdAvgGain / bottomThirdAvgGain : NaN,
    maxMoraleDeltaObserved: maxMoraleDelta,
  };
}

/**
 * `moraleSnowball` with only ~managerCount/3 managers per third, its ratio is
 * noisy on a single seed (observed swinging with the RNG draw). Average
 * several independent runs for a stable point estimate — this is what the
 * report should actually read, not a single seed.
 */
export function moraleSnowballBatch(
  seeds: readonly number[],
  managerCount = 16,
  rounds = 6,
): MoraleSnowballResult {
  const runs = seeds.map((seed) => moraleSnowball(seed, managerCount, rounds));
  const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const topThirdAvgGain = avg(runs.map((r) => r.topThirdAvgGain));
  const bottomThirdAvgGain = avg(runs.map((r) => r.bottomThirdAvgGain));
  return {
    managers: managerCount,
    rounds,
    topThirdAvgGain,
    bottomThirdAvgGain,
    ratio: bottomThirdAvgGain !== 0 ? topThirdAvgGain / bottomThirdAvgGain : NaN,
    maxMoraleDeltaObserved: Math.max(...runs.map((r) => r.maxMoraleDeltaObserved)),
  };
}

export interface BalanceReportV2 {
  sampleMatches: number;
  goals: GoalsStats;
  preShootoutDrawRate: number;
  postShootoutDrawRate: number;
  cleanSheetRate: number;
  upsets: UpsetBucket[];
  moraleSnowball: MoraleSnowballResult;
}

export function buildBalanceReportV2(
  matchupSeeds: readonly number[],
  moraleSeeds: readonly number[] = [0xba1a, 0xba1b, 0xba1c, 0xba1d, 0xba1e, 0xba1f, 0xba20, 0xba21],
): BalanceReportV2 {
  // Team-generation rng is independent of the per-match outcome seed, same
  // separation-of-concerns engine.v2.test.ts's own harness uses.
  const genRng = createRng(0x11a1e);
  const samples: MatchupSample[] = matchupSeeds.map((seed) => {
    const home = randomSide(`h${seed}`, genRng);
    const away = randomSide(`a${seed}`, genRng);
    const result = resolveMatch(home, away, seed);
    return { homeStrength: overallStrength(home.xi), awayStrength: overallStrength(away.xi), result };
  });
  const results = samples.map((s) => s.result);
  return {
    sampleMatches: results.length,
    goals: goalsStats(results),
    preShootoutDrawRate: drawRate(results),
    postShootoutDrawRate: postShootoutDrawRate(results),
    cleanSheetRate: cleanSheetRate(results),
    upsets: upsetRateByGapV2(samples),
    moraleSnowball: moraleSnowballBatch(moraleSeeds),
  };
}
