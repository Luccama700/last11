import { describe, expect, it } from 'vitest';
import { runTournament, type TournamentLog } from './tournament';
import { resolveMatch, type MatchSide } from './match';
import { FORMATIONS } from './types';
import {
  TARGETS,
  buildBalanceReport,
  buildBalanceReportV2,
  buildEarlyRoundBalanceReportV2,
  cleanSheetRate,
  collectMatches,
  drawRate,
  finalDrawRate,
  goalsStats,
  lootSnowball,
  moraleSnowball,
  moraleSnowballBatch,
  postShootoutDrawRate,
  tacticsMatchupSpreadV2,
  upsetRateByGap,
  upsetRateByGapV2,
  type MatchupSample,
} from './balance.report';
import type { MatchResultV2 } from './types';

// This file runs under Vitest/Node, where `process` is a real global, but the
// app's tsconfig has no `@types/node` (browser-lib project). Declare just
// enough of the shape we use rather than pulling in a new devDependency.
declare const process: { env: Record<string, string | undefined> };

describe('goalsStats', () => {
  it('computes mean/median/max/rates over a tiny synthetic sample', () => {
    const matches = [
      { homeId: 'a', awayId: 'b', homeGoals: 0, awayGoals: 0 },
      { homeId: 'a', awayId: 'b', homeGoals: 2, awayGoals: 1 },
      { homeId: 'a', awayId: 'b', homeGoals: 3, awayGoals: 3 },
      { homeId: 'a', awayId: 'b', homeGoals: 4, awayGoals: 1 },
    ];
    const stats = goalsStats(matches);
    expect(stats.sampleSize).toBe(4);
    expect(stats.mean).toBeCloseTo((0 + 3 + 6 + 5) / 4, 10);
    expect(stats.max).toBe(6);
    expect(stats.scorelessRate).toBeCloseTo(0.25, 10);
  });
});

describe('drawRate', () => {
  it('counts equal-score matches only', () => {
    const matches = [
      { homeId: 'a', awayId: 'b', homeGoals: 1, awayGoals: 1 },
      { homeId: 'a', awayId: 'b', homeGoals: 2, awayGoals: 0 },
    ];
    expect(drawRate(matches)).toBeCloseTo(0.5, 10);
  });
});

describe('cleanSheetRate', () => {
  it('counts one clean sheet per shutout side, not per shutout match', () => {
    // 3-0: home keeps a clean sheet, away doesn't. 0-0: both do.
    const matches = [
      { homeId: 'a', awayId: 'b', homeGoals: 3, awayGoals: 0 },
      { homeId: 'a', awayId: 'b', homeGoals: 0, awayGoals: 0 },
    ];
    // clean sheets: (3-0 home) + (0-0 home) + (0-0 away) = 3, over 4 team-match instances
    expect(cleanSheetRate(matches)).toBeCloseTo(3 / 4, 10);
  });
});

describe('upsetRateByGap', () => {
  it('buckets by round-table strength gap and excludes draws', () => {
    const log: TournamentLog = {
      seed: 1,
      winnerId: 'weak',
      rounds: [
        {
          round: 1,
          table: [
            { managerId: 'strong', points: 3, gf: 2, ga: 0, gd: 2, strength: 950 },
            { managerId: 'weak', points: 0, gf: 0, ga: 2, gd: -2, strength: 900 }, // gap 50
          ],
          matches: [
            { homeId: 'weak', awayId: 'strong', homeGoals: 2, awayGoals: 0 }, // weaker side WINS
          ],
          eliminatedIds: [],
        },
      ],
    };
    const buckets = upsetRateByGap([log]);
    const bigGap = buckets.find((b) => b.label === '25+')!;
    expect(bigGap.decisiveMatches).toBe(1);
    expect(bigGap.weakerWinRate).toBe(1);
    const smallGap = buckets.find((b) => b.label === '0-10')!;
    expect(smallGap.decisiveMatches).toBe(0);
    expect(Number.isNaN(smallGap.weakerWinRate)).toBe(true);
  });

  it('ignores draws entirely', () => {
    const log: TournamentLog = {
      seed: 1,
      winnerId: 'a',
      rounds: [
        {
          round: 1,
          table: [
            { managerId: 'a', points: 1, gf: 1, ga: 1, gd: 0, strength: 900 },
            { managerId: 'b', points: 1, gf: 1, ga: 1, gd: 0, strength: 905 },
          ],
          matches: [{ homeId: 'a', awayId: 'b', homeGoals: 1, awayGoals: 1 }],
          eliminatedIds: [],
        },
      ],
    };
    const buckets = upsetRateByGap([log]);
    expect(buckets.every((b) => b.decisiveMatches === 0)).toBe(true);
  });
});

describe('lootSnowball', () => {
  it('reports zero gain and zero spread when strength never changes round to round', () => {
    const log: TournamentLog = {
      seed: 1,
      winnerId: 'a',
      rounds: [
        {
          round: 1,
          table: [
            { managerId: 'a', points: 3, gf: 1, ga: 0, gd: 1, strength: 950 },
            { managerId: 'b', points: 0, gf: 0, ga: 1, gd: -1, strength: 900 },
          ],
          matches: [],
          eliminatedIds: [],
        },
        {
          round: 2,
          table: [
            { managerId: 'a', points: 3, gf: 1, ga: 0, gd: 1, strength: 950 },
            { managerId: 'b', points: 0, gf: 0, ga: 1, gd: -1, strength: 900 },
          ],
          matches: [],
          eliminatedIds: [],
        },
      ],
    };
    const result = lootSnowball([log]);
    expect(result.topThirdAvgGain).toBe(0);
    expect(result.bottomThirdAvgGain).toBe(0);
    expect(result.maxSpreadObserved).toBe(50);
  });

  it('gives the top-third credit for gains and the bottom-third for their own', () => {
    const log: TournamentLog = {
      seed: 1,
      winnerId: 'a',
      rounds: [
        {
          round: 1,
          table: [
            { managerId: 'a', points: 3, gf: 1, ga: 0, gd: 1, strength: 1000 },
            { managerId: 'b', points: 0, gf: 0, ga: 1, gd: -1, strength: 800 },
          ],
          matches: [],
          eliminatedIds: [],
        },
        {
          round: 2,
          // top gains 30, bottom gains 10 via steals between rounds
          table: [
            { managerId: 'a', points: 3, gf: 1, ga: 0, gd: 1, strength: 1030 },
            { managerId: 'b', points: 0, gf: 0, ga: 1, gd: -1, strength: 810 },
          ],
          matches: [],
          eliminatedIds: [],
        },
      ],
    };
    const result = lootSnowball([log]);
    expect(result.topThirdAvgGain).toBe(30);
    expect(result.bottomThirdAvgGain).toBe(10);
    expect(result.ratio).toBeCloseTo(3, 10);
  });
});

describe('postShootoutDrawRate', () => {
  it('is 0 when every level match carries a shootout', () => {
    const results: MatchResultV2[] = [
      { homeId: 'a', awayId: 'b', homeGoals: 1, awayGoals: 1, goals: [], shootout: { winner: 'home', home: 3, away: 2, kicks: [] } },
      { homeId: 'a', awayId: 'b', homeGoals: 2, awayGoals: 0, goals: [] },
    ];
    expect(postShootoutDrawRate(results)).toBe(0);
  });

  it('flags a level match with no shootout as undecided', () => {
    const results: MatchResultV2[] = [
      { homeId: 'a', awayId: 'b', homeGoals: 1, awayGoals: 1, goals: [] }, // no shootout — a broken invariant
    ];
    expect(postShootoutDrawRate(results)).toBe(1);
  });
});

describe('upsetRateByGapV2', () => {
  it('buckets by supplied strength gap on the v2 (~60-97) scale and excludes level results', () => {
    const samples: MatchupSample[] = [
      {
        homeStrength: 90,
        awayStrength: 88, // gap 2 -> "0-5"
        result: { homeId: 'weak', awayId: 'strong', homeGoals: 0, awayGoals: 0, goals: [] }, // will be excluded (level)
      },
      {
        homeStrength: 70,
        awayStrength: 90, // gap 20 -> "15+", weaker (home) wins
        result: { homeId: 'weak', awayId: 'strong', homeGoals: 2, awayGoals: 1, goals: [] },
      },
    ];
    const buckets = upsetRateByGapV2(samples);
    const small = buckets.find((b) => b.label === '0-5')!;
    expect(small.decisiveMatches).toBe(0); // the level one was excluded
    const big = buckets.find((b) => b.label === '15+')!;
    expect(big.decisiveMatches).toBe(1);
    expect(big.weakerWinRate).toBe(1);
  });
});

describe('moraleSnowball', () => {
  it('runs deterministically and reports a bounded max morale delta', () => {
    const a = moraleSnowball(42, 8, 4);
    const b = moraleSnowball(42, 8, 4);
    expect(a).toEqual(b);
    // MORALE_CAP=3 per player; a single-round delta can only come from goal/
    // assist bumps on THIS manager's own XI, so it should be well under a
    // single star's rating, not comparable to the ~60-97 strength scale.
    expect(a.maxMoraleDeltaObserved).toBeGreaterThanOrEqual(0);
    expect(a.maxMoraleDeltaObserved).toBeLessThan(3);
  });

  it('rejects an odd manager count (round-robin pairing requires even)', () => {
    expect(() => moraleSnowball(1, 7, 2)).toThrow(/even/);
  });
});

describe('moraleSnowballBatch', () => {
  it('averages topThird/bottomThird gain across seeds, deterministically', () => {
    const a = moraleSnowballBatch([1, 2, 3], 8, 4);
    const b = moraleSnowballBatch([1, 2, 3], 8, 4);
    expect(a).toEqual(b);
    expect(a.managers).toBe(8);
    // sanity: the batch average should sit near the per-seed values, not
    // wildly outside their range
    const single = [1, 2, 3].map((s) => moraleSnowball(s, 8, 4));
    const minTop = Math.min(...single.map((r) => r.topThirdAvgGain));
    const maxTop = Math.max(...single.map((r) => r.topThirdAvgGain));
    expect(a.topThirdAvgGain).toBeGreaterThanOrEqual(minTop - 1e-9);
    expect(a.topThirdAvgGain).toBeLessThanOrEqual(maxTop + 1e-9);
  });
});

describe('tacticsMatchupSpreadV2', () => {
  it('is deterministic and covers every catalog formation x 3 styles at equal strength', () => {
    const a = tacticsMatchupSpreadV2(1);
    const b = tacticsMatchupSpreadV2(1);
    expect(a).toEqual(b);
    // Derive from the live catalog so adding a formation doesn't fossilise a count.
    const F = FORMATIONS.length;
    const S = 3;
    const opponents = F * S - 1; // every (formation,style) combo plays every OTHER once
    expect(a.formations).toHaveLength(F);
    expect(a.styles).toHaveLength(S);
    // each formation appears in S combos (one per style) -> S*opponents matches;
    // each style appears in F combos -> F*opponents matches.
    for (const f of a.formations) expect(f.matches).toBe(S * opponents);
    for (const s of a.styles) expect(s.matches).toBe(F * opponents);
    // win rates are real fractions in [0,1], not NaN (every bucket has samples)
    for (const f of a.formations) expect(f.winRate).toBeGreaterThanOrEqual(0);
    for (const f of a.formations) expect(f.winRate).toBeLessThanOrEqual(1);
  });

  it('different seeds can shuffle which matches resolve on penalties but the total stays fixed', () => {
    const a = tacticsMatchupSpreadV2(1);
    const b = tacticsMatchupSpreadV2(2);
    // same round-robin size regardless of seed
    expect(a.formations.reduce((s, f) => s + f.matches, 0)).toBe(
      b.formations.reduce((s, f) => s + f.matches, 0),
    );
  });
});

// Full-batch report: expensive-ish (N tournaments), gated behind BALANCE=1 so
// `npm test` stays fast. Run with `npm run balance`. This is the v1 baseline
// to diff engineV2/dataV2 against as they land (DECISIONS.md, Phase I).
describe.skipIf(!process.env.BALANCE)('balance report (v1 baseline)', () => {
  it('prints the full report against the NEW (DECISIONS.md) targets', () => {
    const N = 200;
    const seeds = Array.from({ length: N }, (_, i) => i);
    const report = buildBalanceReport(seeds);

    console.log('\n=== Last11 balance report — v1 (pre-redesign) baseline ===');
    console.log(`sample: ${report.sampleTournaments} tournaments, ${report.sampleMatches} matches\n`);

    console.table({
      'goals/match': {
        value: report.goals.mean.toFixed(2),
        target: TARGETS.goalsPerMatch,
        note: 'v1 is NOT tuned for the new 3.4 target — expected to miss until engineV2 lands',
      },
      'draw rate (plain)': {
        value: (report.drawRate * 100).toFixed(1) + '%',
        target: `${TARGETS.earlyRoundDrawRate * 100}% early-round (v2) / 0% late-round final (v2)`,
        note: 'v1 has no staged shootout rule — this is v1s FINAL draw rate, not comparable to either v2 regime yet',
      },
      'scoreless rate': { value: (report.goals.scorelessRate * 100).toFixed(1) + '%', target: '-', note: 'informational' },
      '5+ goal rate': { value: (report.goals.fivePlusRate * 100).toFixed(1) + '%', target: '-', note: 'informational' },
      'clean sheet rate': { value: (report.cleanSheetRate * 100).toFixed(1) + '%', target: '-', note: 'informational' },
    });

    console.log('\nupset rate by strength-gap bucket (v1 teamStrength scale — see PLAN-qa.md note on units):');
    console.table(
      report.upsets.map((u) => ({
        bucket: u.label,
        decisiveMatches: u.decisiveMatches,
        weakerWinRate: Number.isNaN(u.weakerWinRate) ? 'n/a (0 samples)' : (u.weakerWinRate * 100).toFixed(1) + '%',
      })),
    );

    console.log('\nloot-snowball (v1 PROXY for morale — see balance.report.ts doc comment):');
    console.table([
      {
        topThirdAvgGain: report.lootSnowball.topThirdAvgGain.toFixed(2),
        bottomThirdAvgGain: report.lootSnowball.bottomThirdAvgGain.toFixed(2),
        ratio: Number.isNaN(report.lootSnowball.ratio) ? 'n/a' : report.lootSnowball.ratio.toFixed(2),
        maxSpreadObserved: report.lootSnowball.maxSpreadObserved.toFixed(1),
      },
    ]);

    console.log('\ntactics matchup spread: ' + (report.tacticsMatchupSpread === null
      ? 'N/A — v1 bots are fixed 4-3-3, no tactics to compare (pending engineV2 varied bot tactics)'
      : JSON.stringify(report.tacticsMatchupSpread)));

    // Sanity assertions only (this is a report, not a gate — see PLAN-qa.md
    // "deliberately NOT a hard CI gate" rationale). These just prove the
    // harness itself isn't broken, not that v1 hits the v2 targets.
    expect(report.sampleMatches).toBeGreaterThan(0);
    expect(report.goals.mean).toBeGreaterThan(0);
    expect(Number.isFinite(report.lootSnowball.maxSpreadObserved)).toBe(true);
  });

  it('is deterministic: same seed batch => identical report', () => {
    const seeds = [10, 20, 30, 40, 50];
    const a = buildBalanceReport(seeds);
    const b = buildBalanceReport(seeds);
    expect(a).toEqual(b);
  });
});

// v2 engine balance report: same BALANCE=1 gate, `npm run balance` prints
// both. This is the first REAL diff against the v1 baseline logged in
// ~/Documents/agent-ops/logs/last11-qa-2026-07-11.md.
describe.skipIf(!process.env.BALANCE)('balance report (v2 engine)', () => {
  it('prints the full v2 report against the DECISIONS.md targets, BOTH staged-shootout regimes', () => {
    const N = 4000; // matches engine.v2.test.ts's own sample size for comparability
    const seeds = Array.from({ length: N }, (_, i) => i);
    const late = buildBalanceReportV2(seeds); // <=16 alive: shootoutEnabled=true
    const early = buildEarlyRoundBalanceReportV2(seeds); // >16 alive: shootoutEnabled=false

    console.log('\n=== Last11 balance report — v2 engine (NIGHT-SHIFT staged shootouts, ce6c5b4) ===');
    console.log(`sample: ${late.sampleMatches} synthetic matchups per regime\n`);

    console.log('--- LATE-ROUND regime (<=16 alive, shootoutEnabled=true, R3-R6) ---');
    console.table({
      'goals/match': { value: late.goals.mean.toFixed(2), target: TARGETS.goalsPerMatch, note: '' },
      'draw rate (pre-shootout, i.e. level-in-regulation)': {
        value: (late.preShootoutDrawRate * 100).toFixed(1) + '%',
        target: `${TARGETS.earlyRoundDrawRate * 100}%`,
        note: 'same "how often is regulation level" stat as the early-round regime — shootoutEnabled only affects what happens AFTER, not the rate of reaching it',
      },
      'draw rate (FINAL)': {
        value: (late.finalDrawRate * 100).toFixed(1) + '%',
        target: `${TARGETS.lateRoundFinalDrawRate * 100}%`,
        note: 'must be exactly 0 — every level match here gets a shootout winner',
      },
      'undecided (bug check)': { value: (late.undecidedRate * 100).toFixed(1) + '%', target: '0%', note: 'must be exactly 0' },
      'scoreless rate': { value: (late.goals.scorelessRate * 100).toFixed(1) + '%', target: '-', note: 'informational' },
      '5+ goal rate': { value: (late.goals.fivePlusRate * 100).toFixed(1) + '%', target: '-', note: 'informational' },
      'clean sheet rate': { value: (late.cleanSheetRate * 100).toFixed(1) + '%', target: '-', note: 'informational' },
    });
    console.log('upset rate by strength-gap bucket (v2 overallStrength scale, ~60-97):');
    console.table(
      late.upsets.map((u) => ({
        bucket: u.label,
        decisiveMatches: u.decisiveMatches,
        weakerWinRate: Number.isNaN(u.weakerWinRate) ? 'n/a (0 samples)' : (u.weakerWinRate * 100).toFixed(1) + '%',
      })),
    );

    console.log('\n--- EARLY-ROUND regime (>16 alive, shootoutEnabled=false, R1-R2) ---');
    console.table({
      'goals/match': { value: early.goals.mean.toFixed(2), target: TARGETS.goalsPerMatch, note: '' },
      'draw rate (FINAL — nothing resolves it further)': {
        value: (early.drawRate * 100).toFixed(1) + '%',
        target: `${TARGETS.earlyRoundDrawRate * 100}%`,
        note: '',
      },
      'undecided (bug check)': { value: (early.undecidedRate * 100).toFixed(1) + '%', target: '0%', note: 'must be exactly 0 — no shootout should EVER fire here' },
      'scoreless rate': { value: (early.goals.scorelessRate * 100).toFixed(1) + '%', target: '-', note: 'informational' },
      '5+ goal rate': { value: (early.goals.fivePlusRate * 100).toFixed(1) + '%', target: '-', note: 'informational' },
      'clean sheet rate': { value: (early.cleanSheetRate * 100).toFixed(1) + '%', target: '-', note: 'informational' },
    });
    console.log('upset rate by strength-gap bucket (v2 overallStrength scale, ~60-97), genuine draws excluded:');
    console.table(
      early.upsets.map((u) => ({
        bucket: u.label,
        decisiveMatches: u.decisiveMatches,
        weakerWinRate: Number.isNaN(u.weakerWinRate) ? 'n/a (0 samples)' : (u.weakerWinRate * 100).toFixed(1) + '%',
      })),
    );

    console.log('\nmorale snowball (real mechanic, not a proxy — late-round regime only):');
    console.table([
      {
        managers: late.moraleSnowball.managers,
        rounds: late.moraleSnowball.rounds,
        topThirdAvgGain: late.moraleSnowball.topThirdAvgGain.toFixed(3),
        bottomThirdAvgGain: late.moraleSnowball.bottomThirdAvgGain.toFixed(3),
        ratio: Number.isNaN(late.moraleSnowball.ratio) ? 'n/a' : late.moraleSnowball.ratio.toFixed(2),
        maxMoraleDeltaObserved: late.moraleSnowball.maxMoraleDeltaObserved.toFixed(3),
      },
    ]);

    console.log('\ntactics spread — equal-strength round robin, 8 formations x 3 styles (late-round regime):');
    console.table(
      late.tacticsSpread.formations.map((f) => ({
        formation: f.formationId,
        matches: f.matches,
        winRate: (f.winRate * 100).toFixed(1) + '%',
      })),
    );
    console.table(
      late.tacticsSpread.styles.map((s) => ({
        style: s.style,
        matches: s.matches,
        winRate: (s.winRate * 100).toFixed(1) + '%',
      })),
    );
    if (late.tacticsSpread.outliers.length > 0) {
      console.log(`outliers (win rate outside 35-65% at equal strength): ${late.tacticsSpread.outliers.join(', ')}`);
    }

    // Same posture as the v1 report: this is a human-read report, not a hard
    // gate (game-engine's engine.v2.test.ts already owns the hard band
    // assertions on goals/draws/stronger-win-rate). Sanity-only here.
    expect(late.sampleMatches).toBe(N);
    expect(late.undecidedRate).toBe(0);
    expect(late.finalDrawRate).toBe(0);
    expect(early.undecidedRate).toBe(0);
  });

  it('is deterministic: same seed batch => identical report, both regimes', () => {
    const seeds = [10, 20, 30, 40, 50];
    expect(buildBalanceReportV2(seeds)).toEqual(buildBalanceReportV2(seeds));
    expect(buildEarlyRoundBalanceReportV2(seeds)).toEqual(buildEarlyRoundBalanceReportV2(seeds));
  });
});

// Cheap, always-on smoke test that buildBalanceReport works end-to-end on a
// handful of real tournaments (not the full N=200 batch) — catches breakage
// in `npm test` without paying the BALANCE=1 cost.
describe('buildBalanceReport smoke test', () => {
  it('runs against a small seed batch without throwing', () => {
    const report = buildBalanceReport([1, 2, 3]);
    expect(report.sampleTournaments).toBe(3);
    expect(report.sampleMatches).toBeGreaterThan(0);
    expect(report.goals.sampleSize).toBe(report.sampleMatches);
  });

  it('collectMatches + runTournament agree on total match count', () => {
    const logs = [1, 2].map((seed) => runTournament(seed).log);
    const matches = collectMatches(logs);
    const expected = logs.reduce(
      (sum, log) => sum + log.rounds.reduce((s, r) => s + r.matches.length, 0),
      0,
    );
    expect(matches.length).toBe(expected);
  });
});

describe('buildBalanceReportV2 smoke test', () => {
  it('runs against a small seed batch without throwing (late-round regime)', () => {
    const report = buildBalanceReportV2([1, 2, 3, 4, 5, 6]);
    expect(report.sampleMatches).toBe(6);
    expect(report.goals.sampleSize).toBe(6);
    expect(report.undecidedRate).toBe(0);
    expect(report.finalDrawRate).toBe(0);
    expect(report.moraleSnowball.managers).toBe(16); // default roster size
  });
});

describe('buildEarlyRoundBalanceReportV2 smoke test', () => {
  it('runs against a small seed batch without throwing (early-round regime)', () => {
    const report = buildEarlyRoundBalanceReportV2([1, 2, 3, 4, 5, 6]);
    expect(report.sampleMatches).toBe(6);
    expect(report.goals.sampleSize).toBe(6);
    expect(report.undecidedRate).toBe(0); // no shootout should ever fire
  });

  it('never produces a shootout — shootoutEnabled=false is honored, checked directly on the raw results (undecidedRate would not catch a stray shootout, only a MISSING one)', () => {
    const formation = FORMATIONS.find((f) => f.id === '4-3-3')!;
    const flatSide = (id: string): MatchSide => ({
      id,
      xi: formation.slots.map((pos, i) => ({
        position: pos,
        player: { id: `${id}-${i}`, name: `${id}-${i}`, nation: 'BRA', year: 2026, position: pos, rating: 80 },
      })),
      tactics: { formationId: formation.id, style: 'balanced' },
    });
    const home = flatSide('h');
    const away = flatSide('a');
    let sawLevel = false;
    for (let seed = 0; seed < 300; seed++) {
      const r = resolveMatch(home, away, seed, false);
      if (r.homeGoals === r.awayGoals) sawLevel = true;
      expect(r.shootout).toBeUndefined();
    }
    expect(sawLevel).toBe(true); // proves the sample actually exercised level scores
  });
});

describe('finalDrawRate', () => {
  it('counts genuine draws (matchVerdict decidedBy===draw), not raw level scores', () => {
    const decisive: MatchResultV2 = { homeId: 'a', awayId: 'b', homeGoals: 2, awayGoals: 0, goals: [] };
    const genuineDraw: MatchResultV2 = { homeId: 'a', awayId: 'b', homeGoals: 1, awayGoals: 1, goals: [] }; // no shootout
    const pensDecided: MatchResultV2 = {
      homeId: 'a', awayId: 'b', homeGoals: 1, awayGoals: 1, goals: [],
      shootout: { winner: 'away', home: 3, away: 4, kicks: [] },
    };
    expect(finalDrawRate([decisive, genuineDraw, pensDecided])).toBeCloseTo(1 / 3, 10);
  });
});
