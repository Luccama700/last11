import { runTournament, type MatchResult, type TournamentLog } from './tournament';
import { matchVerdict, resolveMatch, type MatchSide } from './match';
import { overallStrength } from './rating';
import { moraleForManager, type MoraleMap } from './morale';
import { FORMATIONS, type MatchResultV2, type PlayingStyle } from './types';
import { createRng, type Rng } from './rng';
import type { PlayerV2, Position } from './data/schema';

/**
 * Real-football-inspired targets, revised by Lucca (DECISIONS.md, 2026-07-11
 * morning) and RESTATED for the NIGHT-SHIFT staged-shootout rule (`ce6c5b4`,
 * same night): shootouts only run when a round starts with ≤16 alive
 * (`SHOOTOUT_ALIVE_MAX`/`shootoutEnabledForRound`, tournament.ts). Rounds
 * that start with MORE than 16 alive (32, 24 — R1/R2 of the BR) keep classic
 * draws; rounds with 16 or fewer alive (R3-R6) never end level. Draw-rate
 * targets are therefore regime-specific, not a single number:
 *
 * - `earlyRoundDrawRate` — the >16-alive regime (shootoutEnabled=false).
 *   This IS the final draw rate there too (nothing resolves it further).
 * - `lateRoundFinalDrawRate` — the ≤16-alive regime (shootoutEnabled=true).
 *   Must be exactly 0 — every level match there gets a shootout winner.
 *
 * `goalsPerMatch` is unaffected by the staged rule (shootouts don't add
 * regulation goals) and stays a single target across both regimes.
 */
export const TARGETS = {
  goalsPerMatch: 3.4,
  /** >16-alive rounds (shootoutEnabled=false): the real, final draw rate. */
  earlyRoundDrawRate: 0.15,
  /** ≤16-alive rounds (shootoutEnabled=true): must be exactly 0. */
  lateRoundFinalDrawRate: 0,
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
 * "Undecided" = a match where a shootout was SUPPOSED to run (shootoutEnabled)
 * and a level regulation score didn't get one — a genuine engine bug, since
 * `resolveMatchOutcome` should always draw the shootout in that case. Should
 * be exactly 0, always, in both regimes.
 *
 * NIGHT-SHIFT rule (`ce6c5b4`): a level match where `shootoutEnabled` is
 * false (>16-alive rounds) is a LEGITIMATE draw, not undecided — do NOT flag
 * it. `MatchResultV2.shootoutEnabled` is stamped per-match by the real
 * tournament (`playRound`); this harness's own `resolveMatch(...)` calls
 * don't explicitly set it either, so `?? true` mirrors `resolveMatch`'s own
 * default (shootoutEnabled=true) rather than silently miscounting them.
 */
export function postShootoutDrawRate(results: readonly MatchResultV2[]): number {
  const undecided = results.filter(
    (r) => r.homeGoals === r.awayGoals && !r.shootout && (r.shootoutEnabled ?? true),
  ).length;
  return undecided / results.length;
}

/**
 * The REAL, final draw rate — matches whose canonical verdict
 * (`matchVerdict`) is a genuine draw. Under `shootoutEnabled=true` this
 * should be exactly 0 (same invariant as `postShootoutDrawRate`, restated
 * positively); under `shootoutEnabled=false` (early rounds) this IS the
 * meaningful draw-rate metric — nothing resolves those draws further.
 */
export function finalDrawRate(results: readonly MatchResultV2[]): number {
  const draws = results.filter((r) => matchVerdict(r).decidedBy === 'draw').length;
  return draws / results.length;
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
 *
 * Uses `matchVerdict` (NIGHT-SHIFT fix, `ce6c5b4`) rather than comparing raw
 * goals — the raw-goals check used to `continue` (exclude) EVERY level
 * result, including shootout-decided ones, which silently dropped every
 * shootout winner from upset stats (a real undercount, not just a style
 * nit — in ≤16-alive rounds many matches go level then resolve on pens).
 * Only a GENUINE draw (`decidedBy === 'draw'`, possible in >16-alive rounds
 * under the staged rule) is excluded now — it doesn't resolve an upset
 * either way; a shootout winner is a real decisive result and counts.
 */
export function upsetRateByGapV2(samples: readonly MatchupSample[]): UpsetBucket[] {
  const buckets = UPSET_BUCKET_BOUNDS_V2.map((b) => ({ ...b, decisiveMatches: 0, weakerWins: 0 }));
  for (const { homeStrength, awayStrength, result } of samples) {
    const v = matchVerdict(result);
    if (v.decidedBy === 'draw') continue; // genuine draw — excluded, same as before
    const gap = Math.abs(homeStrength - awayStrength);
    const bucket = buckets.find((b) => gap >= b.minGap && gap < b.maxGap);
    if (!bucket) continue;
    bucket.decisiveMatches++;
    const weakerWasHome = homeStrength < awayStrength;
    const weakerWon = weakerWasHome ? v.winner === 'home' : v.winner === 'away';
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

export interface TacticsFormationStat {
  formationId: string;
  matches: number;
  wins: number;
  winRate: number;
}

export interface TacticsStyleStat {
  style: PlayingStyle;
  matches: number;
  wins: number;
  winRate: number;
}

export interface TacticsSpreadResult {
  formations: TacticsFormationStat[];
  styles: TacticsStyleStat[];
  /** Formation/style labels whose win rate falls outside [0.35, 0.65] against
   *  the full round-robin field AT EQUAL PLAYER STRENGTH — a signal that one
   *  tactic choice dominates or under-performs regardless of talent (see
   *  PLAN-qa.md Job 1 metric 5: "does 4-2-3-1 dominate everything?"). */
  outliers: string[];
}

const OUTLIER_LOW = 0.35;
const OUTLIER_HIGH = 0.65;

function flatPlayer(id: string, position: Position, rating: number, nation: string): PlayerV2 {
  return { id, name: `${position}-${id}`, nation, year: 2026, position, rating };
}

/**
 * Now unblocked: bots draft varied formations/styles (draft-page's
 * `draftBotSlateV2` + `pickBotFormation`/`pickBotStyle`), so there's a real
 * matchup space. Every (formation, style) combo plays every OTHER combo once
 * — a round-robin, not random pairings — on IDENTICAL flat-rated XIs (80
 * across the board) so only tactics differ, isolating the tactics effect
 * from talent the way random matchups (like `upsetRateByGapV2`'s samples)
 * can't. 8 formations x 3 styles = 24 combos, C(24,2) = 276 matches — cheap.
 */
export function tacticsMatchupSpreadV2(seed = 0x7ac71c5): TacticsSpreadResult {
  const combos = FORMATIONS.flatMap((formation) =>
    (['defensive', 'balanced', 'attacking'] as const).map((style) => ({ formation, style })),
  );
  const sideFor = (combo: (typeof combos)[number], tag: string): MatchSide => ({
    id: tag,
    xi: combo.formation.slots.map((pos, i) => ({
      position: pos,
      player: flatPlayer(`${tag}-${i}`, pos, 80, 'BRA'),
    })),
    tactics: { formationId: combo.formation.id, style: combo.style },
  });

  const formationStats = new Map<string, { matches: number; wins: number }>();
  const styleStats = new Map<PlayingStyle, { matches: number; wins: number }>();
  const bump = <K,>(map: Map<K, { matches: number; wins: number }>, key: K, won: boolean) => {
    const s = map.get(key) ?? { matches: 0, wins: 0 };
    s.matches++;
    if (won) s.wins++;
    map.set(key, s);
  };

  let matchIndex = 0;
  for (let i = 0; i < combos.length; i++) {
    for (let j = i + 1; j < combos.length; j++) {
      const home = sideFor(combos[i], `t${i}`);
      const away = sideFor(combos[j], `t${j}`);
      const r = resolveMatch(home, away, seed + matchIndex++);
      // No draws exist under engineV2 (shootout resolves every level match).
      const homeWon = r.shootout ? r.shootout.winner === 'home' : r.homeGoals > r.awayGoals;
      bump(formationStats, combos[i].formation.id, homeWon);
      bump(formationStats, combos[j].formation.id, !homeWon);
      bump(styleStats, combos[i].style, homeWon);
      bump(styleStats, combos[j].style, !homeWon);
    }
  }

  const formations: TacticsFormationStat[] = FORMATIONS.map((f) => {
    const s = formationStats.get(f.id)!;
    return { formationId: f.id, matches: s.matches, wins: s.wins, winRate: s.wins / s.matches };
  });
  const styles: TacticsStyleStat[] = (['defensive', 'balanced', 'attacking'] as const).map((style) => {
    const s = styleStats.get(style)!;
    return { style, matches: s.matches, wins: s.wins, winRate: s.wins / s.matches };
  });
  const outliers = [
    ...formations.filter((f) => f.winRate < OUTLIER_LOW || f.winRate > OUTLIER_HIGH).map((f) => f.formationId),
    ...styles.filter((s) => s.winRate < OUTLIER_LOW || s.winRate > OUTLIER_HIGH).map((s) => s.style),
  ];
  return { formations, styles, outliers };
}

/**
 * Sample N random matchups at a FIXED shootout regime — the shared batch
 * generator for both the late-round (shootoutEnabled=true) and early-round
 * (shootoutEnabled=false) reports. Stamps `shootoutEnabled` on each result,
 * mirroring what `playRound` itself does in the real tournament — this
 * harness's `resolveMatch(...)` calls don't set it automatically, and
 * `postShootoutDrawRate`/`finalDrawRate` both key off that field.
 */
function sampleMatchups(seeds: readonly number[], shootoutEnabled: boolean): MatchupSample[] {
  // Team-generation rng is independent of the per-match outcome seed, same
  // separation-of-concerns engine.v2.test.ts's own harness uses.
  const genRng = createRng(0x11a1e);
  return seeds.map((seed) => {
    const home = randomSide(`h${seed}`, genRng);
    const away = randomSide(`a${seed}`, genRng);
    const result = resolveMatch(home, away, seed, shootoutEnabled);
    result.shootoutEnabled = shootoutEnabled;
    return { homeStrength: overallStrength(home.xi), awayStrength: overallStrength(away.xi), result };
  });
}

/** The ≤16-alive, shootoutEnabled=true regime — shootouts fire, final draws must be 0. */
export interface BalanceReportV2 {
  sampleMatches: number;
  goals: GoalsStats;
  preShootoutDrawRate: number;
  /** Bug detector (was named `postShootoutDrawRate`): must always be 0 — a
   *  level match with shootoutEnabled that got no shootout. */
  undecidedRate: number;
  /** The real final draw rate. Must be 0 in THIS regime (shootoutEnabled=true). */
  finalDrawRate: number;
  cleanSheetRate: number;
  upsets: UpsetBucket[];
  moraleSnowball: MoraleSnowballResult;
  tacticsSpread: TacticsSpreadResult;
}

export function buildBalanceReportV2(
  matchupSeeds: readonly number[],
  moraleSeeds: readonly number[] = [0xba1a, 0xba1b, 0xba1c, 0xba1d, 0xba1e, 0xba1f, 0xba20, 0xba21],
): BalanceReportV2 {
  const samples = sampleMatchups(matchupSeeds, true);
  const results = samples.map((s) => s.result);
  return {
    sampleMatches: results.length,
    goals: goalsStats(results),
    preShootoutDrawRate: drawRate(results),
    undecidedRate: postShootoutDrawRate(results),
    finalDrawRate: finalDrawRate(results),
    cleanSheetRate: cleanSheetRate(results),
    upsets: upsetRateByGapV2(samples),
    moraleSnowball: moraleSnowballBatch(moraleSeeds),
    tacticsSpread: tacticsMatchupSpreadV2(),
  };
}

/** The >16-alive, shootoutEnabled=false regime — real draws stand; nothing
 *  resolves them further, so `drawRate` here IS the final draw rate. */
export interface EarlyRoundBalanceReportV2 {
  sampleMatches: number;
  goals: GoalsStats;
  drawRate: number;
  /** Sanity: must be 0 — with shootoutEnabled=false no shootout should EVER
   *  fire, so there's nothing to be "undecided" about; a non-zero value here
   *  means `resolveMatchOutcome` ignored the flag somewhere. */
  undecidedRate: number;
  cleanSheetRate: number;
  upsets: UpsetBucket[];
}

export function buildEarlyRoundBalanceReportV2(matchupSeeds: readonly number[]): EarlyRoundBalanceReportV2 {
  const samples = sampleMatchups(matchupSeeds, false);
  const results = samples.map((s) => s.result);
  return {
    sampleMatches: results.length,
    goals: goalsStats(results),
    drawRate: drawRate(results),
    undecidedRate: postShootoutDrawRate(results),
    cleanSheetRate: cleanSheetRate(results),
    upsets: upsetRateByGapV2(samples),
  };
}
