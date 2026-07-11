import { describe, expect, it } from 'vitest';
import { runTournament, type TournamentLog } from './tournament';
import {
  TARGETS,
  buildBalanceReport,
  cleanSheetRate,
  collectMatches,
  drawRate,
  goalsStats,
  lootSnowball,
  upsetRateByGap,
} from './balance.report';

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
        target: `${TARGETS.preShootoutDrawRate * 100}% pre-shootout (v2) / 0% final (v2)`,
        note: 'v1 has no shootout — this is v1s FINAL draw rate, not comparable to either v2 band yet',
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
