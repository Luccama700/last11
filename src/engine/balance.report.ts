import { runTournament, type MatchResult, type TournamentLog } from './tournament';

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
